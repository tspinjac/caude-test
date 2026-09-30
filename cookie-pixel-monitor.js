/*
 * Cookie & Pixel Monitor — Chrome DevTools snippet
 *
 * How to use:
 *   1. DevTools (F12) -> Sources -> Snippets -> "+ New snippet"
 *   2. Paste this whole file, save (Ctrl+S)
 *   3. Open any page, right-click the snippet -> Run (or Ctrl+Enter)
 *
 * A panel appears in the bottom-right corner and keeps updating while you use
 * the page. Run the snippet again to re-open the panel if you closed it.
 * Console API: __cpm.report(), __cpm.export(), __cpm.stop()
 *
 * Limits: a snippet only lives until the page navigates/reloads, so re-run it
 * after navigation. HttpOnly cookies are invisible to page JavaScript.
 */
(() => {
  'use strict';

  if (window.__cpm) {
    window.__cpm.show();
    console.log('%c[CPM] already running — panel re-opened', 'color:#0a7');
    return;
  }

  // ---------------------------------------------------------------- rules --

  // Known tracker/pixel endpoints, matched against "host + path".
  const VENDORS = [
    [/facebook\.com\/tr|connect\.facebook\.net/, 'Meta Pixel'],
    [/google-analytics\.com|analytics\.google\.com|\/g\/collect/, 'Google Analytics'],
    [/googletagmanager\.com/, 'Google Tag Manager'],
    [/doubleclick\.net|googleadservices\.com|googlesyndication\.com|google\.[a-z.]+\/(pagead|ads)\//, 'Google Ads'],
    [/analytics\.tiktok\.com/, 'TikTok Pixel'],
    [/bat\.bing\.com/, 'Microsoft Ads (UET)'],
    [/clarity\.ms/, 'Microsoft Clarity'],
    [/px\.ads\.linkedin\.com|snap\.licdn\.com/, 'LinkedIn Insight'],
    [/ct\.pinterest\.com|s\.pinimg\.com\/ct/, 'Pinterest Tag'],
    [/tr\.snapchat\.com|sc-static\.net/, 'Snap Pixel'],
    [/analytics\.twitter\.com|t\.co\/i\/adsct|static\.ads-twitter\.com|ads-api\.x\.com/, 'X/Twitter Pixel'],
    [/reddit\.com\/rp\.gif|alb\.reddit\.com|redditstatic\.com\/ads/, 'Reddit Pixel'],
    [/hotjar\.(com|io)/, 'Hotjar'],
    [/segment\.(com|io)/, 'Segment'],
    [/mixpanel\.com/, 'Mixpanel'],
    [/amplitude\.com/, 'Amplitude'],
    [/heapanalytics\.com/, 'Heap'],
    [/fullstory\.com/, 'FullStory'],
    [/hs-analytics\.net|hs-scripts\.com|track\.hubspot\.com/, 'HubSpot'],
    [/criteo\.(com|net)/, 'Criteo'],
    [/taboola\.com/, 'Taboola'],
    [/outbrain\.com/, 'Outbrain'],
    [/adnxs\.com/, 'Xandr'],
    [/adsrvr\.org/, 'The Trade Desk'],
    [/demdex\.net|omtrdc\.net|everesttech\.net/, 'Adobe'],
    [/scorecardresearch\.com/, 'Comscore'],
    [/quantserve\.com|quantcount\.com/, 'Quantcast'],
    [/mc\.yandex\.(ru|com)/, 'Yandex Metrica'],
    [/rubiconproject\.com|pubmatic\.com|casalemedia\.com|openx\.net|rlcdn\.com|bluekai\.com|amazon-adsystem\.com/, 'Ad exchange'],
    [/matomo|piwik/, 'Matomo'],
  ];

  // Generic "looks like a pixel/beacon" URL shapes for unknown third parties.
  const PIXEL_PATH = /(pixel|beacon|collect|track(ing)?|\/tr\/?$|\/tr\?|\/p\.gif|1x1|spacer|impression|adsct|\/log(ging)?\b|\/event)/i;

  // Known tracking cookie names.
  const COOKIE_VENDORS = [
    [/^_ga($|_)|^_gid$|^_gat|^__utm/, 'Google Analytics'],
    [/^_gcl_|^_gac_/, 'Google Ads'],
    [/^(IDE|DSID|test_cookie|__gads|__gpi)$/, 'Google Ads'],
    [/^_fbp$|^_fbc$|^fr$/, 'Meta'],
    [/^_tt_|^_ttp$|^ttclid$/, 'TikTok'],
    [/^_uet(sid|vid)$|^MUID$/, 'Microsoft Ads'],
    [/^_clck$|^_clsk$|^CLID$/, 'Microsoft Clarity'],
    [/^_hj/, 'Hotjar'],
    [/^li_|^lidc$|^bcookie$|^UserMatchHistory$|^AnalyticsSyncHistory$/, 'LinkedIn'],
    [/^_pin_unauth$|^_pinterest_/, 'Pinterest'],
    [/^_scid|^_sctr$/, 'Snap'],
    [/^_rdt_uuid$/, 'Reddit'],
    [/^_twclid$|^muc_ads$/, 'X/Twitter'],
    [/^ajs_/, 'Segment'],
    [/^mp_/, 'Mixpanel'],
    [/^amp_|^AMP_/, 'Amplitude'],
    [/^_hp2_/, 'Heap'],
    [/^fs_uid$/, 'FullStory'],
    [/^hubspotutk$|^__hs/, 'HubSpot'],
    [/^cto_/, 'Criteo'],
    [/^_pk_|^MATOMO/, 'Matomo'],
    [/^_ym_|^yandexuid$/, 'Yandex'],
    [/^(OptanonConsent|OptanonAlertBoxClosed|CookieConsent|euconsent(-v2)?|__cmpcc|didomi_token)$/, 'Consent manager'],
  ];

  // Query params worth surfacing (event name, pixel id, hit type...).
  const KEY_PARAMS = ['ev', 'en', 'event', 'event_name', 'e', 't', 'tid', 'id', 'pid', 'ec', 'ea', 'dl'];

  // ---------------------------------------------------------------- state --

  const state = {
    startedAt: new Date(),
    page: location.href,
    pixels: new Map(),   // url -> pixel record
    cookies: new Map(),  // name -> cookie record
    log: [],             // chronological events
  };
  const awaitingNetwork = new Set(); // urls seen via hooks/DOM, awaiting their resource-timing entry
  const cleanups = [];

  const now = () => new Date().toLocaleTimeString();
  const vendorOf = (list, s) => (list.find(([re]) => re.test(s)) || [])[1] || null;

  function baseDomain(host) {
    const p = host.split('.');
    if (p.length <= 2) return host;
    const twoLevelTld = p[p.length - 1].length === 2 && p[p.length - 2].length <= 3; // co.uk, com.au
    return p.slice(twoLevelTld ? -3 : -2).join('.');
  }
  const PAGE_SITE = baseDomain(location.hostname);

  function addLog(kind, text, data) {
    state.log.push({ time: now(), kind, text, data });
    if (state.log.length > 2000) state.log.shift();
    scheduleRender();
  }

  // --------------------------------------------------------------- pixels --

  function bodyInfo(body) {
    if (body == null) return { size: 0, preview: '' };
    if (typeof body === 'string') return { size: body.length, preview: body.slice(0, 1000) };
    if (body instanceof URLSearchParams) { const s = body.toString(); return { size: s.length, preview: s.slice(0, 1000) }; }
    if (body instanceof Blob) return { size: body.size, preview: `[Blob ${body.type}]` };
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { size: body.byteLength, preview: '[binary]' };
    if (body instanceof FormData) return { size: null, preview: [...body.keys()].join(', ') };
    return { size: null, preview: String(body).slice(0, 200) };
  }

  /**
   * Decide whether a request is a tracker/pixel and record it.
   * @param {string} rawUrl
   * @param {string} type    img | beacon | fetch | xhr | script | iframe | dom-img ...
   * @param {object} extra   { method, body, fromHook, reason }
   */
  function consider(rawUrl, type, extra = {}) {
    let url;
    try { url = new URL(rawUrl, location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;

    const hostPath = url.host + url.pathname;
    const vendor = vendorOf(VENDORS, hostPath);
    const thirdParty = baseDomain(url.hostname) !== PAGE_SITE;
    const generic = thirdParty && PIXEL_PATH.test(url.pathname + url.search);
    if (!vendor && !generic && !extra.reason) return;

    const key = url.href;
    const existing = state.pixels.get(key);

    // A hooked/DOM-found request later shows up again as a resource-timing entry: merge, don't double count.
    const fromNetwork = !extra.fromHook && !extra.reason;
    if (fromNetwork && awaitingNetwork.has(key)) {
      awaitingNetwork.delete(key);
      if (existing) { existing.size = extra.size ?? existing.size; scheduleRender(); }
      return;
    }
    // DOM scans re-find the same element's request; that's not a new hit.
    if (existing && extra.reason) return;
    if (!fromNetwork) awaitingNetwork.add(key);

    if (existing) {
      existing.count++;
      existing.last = now();
      scheduleRender();
      return;
    }

    const params = Object.fromEntries(url.searchParams);
    const keyParams = KEY_PARAMS.filter((k) => k in params).map((k) => `${k}=${params[k]}`).join(' ');
    const { size, preview } = bodyInfo(extra.body);
    const rec = {
      first: now(),
      last: now(),
      count: 1,
      vendor: vendor || (extra.reason ? 'Hidden element' : 'Unknown tracker'),
      type,
      method: extra.method || (type === 'beacon' ? 'POST' : 'GET'),
      host: url.host,
      path: url.pathname,
      thirdParty,
      keyParams,
      params,
      bodySize: size,
      bodyPreview: preview,
      reason: extra.reason || (vendor ? 'known vendor' : 'pixel-like URL'),
      url: url.href,
    };
    state.pixels.set(key, rec);
    addLog('pixel', `${rec.vendor} · ${type} · ${url.host}${url.pathname}${keyParams ? ' · ' + keyParams : ''}`, rec);
  }

  // Everything the page loaded, including what happened before the snippet ran.
  function watchResources() {
    try { performance.setResourceTimingBufferSize(5000); } catch {}
    const typeMap = { img: 'img', beacon: 'beacon', xmlhttprequest: 'xhr', fetch: 'fetch', script: 'script', iframe: 'iframe', link: 'link', ping: 'ping', other: 'other' };
    const handle = (e) => consider(e.name, typeMap[e.initiatorType] || e.initiatorType, { size: e.transferSize });
    const po = new PerformanceObserver((list) => list.getEntries().forEach(handle));
    po.observe({ type: 'resource', buffered: true });
    cleanups.push(() => po.disconnect());
  }

  // Hooks give us method + payload, which resource timing does not.
  function installHooks() {
    const origBeacon = navigator.sendBeacon;
    if (origBeacon) {
      navigator.sendBeacon = function (url, data) {
        consider(url, 'beacon', { method: 'POST', body: data, fromHook: true });
        return origBeacon.apply(this, arguments);
      };
      cleanups.push(() => { navigator.sendBeacon = origBeacon; });
    }

    const origFetch = window.fetch;
    window.fetch = function (input, init = {}) {
      try {
        const url = input instanceof Request ? input.url : String(input);
        const method = (init.method || (input instanceof Request && input.method) || 'GET').toUpperCase();
        consider(url, 'fetch', { method, body: init.body, fromHook: true });
      } catch {}
      return origFetch.apply(this, arguments);
    };
    cleanups.push(() => { window.fetch = origFetch; });

    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (method, url) {
      this.__cpm = { method: String(method).toUpperCase(), url: String(url) };
      return origOpen.apply(this, arguments);
    };
    XHR.send = function (body) {
      try { if (this.__cpm) consider(this.__cpm.url, 'xhr', { method: this.__cpm.method, body, fromHook: true }); } catch {}
      return origSend.apply(this, arguments);
    };
    cleanups.push(() => { XHR.open = origOpen; XHR.send = origSend; });
  }

  // Invisible 1x1 images / hidden iframes in the DOM (catches first-party pixels too).
  function isHidden(el) {
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
  }
  function checkImg(img) {
    if (!img.src || img.src.startsWith('data:')) return;
    const tiny = (img.complete && img.naturalWidth <= 1 && img.naturalHeight <= 1 && img.naturalWidth + img.naturalHeight > 0) ||
      img.getAttribute('width') === '1' || img.getAttribute('height') === '1' ||
      img.getAttribute('width') === '0' || img.getAttribute('height') === '0';
    if (tiny || (img.isConnected && isHidden(img))) consider(img.src, 'dom-img', { reason: tiny ? '1x1 image' : 'hidden image' });
    else if (!img.complete) img.addEventListener('load', () => checkImg(img), { once: true });
  }
  function checkIframe(fr) {
    if (!fr.src || fr.src === 'about:blank') return;
    const r = fr.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || isHidden(fr)) consider(fr.src, 'dom-iframe', { reason: 'hidden iframe' });
  }
  function scanNode(node) {
    if (node.nodeType !== 1 || node === host) return;
    if (node.tagName === 'IMG') checkImg(node);
    else if (node.tagName === 'IFRAME') checkIframe(node);
    node.querySelectorAll?.('img, iframe').forEach(scanNode);
  }
  function watchDom() {
    scanNode(document.documentElement);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') scanNode(m.target);
        else m.addedNodes.forEach(scanNode);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    cleanups.push(() => mo.disconnect());
  }

  // -------------------------------------------------------------- cookies --

  async function readCookies() {
    if (window.cookieStore) {
      try {
        const list = await cookieStore.getAll();
        return list.map((c) => ({
          name: c.name, value: c.value, domain: c.domain || location.hostname, path: c.path,
          expires: c.expires ? new Date(c.expires).toLocaleString() : 'session',
          secure: c.secure, sameSite: c.sameSite, partitioned: c.partitioned,
        }));
      } catch {}
    }
    return document.cookie.split(/;\s*/).filter(Boolean).map((pair) => {
      const i = pair.indexOf('=');
      return { name: i < 0 ? pair : pair.slice(0, i), value: i < 0 ? '' : pair.slice(i + 1), domain: location.hostname, expires: '?' };
    });
  }

  let firstSync = true;
  async function syncCookies() {
    const list = await readCookies();
    const seen = new Set();
    for (const c of list) {
      seen.add(c.name);
      const prev = state.cookies.get(c.name);
      const vendor = vendorOf(COOKIE_VENDORS, c.name);
      if (!prev) {
        state.cookies.set(c.name, { ...c, vendor, firstSeen: now(), changes: 0 });
        addLog(firstSync ? 'cookie' : 'cookie+', `${firstSync ? 'present' : 'SET'}: ${c.name}${vendor ? ' [' + vendor + ']' : ''}`, c);
      } else if (prev.value !== c.value) {
        Object.assign(prev, c, { changes: prev.changes + 1 });
        addLog('cookie~', `CHANGED: ${c.name}${vendor ? ' [' + vendor + ']' : ''}`, c);
      }
    }
    for (const name of [...state.cookies.keys()]) {
      if (!seen.has(name)) {
        state.cookies.delete(name);
        addLog('cookie-', `DELETED: ${name}`);
      }
    }
    firstSync = false;
  }

  function watchCookies() {
    syncCookies();
    if (window.cookieStore) {
      const onChange = () => syncCookies();
      cookieStore.addEventListener('change', onChange);
      cleanups.push(() => cookieStore.removeEventListener('change', onChange));
    }
    const t = setInterval(syncCookies, 2000); // safety net for missed events
    cleanups.push(() => clearInterval(t));
  }

  // ------------------------------------------------------------------- UI --
  // Built with DOM APIs (no innerHTML) so it works on Trusted Types pages,
  // inside a shadow root so page CSS can't break it.

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  const CSS = `
    :host { all: initial; }
    .box { position: fixed; right: 12px; bottom: 12px; width: 520px; max-width: calc(100vw - 24px);
      max-height: 60vh; display: flex; flex-direction: column; z-index: 2147483647;
      font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #e6e6e6; background: #1b1d23;
      border: 1px solid #3a3f4b; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.45); overflow: hidden; }
    .box.min .body, .box.min .tools { display: none; }
    .top { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #252933; cursor: move; user-select: none; }
    .title { font-weight: bold; flex: 1; }
    .tabs { display: flex; gap: 2px; padding: 4px 8px 0; background: #252933; }
    .tab { padding: 4px 10px; border-radius: 6px 6px 0 0; cursor: pointer; color: #aab; }
    .tab.on { background: #1b1d23; color: #fff; }
    .tools { display: flex; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #333; }
    input { flex: 1; background: #111318; color: #eee; border: 1px solid #3a3f4b; border-radius: 4px; padding: 3px 6px; font: inherit; }
    button { background: #333a48; color: #eee; border: 0; border-radius: 4px; padding: 3px 8px; cursor: pointer; font: inherit; }
    button:hover { background: #445066; }
    .body { overflow: auto; padding: 6px 8px; flex: 1; }
    .sum { color: #9ab; margin-bottom: 6px; white-space: pre-wrap; }
    .row { padding: 4px 0; border-bottom: 1px solid #2a2e38; cursor: pointer; word-break: break-all; }
    .row:hover { background: #222631; }
    .b { display: inline-block; padding: 0 5px; border-radius: 3px; margin-right: 4px; font-size: 11px; }
    .v { background: #7a2e3a; } .t { background: #2e4a7a; } .ok { background: #2f5a3a; } .n { background: #555; }
    .dim { color: #889; } .add { color: #6d6; } .chg { color: #dc6; } .del { color: #e66; }
    .note { color: #889; font-size: 11px; margin-top: 6px; }
  `;

  const host = h('div', { id: 'cpm-host' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, CSS));

  let tab = 'pixels';
  let filter = '';
  const counts = { pixels: h('span'), cookies: h('span'), log: h('span') };
  const body = h('div', { class: 'body' });
  const tabEls = {};
  const mkTab = (id, label) => (tabEls[id] = h('div', { class: 'tab', onclick: () => { tab = id; render(); } }, label, ' ', counts[id]));

  const box = h('div', { class: 'box' },
    h('div', { class: 'top' },
      h('span', { class: 'title' }, '🍪 Cookie & Pixel Monitor'),
      h('button', { title: 'Download JSON report', onclick: () => api.export() }, 'Export'),
      h('button', { title: 'Clear activity log', onclick: () => { state.log = []; render(); } }, 'Clear'),
      h('button', { title: 'Minimise', onclick: () => box.classList.toggle('min') }, '_'),
      h('button', { title: 'Hide (run snippet again to show)', onclick: () => host.remove() }, '×'),
    ),
    h('div', { class: 'tabs' }, mkTab('pixels', 'Pixels'), mkTab('cookies', 'Cookies'), mkTab('log', 'Log')),
    h('div', { class: 'tools' },
      h('input', { placeholder: 'filter…', oninput: (e) => { filter = e.target.value.toLowerCase(); render(); } }),
    ),
    body,
  );
  root.append(box);

  // Drag by the header.
  box.firstChild.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => Object.assign(box.style, { left: ev.clientX - dx + 'px', top: ev.clientY - dy + 'px', right: 'auto', bottom: 'auto' });
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });

  const matches = (...parts) => !filter || parts.join(' ').toLowerCase().includes(filter);

  function tally(items, keyFn) {
    const m = {};
    for (const it of items) { const k = keyFn(it); if (k) m[k] = (m[k] || 0) + (it.count || 1); }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(', ');
  }

  function renderPixels() {
    const all = [...state.pixels.values()];
    const hits = all.reduce((n, p) => n + p.count, 0);
    body.append(h('div', { class: 'sum' },
      `${all.length} unique tracker URLs, ${hits} hits\n`,
      all.length ? `Vendors: ${tally(all, (p) => p.vendor)}` : 'No pixels/trackers detected yet.'));
    for (const p of all.reverse()) {
      if (!matches(p.vendor, p.host, p.path, p.type, p.keyParams)) continue;
      body.append(h('div', { class: 'row', title: 'Click to log full details to console', onclick: () => console.log('[CPM] pixel', p) },
        h('span', { class: 'b v' }, p.vendor),
        h('span', { class: 'b t' }, `${p.method} ${p.type}`),
        p.count > 1 ? h('span', { class: 'b n' }, `×${p.count}`) : null,
        h('span', { class: 'dim' }, p.last, ' '),
        `${p.host}${p.path}`,
        p.keyParams ? h('div', { class: 'dim' }, p.keyParams) : null,
        p.bodyPreview ? h('div', { class: 'dim' }, `body: ${p.bodyPreview.slice(0, 160)}`) : null,
      ));
    }
  }

  function renderCookies() {
    const all = [...state.cookies.values()];
    const tracking = all.filter((c) => c.vendor && c.vendor !== 'Consent manager');
    body.append(h('div', { class: 'sum' },
      `${all.length} cookies visible to JS, ${tracking.length} known tracking\n`,
      tracking.length ? `Vendors: ${tally(tracking, (c) => c.vendor)}` : ''));
    const sorted = all.sort((a, b) => (!!b.vendor - !!a.vendor) || a.name.localeCompare(b.name));
    for (const c of sorted) {
      if (!matches(c.name, c.vendor, c.domain, c.value)) continue;
      const flags = [c.secure && 'Secure', c.sameSite && `SameSite=${c.sameSite}`, c.partitioned && 'Partitioned'].filter(Boolean).join(' ');
      body.append(h('div', { class: 'row', title: 'Click to log full details to console', onclick: () => console.log('[CPM] cookie', c) },
        c.vendor ? h('span', { class: 'b v' }, c.vendor) : h('span', { class: 'b ok' }, 'other'),
        h('b', {}, c.name), ' ',
        h('span', { class: 'dim' }, `${c.domain}${c.path || ''} · expires ${c.expires}${flags ? ' · ' + flags : ''}${c.changes ? ' · changed ×' + c.changes : ''}`),
        h('div', { class: 'dim' }, c.value.length > 120 ? c.value.slice(0, 120) + '…' : c.value),
      ));
    }
    body.append(h('div', { class: 'note' }, 'HttpOnly cookies are not visible to page scripts — see DevTools → Application → Cookies for those.'));
  }

  function renderLog() {
    const cls = { pixel: 'v', 'cookie+': 'add', 'cookie~': 'chg', 'cookie-': 'del', cookie: 'dim' };
    body.append(h('div', { class: 'sum' }, `Monitoring since ${state.startedAt.toLocaleTimeString()} on ${state.page}`));
    for (const e of [...state.log].reverse()) {
      if (!matches(e.kind, e.text)) continue;
      body.append(h('div', { class: 'row', onclick: () => e.data && console.log('[CPM]', e.kind, e.data) },
        h('span', { class: 'dim' }, e.time, ' '),
        h('span', { class: cls[e.kind] || '' }, e.text)));
    }
  }

  function render() {
    renderQueued = false;
    counts.pixels.textContent = `(${state.pixels.size})`;
    counts.cookies.textContent = `(${state.cookies.size})`;
    counts.log.textContent = `(${state.log.length})`;
    for (const [id, el] of Object.entries(tabEls)) el.classList.toggle('on', id === tab);
    const scroll = body.scrollTop;
    body.replaceChildren();
    ({ pixels: renderPixels, cookies: renderCookies, log: renderLog })[tab]();
    body.scrollTop = scroll;
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(render, 250);
  }

  // ------------------------------------------------------------------ API --

  const api = {
    show() { if (!host.isConnected) document.documentElement.append(host); box.classList.remove('min'); render(); },
    report() {
      console.group('%c[CPM] Report', 'color:#0a7;font-weight:bold');
      console.table([...state.pixels.values()].map(({ vendor, type, method, host, path, count, keyParams }) => ({ vendor, type, method, host, path, count, keyParams })));
      console.table([...state.cookies.values()].map(({ name, vendor, domain, expires, secure, sameSite }) => ({ name, vendor, domain, expires, secure, sameSite })));
      console.groupEnd();
    },
    data() {
      return {
        page: state.page,
        startedAt: state.startedAt.toISOString(),
        exportedAt: new Date().toISOString(),
        pixels: [...state.pixels.values()],
        cookies: [...state.cookies.values()],
        log: state.log.map(({ time, kind, text }) => ({ time, kind, text })),
      };
    },
    export() {
      const blob = new Blob([JSON.stringify(api.data(), null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `cpm-${location.hostname}-${Date.now()}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    stop() {
      cleanups.forEach((fn) => { try { fn(); } catch {} });
      host.remove();
      delete window.__cpm;
      console.log('%c[CPM] stopped, hooks removed', 'color:#0a7');
    },
  };
  window.__cpm = api;

  // ---------------------------------------------------------------- start --

  installHooks();
  watchResources();
  watchDom();
  watchCookies();
  api.show();
  console.log('%c[CPM] Cookie & Pixel Monitor running. Commands: __cpm.report(), __cpm.export(), __cpm.stop()', 'color:#0a7;font-weight:bold');
})();
