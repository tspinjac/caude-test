/*
 * Cookie & Pixel Monitor v2 — Chrome DevTools snippet
 *
 * How to use:
 *   1. DevTools (F12) -> Sources -> Snippets -> "+ New snippet"
 *   2. Paste this whole file, save (Ctrl+S)
 *   3. Open any page, right-click the snippet -> Run (or Ctrl+Enter)
 *
 * What it finds (each item is clickable and explains itself):
 *   Pixels       tracking pixels, beacons, tracker scripts, hidden iframes, websockets
 *                + decoded parameters, personal data, which script sent it, where on page
 *   Cookies      every JS-visible cookie, what it's for, decoded value, lifetime, who set it,
 *                which trackers it was sent to
 *   Storage      localStorage / sessionStorage / IndexedDB used for tracking
 *   Forms        forms posting to third parties, hidden tracking fields, sensitive fields,
 *                scripts listening to your keystrokes, form submissions
 *   Fingerprint  canvas / WebGL / audio / font / device-attribute / WebRTC fingerprinting
 *   Domains      every third-party domain the page talks to
 *   Overview     privacy grade, main concerns, companies, consent state, URL tracking params,
 *                data-layer events
 *
 * Run the snippet again to re-open the panel. Console: __cpm.report(), __cpm.export(),
 * __cpm.data(), __cpm.stop()
 *
 * Limits: a snippet lives until the page navigates/reloads — re-run it after navigation.
 * HttpOnly and third-party cookies are invisible to page JavaScript (see DevTools ->
 * Application -> Cookies). Hooks only see calls made after the snippet started; earlier
 * network requests are still picked up from the browser's resource-timing buffer.
 */
(() => {
  'use strict';

  if (window.__cpm) {
    window.__cpm.show();
    console.log('%c[CPM] already running — panel re-opened', 'color:#0a7');
    return;
  }

  // DevTools Console Utilities only exist while the snippet is being evaluated.
  const devInspect = typeof inspect === 'function' ? inspect : null; // eslint-disable-line no-undef

  // ============================================================ knowledge base ==

  const CATS = {
    ads:         { label: 'Advertising',          risk: 3,   cls: 'red',   desc: 'Measures ad conversions and builds an interest profile used to target ads to you on other sites and apps.' },
    exchange:    { label: 'Ad exchange / ID sync', risk: 3,  cls: 'red',   desc: 'Real-time-bidding and data-broker infrastructure. Shares ("syncs") your browser ID between many ad companies so they can all recognise you.' },
    replay:      { label: 'Session recording',    risk: 4,   cls: 'red',   desc: 'Records mouse movement, clicks, scrolling and often typing so your visit can be replayed like a video.' },
    fingerprint: { label: 'Fingerprinting',       risk: 4,   cls: 'red',   desc: 'Identifies your device from hardware/software characteristics. Works without cookies and survives clearing them.' },
    analytics:   { label: 'Analytics',            risk: 1.5, cls: 'amber', desc: 'Counts visits and measures behaviour (pages, clicks, time on site). Usually gives you a persistent visitor ID.' },
    marketing:   { label: 'Marketing / CRM',      risk: 2,   cls: 'amber', desc: 'Links your browsing to a contact record (your email) once you fill in a form or click a newsletter link.' },
    social:      { label: 'Social widget',        risk: 2,   cls: 'amber', desc: 'Embedded social button/SDK. The network learns you visited this page even if you never click it.' },
    unknown:     { label: 'Unknown tracker',      risk: 1.5, cls: 'amber', desc: 'Request whose URL looks like a tracking pixel/beacon, but the vendor is not in the built-in list.' },
    abtest:      { label: 'A/B testing',          risk: 1,   cls: 'blue',  desc: 'Assigns you to experiment variants and measures how each variant performs.' },
    tagmgr:      { label: 'Tag manager',          risk: 0.5, cls: 'blue',  desc: 'Container that loads other tags. Not a tracker by itself, but decides which trackers run.' },
    consent:     { label: 'Consent manager',      risk: 0,   cls: 'green', desc: 'Cookie banner / consent platform. Stores your privacy choices and tells other tags what they may do.' },
  };

  // name, category, company, URL regex (host+path), cookie/storage-key regex, window globals, description
  const V = (name, cat, company, hosts, cookies, globals, desc) => ({ name, cat, company, hosts, cookies, globals: globals || [], desc });
  const VENDORS = [
    V('Meta Pixel', 'ads', 'Meta Platforms', /facebook\.com\/(tr|privacy_sandbox)|connect\.facebook\.net|facebook\.net\/signals/, /^(_fbp|_fbc|fr)$/, ['fbq', '_fbq'],
      'Meta (Facebook/Instagram) conversion pixel. Reports page views and actions such as purchases and sign-ups to Meta, which matches them to Facebook/Instagram accounts for ad targeting, retargeting and measurement.'),
    V('Google Analytics', 'analytics', 'Google', /google-analytics\.com|analytics\.google\.com|\/g\/collect|\/j\/collect|\/gtag\/js/, /^(_ga|_ga_\w+|_gid|_gat\w*|__utm[a-z])$/, ['ga', 'gtag', '_gaq', 'GoogleAnalyticsObject'],
      'Google Analytics. Measures traffic and behaviour and assigns a client ID (the _ga cookie) that recognises your browser for up to 2 years. When Google Signals is on, data can be linked to signed-in Google accounts.'),
    V('Google Tag Manager', 'tagmgr', 'Google', /googletagmanager\.com\/(gtm|ns)/, null, ['google_tag_manager'],
      'Google Tag Manager container. Loads the site\'s other tags (analytics, ad pixels) according to rules configured by the site owner.'),
    V('Google Ads / DoubleClick', 'ads', 'Google', /doubleclick\.net|googleadservices\.com|googlesyndication\.com|google\.[a-z.]+\/(pagead|ads)\/|adservice\.google|googletagservices\.com/, /^(_gcl_\w+|_gac_\w+|IDE|DSID|test_cookie|__gads|__gpi|__eoi|_gcl_ls)$/, ['googletag', 'adsbygoogle'],
      'Google advertising (Ads, DoubleClick, AdSense, Ad Manager). Records ad clicks and conversions and powers remarketing, i.e. showing you ads for this site elsewhere.'),
    V('TikTok Pixel', 'ads', 'ByteDance', /analytics\.tiktok\.com|business-api\.tiktok\.com/, /^(_ttp|_tt_enable_cookie|ttcsid\w*|ttclid|tt_\w+)$/, ['ttq'],
      'TikTok pixel. Reports visits and conversions to TikTok for ad targeting and measurement, matched to TikTok accounts.'),
    V('Microsoft Ads (UET)', 'ads', 'Microsoft', /bat\.bing\.com|bat\.r\.msn\.com/, /^(_uetsid|_uetvid|_uetmsclkid|MUID)$/, ['uetq', 'UET'],
      'Microsoft Advertising Universal Event Tracking. Reports conversions to Bing/Microsoft Ads and builds remarketing audiences.'),
    V('Microsoft Clarity', 'replay', 'Microsoft', /clarity\.ms/, /^(_clck|_clsk|CLID|ANONCHK)$/, ['clarity'],
      'Microsoft Clarity session recording and heatmaps. Records clicks, scrolls and mouse movement to replay sessions.'),
    V('LinkedIn Insight', 'ads', 'LinkedIn (Microsoft)', /px\.ads\.linkedin\.com|snap\.licdn\.com|linkedin\.com\/(px|collect)/, /^(li_\w+|lidc|bcookie|bscookie|UserMatchHistory|AnalyticsSyncHistory)$/, ['_linkedin_partner_id', '_linkedin_data_partner_ids', 'lintrk'],
      'LinkedIn Insight Tag. Reports visits and conversions to LinkedIn, enabling B2B targeting by job title/company.'),
    V('Pinterest Tag', 'ads', 'Pinterest', /ct\.pinterest\.com|s\.pinimg\.com\/ct/, /^(_pin_unauth|_pinterest_\w+|_epik|_derived_epik)$/, ['pintrk'],
      'Pinterest conversion tag. Reports visits/checkouts to Pinterest for ad targeting.'),
    V('Snap Pixel', 'ads', 'Snap Inc.', /tr\.snapchat\.com|tr-shadow\.snapchat\.com|sc-static\.net/, /^(_scid|_sctr|_scid_r|sc_at)$/, ['snaptr'],
      'Snapchat pixel. Reports visits and conversions to Snap for ad targeting.'),
    V('X / Twitter Pixel', 'ads', 'X Corp.', /analytics\.twitter\.com|t\.co\/i\/adsct|static\.ads-twitter\.com|ads-api\.x\.com|ads-twitter\.com/, /^(_twclid|muc_ads|personalization_id|guest_id\w*)$/, ['twq', 'twttr'],
      'X (Twitter) conversion tag. Reports visits to X for ad targeting and conversion measurement.'),
    V('Reddit Pixel', 'ads', 'Reddit', /reddit\.com\/rp\.gif|alb\.reddit\.com|redditstatic\.com\/ads|pixel-config\.reddit\.com/, /^(_rdt_uuid|_rdt_cid|_rdt_em)$/, ['rdt'],
      'Reddit pixel. Reports visits and conversions to Reddit for ad targeting.'),
    V('Hotjar', 'replay', 'Hotjar (Contentsquare)', /hotjar\.(com|io)/, /^_hj/, ['hj', '_hjSettings'],
      'Hotjar session recording, heatmaps and surveys. Records mouse movement, clicks, scrolling and (unless masked) form input.'),
    V('FullStory', 'replay', 'FullStory', /fullstory\.com|fs\.io\/rec/, /^(fs_uid|fs_lua|fs_cid|_fs\w*)$/, ['FS', '_fs_namespace'],
      'FullStory session replay. Captures the full page DOM, clicks and typing to replay sessions.'),
    V('LogRocket', 'replay', 'LogRocket', /logrocket\.(com|io)|lr-ingest\.(io|com)|lr-in\.com/, /^(_lr_\w+|lr-\w+)/, ['LogRocket'],
      'LogRocket session replay. Records DOM changes, console logs and network activity.'),
    V('Mouseflow', 'replay', 'Mouseflow', /mouseflow\.com/, /^(mf_\w+)$/, ['mouseflow', '_mfq'],
      'Mouseflow session replay and heatmaps.'),
    V('Smartlook', 'replay', 'Smartlook', /smartlook\.(com|cloud)/, /^SL_/, ['smartlook'],
      'Smartlook session recording and event analytics.'),
    V('Yandex Metrica', 'analytics', 'Yandex', /mc\.yandex\.(ru|com)|mc\.webvisor/, /^(_ym_\w+|yandexuid|ymex|yabs-sid)$/, ['ym', 'Ya'],
      'Yandex Metrica analytics. Its "Webvisor" feature also records full sessions (mouse, clicks, typing).'),
    V('Segment', 'analytics', 'Twilio', /segment\.(com|io)|segmentapis\.com/, /^(ajs_\w+)$/, ['analytics'],
      'Segment customer-data pipeline. Collects events once and forwards them to many other tools (analytics, ads, CRM).'),
    V('Mixpanel', 'analytics', 'Mixpanel', /mixpanel\.com|mxpnl\.com/, /^(mp_\w+|mixpanel\w*)$/, ['mixpanel'],
      'Mixpanel product analytics. Tracks events per user and keeps a persistent distinct ID.'),
    V('Amplitude', 'analytics', 'Amplitude', /amplitude\.com/, /^(amp_\w+|AMP_\w+|amplitude\w*)$/, ['amplitude'],
      'Amplitude product analytics. Tracks events per user/device ID.'),
    V('Heap', 'analytics', 'Heap (Contentsquare)', /heapanalytics\.com|heap-api\.com/, /^(_hp2_\w+)$/, ['heap'],
      'Heap analytics. Automatically captures every click, form change and page view.'),
    V('HubSpot', 'marketing', 'HubSpot', /hs-analytics\.net|hs-scripts\.com|track\.hubspot\.com|hsforms\.(com|net)|hs-banner\.com|hubspot\.com\/__ptq/, /^(hubspotutk|__hs\w+|messagesUtk)$/, ['_hsq', 'hbspt', 'HubSpotConversations'],
      'HubSpot marketing/CRM. The hubspotutk cookie ties your page views to your contact record once you submit any HubSpot form.'),
    V('Marketo', 'marketing', 'Adobe', /mktoresp\.com|marketo\.(com|net)|munchkin/, /^(_mkto_trk)$/, ['Munchkin', 'MktoForms2'],
      'Marketo (Adobe) marketing automation. The _mkto_trk cookie links your browsing to your lead record.'),
    V('Salesforce Pardot', 'marketing', 'Salesforce', /pardot\.com|pi\.pardot/, /^(visitor_id\d*|visitor_id\d*-hash|pi_opt_in\d*|lpv\d+)$/, ['piAId', 'piCId'],
      'Salesforce Pardot / Account Engagement. Links visits to your prospect record.'),
    V('Klaviyo', 'marketing', 'Klaviyo', /klaviyo\.com/, /^(__kla_id|__kla_\w+)$/, ['klaviyo', '_learnq'],
      'Klaviyo email marketing. Identifies you (email) and records browsing/cart activity for abandoned-cart emails.'),
    V('Intercom', 'marketing', 'Intercom', /intercom\.io|intercomcdn\.com|intercom\.com/, /^(intercom-\w+)/, ['Intercom'],
      'Intercom chat/CRM widget. Keeps a visitor ID and records page views for the support team.'),
    V('Adobe Experience Cloud', 'analytics', 'Adobe', /demdex\.net|omtrdc\.net|everesttech\.net|adobedtm\.com|2o7\.net|sc\.omtrdc/, /^(AMCV_\w+|AMCVS_\w+|s_cc|s_sq|s_vi|s_fid|s_ecid|demdex|dextp|mbox)$/, ['_satellite', 'Visitor', 'adobe'],
      'Adobe Analytics / Audience Manager / Target. Assigns an Experience Cloud ID shared across Adobe products and partner ad platforms.'),
    V('Tealium', 'tagmgr', 'Tealium', /tiqcdn\.com|tealiumiq\.com/, /^(utag_main\w*)$/, ['utag', 'utag_data'],
      'Tealium iQ tag manager / customer data platform. Loads other tags and keeps a visitor profile (utag_main).'),
    V('Criteo', 'ads', 'Criteo', /criteo\.(com|net)/, /^(cto_\w+|criteo\w*)$/, ['criteo_q', 'Criteo'],
      'Criteo retargeting. Shows you ads for products you viewed on this site across other websites.'),
    V('Taboola', 'ads', 'Taboola', /taboola\.com|taboolasyndication/, /^(t_gid|t_pt_gid|taboola\w*)$/, ['_tfa', 'TRC'],
      'Taboola "recommended content" ads and conversion tracking.'),
    V('Outbrain', 'ads', 'Outbrain (Teads)', /outbrain\.com|outbrainimg\.com/, /^(obuid|outbrain\w*)$/, ['obApi', 'OBR'],
      'Outbrain recommended-content ads and conversion tracking.'),
    V('Amazon Ads', 'ads', 'Amazon', /amazon-adsystem\.com|assoc-amazon/, /^(ad-id|ad-privacy)$/, ['apstag', 'amzn'],
      'Amazon advertising / publisher services. Bids on and measures ads.'),
    V('Xandr', 'exchange', 'Microsoft', /adnxs\.com/, null, [], 'Xandr (AppNexus) ad exchange. Syncs your browser ID with other ad platforms.'),
    V('The Trade Desk', 'exchange', 'The Trade Desk', /adsrvr\.org/, /^(TDID|TDCPM)$/, [], 'The Trade Desk demand-side platform. Its Unified ID links your browsing across advertisers.'),
    V('Ad exchange / identity sync', 'exchange', 'various', /rubiconproject\.com|pubmatic\.com|casalemedia\.com|openx\.net|rlcdn\.com|bluekai\.com|liadm\.com|id5-sync\.com|crwdcntrl\.net|agkn\.com|adform\.net|smartadserver\.com|bidswitch\.net|3lift\.com|sharethrough\.com|teads\.tv|yieldmo\.com|media\.net|mathtag\.com|bidr\.io|contextweb\.com|sonobi\.com|indexww\.com|gumgum\.com|33across\.com|lijit\.com|sovrn\.com|zemanta\.com|tapad\.com|eyeota\.net|exelator\.com|krxd\.net|addthis\.com|sharethis\.com/, null, [],
      'Programmatic advertising / data-broker endpoint. These typically "cookie-sync": they swap your browser ID with other ad companies so everyone can bid on you as a known user.'),
    V('Comscore', 'analytics', 'Comscore', /scorecardresearch\.com|comscore\.com/, /^(UID|UIDR)$/, ['COMSCORE', '_comscore'], 'Comscore audience measurement (media ratings).'),
    V('Quantcast', 'ads', 'Quantcast', /quantserve\.com|quantcount\.com|quantcast\.com/, /^(__qca|mc)$/, ['_qevents', '__qc'], 'Quantcast audience measurement and ad targeting.'),
    V('Matomo', 'analytics', 'Matomo / self-hosted', /matomo|piwik/, /^(_pk_\w+|MATOMO_\w+|mtm_\w+)$/, ['_paq', 'Matomo', 'Piwik'], 'Matomo analytics (often self-hosted, can be configured privacy-friendly).'),
    V('Plausible', 'analytics', 'Plausible', /plausible\.io/, null, ['plausible'], 'Plausible — cookieless, privacy-oriented analytics. No personal identifiers.'),
    V('Optimizely', 'abtest', 'Optimizely', /optimizely\.com/, /^(optimizely\w*)$/, ['optimizely'], 'Optimizely A/B testing and personalisation.'),
    V('VWO', 'abtest', 'Wingify', /visualwebsiteoptimizer\.com|vwo\.com|wingify/, /^(_vwo_\w+|_vis_opt_\w+|_vwo)$/, ['VWO', '_vwo_code'], 'VWO A/B testing, heatmaps and session recording.'),
    V('FingerprintJS', 'fingerprint', 'Fingerprint', /fpjs\.io|fpcdn\.io|fingerprint\.com|fpnpmcdn\.net/, /^(_iidt|_vid_t)$/, ['FingerprintJS', 'Fingerprint'], 'Fingerprint (FingerprintJS) device identification. Builds a stable visitor ID from device characteristics.'),
    V('OneTrust', 'consent', 'OneTrust', /cookielaw\.org|onetrust\.com|cookiepro\.com/, /^(OptanonConsent|OptanonAlertBoxClosed)$/, ['OneTrust', 'OnetrustActiveGroups', 'OptanonActiveGroups'], 'OneTrust cookie banner / consent management.'),
    V('Cookiebot', 'consent', 'Usercentrics', /cookiebot\.com|consentcdn\.cookiebot/, /^(CookieConsent|CookieConsentBulkSetting\w*)$/, ['Cookiebot', 'CookieConsent'], 'Cookiebot cookie banner / consent management.'),
    V('Usercentrics', 'consent', 'Usercentrics', /usercentrics\.eu|usercentrics\.com/, /^(uc_\w+)$/, ['UC_UI', 'usercentrics'], 'Usercentrics consent management.'),
    V('Didomi', 'consent', 'Didomi', /didomi\.io|privacy-center\.org/, /^(didomi_token|euconsent-v2)$/, ['Didomi'], 'Didomi consent management.'),
    V('Quantcast Choice', 'consent', 'Quantcast', /quantcast\.mgr|cmp\.quantcast/, /^(addtl_consent|euconsent-v2|usprivacy)$/, [], 'Quantcast Choice consent management (IAB TCF).'),
    V('YouTube embed', 'social', 'Google', /youtube\.com\/(embed|iframe_api|youtubei)|ytimg\.com|youtube-nocookie\.com/, /^(VISITOR_INFO1_LIVE|YSC|VISITOR_PRIVACY_METADATA)$/, ['YT'], 'Embedded YouTube player. Google sees the page you are on and can link it to your Google/YouTube account.'),
    V('Facebook social plugin', 'social', 'Meta Platforms', /facebook\.com\/plugins|connect\.facebook\.net\/[^/]+\/sdk/, null, ['FB'], 'Facebook Like/Share/comments plugin or SDK. Meta learns which page you are on.'),
    V('X / Twitter widget', 'social', 'X Corp.', /platform\.twitter\.com|syndication\.twitter\.com/, null, [], 'Embedded tweet / follow button. X learns which page you are on.'),
  ];
  // localStorage / sessionStorage / IndexedDB names used by trackers.
  const STORAGE_VENDORS = [
    [/^_gcl_|^_gcl$/, 'Google Ads / DoubleClick'], [/^(_ga|ga:|gtag)/, 'Google Analytics'], [/^(tt_|_tt_|tiktok)/i, 'TikTok Pixel'],
    [/^_hj|hotjar/i, 'Hotjar'], [/^(AMP_|amp_|amplitude)/i, 'Amplitude'], [/^(ajs_|__anon_id$|__user_id$|__user_traits$|segment)/i, 'Segment'],
    [/^(mp_|mixpanel)/i, 'Mixpanel'], [/^_uet/, 'Microsoft Ads (UET)'], [/^(_clck|_clsk|clarity)/i, 'Microsoft Clarity'],
    [/^(lr-|_lr_|logrocket)/i, 'LogRocket'], [/^(_fs_|fs_|fullstory)/i, 'FullStory'], [/^(__kla|klaviyo)/i, 'Klaviyo'],
    [/^(_pin|_epik|pinterest)/i, 'Pinterest Tag'], [/^_rdt/, 'Reddit Pixel'], [/^(_scid|snap)/i, 'Snap Pixel'], [/^_ym|^ym_/, 'Yandex Metrica'],
    [/^(_fbp|fbq|__fb|fb_)/, 'Meta Pixel'], [/^intercom/i, 'Intercom'], [/^optimizely/i, 'Optimizely'], [/^(_vwo|vwo)/i, 'VWO'],
    [/^(_pk_|matomo|piwik)/i, 'Matomo'], [/^(__hs|hubspot)/i, 'HubSpot'], [/^(heap|_hp2)/i, 'Heap'], [/^(mf_|mouseflow)/i, 'Mouseflow'],
    [/^(criteo|cto_)/i, 'Criteo'], [/^(_iidt|_vid_t|fpjs|fingerprint)/i, 'FingerprintJS'], [/^(OptanonConsent|onetrust|ot_)/i, 'OneTrust'],
    [/^(CookieConsent|cookiebot)/i, 'Cookiebot'], [/^(uc_|ucData|usercentrics)/i, 'Usercentrics'], [/^didomi/i, 'Didomi'],
  ];
  const storageVendor = (name) => (VENDORS.find((v) => v.cookies && v.cookies.test(name)) || {}).name || (STORAGE_VENDORS.find(([re]) => re.test(name)) || [])[1] || null;
  const VENDOR_BY_NAME = new Map(VENDORS.map((v) => [v.name, v]));
  VENDOR_BY_NAME.set('Unknown tracker', { name: 'Unknown tracker', cat: 'unknown', company: '?', desc: CATS.unknown.desc, globals: [] });

  // What individual cookies (and same-named storage keys) are for.
  const COOKIE_DETAILS = [
    [/^_ga$/, 'Google Analytics client ID: random number + first-visit timestamp. Identifies your browser on every visit.', '2 years'],
    [/^_ga_\w+$/, 'Google Analytics 4 session state for one property: session start time, session count, engagement.', '2 years'],
    [/^_gid$/, 'Google Analytics 24-hour visitor ID.', '24 hours'],
    [/^_gat/, 'Google Analytics request throttling.', '1 minute'],
    [/^__utm[a-z]$/, 'Legacy Google Analytics (urchin) visitor/session/campaign cookie.', 'up to 2 years'],
    [/^_gcl_au$/, 'Google Ads "conversion linker": remembers ad interactions to attribute later conversions.', '90 days'],
    [/^_gcl_(aw|dc|gb|gs|ag)$/, 'Stores the Google ad click ID (gclid) of an ad you clicked.', '90 days'],
    [/^_gcl_ls$/, 'Google Ads click data kept in localStorage (backup of the _gcl cookies).', 'persistent'],
    [/^(IDE|DSID)$/, 'DoubleClick advertising ID (third-party). Used for remarketing across sites.', '13 months'],
    [/^__gads$|^__gpi$/, 'Google Ad Manager/AdSense ID for frequency capping and ad targeting.', '13 months'],
    [/^_fbp$/, 'Meta browser ID (fb.1.<created>.<random>). Identifies your browser to Meta even when not logged in.', '90 days'],
    [/^_fbc$/, 'Meta click ID: stores the fbclid of a Facebook/Instagram ad or link you clicked.', '90 days'],
    [/^fr$/, 'Meta advertising cookie (usually third-party on facebook.com).', '90 days'],
    [/^_ttp$/, 'TikTok browser ID used by the TikTok pixel.', '13 months'],
    [/^ttclid$/, 'TikTok ad click ID.', '30 days'],
    [/^_uetsid$/, 'Microsoft Ads session ID.', '1 day'],
    [/^_uetvid$/, 'Microsoft Ads visitor ID.', '13 months'],
    [/^MUID$/, 'Microsoft user ID shared across Microsoft sites (Bing, Clarity, Ads).', '13 months'],
    [/^_clck$/, 'Microsoft Clarity user ID.', '1 year'],
    [/^_clsk$/, 'Microsoft Clarity session ID (links page views into one recording).', '1 day'],
    [/^_hjSessionUser_/, 'Hotjar user ID (persists across sessions).', '1 year'],
    [/^_hjSession_/, 'Hotjar current session ID.', '30 minutes'],
    [/^_hj/, 'Hotjar recording/survey state.', 'varies'],
    [/^li_fat_id$/, 'LinkedIn first-party ad click ID.', '30 days'],
    [/^li_sugr$|^bcookie$|^bscookie$|^lidc$|^UserMatchHistory$|^AnalyticsSyncHistory$/, 'LinkedIn browser/ad-matching ID.', 'up to 1 year'],
    [/^_pin_unauth$/, 'Pinterest ID for visitors not logged in to Pinterest.', '1 year'],
    [/^_epik$|^_derived_epik$/, 'Pinterest ad click ID.', '1 year'],
    [/^_scid$/, 'Snap Pixel browser ID.', '13 months'],
    [/^_rdt_uuid$/, 'Reddit Pixel browser ID.', '90 days'],
    [/^_twclid$/, 'X/Twitter ad click ID.', '2 years'],
    [/^ajs_anonymous_id$/, 'Segment anonymous visitor ID (forwarded to all connected tools).', '1 year'],
    [/^ajs_user_id$/, 'Segment logged-in user ID.', '1 year'],
    [/^mp_\w+_mixpanel$/, 'Mixpanel distinct ID + "super properties" (JSON).', '1 year'],
    [/^(AMP_|amp_)/, 'Amplitude device/session ID.', '1 year'],
    [/^_hp2_id/, 'Heap user ID.', '13 months'],
    [/^fs_uid$/, 'FullStory user ID (links recordings of the same visitor).', '1 year'],
    [/^hubspotutk$/, 'HubSpot visitor token — attached to your contact record when you submit a form.', '6 months'],
    [/^__hstc$/, 'HubSpot tracking: domain, visitor token, first/previous/current visit timestamps, session count.', '6 months'],
    [/^__hssc$|^__hssrc$/, 'HubSpot session tracking.', 'session / 30 min'],
    [/^_mkto_trk$/, 'Marketo visitor ID linking browsing to your lead record.', '2 years'],
    [/^__kla_id$/, 'Klaviyo ID (base64 JSON, may include your email once known).', '2 years'],
    [/^cto_bundle$/, 'Criteo retargeting ID bundle.', '13 months'],
    [/^_pk_id/, 'Matomo visitor ID.', '13 months'],
    [/^_pk_ses/, 'Matomo session.', '30 minutes'],
    [/^_ym_uid$/, 'Yandex Metrica user ID.', '1 year'],
    [/^_ym_d$/, 'Yandex Metrica first-visit date.', '1 year'],
    [/^__qca$/, 'Quantcast visitor ID.', '13 months'],
    [/^AMCV_/, 'Adobe Experience Cloud visitor ID (ECID), shared across Adobe products.', '2 years'],
    [/^s_cc$|^s_sq$/, 'Adobe Analytics cookie check / click-map data.', 'session'],
    [/^utag_main/, 'Tealium visitor profile: visitor ID, session count, timestamps.', '1 year'],
    [/^_vwo_uuid/, 'VWO visitor ID.', '1 year'],
    [/^intercom-id-/, 'Intercom anonymous visitor ID.', '9 months'],
    [/^intercom-session-/, 'Intercom session.', '1 week'],
    [/^OptanonConsent$/, 'OneTrust consent record: which cookie categories you accepted (groups=C0001:1,C0002:0,...).', '1 year'],
    [/^OptanonAlertBoxClosed$/, 'When you closed the OneTrust cookie banner.', '1 year'],
    [/^CookieConsent$/, 'Cookiebot consent record (necessary/preferences/statistics/marketing).', '1 year'],
    [/^euconsent(-v2)?$/, 'IAB TCF consent string: encodes which ad vendors and purposes you consented to.', '13 months'],
    [/^usprivacy$/, 'IAB US Privacy (CCPA) string, e.g. 1YNN.', '1 year'],
    [/^VISITOR_INFO1_LIVE$|^YSC$/, 'YouTube visitor ID / session (set by embedded videos).', '6 months / session'],
  ];
  const GENERIC_COOKIES = [
    [/^(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|connect\.sid|sessionid|session|sid|_session\w*|\w+_session|laravel_session|ci_session)$/i, 'Session cookie — keeps you logged in / remembers your cart during this visit.', 'functional'],
    [/csrf|xsrf/i, 'Security token that protects forms against cross-site request forgery.', 'functional'],
    [/^(__cf_bm|cf_clearance|__cfruid|_cfuvid|cf_chl\w*)$/, 'Cloudflare bot-protection / load-balancing cookie.', 'functional'],
    [/^(AWSALB|AWSALBCORS|AWSELB|AWSALBTG\w*)$/, 'AWS load-balancer stickiness cookie.', 'functional'],
    [/^(__Secure-|__Host-)/, 'Security-hardened cookie (prefix enforces Secure/HTTPS); usually auth or session.', 'functional'],
    [/lang|locale|currency|country|region|theme|dark|timezone|i18n/i, 'Preference cookie (language, currency, theme ...).', 'functional'],
    [/cart|basket|wishlist|checkout/i, 'Shopping cart state.', 'functional'],
    [/consent|gdpr|cookie_?(policy|notice|banner|law|accept)|cmp|privacy/i, 'Stores your cookie-banner / privacy choice.', 'consent'],
    [/(^|_)(uid|uuid|vid|visitor|device|client|anon|track|trk|user_?id)(_|$)/i, 'Name suggests a visitor/user identifier — possibly first-party tracking.', 'tracking?'],
  ];

  // Meaning of common tracking-request parameters: [regex, meaning, data category]
  const PARAMS = [
    [/^(gcs)$/, 'Google Consent Mode state: G1xy where x = ad storage, y = analytics storage (1 granted, 0 denied)', 'consent'],
    [/^(gcd|gdpr|gdpr_consent|us_privacy|gpp|gpp_sid|npa|dma|dma_cps|consent|tcf|addtl_consent|pscdl)$/i, 'Privacy / consent signal passed to the tracker', 'consent'],
    [/^(id|pid|pixel_?id|tid|measurement_id|partner_?id|pixelid|ti|sdkid|pixel_code|tagid|account_?id|site_?id|idsite|key|api_?key|token)$/i, "Tracker account / pixel ID (identifies the website's account, not you)", 'account'],
    [/^(cid|client_?id|_fbp|fbp|uid2?|user_?id|uuid|puid|anonymous_?id|anonymousid|distinct_?id|device_?id|vid|visitor_?id|_uetvid|mid|muid|external_id|ud\[external_id\]|_id|pvid|uniq|_pk_id|ga_?cid|ecid|mcid|tdid|ttp|_ttp|scid|_scid|epik|clid)$/i, 'Unique ID for you / your browser — lets the tracker recognise you on every visit and across sites', 'id'],
    [/^(sid|session_?id|_s|sct|seg|_uetsid|ssid|_ss|_nsi|_fv|_et)$/i, 'Session info (session ID, count, first-visit / engagement flags)', 'id'],
    [/^(gclid|gbraid|wbraid|dclid|fbclid|fbc|_fbc|msclkid|ttclid|twclid|li_fat_id|sccid|rdt_cid|yclid|igshid|mc_eid|_hsenc|_hsmi|irclickid|cjevent|click_?id|_gl|srsltid)$/i, 'Ad-click / campaign ID — ties this visit to the ad or email you clicked', 'campaign'],
    [/^utm_/i, 'Campaign tag (source / medium / campaign name)', 'campaign'],
    [/^(ud\[\w+\]|em|email|e_?mail|hashed_?email|ph|phone|fn|first_?name|ln|last_?name|ct|city|st|zp|zip|postal|country|db|dob|ge|gender|address|user_data|udff\[\w+\])$/i, 'Personal data (often SHA-256 hashed for "advanced matching")', 'pii'],
    [/^(value|currency|cu|revenue|tr|price|order_?id|transaction_?id|content_ids|contents|items|pr\d+\w*|product\w*|sku|quantity|num_items|cd\[(value|currency|content_ids|contents|num_items|order_id)\])$/i, 'Purchase / product data', 'commerce'],
    [/^(ev|en|e|event|event_?name|t|ea|ec|el|type|action|evt|event_?type|eventname|a)$/i, 'Event / hit type — what you did', 'event'],
    [/^(cd\[|ep\.|epn\.|up\.|upn\.|cd\d|cm\d|dimension|properties|props|data|payload|custom|context|traits)/i, 'Custom event data sent with the hit', 'event'],
    [/^(dl|url|u|page_?url|location|href|pl|dlc|page|path|dp|uri|pu|page_?location|landing)$/i, 'Page URL you are on', 'page'],
    [/^(dr|ref|referrer|rl|referer|page_?referrer)$/i, 'Referrer — the page you came from', 'page'],
    [/^(dt|title|page_?title|tl)$/i, 'Page title', 'page'],
    [/^(sr|sw|sh|screen\w*|res|vp|bw|bh|viewport|sd|colou?r_?depth|dpr|pr)$/i, 'Screen / window size, colour depth', 'device'],
    [/^(ul|lang|language|lg|hl|locale)$/i, 'Browser language', 'device'],
    [/^(ua|user_?agent|uach|uaa|uab|uafvl|uamb|uam|uap|uapv|uaw|os|browser|platform|device\w*)$/i, 'Browser / OS / device details', 'device'],
    [/^(tz|timezone|tzo)$/i, 'Time zone', 'device'],
    [/^(v|_v|ver|version|sdk|lib|lib_?version|gtm|tag_exp|if|it|coo|rqm|o|je)$/i, 'Technical (protocol/library version, tag config)', 'tech'],
    [/^(ts|timestamp|time|_ts|ts_?ms|_t|t0|ms)$/i, 'Timestamp', 'tech'],
    [/^(_p|z|rnd|random|cb|cachebuster|_|ord|r|nocache|bust)$/i, 'Random cache-buster (forces a fresh request)', 'tech'],
  ];
  const PARAM_CATS = { account: 'Site account', id: 'Identifier', session: 'Session', campaign: 'Ad click / campaign', pii: 'Personal data', commerce: 'Commerce', event: 'Event', page: 'Page', device: 'Device', consent: 'Consent', tech: 'Technical', other: 'Other' };

  const EVENT_INFO = {
    pageview: 'You viewed this page', page_view: 'You viewed this page',
    viewcontent: 'You viewed a product / content item', view_item: 'You viewed a product', view_item_list: 'You viewed a product list',
    addtocart: 'You added something to the cart', add_to_cart: 'You added something to the cart', remove_from_cart: 'You removed an item from the cart', view_cart: 'You viewed the cart',
    initiatecheckout: 'You started checkout', begin_checkout: 'You started checkout',
    addpaymentinfo: 'You entered payment info', add_payment_info: 'You entered payment info', add_shipping_info: 'You entered shipping info',
    purchase: 'You bought something (usually with order value and products)',
    lead: 'You submitted a lead / contact form', generate_lead: 'You submitted a lead / contact form',
    completeregistration: 'You created an account', sign_up: 'You created an account', login: 'You logged in',
    search: 'You searched (the search term is often included)', view_search_results: 'You viewed search results',
    subscribe: 'You subscribed', starttrial: 'You started a trial', contact: 'You contacted the business',
    addtowishlist: 'You added an item to a wishlist', add_to_wishlist: 'You added an item to a wishlist',
    scroll: 'You scrolled far down the page (usually 90%)', user_engagement: 'How long you actively looked at the page',
    first_visit: 'First time this browser visited the site', session_start: 'A new visit started',
    form_start: 'You started filling in a form', form_submit: 'You submitted a form',
    click: 'You clicked (often an outbound link)', file_download: 'You downloaded a file',
    video_start: 'You started a video', video_progress: 'Video watch progress', video_complete: 'You finished a video',
    select_item: 'You selected a product', select_promotion: 'You clicked a promotion', view_promotion: 'You saw a promotion',
    microdata: 'Meta pixel read structured product data (schema.org/OpenGraph) from the page',
    subscribedbuttonclick: 'Meta pixel automatically reported a button you clicked (automatic event)',
  };

  const TYPE_INFO = {
    img: 'Image pixel: a tiny (often invisible) image whose URL carries the data. The classic "tracking pixel".',
    'dom-img': 'Image element in the page that is 1×1 or hidden — a tracking pixel embedded in the HTML.',
    beacon: 'navigator.sendBeacon: fire-and-forget POST, typically used on page exit so it survives navigation.',
    fetch: 'JavaScript fetch() request sending data in the URL and/or body.',
    xhr: 'JavaScript XMLHttpRequest sending data in the URL and/or body.',
    script: 'Tracking library loaded into the page. It runs with full access to the page (DOM, forms, JS-visible cookies).',
    iframe: 'Frame loaded from the tracker. Runs its own code and can set cookies on the tracker domain (third-party cookies / ID sync).',
    'dom-iframe': 'Hidden or tiny iframe — commonly used for cookie syncing between ad companies.',
    websocket: 'WebSocket: a persistent two-way connection, often used to stream session-recording data or chat.',
    ping: '<a ping>: the browser notifies a URL when you click a link.',
    link: 'Preconnect / prefetch / stylesheet link.',
    other: 'Other request (e.g. CSS background, font).',
  };

  const FP_TECH = {
    canvas: { label: 'Canvas fingerprinting', desc: 'Draws hidden text/shapes and reads the pixels back. Tiny GPU, driver and font differences make the result almost unique to your device. (Also used legitimately for image editing / charts / captchas.)' },
    webgl: { label: 'WebGL GPU identification', desc: 'Reads the unmasked graphics-card vendor and model. Combined with other attributes it is a strong device identifier.' },
    audio: { label: 'Audio fingerprinting', desc: 'Renders a silent audio signal off-screen and hashes the output; small differences in the audio stack identify the device.' },
    fonts: { label: 'Font enumeration', desc: 'Measures text in many fonts to learn which fonts are installed — a well-known fingerprinting vector.' },
    navigator: { label: 'Device attribute sweep', desc: 'Reads many device attributes (CPU cores, memory, platform, plugins, languages, touch, screen). Each is harmless alone; together they narrow you down.' },
    battery: { label: 'Battery status', desc: 'Reads battery level/charging state — short-term identifier across sites.' },
    devices: { label: 'Media device enumeration', desc: 'Lists cameras, microphones and speakers (counts and IDs).' },
    voices: { label: 'Speech voices list', desc: 'The list of installed text-to-speech voices varies by OS and language packs.' },
    webrtc: { label: 'WebRTC connection', desc: 'Opens a peer connection, which can reveal your local and public IP addresses (used for fingerprinting and VPN detection; also used legitimately by calls/chat).' },
  };

  // Query parameters that mark a URL as "decorated" for tracking.
  const URL_TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|ttclid|twclid|li_fat_id|epik|sccid|rdt_cid|yclid|igshid|mc_eid|mc_cid|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsCtaTracking|mkt_tok|irclickid|cjevent|_gl|_ga|srsltid|oly_enc_id|oly_anon_id|vero_id|wickedid|ScCid|s_kwcid|ef_id|_branch_match_id|ref|referrer|aff_?id|affiliate)$/i;

  const PIXEL_PATH = /(pixel|beacon|collect|track(ing|er)?|\/tr\/?$|\/tr\?|\/p\.gif|\/t\.gif|1x1|spacer|impression|adsct|\/log(ging)?\b|\/event|\/hit|\/ping|\/analytics|\/metrics|\/telemetry|\/sync|\/usersync|\/cm\b|\/match|\/sa\.gif|\/b\/ss)/i;
  const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}/i;
  const TRACKING_FIELD = /utm_|gclid|fbclid|msclkid|ttclid|hutk|hs_context|_mkt_trk|mkto|^pi_|visitor_?id|client_?id|ga_?cid|google_?cid|fbp|fbc|lead_?source|referr|landing|session_?id|device_?id|anon|tracking|campaign|source|medium|gaclientid|_ga/i;
  const FORM_VENDORS = /hsforms|hubspot|marketo|mktoweb|pardot|typeform|jotform|docs\.google\.com\/forms|formstack|cognitoforms|wufoo|list-manage\.com|mailchimp|klaviyo|formsite|123formbuilder|zoho\.com\/forms|salesforce\.com\/servlet\/servlet\.WebToLead|webto\.salesforce/i;

  // ================================================================= settings ==

  const SETTINGS_KEY = '__cpm_settings';
  const SETTING_INFO = [
    ['firstPartyPixels', 'Flag first-party pixels', 'Also report pixel-like requests to the site\'s own domain (server-side tagging often proxies trackers through the first party).', false],
    ['detectFingerprinting', 'Detect fingerprinting', 'Hook canvas, WebGL, audio, font, navigator and WebRTC APIs to see which scripts fingerprint your device.', true],
    ['showWeakFingerprint', 'Show weak fingerprint signals', 'Also list API use that is probably harmless (few device attributes, few font measurements).', false],
    ['detectListeners', 'Detect input/keystroke listeners', 'Record third-party scripts that listen to keystrokes, input, clipboard, mouse movement and page exit.', true],
    ['watchStorage', 'Monitor localStorage / sessionStorage', 'Scan and watch web storage and IndexedDB for tracking IDs.', true],
    ['watchForms', 'Analyse forms', 'Find forms that send data to third parties, hidden tracking fields and sensitive inputs; log form submissions.', true],
    ['maskFormValues', 'Mask typed form values', 'Hide what you type in forms in the log (hidden-field values are still shown).', true],
    ['trackingCookiesOnly', 'Only tracking cookies', 'Hide cookies that are recognised as functional (session, security, preferences).', false],
    ['consoleLog', 'Mirror events to console', 'Also print every new finding to the DevTools console.', false],
    ['outlineElements', 'Outline tracking elements on page', 'Draw a red outline around visible tracking images/iframes/forms on the page.', false],
    ['lightTheme', 'Light theme', 'Use a light colour scheme for the panel.', false],
  ];
  const settings = Object.fromEntries(SETTING_INFO.map(([k, , , d]) => [k, d]));
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

  // ==================================================================== state ==

  const state = {
    startedAt: new Date(),
    page: location.href,
    pixels: new Map(),    // url -> pixel/request record
    cookies: new Map(),   // name -> cookie record
    storage: new Map(),   // "local:key" -> storage record
    forms: new Map(),     // id -> form record
    listeners: new Map(), // script url -> listener record
    fp: new Map(),        // tech|script -> fingerprint record
    domains: new Map(),   // base domain -> domain record
    globals: new Map(),   // global name -> vendor
    dataLayer: [],        // captured dataLayer / gtag events
    urlParams: [],        // tracking params in page URL / referrer
    links: { decorated: [], ping: [], total: 0 },
    consent: {},
    typed: [],            // emails typed into forms (in memory only) + hash
    submissions: [],
    log: [],
  };
  const cleanups = [];
  const awaitingNetwork = new Set(); // urls seen via hooks/DOM, awaiting their resource-timing entry
  const initiators = new Map();      // url -> { caller, el } from src setters
  const cookieWriters = new Map();   // cookie name -> caller that last wrote it
  const storageWriters = new Map();  // storage key -> caller
  const expanded = new Set();        // expanded row keys in the UI
  let paused = false;
  let seq = 0;

  // ================================================================== helpers ==

  const now = () => new Date().toLocaleTimeString();
  const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  const fmtDate = (ms) => { const d = new Date(ms); return isNaN(d) ? '?' : `${d.toLocaleString()} (${ago(ms)})`; };
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    const a = Math.abs(s), fut = s < 0;
    const t = a < 90 ? `${a}s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 172800 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} days`;
    return fut ? `in ${t}` : `${t} ago`;
  }
  const fmtBytes = (n) => (n == null ? '?' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  function baseDomain(host) {
    host = String(host || '').replace(/\.$/, '');
    if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
    const p = host.split('.');
    if (p.length <= 2) return host;
    const twoLevelTld = p[p.length - 1].length === 2 && p[p.length - 2].length <= 3; // co.uk, com.au
    return p.slice(twoLevelTld ? -3 : -2).join('.');
  }
  const PAGE_SITE = baseDomain(location.hostname);
  const isThirdParty = (host) => baseDomain(host) !== PAGE_SITE;

  function parseUrl(u) { try { return new URL(u, location.href); } catch { return null; } }
  function vendorByUrl(u) {
    const url = typeof u === 'string' ? parseUrl(u) : u;
    if (!url) return null;
    const hp = url.host + url.pathname;
    return VENDORS.find((v) => v.hosts && v.hosts.test(hp)) || null;
  }
  const vendorByName = (name) => VENDORS.find((v) => v.cookies && v.cookies.test(name)) || null;

  function safeJSON(obj, max = 3000) {
    const seen = new WeakSet();
    let out;
    try {
      out = JSON.stringify(obj, (k, v) => {
        if (typeof v === 'function') return `[function ${v.name || ''}]`;
        if (v && typeof v === 'object') {
          if (v.nodeType) return `[${describeEl(v)}]`;
          if (v === window) return '[window]';
          if (seen.has(v)) return '[circular]';
          seen.add(v);
          if (Object.prototype.toString.call(v) === '[object Arguments]') return Array.from(v);
        }
        return v;
      }, 2);
    } catch (e) { out = String(obj); }
    return trunc(out, max);
  }

  function describeEl(el) {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    const src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('action') || el.getAttribute('name'));
    if (src) s += `[${trunc(src, 60)}]`;
    return s;
  }

  // Which page script is calling us? Returns the first http(s) frame that isn't this snippet.
  function caller() {
    const old = Error.stackTraceLimit;
    Error.stackTraceLimit = 40;
    const stack = new Error().stack || '';
    Error.stackTraceLimit = old;
    const frames = [];
    for (const line of stack.split('\n').slice(1)) {
      const m = line.match(/(https?:\/\/[^\s()]+?):(\d+):(\d+)/);
      if (m) frames.push({ url: m[1], line: +m[2], col: +m[3], fn: (line.match(/at\s+(?:async\s+)?([^\s(]+)\s+\(/) || [])[1] || '' });
    }
    if (!frames.length) return null;
    const f = frames[0];
    const u = parseUrl(f.url);
    const inline = u && u.origin + u.pathname === location.origin + location.pathname;
    return { url: f.url, line: f.line, col: f.col, host: u ? u.host : '', inline, vendor: vendorByUrl(u)?.name || null, frames: frames.slice(0, 8) };
  }
  const callerLabel = (c) => (!c ? 'unknown' : c.inline ? `inline <script> in this page, line ${c.line}` : `${c.host}${trunc(parseUrl(c.url)?.pathname, 60)}:${c.line}`);

  async function sha256(text) {
    if (!crypto.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function isHidden(el) {
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
  }

  function log(kind, text, ref) {
    state.log.push({ time: now(), kind, text, ref });
    if (state.log.length > 3000) state.log.shift();
    if (settings.consoleLog) console.log(`%c[CPM] ${kind}%c ${text}`, 'color:#e67;font-weight:bold', 'color:inherit');
    scheduleRender();
  }

  // Decode a cookie/storage/parameter value into human-readable facts.
  function decodeValue(name, raw) {
    const out = [];
    let v = String(raw ?? '');
    if (!v) return out;
    try { const d = decodeURIComponent(v); if (d !== v) { out.push(['URL-decoded', d]); v = d; } } catch {}
    let m, known = false;
    if ((m = v.match(/^GA\d\.\d+\.(\d+)\.(\d{10})$/))) {
      known = true;
      out.push(['GA client ID', `${m[1]}.${m[2]} — this exact value is sent as "cid" with every Google Analytics hit`], ['First visit', fmtDate(m[2] * 1000)]);
    } else if ((m = v.match(/^GS\d\.\d\.(.+)$/))) {
      known = true;
      const s = m[1];
      const ts = s.match(/(?:^|\$)s?(\d{10})/);
      const cnt = s.match(/\$o(\d+)|^\d{10}\.(\d+)/);
      if (ts) out.push(['Session started', fmtDate(ts[1] * 1000)]);
      if (cnt) out.push(['Session number', `${cnt[1] || cnt[2]} (how many times you have visited)`]);
    } else if ((m = v.match(/^fb\.\d\.(\d{13})\.(.+)$/))) {
      known = true;
      out.push(['Created', fmtDate(+m[1])], [/^fb\.\d\.\d{13}\.IwA|^fb\.\d\.\d{13}\.[A-Za-z0-9_-]{20,}$/.test(v) || name === '_fbc' ? 'Facebook click ID (fbclid)' : 'Random browser ID', m[2]]);
    } else if ((m = v.match(/^GCL\.(\d{10})\.(.+)$/))) {
      known = true;
      out.push(['Created', fmtDate(m[1] * 1000)], ['Ad click / linker ID', m[2]]);
    } else if ((m = v.match(/^(\d{5,})\.(\d{10})$/)) && /_ym|_pk|_hp2/.test(name)) {
      out.push(['ID', m[1]], ['Created', fmtDate(m[2] * 1000)]);
      known = true;
    } else if (/^groups=|&groups=/.test(v) || name === 'OptanonConsent') {
      const g = new URLSearchParams(v).get('groups');
      if (g) out.push(['Consent groups', describeOneTrust(g)]);
      known = true;
    }
    if (/^[{[]/.test(v.trim())) { try { out.push(['JSON', JSON.stringify(JSON.parse(v), null, 2)]); known = true; } catch {} }
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(v)) {
      try { out.push(['JWT payload', JSON.stringify(JSON.parse(atob(v.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))), null, 2)]); known = true; } catch {}
    } else if (v.length >= 12 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) && !/^\d+$/.test(v)) {
      try {
        const t = atob(v.replace(/-/g, '+').replace(/_/g, '/'));
        if (/^[\x20-\x7e\r\n\t]+$/.test(t) && t.length > 4) {
          let pretty = t;
          try { pretty = JSON.stringify(JSON.parse(t), null, 2); } catch {}
          out.push(['Base64-decoded', pretty]);
          known = true;
        }
      } catch {}
    }
    if (!known) {
      const stamps = [...new Set(v.match(/(?<!\d)1[5-9]\d{8}(?:\d{3})?(?!\d)/g) || [])].slice(0, 3);
      for (const t of stamps) out.push([`Timestamp ${t}`, fmtDate(t.length === 13 ? +t : t * 1000)]);
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) out.push(['Format', 'UUID — a random unique identifier']);
    else if (/^[a-f0-9]{64}$/i.test(v)) out.push(['Format', 'SHA-256 hash — could be a hashed email / user ID']);
    else if (/^[a-f0-9]{32}$/i.test(v)) out.push(['Format', 'MD5-length hex — hashed value or random ID']);
    else if (looksLikeId(v) && !known) out.push(['Format', 'High-entropy string — looks like a unique identifier']);
    if (EMAIL_RE.test(v)) out.push(['⚠ Contains', `an email address: ${v.match(EMAIL_RE)[0]}`]);
    return out;
  }
  const looksLikeId = (v) => v.length >= 16 && v.length <= 200 && /\d/.test(v) && /[a-z]/i.test(v) && !/\s/.test(v) && !/^(true|false)$/.test(v);

  function describeOneTrust(groups) {
    const names = { C0001: 'Strictly necessary', C0002: 'Performance/analytics', C0003: 'Functional', C0004: 'Targeting/advertising', C0005: 'Social media', STACK42: 'IAB TCF stack' };
    return groups.split(/[,]/).filter(Boolean).map((g) => {
      const [id, on] = g.split(':');
      return `${names[id] || id}: ${on === undefined ? 'active' : on === '1' ? 'accepted' : 'rejected'}`;
    }).join('\n');
  }

  function cookieInfo(name, value) {
    const vendor = vendorByName(name);
    const d = COOKIE_DETAILS.find(([re]) => re.test(name));
    if (d || vendor) {
      const cat = vendor?.cat || 'analytics';
      return { vendor: vendor?.name || null, kind: cat === 'consent' ? 'consent' : 'tracking', purpose: d ? d[1] : `Set by ${vendor.name}. ${vendor.desc}`, typical: d ? d[2] : null };
    }
    const g = GENERIC_COOKIES.find(([re]) => re.test(name));
    if (g) return { vendor: null, kind: g[2], purpose: g[1], typical: null };
    if (looksLikeId(String(value || ''))) return { vendor: null, kind: 'tracking?', purpose: 'Unrecognised cookie holding a unique-looking value — could be a first-party visitor ID.', typical: null };
    return { vendor: null, kind: 'unknown', purpose: 'Not in the built-in list. Check the value and who set it (below) for clues.', typical: null };
  }

  // Break a request's URL + body into explained parameters.
  function flatten(obj, prefix, rows, depth = 0) {
    if (rows.length > 150) return;
    if (obj && typeof obj === 'object' && depth < 5) {
      const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
      for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : String(k), rows, depth + 1);
    } else rows.push([prefix, obj == null ? '' : String(obj)]);
  }
  function parseBody(text) {
    const rows = [];
    if (!text) return rows;
    const t = String(text).trim();
    if (/^[{[]/.test(t)) { try { flatten(JSON.parse(t), '', rows); return rows; } catch {} }
    if (/^[^\s=&]+=/.test(t)) {
      for (const line of t.split('\n')) for (const [k, v] of new URLSearchParams(line)) rows.push([k, v]);
      return rows;
    }
    return rows;
  }
  function explainParam(key) {
    const leaf = String(key).split('.').pop();
    const hit = PARAMS.find(([re]) => re.test(key)) || PARAMS.find(([re]) => re.test(leaf));
    return hit ? { meaning: hit[1], cat: hit[2] } : { meaning: '', cat: 'other' };
  }
  function analyzeParams(pairs, source) {
    const rows = [];
    for (const [key, value] of pairs.slice(0, 200)) {
      const { meaning, cat } = explainParam(key);
      const row = { key, value, meaning, cat, source, notes: [] };
      const lk = key.toLowerCase();
      if (/^(ev|en|event|event_?name|e|ea|type)$/.test(lk) && EVENT_INFO[String(value).toLowerCase()]) row.notes.push(EVENT_INFO[String(value).toLowerCase()]);
      if (lk === 'gcs') row.notes.push(decodeGcs(value));
      if (EMAIL_RE.test(value)) { row.cat = 'pii'; row.notes.push('⚠ plain-text email address'); }
      else if (cat === 'pii' && /^[a-f0-9]{64}$/i.test(value)) row.notes.push('SHA-256 hash of personal data. Hashing hides the raw value but the tracker can still match it to the same email/phone in its database.');
      else if (cat === 'pii' && value) row.notes.push('personal data');
      for (const c of state.cookies.values()) {
        const cv = String(c.value || '');
        if (cv.length >= 8 && value.length >= 8 && (value.includes(cv) || cv.includes(value))) row.notes.push(`= value of cookie "${c.name}"`), (row.cookie = c.name);
      }
      if (/^(dl|url|u|page_?url|location|href|dr|ref|referrer|rl)$/.test(lk) && /[?&](q|query|search|s|email|token|code|session)=/i.test(value)) row.notes.push('⚠ URL contains search terms / tokens');
      rows.push(row);
    }
    return rows;
  }
  function decodeGcs(v) {
    const m = String(v).match(/^G1(\d|-)(\d|-)$/);
    if (!m) return '';
    const s = (x) => (x === '1' ? 'granted' : x === '0' ? 'denied' : 'not set');
    return `ad storage ${s(m[1])}, analytics storage ${s(m[2])}`;
  }

  // ================================================================== consent ==

  function marketingDenied() {
    const c = state.consent;
    if (typeof c.onetrust === 'string' && !/C0004/.test(c.onetrust)) return 'OneTrust: "Targeting" group (C0004) not active';
    if (c.cookiebot && c.cookiebot.marketing === false) return 'Cookiebot: marketing consent = false';
    if (c.google && c.google.ad_storage === 'denied') return 'Google Consent Mode: ad_storage = denied';
    if (c.tcf && c.tcf.gdprApplies && c.tcf.purposes && !c.tcf.purposes['1']) return 'IAB TCF: purpose 1 (store/access device) not consented';
    return null;
  }

  function checkConsent() {
    const c = state.consent;
    c.gpc = navigator.globalPrivacyControl === true;
    c.dnt = navigator.doNotTrack === '1';
    if (typeof window.OnetrustActiveGroups === 'string') c.onetrust = window.OnetrustActiveGroups;
    try {
      if (window.Cookiebot && window.Cookiebot.consent) {
        const k = window.Cookiebot.consent;
        c.cookiebot = { necessary: k.necessary, preferences: k.preferences, statistics: k.statistics, marketing: k.marketing };
      }
    } catch {}
    if (typeof window.__tcfapi === 'function' && !c.tcfListening) {
      c.tcfListening = true;
      try {
        window.__tcfapi('addEventListener', 2, (d, ok) => {
          if (!ok || !d) return;
          const prev = c.tcf && c.tcf.status;
          c.tcf = {
            cmpId: d.cmpId, gdprApplies: d.gdprApplies, status: d.eventStatus,
            purposes: (d.purpose && d.purpose.consents) || {},
            vendors: Object.values((d.vendor && d.vendor.consents) || {}).filter(Boolean).length,
            tcString: d.tcString,
          };
          if (prev !== d.eventStatus) log('consent', `IAB TCF consent status: ${d.eventStatus}`);
        });
      } catch {}
    }
    c.cmps = VENDORS.filter((v) => v.cat === 'consent' && (v.globals.some((g) => g in window) || [...state.cookies.keys()].some((n) => v.cookies && v.cookies.test(n)))).map((v) => v.name);
  }

  // =================================================================== pixels ==

  function bodyInfo(body) {
    if (body == null) return { size: 0, text: '' };
    if (typeof body === 'string') return { size: body.length, text: body.slice(0, 20000) };
    if (body instanceof URLSearchParams) { const s = body.toString(); return { size: s.length, text: s.slice(0, 20000) }; }
    if (body instanceof Blob) return { size: body.size, text: `[Blob ${body.type || ''}, ${body.size} bytes — contents not readable synchronously]` };
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { size: body.byteLength, text: '[binary]' };
    if (body instanceof FormData) { const p = new URLSearchParams(); for (const [k, v] of body) p.append(k, typeof v === 'string' ? v : '[file]'); const s = p.toString(); return { size: s.length, text: s }; }
    return { size: null, text: trunc(String(body), 500) };
  }

  function noteDomain(url, type, size, script) {
    if (!isThirdParty(url.hostname)) return;
    const d = baseDomain(url.hostname);
    let rec = state.domains.get(d);
    if (!rec) {
      const v = vendorByUrl(url);
      rec = { key: 'd:' + d, domain: d, vendor: v?.name || null, cat: v?.cat || null, requests: 0, bytes: 0, types: {}, hosts: new Set(), scripts: new Set(), first: now() };
      state.domains.set(d, rec);
    }
    if (!rec.vendor) { const v = vendorByUrl(url); if (v) { rec.vendor = v.name; rec.cat = v.cat; } }
    rec.requests++;
    rec.bytes += size || 0;
    rec.types[type] = (rec.types[type] || 0) + 1;
    rec.hosts.add(url.host);
    if (type === 'script') rec.scripts.add(url.href);
    if (script) rec.scripts.add(script);
    scheduleRender();
  }

  /**
   * Decide whether a request is a tracker/pixel and record it.
   * extra: { method, body, fromHook, reason, caller, el, timing }
   */
  function consider(rawUrl, type, extra = {}) {
    if (paused) return;
    const url = parseUrl(rawUrl);
    if (!url || !/^(https?|wss?):$/.test(url.protocol)) return;

    const vendor = vendorByUrl(url);
    const thirdParty = isThirdParty(url.hostname);
    const pixelLike = PIXEL_PATH.test(url.pathname + url.search);
    const generic = pixelLike && (thirdParty || settings.firstPartyPixels) && type !== 'script' && type !== 'link';
    const socket = type === 'websocket' && thirdParty;
    if (!vendor && !generic && !extra.reason && !socket) return;

    const key = url.href;
    const existing = state.pixels.get(key);
    const fromNetwork = !extra.fromHook && !extra.reason;

    // A hooked/DOM-found request later shows up again as a resource-timing entry: merge, don't double count.
    if (fromNetwork && awaitingNetwork.has(key)) {
      awaitingNetwork.delete(key);
      if (existing && extra.timing) { existing.timing = extra.timing; scheduleRender(); }
      return;
    }
    // DOM scans re-find the same element's request; that's not a new hit.
    if (existing && extra.reason) { if (extra.el && !existing.el) existing.el = extra.el; return; }
    if (!fromNetwork) awaitingNetwork.add(key);

    if (existing) {
      existing.count++;
      existing.last = now();
      if (extra.timing) existing.timing = extra.timing;
      scheduleRender();
      return;
    }

    const init = initiators.get(key);
    const { size, text } = bodyInfo(extra.body);
    const v = vendor || VENDOR_BY_NAME.get('Unknown tracker');
    const rec = {
      key: 'p:' + key,
      id: ++seq,
      first: now(),
      last: now(),
      firstMs: Date.now(),
      count: 1,
      vendor: extra.reason && !vendor ? (thirdParty ? 'Unknown tracker' : 'First-party pixel') : v.name,
      cat: extra.reason && !vendor ? 'unknown' : v.cat,
      type,
      method: extra.method || (type === 'beacon' ? 'POST' : 'GET'),
      url: url.href,
      host: url.host,
      path: url.pathname,
      thirdParty,
      reason: extra.reason || (vendor ? 'known tracker endpoint' : socket ? 'third-party websocket' : 'URL looks like a pixel / beacon'),
      caller: extra.caller || init?.caller || null,
      el: extra.el || init?.el || null,
      bodySize: size,
      body: text,
      timing: extra.timing || null,
    };
    rec.params = analyzeParams([...url.searchParams], 'url').concat(analyzeParams(parseBody(text), 'body'));
    rec.event = (rec.params.find((p) => p.cat === 'event' && /^(ev|en|event|event_?name|e|ea)$/i.test(p.key)) || {}).value || '';
    rec.pii = rec.params.filter((p) => p.cat === 'pii' && p.value);
    rec.ids = rec.params.filter((p) => p.cat === 'id' || p.cookie);
    rec.leaks = state.typed.filter((t) => {
      const hay = (url.href + ' ' + text).toLowerCase();
      return hay.includes(t.value) || hay.includes(encodeURIComponent(t.value)) || (t.hash && hay.includes(t.hash));
    }).map((t) => `${t.field} (${t.hash && (url.href + text).toLowerCase().includes(t.hash) ? 'SHA-256 hashed' : 'plain text'})`);
    if (['ads', 'exchange'].includes(rec.cat)) rec.beforeConsent = marketingDenied();
    state.pixels.set(key, rec);
    log('pixel', `${rec.vendor} · ${type} · ${url.host}${trunc(url.pathname, 50)}${rec.event ? ' · event=' + rec.event : ''}${rec.pii.length ? ' · ⚠ personal data' : ''}`, rec.key);
  }

  // Everything the page loaded, including what happened before the snippet ran.
  function watchResources() {
    try { performance.setResourceTimingBufferSize(10000); } catch {}
    const typeMap = { img: 'img', image: 'img', beacon: 'beacon', xmlhttprequest: 'xhr', fetch: 'fetch', script: 'script', iframe: 'iframe', subdocument: 'iframe', link: 'link', css: 'other', ping: 'ping', other: 'other' };
    const handle = (e) => {
      const url = parseUrl(e.name);
      if (!url) return;
      const type = typeMap[e.initiatorType] || e.initiatorType || 'other';
      const timing = { duration: Math.round(e.duration), transferSize: e.transferSize, bodySize: e.encodedBodySize, status: e.responseStatus || null, protocol: e.nextHopProtocol || '', startMs: Math.round(e.startTime) };
      if (!paused) noteDomain(url, type, e.transferSize, null);
      consider(e.name, type, { timing });
    };
    const po = new PerformanceObserver((list) => list.getEntries().forEach(handle));
    po.observe({ type: 'resource', buffered: true });
    cleanups.push(() => po.disconnect());
  }

  // ==================================================================== hooks ==

  function hookMethod(obj, name, wrapper) {
    if (!obj || typeof obj[name] !== 'function') return;
    const orig = obj[name];
    obj[name] = wrapper(orig);
    cleanups.push(() => { obj[name] = orig; });
  }
  function hookSetter(proto, prop, onSet) {
    const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set || !d.configurable) return;
    Object.defineProperty(proto, prop, { ...d, set(v) { try { onSet(this, v); } catch {} return d.set.call(this, v); } });
    cleanups.push(() => Object.defineProperty(proto, prop, d));
  }

  function installNetworkHooks() {
    hookMethod(navigator, 'sendBeacon', (orig) => function (url, data) {
      consider(url, 'beacon', { method: 'POST', body: data, fromHook: true, caller: caller() });
      return orig.apply(this, arguments);
    });

    hookMethod(window, 'fetch', (orig) => function (input, init = {}) {
      try {
        const url = input instanceof Request ? input.url : String(input);
        const method = (init.method || (input instanceof Request && input.method) || 'GET').toUpperCase();
        consider(url, 'fetch', { method, body: init.body, fromHook: true, caller: caller() });
      } catch {}
      return orig.apply(this, arguments);
    });

    const XHR = XMLHttpRequest.prototype;
    hookMethod(XHR, 'open', (orig) => function (method, url) {
      this.__cpm = { method: String(method).toUpperCase(), url: String(url), caller: caller() };
      return orig.apply(this, arguments);
    });
    hookMethod(XHR, 'send', (orig) => function (body) {
      try { if (this.__cpm) consider(this.__cpm.url, 'xhr', { method: this.__cpm.method, body, fromHook: true, caller: this.__cpm.caller }); } catch {}
      return orig.apply(this, arguments);
    });

    // Who injected which image / script / iframe (e.g. `new Image().src = pixelUrl`).
    const noteInit = (el, v) => {
      const u = parseUrl(v);
      if (!u || !/^https?:$/.test(u.protocol)) return;
      if (initiators.size > 5000) initiators.clear();
      initiators.set(u.href, { caller: caller(), el });
    };
    hookSetter(HTMLImageElement.prototype, 'src', noteInit);
    hookSetter(HTMLScriptElement.prototype, 'src', noteInit);
    hookSetter(HTMLIFrameElement.prototype, 'src', noteInit);
    hookMethod(Element.prototype, 'setAttribute', (orig) => function (name, value) {
      if (String(name).toLowerCase() === 'src' && /^(IMG|SCRIPT|IFRAME)$/.test(this.tagName)) try { noteInit(this, value); } catch {}
      return orig.apply(this, arguments);
    });

    // WebSockets (session replay / live chat streams).
    const WS = window.WebSocket;
    if (WS) {
      const Wrapped = function (...args) {
        const ws = Reflect.construct(WS, args, new.target || WS);
        const url = args[0];
        try {
          const c = caller();
          const u = parseUrl(url);
          if (u) noteDomain(u, 'websocket', 0, c?.url);
          consider(url, 'websocket', { fromHook: true, caller: c, method: 'WS' });
          const rec = state.pixels.get(u && u.href);
          if (rec) {
            const origSend = ws.send;
            ws.send = function (data) { rec.messages = (rec.messages || 0) + 1; rec.bytesOut = (rec.bytesOut || 0) + (data?.length || data?.byteLength || data?.size || 0); scheduleRender(); return origSend.apply(this, arguments); };
          }
        } catch {}
        return ws;
      };
      Wrapped.prototype = WS.prototype;
      Object.setPrototypeOf(Wrapped, WS);
      window.WebSocket = Wrapped;
      cleanups.push(() => { window.WebSocket = WS; });
    }
  }

  // ================================================================== cookies ==

  function parseCookieString(str) {
    const [pair, ...attrs] = String(str).split(';');
    const i = pair.indexOf('=');
    const out = { name: (i < 0 ? '' : pair.slice(0, i)).trim(), value: i < 0 ? pair.trim() : pair.slice(i + 1).trim(), attrs: {} };
    for (const a of attrs) { const [k, ...v] = a.trim().split('='); if (k) out.attrs[k.toLowerCase()] = v.join('=') || true; }
    return out;
  }

  function installCookieHooks() {
    const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (d && d.set && d.configurable) {
      Object.defineProperty(Document.prototype, 'cookie', {
        ...d,
        set(v) {
          try {
            const c = caller();
            if (c) { const p = parseCookieString(v); cookieWriters.set(p.name, { caller: c, raw: String(v), time: now() }); }
          } catch {}
          d.set.call(this, v);
          setTimeout(syncCookies, 0);
        },
      });
      cleanups.push(() => Object.defineProperty(Document.prototype, 'cookie', d));
    }
    if (window.cookieStore && typeof cookieStore.set === 'function') {
      hookMethod(cookieStore, 'set', (orig) => function (a, b) {
        try { const c = caller(); const name = typeof a === 'string' ? a : a && a.name; if (c && name) cookieWriters.set(name, { caller: c, raw: safeJSON(typeof a === 'string' ? { name: a, value: b } : a, 400), time: now() }); } catch {}
        return orig.apply(this, arguments);
      });
    }
  }

  async function readCookies() {
    if (window.cookieStore) {
      try {
        const list = await cookieStore.getAll();
        return list.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, secure: c.secure, sameSite: c.sameSite, partitioned: c.partitioned, detailed: true }));
      } catch {}
    }
    return document.cookie.split(/;\s*/).filter(Boolean).map((pair) => {
      const i = pair.indexOf('=');
      return { name: i < 0 ? pair : pair.slice(0, i), value: i < 0 ? '' : pair.slice(i + 1), detailed: false };
    });
  }

  let firstCookieSync = true;
  let syncing = null;
  function syncCookies() {
    if (syncing) return syncing;
    syncing = (async () => {
      const list = await readCookies();
      if (paused) return;
      const seen = new Set();
      for (const c of list) {
        seen.add(c.name);
        const prev = state.cookies.get(c.name);
        const writer = cookieWriters.get(c.name);
        if (!prev) {
          const info = cookieInfo(c.name, c.value);
          const rec = { ...c, key: 'c:' + c.name, info, firstSeen: now(), changes: 0, history: [], setBy: firstCookieSync ? null : writer || null, preexisting: firstCookieSync };
          state.cookies.set(c.name, rec);
          log(firstCookieSync ? 'cookie' : 'cookie+', `${firstCookieSync ? 'present' : 'SET'}: ${c.name}${info.vendor ? ' [' + info.vendor + ']' : ''}${!firstCookieSync && writer ? ' by ' + callerLabel(writer.caller) : ''}`, rec.key);
        } else if (prev.value !== c.value) {
          prev.history.unshift({ time: now(), value: prev.value });
          prev.history.length = Math.min(prev.history.length, 8);
          Object.assign(prev, c, { changes: prev.changes + 1, setBy: writer || prev.setBy });
          log('cookie~', `CHANGED: ${c.name}${prev.info.vendor ? ' [' + prev.info.vendor + ']' : ''}${writer ? ' by ' + callerLabel(writer.caller) : ''}`, prev.key);
        } else if (c.detailed) Object.assign(prev, { expires: c.expires, domain: c.domain, path: c.path, secure: c.secure, sameSite: c.sameSite });
      }
      for (const name of [...state.cookies.keys()]) {
        if (!seen.has(name)) {
          const writer = cookieWriters.get(name);
          state.cookies.delete(name);
          log('cookie-', `DELETED: ${name}${writer ? ' by ' + callerLabel(writer.caller) : ''}`);
        }
      }
      firstCookieSync = false;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  function watchCookies() {
    if (window.cookieStore) {
      const onChange = () => syncCookies();
      cookieStore.addEventListener('change', onChange);
      cleanups.push(() => cookieStore.removeEventListener('change', onChange));
    }
    const t = setInterval(syncCookies, 2000); // safety net for missed events / server-set cookies
    cleanups.push(() => clearInterval(t));
  }

  async function deleteCookie(c) {
    if (window.cookieStore) { try { await cookieStore.delete({ name: c.name, domain: c.domain || undefined, path: c.path || '/' }); } catch {} }
    const parts = location.hostname.split('.');
    const domains = [''].concat(parts.map((_, i) => parts.slice(i).join('.')).filter((d) => d.includes('.')));
    for (const dm of domains) for (const p of new Set(['/', c.path || '/', location.pathname])) {
      document.cookie = `${c.name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}${dm ? '; domain=' + dm : ''}`;
    }
    await syncCookies();
    toast(state.cookies.has(c.name) ? `Could not delete ${c.name} (HttpOnly twin or different scope?)` : `Deleted cookie ${c.name}`);
  }

  // ================================================================== storage ==

  function storageArea(kind) { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; } }

  function installStorageHooks() {
    const note = (area, key) => {
      const c = caller();
      if (!c) return;
      const kind = area === storageArea('local') ? 'local' : 'session';
      storageWriters.set(`${kind}:${key}`, { caller: c, time: now() });
      setTimeout(syncStorage, 0);
    };
    hookMethod(Storage.prototype, 'setItem', (orig) => function (k) { try { if (settings.watchStorage) note(this, k); } catch {} return orig.apply(this, arguments); });
    hookMethod(Storage.prototype, 'removeItem', (orig) => function (k) { try { if (settings.watchStorage) note(this, k); } catch {} return orig.apply(this, arguments); });
  }

  let firstStorageSync = true;
  async function syncStorage() {
    if (!settings.watchStorage || paused) return;
    const seen = new Set();
    for (const kind of ['local', 'session']) {
      const area = storageArea(kind);
      if (!area) continue;
      let keys = [];
      try { keys = Object.keys(area); } catch { continue; }
      for (const k of keys) {
        if (k === SETTINGS_KEY) continue;
        const key = `${kind}:${k}`;
        let value = '';
        try { value = area.getItem(k) || ''; } catch {}
        seen.add(key);
        const prev = state.storage.get(key);
        if (!prev) {
          const info = cookieInfo(k, value);
          const rec = { key: 's:' + key, kind, name: k, value, vendor: storageVendor(k), info, firstSeen: now(), changes: 0, setBy: firstStorageSync ? null : storageWriters.get(key) || null, preexisting: firstStorageSync };
          state.storage.set(key, rec);
          if (!firstStorageSync || rec.vendor) log(firstStorageSync ? 'storage' : 'storage+', `${kind}Storage ${firstStorageSync ? 'has' : 'SET'}: ${k}${rec.vendor ? ' [' + rec.vendor + ']' : ''}`, rec.key);
        } else if (prev.value !== value) {
          prev.value = value;
          prev.changes++;
          prev.setBy = storageWriters.get(key) || prev.setBy;
        }
      }
    }
    for (const key of [...state.storage.keys()]) {
      if (!seen.has(key) && !key.startsWith('idb:')) { state.storage.delete(key); log('storage-', `removed ${key}`); }
    }
    if (firstStorageSync && indexedDB && indexedDB.databases) {
      try {
        for (const db of await indexedDB.databases()) {
          const vendor = VENDOR_BY_NAME.get(storageVendor(db.name));
          state.storage.set('idb:' + db.name, { key: 's:idb:' + db.name, kind: 'indexedDB', name: db.name, value: `(database, version ${db.version})`, vendor: vendor?.name || null, info: { kind: vendor ? 'tracking' : 'unknown', purpose: vendor ? vendor.desc : 'IndexedDB database. Sites use it for offline data, caches — and sometimes to store tracking IDs that survive cookie clearing.' }, firstSeen: now(), changes: 0, preexisting: true });
        }
      } catch {}
    }
    firstStorageSync = false;
    scheduleRender();
  }

  // ==================================================================== forms ==

  const formIds = new WeakMap();
  let formSeq = 0;

  function sensitiveKind(el) {
    const s = `${el.type || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute?.('autocomplete') || ''} ${el.placeholder || ''}`.toLowerCase();
    if (el.type === 'password' || /password|passwd|pwd/.test(s)) return 'password';
    if (/cc-|card|cvc|cvv|iban|expir|kreditkarte/.test(s)) return 'payment';
    if (el.type === 'email' || /e-?mail/.test(s)) return 'email';
    if (el.type === 'tel' || /phone|mobile|tel\b/.test(s)) return 'phone';
    if (/ssn|passport|birth|dob|national.?id|tax.?id/.test(s)) return 'identity';
    if (/street|address|zip|postal|city/.test(s)) return 'address';
    if (/(^|\s|_)(first|last|full)?_?name/.test(s)) return 'name';
    return null;
  }

  function analyzeForm(f) {
    const actionAttr = f.getAttribute('action');
    const action = parseUrl(actionAttr ? f.action : location.href);
    const vendor = action && (vendorByUrl(action) || (FORM_VENDORS.test(action.href) ? { name: action.host, cat: 'marketing' } : null));
    const fields = [...f.elements].filter((e) => e.name || e.id).slice(0, 80).map((e) => {
      const hidden = e.type === 'hidden';
      const field = { name: e.name || e.id, type: (e.type || e.tagName).toLowerCase(), hidden, sensitive: sensitiveKind(e), value: hidden ? String(e.value || '') : '' };
      if (hidden) {
        if (TRACKING_FIELD.test(field.name)) field.tracking = 'Hidden field name suggests tracking / attribution data';
        const cv = [...state.cookies.values()].find((c) => c.value && c.value.length >= 6 && field.value.includes(c.value));
        if (cv) field.tracking = `Contains the value of cookie "${cv.name}"${cv.info.vendor ? ' (' + cv.info.vendor + ')' : ''}`;
        if (!field.tracking && looksLikeId(field.value)) field.tracking = 'Hidden field holds an ID-like value';
      }
      return field;
    });
    const sensitive = [...new Set(fields.map((x) => x.sensitive).filter(Boolean))];
    return {
      action: action ? action.href : '',
      actionHost: action ? action.host : '',
      method: (f.getAttribute('method') || 'GET').toUpperCase(),
      thirdParty: action ? isThirdParty(action.hostname) : false,
      vendor: vendor?.name || null,
      fields,
      sensitive,
      trackingFields: fields.filter((x) => x.tracking),
    };
  }

  function scanForms() {
    if (!settings.watchForms || paused) return;
    document.querySelectorAll('form').forEach((f) => {
      if (f.closest('#cpm-host')) return;
      if (!formIds.has(f)) formIds.set(f, ++formSeq);
      const id = 'f' + formIds.get(f);
      const a = analyzeForm(f);
      const prev = state.forms.get(id);
      if (!prev) {
        const rec = { key: 'f:' + id, id, el: f, kind: 'form', first: now(), submits: 0, ...a };
        state.forms.set(id, rec);
        if (a.thirdParty || a.trackingFields.length || a.sensitive.length) log('form', `form → ${a.actionHost || 'same page'}${a.thirdParty ? ' (third party)' : ''}${a.sensitive.length ? ' · fields: ' + a.sensitive.join(', ') : ''}${a.trackingFields.length ? ' · ' + a.trackingFields.length + ' hidden tracking field(s)' : ''}`, rec.key);
      } else Object.assign(prev, a);
    });
    document.querySelectorAll('iframe[src]').forEach((fr) => {
      const u = parseUrl(fr.src);
      if (!u || !FORM_VENDORS.test(u.href)) return;
      const id = 'if:' + u.origin + u.pathname;
      if (state.forms.has(id)) return;
      const rec = { key: 'f:' + id, id, el: fr, kind: 'embedded', first: now(), submits: 0, action: u.href, actionHost: u.host, method: '?', thirdParty: isThirdParty(u.hostname), vendor: vendorByUrl(u)?.name || u.host, fields: [], sensitive: [], trackingFields: [] };
      state.forms.set(id, rec);
      log('form', `embedded third-party form from ${u.host}`, rec.key);
    });
    scheduleRender();
  }

  function watchFormEvents() {
    const onSubmit = (e) => {
      if (!settings.watchForms || paused) return;
      const f = e.target;
      if (!(f instanceof HTMLFormElement)) return;
      if (!formIds.has(f)) scanForms();
      const rec = state.forms.get('f' + formIds.get(f));
      const filled = [...f.elements].filter((x) => x.name && x.value && x.type !== 'hidden' && x.type !== 'submit').map((x) => `${x.name}=${settings.maskFormValues ? '•••' : trunc(x.value, 40)}`);
      const sub = { time: now(), action: f.action, fields: filled };
      state.submissions.push(sub);
      if (rec) rec.submits++;
      log('submit', `form submitted → ${parseUrl(f.action)?.host || '?'} · ${filled.join(', ') || 'no visible fields'}`, rec && rec.key);
    };
    const onChange = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || paused) return;
      const v = String(t.value || '').trim().toLowerCase();
      if (!EMAIL_RE.test(v) || state.typed.some((x) => x.value === v)) return;
      const entry = { value: v, field: t.name || t.id || 'email field', hash: null };
      state.typed.push(entry);
      sha256(v).then((hsh) => { entry.hash = hsh; }).catch(() => {});
      log('input', `email typed into "${entry.field}" — watching whether it is sent to trackers`);
    };
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('change', onChange, true);
    cleanups.push(() => { document.removeEventListener('submit', onSubmit, true); document.removeEventListener('change', onChange, true); });
  }

  // =============================================================== listeners ==

  const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'change', 'paste', 'copy', 'cut']);
  const WATCH_EVENTS = new Set([...KEY_EVENTS, 'submit', 'focusin', 'focusout', 'blur', 'mousemove', 'pointermove', 'mousedown', 'click', 'touchstart', 'scroll', 'wheel', 'visibilitychange', 'pagehide', 'beforeunload', 'unload', 'selectionchange']);
  const EVENT_GROUPS = [
    [/^(keydown|keyup|keypress|input|beforeinput|change)$/, 'typing'],
    [/^(paste|copy|cut|selectionchange)$/, 'clipboard / selection'],
    [/^(mousemove|pointermove|mousedown|click|touchstart|wheel)$/, 'mouse & touch'],
    [/^(scroll)$/, 'scrolling'],
    [/^(focusin|focusout|blur|submit)$/, 'form focus / submit'],
    [/^(visibilitychange|pagehide|beforeunload|unload)$/, 'leaving the page'],
  ];

  function describeTarget(t) {
    if (t === window) return 'window';
    if (t === document) return 'document';
    if (t && t.tagName) return describeEl(t);
    return t && t.constructor ? t.constructor.name : '?';
  }

  function installListenerHook() {
    hookMethod(EventTarget.prototype, 'addEventListener', (orig) => function (type) {
      if (settings.detectListeners && !paused && WATCH_EVENTS.has(type) && (this === window || this === document || (this && this.nodeType === 1))) {
        try {
          const c = caller();
          if (c && (isThirdParty(c.host) || c.vendor)) {
            let rec = state.listeners.get(c.url);
            if (!rec) {
              rec = { key: 'l:' + c.url, script: c.url, host: c.host, vendor: c.vendor, caller: c, types: new Set(), targets: new Set(), first: now() };
              state.listeners.set(c.url, rec);
            }
            const isNew = !rec.types.has(type);
            rec.types.add(type);
            if (rec.targets.size < 20) rec.targets.add(describeTarget(this));
            if (isNew && KEY_EVENTS.has(type)) log('listener', `${c.vendor || c.host} listens to "${type}" on ${describeTarget(this)}`, rec.key);
            scheduleRender();
          }
        } catch {}
      }
      return orig.apply(this, arguments);
    });
  }

  // ============================================================ fingerprinting ==

  const fpBudget = {};
  function noteFP(tech, api, sample) {
    if (!settings.detectFingerprinting || paused) return;
    fpBudget[api] = (fpBudget[api] || 0) + 1;
    if (fpBudget[api] > 400) return; // hot APIs: stop attributing after a while
    const c = caller();
    if (!c) return; // our own snippet
    const key = `${tech}|${c.url}`;
    let rec = state.fp.get(key);
    if (!rec) {
      rec = { key: 'fp:' + key, tech, script: c.url, host: c.host, vendor: c.vendor, thirdParty: isThirdParty(c.host), caller: c, apis: {}, samples: new Set(), count: 0, first: now(), logged: false };
      state.fp.set(key, rec);
    }
    rec.count++;
    rec.apis[api] = (rec.apis[api] || 0) + 1;
    if (sample && rec.samples.size < (tech === 'fonts' ? 300 : 12)) rec.samples.add(trunc(sample, 200));
    if (!rec.logged && fpStrong(rec)) {
      rec.logged = true;
      log('fingerprint', `${FP_TECH[tech].label} by ${rec.vendor || c.host || 'page'}`, rec.key);
    }
    scheduleRender();
  }
  function fpStrong(rec) {
    if (rec.tech === 'navigator') return Object.keys(rec.apis).length >= 6;
    if (rec.tech === 'fonts') return rec.samples.size >= 10;
    return true;
  }

  function installFingerprintHooks() {
    const wrap = (obj, name, tech, info) => hookMethod(obj, name, (orig) => function () {
      const ret = orig.apply(this, arguments);
      try {
        const s = info ? info.call(this, arguments, ret) : '';
        if (s !== null) noteFP(tech, name, s);
      } catch {}
      return ret;
    });
    const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    const canvasSize = function () { const c = this.canvas || this; return `${c.width}×${c.height} canvas`; };
    wrap(HTMLCanvasElement.prototype, 'toDataURL', 'canvas', function (a, ret) { return `${this.width}×${this.height} canvas → ${String(ret).length} chars of image data`; });
    wrap(HTMLCanvasElement.prototype, 'toBlob', 'canvas', canvasSize);
    wrap(C2D, 'getImageData', 'canvas', canvasSize);
    wrap(C2D, 'measureText', 'fonts', function () { return this.font; });
    const glInfo = function (a, ret) { return a[0] === 37445 || a[0] === 37446 ? `${a[0] === 37445 ? 'GPU vendor' : 'GPU model'}: ${ret}` : null; };
    if (window.WebGLRenderingContext) wrap(WebGLRenderingContext.prototype, 'getParameter', 'webgl', glInfo);
    if (window.WebGL2RenderingContext) wrap(WebGL2RenderingContext.prototype, 'getParameter', 'webgl', glInfo);
    wrap(Navigator.prototype, 'getBattery', 'battery');
    if (window.MediaDevices) wrap(MediaDevices.prototype, 'enumerateDevices', 'devices');
    if (window.SpeechSynthesis) wrap(SpeechSynthesis.prototype, 'getVoices', 'voices', (a, ret) => `${ret?.length ?? 0} voices`);

    const wrapCtor = (name, tech, info) => {
      const Orig = window[name];
      if (typeof Orig !== 'function') return;
      const Wrapped = function (...args) {
        try { noteFP(tech, name, info ? info(args) : ''); } catch {}
        return Reflect.construct(Orig, args, new.target || Orig);
      };
      Wrapped.prototype = Orig.prototype;
      Object.setPrototypeOf(Wrapped, Orig);
      window[name] = Wrapped;
      cleanups.push(() => { window[name] = Orig; });
    };
    wrapCtor('OfflineAudioContext', 'audio', (a) => (a.length ? a.join(' / ') : ''));
    wrapCtor('webkitOfflineAudioContext', 'audio');
    wrapCtor('RTCPeerConnection', 'webrtc', (a) => safeJSON(a[0] || {}, 200));

    const wrapGetter = (proto, prop, tech) => {
      const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.get || !d.configurable) return;
      Object.defineProperty(proto, prop, {
        ...d,
        get() {
          const v = d.get.call(this);
          try { noteFP(tech, prop, `${prop} = ${typeof v === 'object' ? (v && 'length' in v ? `[${v.length} items]` : safeJSON(v, 80)) : v}`); } catch {}
          return v;
        },
      });
      cleanups.push(() => Object.defineProperty(proto, prop, d));
    };
    for (const p of ['hardwareConcurrency', 'deviceMemory', 'plugins', 'mimeTypes', 'platform', 'languages', 'maxTouchPoints', 'webdriver', 'vendor', 'userAgentData', 'connection', 'pdfViewerEnabled', 'oscpu', 'cpuClass']) wrapGetter(Navigator.prototype, p, 'navigator');
    for (const p of ['colorDepth', 'pixelDepth', 'availWidth', 'availHeight', 'availTop', 'availLeft']) wrapGetter(Screen.prototype, p, 'navigator');
  }

  // =================================================== DOM, globals, URL, links ==

  function checkImg(img) {
    if (!img.src || img.src.startsWith('data:')) return;
    const w = img.getAttribute('width'), hgt = img.getAttribute('height');
    const tiny = (img.complete && img.naturalWidth <= 1 && img.naturalHeight <= 1 && img.naturalWidth + img.naturalHeight > 0) || w === '1' || hgt === '1' || w === '0' || hgt === '0';
    if (tiny || (img.isConnected && isHidden(img))) consider(img.src, 'dom-img', { reason: tiny ? '1×1 image in page' : 'hidden image in page', el: img });
    else if (!img.complete) img.addEventListener('load', () => checkImg(img), { once: true });
  }
  function checkIframe(fr) {
    if (!fr.src || fr.src === 'about:blank' || fr.src.startsWith('javascript:')) return;
    const r = fr.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || isHidden(fr)) consider(fr.src, 'dom-iframe', { reason: 'hidden / tiny iframe', el: fr });
    else if (vendorByUrl(fr.src)) consider(fr.src, 'iframe', { reason: 'tracker iframe', el: fr });
  }
  function scanNode(node) {
    if (paused || node.nodeType !== 1 || node === host) return;
    if (node.tagName === 'IMG') checkImg(node);
    else if (node.tagName === 'IFRAME') checkIframe(node);
    node.querySelectorAll?.('img, iframe').forEach(scanNode);
  }
  let formScanTimer = null;
  function watchDom() {
    scanNode(document.documentElement);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') scanNode(m.target);
        else m.addedNodes.forEach(scanNode);
      }
      clearTimeout(formScanTimer);
      formScanTimer = setTimeout(scanForms, 500);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    cleanups.push(() => mo.disconnect());
  }

  function scanGlobals() {
    for (const v of VENDORS) for (const g of v.globals) {
      let present = false;
      try { present = g in window && window[g] != null; } catch {}
      if (present && !state.globals.has(g)) {
        state.globals.set(g, v.name);
        log('global', `window.${g} found → ${v.name} is loaded`);
      }
    }
  }

  let dlSeen = 0;
  function scanDataLayer() {
    const dl = window.dataLayer;
    if (!Array.isArray(dl)) return;
    if (dl.length < dlSeen) dlSeen = 0;
    for (; dlSeen < dl.length; dlSeen++) {
      let e = dl[dlSeen];
      if (e && Object.prototype.toString.call(e) === '[object Arguments]') e = Array.from(e);
      let label;
      if (Array.isArray(e)) {
        label = `gtag('${e[0]}', ${typeof e[1] === 'string' ? `'${e[1]}'` : '{…}'})`;
        if (e[0] === 'consent' && e[2] && typeof e[2] === 'object') {
          state.consent.google = { ...(state.consent.google || {}), ...e[2], mode: e[1] };
          log('consent', `Google Consent Mode ${e[1]}: ${Object.entries(e[2]).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      } else if (e && typeof e === 'object') {
        label = e.event ? `event: ${e.event}` : `data: ${Object.keys(e).slice(0, 4).join(', ')}`;
      } else label = String(e);
      const internal = /^event: gtm\./.test(label);
      state.dataLayer.push({ time: now(), label, internal, json: safeJSON(e, 4000), info: EVENT_INFO[String((e && e.event) || (Array.isArray(e) && e[1]) || '').toLowerCase()] || '' });
      if (state.dataLayer.length > 500) state.dataLayer.shift();
      if (!internal) log('dataLayer', label);
    }
  }

  function scanUrl() {
    const add = (where, u) => {
      const url = parseUrl(u);
      if (!url) return;
      for (const [k, v] of url.searchParams) if (URL_TRACKING.test(k)) state.urlParams.push({ where, key: k, value: v, meaning: explainParam(k).meaning || 'Tracking / attribution parameter' });
    };
    add('this page URL', location.href);
    if (document.referrer) add('referrer URL', document.referrer);
    if (location.hash.includes('=')) add('URL #hash', location.origin + '/?' + location.hash.slice(1));
  }

  function scanLinks() {
    const links = [...document.links].slice(0, 5000);
    const decorated = [];
    const ping = [];
    for (const a of links) {
      if (a.hasAttribute('ping')) ping.push({ el: a, href: a.href, ping: a.getAttribute('ping') });
      const u = parseUrl(a.href);
      if (!u || !/^https?:$/.test(u.protocol)) continue;
      const keys = [...u.searchParams.keys()].filter((k) => URL_TRACKING.test(k));
      if (keys.length) decorated.push({ el: a, href: a.href, keys, external: isThirdParty(u.hostname) });
    }
    state.links = { total: links.length, decorated: decorated.slice(0, 100), decoratedCount: decorated.length, ping: ping.slice(0, 50) };
  }

  // =================================================================== grading ==

  function vendorSummary() {
    const m = new Map();
    const get = (name) => {
      if (!name) return null;
      if (!m.has(name)) m.set(name, { name, v: VENDOR_BY_NAME.get(name) || { name, cat: 'unknown', desc: CATS.unknown.desc, company: '?' }, pixels: 0, hits: 0, cookies: [], storage: [], globals: [], domains: [], fp: [], listeners: 0 });
      return m.get(name);
    };
    for (const p of state.pixels.values()) { const e = get(p.vendor); if (e) { e.pixels++; e.hits += p.count; } }
    for (const c of state.cookies.values()) { const e = get(c.info.vendor); if (e) e.cookies.push(c.name); }
    for (const s of state.storage.values()) { const e = get(s.vendor); if (e) e.storage.push(s.name); }
    for (const [g, n] of state.globals) get(n).globals.push(g);
    for (const d of state.domains.values()) { const e = get(d.vendor); if (e) e.domains.push(d.domain); }
    for (const f of state.fp.values()) if (fpStrong(f)) { const e = get(f.vendor); if (e) e.fp.push(FP_TECH[f.tech].label); }
    for (const l of state.listeners.values()) { const e = get(l.vendor); if (e) e.listeners++; }
    m.delete('First-party pixel');
    return [...m.values()].sort((a, b) => (CATS[b.v.cat]?.risk || 0) - (CATS[a.v.cat]?.risk || 0) || b.hits - a.hits);
  }

  function concerns() {
    const out = [];
    const add = (level, text, tab, key) => out.push({ level, text, tab, key });
    for (const p of state.pixels.values()) {
      if (p.leaks && p.leaks.length) add('high', `Data you typed (${p.leaks.join(', ')}) was sent to ${p.vendor}`, 'pixels', p.key);
      if (p.pii.length) add('high', `Personal data (${[...new Set(p.pii.map((x) => x.key))].join(', ')}) sent to ${p.vendor}`, 'pixels', p.key);
      if (p.beforeConsent) add('high', `${p.vendor} fired although consent appears missing — ${p.beforeConsent}`, 'pixels', p.key);
      for (const r of p.params) {
        if (!r.cookie) continue;
        const c = state.cookies.get(r.cookie);
        if (c && c.info.vendor && c.info.vendor !== p.vendor && p.cat !== 'tagmgr') add('med', `ID from cookie "${r.cookie}" (${c.info.vendor}) shared with ${p.vendor}`, 'pixels', p.key);
      }
    }
    const vs = vendorSummary();
    for (const e of vs) if (e.v.cat === 'replay') add('high', `Session recording by ${e.name} — mouse, clicks, scrolling and possibly typing are recorded`, 'overview', 'v:' + e.name);
    for (const f of state.fp.values()) if (fpStrong(f) && f.tech !== 'navigator' && f.tech !== 'webrtc') add(f.thirdParty ? 'high' : 'med', `${FP_TECH[f.tech].label} by ${f.vendor || f.host}`, 'fingerprint', f.key);
    for (const f of state.fp.values()) if (fpStrong(f) && f.tech === 'navigator') add('med', `${f.vendor || f.host} reads ${Object.keys(f.apis).length} device attributes`, 'fingerprint', f.key);
    for (const l of state.listeners.values()) if ([...l.types].some((t) => KEY_EVENTS.has(t))) add('med', `${l.vendor || l.host} listens to typing/clipboard events`, 'forms', l.key);
    for (const f of state.forms.values()) if (f.thirdParty && (f.sensitive.length || f.kind === 'embedded')) add('med', `Form sends ${f.sensitive.join(', ') || 'your input'} to third party ${f.actionHost}`, 'forms', f.key);
    for (const f of state.forms.values()) if (f.trackingFields.length) add('low', `Form has ${f.trackingFields.length} hidden tracking field(s)`, 'forms', f.key);
    const ads = vs.filter((e) => e.v.cat === 'ads' || e.v.cat === 'exchange');
    if (ads.length && state.consent.gpc) add('med', `Your browser sends Global Privacy Control, yet ${ads.length} advertising tracker(s) loaded`, 'overview');
    if (ads.length >= 3) add('med', `${ads.length} advertising companies present: ${ads.map((e) => e.name).join(', ')}`, 'overview');
    const longLived = [...state.cookies.values()].filter((c) => c.info.kind === 'tracking' && c.expires && c.expires - Date.now() > 395 * 86400000);
    if (longLived.length) add('low', `${longLived.length} tracking cookie(s) live longer than 13 months: ${longLived.map((c) => c.name).join(', ')}`, 'cookies');
    if (state.links.decoratedCount) add('low', `${state.links.decoratedCount} link(s) on the page carry tracking parameters`, 'overview');
    const seen = new Set();
    return out.filter((c) => !seen.has(c.text) && seen.add(c.text)).sort((a, b) => ['high', 'med', 'low'].indexOf(a.level) - ['high', 'med', 'low'].indexOf(b.level));
  }

  function grade() {
    const vs = vendorSummary();
    const cs = concerns();
    const score = vs.reduce((n, e) => n + (CATS[e.v.cat]?.risk || 1), 0) + cs.reduce((n, c) => n + ({ high: 4, med: 2, low: 0.5 })[c.level], 0);
    const letter = score < 2 ? 'A' : score < 6 ? 'B' : score < 12 ? 'C' : score < 20 ? 'D' : score < 32 ? 'E' : 'F';
    return { score: Math.round(score * 10) / 10, letter, vendors: vs, concerns: cs };
  }

  // ======================================================================= UI ==
  // Built with DOM APIs (no innerHTML) so it works on Trusted Types pages,
  // inside a shadow root so page CSS can't break it.

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const badge = (text, cls = 'n', title) => h('span', { class: 'b ' + cls, title }, text);
  const catBadge = (cat) => badge(CATS[cat]?.label || cat || '?', CATS[cat]?.cls || 'n', CATS[cat]?.desc);
  const btn = (label, fn, title) => h('button', { title, onclick: (e) => { e.stopPropagation(); fn(e); } }, label);
  const sec = (title, ...kids) => h('div', { class: 'sec' }, h('div', { class: 'sech' }, title), ...kids);
  const kv = (rows) => h('table', { class: 'kv' }, rows.filter(Boolean).map(([k, v]) => h('tr', {}, h('td', { class: 'k' }, k), h('td', {}, v))));
  const pre = (t) => h('pre', {}, t);
  const dim = (...t) => h('span', { class: 'dim' }, ...t);

  const CSS = `
    :host { all: initial; }
    .box { --bg:#1b1d23; --bg2:#252933; --bg3:#111318; --fg:#e6e6e6; --dim:#8b93a7; --line:#2d323d; --hover:#222734; --btn:#333a48; --btnh:#445066;
      position: fixed; right: 12px; bottom: 12px; width: 620px; height: 70vh; min-width: 340px; min-height: 160px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      display: flex; flex-direction: column; z-index: 2147483647; resize: both;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--fg); background: var(--bg);
      border: 1px solid #3a3f4b; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.45); overflow: hidden; }
    .box.light { --bg:#fbfbfd; --bg2:#eceef3; --bg3:#fff; --fg:#1d2230; --dim:#636b7e; --line:#dde0e7; --hover:#f0f2f7; --btn:#dfe3ea; --btnh:#cfd5df; border-color:#c8ccd6; }
    .box.min { height: auto !important; min-height: 0; resize: none; }
    .box.min .body, .box.min .tools, .box.min .tabs { display: none; }
    .top { display: flex; align-items: center; gap: 5px; padding: 6px 8px; background: var(--bg2); cursor: move; user-select: none; }
    .title { font-weight: bold; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .grade { font-weight: bold; padding: 0 6px; border-radius: 4px; color: #fff; }
    .gA,.gB { background:#2f7a45 } .gC { background:#9a7a1c } .gD,.gE { background:#b0582a } .gF { background:#a3303f }
    .tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 6px 0; background: var(--bg2); }
    .tab { padding: 3px 8px; border-radius: 6px 6px 0 0; cursor: pointer; color: var(--dim); white-space: nowrap; }
    .tab.on { background: var(--bg); color: var(--fg); }
    .tools { display: flex; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line); align-items: center; }
    input[type=text] { flex: 1; min-width: 60px; background: var(--bg3); color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 3px 6px; font: inherit; }
    button { background: var(--btn); color: var(--fg); border: 0; border-radius: 4px; padding: 2px 7px; cursor: pointer; font: inherit; white-space: nowrap; }
    button:hover { background: var(--btnh); }
    .body { overflow: auto; padding: 6px 8px 20px; flex: 1; }
    .sum { color: var(--dim); margin-bottom: 6px; white-space: pre-wrap; }
    .row { border-bottom: 1px solid var(--line); word-break: break-word; }
    .head { padding: 4px 0; cursor: pointer; }
    .head:hover { background: var(--hover); }
    .head::before { content: '▸ '; color: var(--dim); }
    .row.open > .head::before { content: '▾ '; }
    .det { padding: 4px 0 10px 14px; }
    .sec { margin: 6px 0; }
    .sech { font-weight: bold; color: #7fb2ff; margin-bottom: 2px; }
    .light .sech { color: #2458b3; }
    .b { display: inline-block; padding: 0 5px; border-radius: 3px; margin-right: 4px; font-size: 11px; color: #fff; }
    .red { background: #a3303f; } .amber { background: #9a6a12; } .blue { background: #2e4f8a; } .green { background: #2f6f45; } .n { background: #5b6275; } .t { background: #3a4a6b; } .pii { background: #c0292f; }
    .dim { color: var(--dim); } .add { color: #3fae5a; } .chg { color: #c9a227; } .del { color: #e05d5d; } .warn { color: #ff8a65; }
    .note { color: var(--dim); font-size: 11px; margin: 6px 0; }
    table, td, tr { font: inherit; color: inherit; }
    table.kv { border-collapse: collapse; width: 100%; }
    table.kv td { vertical-align: top; padding: 1px 6px 1px 0; border-bottom: 1px dotted var(--line); word-break: break-all; }
    table.kv td.k { color: var(--dim); white-space: nowrap; word-break: normal; width: 1%; }
    table.params td { vertical-align: top; padding: 2px 6px 2px 0; border-bottom: 1px dotted var(--line); word-break: break-all; }
    pre { margin: 2px 0; padding: 4px 6px; background: var(--bg3); border: 1px solid var(--line); border-radius: 4px; white-space: pre-wrap; word-break: break-all; max-height: 260px; overflow: auto; font: inherit; }
    .acts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .card { border: 1px solid var(--line); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
    .big { font-size: 30px; font-weight: bold; padding: 2px 12px; border-radius: 6px; color: #fff; margin-right: 10px; }
    .flex { display: flex; align-items: center; }
    .c-high { color: #ff6b6b; } .c-med { color: #f0b429; } .c-low { color: var(--dim); }
    .clink { cursor: pointer; padding: 2px 0; } .clink:hover { text-decoration: underline; }
    .set { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
    .set input { margin-top: 2px; }
    .toast { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); background: #000c; color: #fff; padding: 5px 10px; border-radius: 5px; pointer-events: none; }
    .hl { position: fixed; z-index: 2147483646; border: 2px solid #ff3b5c; background: #ff3b5c22; pointer-events: none; border-radius: 3px; transition: all .2s; }
    .hl span { position: absolute; left: 0; top: -20px; background: #ff3b5c; color: #fff; font: 11px ui-monospace, monospace; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
    .newdot { color: #3fae5a; }
  `;

  const host = h('div', { id: 'cpm-host' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, CSS));

  let tab = 'overview';
  let filter = '';
  let hovering = false;
  let pendingWhileHover = false;
  const TABS = [['overview', 'Overview'], ['pixels', 'Pixels'], ['cookies', 'Cookies'], ['storage', 'Storage'], ['forms', 'Forms'], ['fingerprint', 'Fingerprint'], ['domains', 'Domains'], ['log', 'Log'], ['settings', '⚙']];
  const counts = {};
  const tabEls = {};
  const body = h('div', { class: 'body', onmouseenter: () => { hovering = true; }, onmouseleave: () => { hovering = false; if (pendingWhileHover) scheduleRender(); } });
  const gradeEl = h('span', { class: 'grade', title: 'Privacy grade (rough heuristic) — see Overview' });
  const newDot = h('span', { class: 'newdot', title: 'New data — move the mouse out of the list to refresh' });
  const pauseBtn = btn('Pause', () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; toast(paused ? 'Monitoring paused' : 'Monitoring resumed'); }, 'Pause / resume monitoring');
  const toastEl = h('div', { class: 'toast', style: 'display:none' });

  const box = h('div', { class: 'box' },
    h('div', { class: 'top' },
      h('span', { class: 'title' }, '🍪 Cookie & Pixel Monitor ', newDot),
      gradeEl,
      pauseBtn,
      btn('Export', () => api.export(), 'Download a JSON report'),
      btn('Copy', () => copyText(api.summary()).then(() => toast('Summary copied to clipboard')), 'Copy a text summary to the clipboard'),
      btn('_', () => box.classList.toggle('min'), 'Minimise'),
      btn('×', () => { host.remove(); clearHighlight(); }, 'Hide the panel (run the snippet again to show it; __cpm.stop() to fully stop)'),
    ),
    h('div', { class: 'tabs' }, TABS.map(([id, label]) => {
      counts[id] = h('span', { class: 'dim' });
      return (tabEls[id] = h('div', { class: 'tab', onclick: () => { tab = id; body.scrollTop = 0; render(); } }, label, ' ', counts[id]));
    })),
    h('div', { class: 'tools' },
      h('input', { type: 'text', placeholder: 'filter…', oninput: (e) => { filter = e.target.value.toLowerCase(); render(); } }),
      btn('Expand all', () => { body.querySelectorAll('.row').forEach((r) => r.dataset.key && expanded.add(r.dataset.key)); render(); }),
      btn('Collapse', () => { expanded.clear(); render(); }),
    ),
    body,
    toastEl,
  );
  root.append(box);

  // Drag by the header.
  box.firstChild.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => Object.assign(box.style, { left: Math.max(0, ev.clientX - dx) + 'px', top: Math.max(0, ev.clientY - dy) + 'px', right: 'auto', bottom: 'auto' });
    const up = () => { removeEventListener('mousemove', move, true); removeEventListener('mouseup', up, true); };
    addEventListener('mousemove', move, true);
    addEventListener('mouseup', up, true);
  });

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2200);
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return; } catch {}
    const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = t;
    root.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }

  // --- element highlighting -------------------------------------------------
  let hlEl = null, hlTimer = null;
  function clearHighlight() { if (hlEl) hlEl.remove(); hlEl = null; clearTimeout(hlTimer); }
  function highlight(el, label) {
    clearHighlight();
    if (!el || !el.isConnected) return toast('Element is no longer in the page');
    let target = el, note = '';
    const tooSmall = (x) => { const r = x.getBoundingClientRect(); return r.width < 4 || r.height < 4 || isHidden(x); };
    if (tooSmall(el)) {
      note = ' (hidden/1×1 — showing its container)';
      while (target.parentElement && tooSmall(target)) target = target.parentElement;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      hlEl = h('div', { class: 'hl', style: `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 2}px;height:${r.height + 2}px` }, h('span', { style: r.top < 24 ? 'top:0' : '' }, trunc((label || describeEl(el)) + note, 90)));
      root.append(hlEl);
      hlTimer = setTimeout(clearHighlight, 3500);
    }, 450);
  }
  function inspectEl(el) {
    if (!el) return;
    try { if (devInspect) { devInspect(el); return; } } catch {}
    console.log('[CPM] element (right-click → "Reveal in Elements panel"):', el);
    toast('Element logged to console');
  }
  function elementFacts(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = el.isConnected ? getComputedStyle(el) : null;
    return kv([
      ['Element', describeEl(el)],
      ['In page', el.isConnected ? 'yes' : 'no (detached / created in memory)'],
      ['Size', `${Math.round(r.width)}×${Math.round(r.height)} px${el.naturalWidth != null ? ` (image ${el.naturalWidth}×${el.naturalHeight})` : ''}`],
      ['Position', `x ${Math.round(r.left + scrollX)}, y ${Math.round(r.top + scrollY)} (page coordinates)`],
      cs && ['Visibility', `display:${cs.display}; visibility:${cs.visibility}; opacity:${cs.opacity}`],
      ['Inside', el.parentElement ? describeEl(el.parentElement) : '-'],
      ['HTML', pre(trunc(el.outerHTML, 600))],
    ]);
  }
  function elementActions(el, label) {
    return el ? [btn('Highlight on page', () => highlight(el, label)), btn('Inspect element', () => inspectEl(el)), btn('Log element', () => console.log('[CPM] element:', el))] : [];
  }

  // --- source location ------------------------------------------------------
  function locationView(c, what = 'Triggered by') {
    if (!c) return kv([[what, 'unknown — happened before the snippet started, came from HTML markup, or from a server response']]);
    return h('div', {},
      kv([
        [what, callerLabel(c)],
        c.vendor && ['Script vendor', c.vendor],
        ['Function', c.frames[0].fn || '(anonymous)'],
        ['Call stack', pre(c.frames.map((f) => `${f.fn || '(anonymous)'}  ${f.url}:${f.line}:${f.col}`).join('\n'))],
      ]),
      h('div', { class: 'acts' },
        btn('Open source (console link)', () => { console.log(`[CPM] source → ${c.url}:${c.line}:${c.col}`); toast('Clickable source link printed to console'); }),
        btn('Copy script URL', () => copyText(c.url).then(() => toast('Copied'))),
      ));
  }

  function paramTable(rows) {
    if (!rows.length) return dim('none');
    const groups = {};
    for (const r of rows) (groups[r.cat] ||= []).push(r);
    const order = ['pii', 'id', 'campaign', 'event', 'commerce', 'page', 'device', 'consent', 'account', 'tech', 'other'];
    return h('table', { class: 'params' }, order.filter((c) => groups[c]).map((c) => [
      h('tr', {}, h('td', { colspan: 3 }, h('b', { class: c === 'pii' ? 'warn' : '' }, PARAM_CATS[c] || c))),
      groups[c].map((r) => h('tr', {},
        h('td', { style: 'white-space:nowrap' }, r.key, r.source === 'body' ? dim(' (body)') : ''),
        h('td', {}, trunc(r.value, 300)),
        h('td', { class: 'dim' }, [r.meaning, ...r.notes].filter(Boolean).join(' · ')))),
    ]));
  }

  // --- generic row ------------------------------------------------------------
  function row(key, headKids, detailsFn) {
    const open = expanded.has(key);
    const r = h('div', { class: 'row' + (open ? ' open' : '') });
    r.dataset.key = key;
    r.append(h('div', { class: 'head', onclick: () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); } }, headKids));
    if (open) {
      let det;
      try { det = detailsFn(); } catch (e) { det = pre('Error rendering details: ' + e.message); }
      r.append(h('div', { class: 'det' }, det));
    }
    return r;
  }
  const matches = (...parts) => !filter || parts.join(' ').toLowerCase().includes(filter);
  const LIMIT = 400;
  function more(n) { return n > LIMIT ? h('div', { class: 'note' }, `Showing ${LIMIT} of ${n} — use the filter to narrow down.`) : ''; }
  function goTo(t, key) { tab = t; if (key) expanded.add(key); body.scrollTop = 0; render(); setTimeout(() => { const el = key && [...body.querySelectorAll('.row')].find((r) => r.dataset.key === key); if (el) el.scrollIntoView({ block: 'start' }); }, 0); }

  // --- Overview ---------------------------------------------------------------
  function renderOverview() {
    const g = grade();
    const cs = g.concerns;
    body.append(h('div', { class: 'card flex' },
      h('span', { class: `big g${g.letter}` }, g.letter),
      h('div', {},
        h('div', {}, h('b', {}, `${g.vendors.length} tracking/third-party companies · ${state.pixels.size} tracker requests · ${[...state.cookies.values()].filter((c) => c.info.kind === 'tracking').length} tracking cookies`)),
        dim(`Score ${g.score} (rough heuristic: category risk of each company + concerns). A = little/no tracking, F = heavy tracking.`),
        h('div', { class: 'dim' }, `${location.host} · monitoring since ${state.startedAt.toLocaleTimeString()}`))));

    body.append(sec(`Main concerns (${cs.length})`,
      cs.length ? cs.map((c) => h('div', { class: `clink c-${c.level}`, onclick: () => goTo(c.tab, c.key) }, `${c.level === 'high' ? '●' : c.level === 'med' ? '◐' : '○'} ${c.text}`))
        : dim('Nothing notable found (yet). Interact with the page — scroll, click, add to cart — trackers often fire on actions.')));

    body.append(sec('Companies on this page',
      g.vendors.length ? g.vendors.map((e) => row('v:' + e.name,
        [catBadge(e.v.cat), h('b', {}, e.name), dim(` ${e.v.company && e.v.company !== '?' ? '· ' + e.v.company : ''} · `, [e.hits && `${e.hits} hits`, e.cookies.length && `${e.cookies.length} cookies`, e.storage.length && `${e.storage.length} storage keys`, e.fp.length && 'fingerprinting', e.globals.length && 'script loaded'].filter(Boolean).join(', '))],
        () => [
          h('div', {}, e.v.desc),
          h('div', { class: 'note' }, `Category "${CATS[e.v.cat]?.label}": ${CATS[e.v.cat]?.desc || ''}`),
          kv([
            e.pixels && ['Requests', `${e.pixels} unique URLs, ${e.hits} hits`],
            e.domains.length && ['Domains', e.domains.join(', ')],
            e.cookies.length && ['Cookies', e.cookies.join(', ')],
            e.storage.length && ['Storage', e.storage.join(', ')],
            e.globals.length && ['JS objects', e.globals.map((x) => 'window.' + x).join(', ')],
            e.fp.length && ['Fingerprinting', [...new Set(e.fp)].join(', ')],
            e.listeners && ['Event listeners', `${e.listeners} script(s)`],
          ]),
          h('div', { class: 'acts' },
            e.pixels && btn('Show requests', () => { filter = ''; goTo('pixels'); setFilter(e.name); }),
            e.cookies.length && btn('Show cookies', () => { goTo('cookies'); setFilter(e.name); })),
        ])) : dim('None detected yet.')));

    const c = state.consent;
    const denied = marketingDenied();
    body.append(sec('Consent & privacy signals', kv([
      ['Consent manager', c.cmps && c.cmps.length ? c.cmps.join(', ') : 'none detected'],
      c.tcf && ['IAB TCF', `status ${c.tcf.status}, GDPR applies: ${c.tcf.gdprApplies}, purposes consented: ${Object.entries(c.tcf.purposes).filter(([, v]) => v).map(([k]) => k).join(',') || 'none'}, vendors consented: ${c.tcf.vendors}`],
      typeof c.onetrust === 'string' && ['OneTrust groups', pre(describeOneTrust(c.onetrust))],
      c.cookiebot && ['Cookiebot', Object.entries(c.cookiebot).map(([k, v]) => `${k}: ${v}`).join(', ')],
      c.google && ['Google Consent Mode', Object.entries(c.google).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`).join(', ')],
      ['Marketing consent', denied ? h('span', { class: 'warn' }, 'appears NOT given — ' + denied) : dim('given, not required, or unknown')],
      ['Global Privacy Control', c.gpc ? 'ON (your browser asks sites not to sell/share your data)' : 'off'],
      ['Do Not Track', c.dnt ? 'ON (ignored by most trackers)' : 'off'],
    ])));

    if (state.urlParams.length) {
      body.append(sec('Tracking parameters in the URL', kv(state.urlParams.map((p) => [p.key, h('span', {}, trunc(p.value, 120), dim(` — ${p.meaning} (${p.where})`))])),
        h('div', { class: 'note' }, 'These were added by the link you clicked (ad, email, social post) so the site can attribute your visit. Removing them from the URL before sharing avoids leaking them.')));
    }

    const L = state.links;
    if (L.decoratedCount || L.ping.length) {
      body.append(sec(`Link decoration (${L.decoratedCount} of ${L.total} links)`,
        h('div', { class: 'note' }, 'Links carrying tracking parameters pass your IDs to the next page (e.g. _gl = Google cross-domain linker with your client ID). <a ping> links notify a URL when clicked.'),
        L.decorated.slice(0, 30).map((d) => h('div', { class: 'clink', onclick: () => highlight(d.el, d.keys.join(', ')) }, badge(d.keys.join(', '), 'amber'), d.external ? badge('external', 'n') : '', trunc(d.href, 110))),
        L.ping.slice(0, 20).map((d) => h('div', { class: 'clink', onclick: () => highlight(d.el, 'ping → ' + d.ping) }, badge('ping', 'red'), trunc(d.href, 70), dim(' → ' + trunc(d.ping, 60))))));
    }

    const dl = state.dataLayer.filter((d) => !d.internal);
    body.append(sec(`Data layer events (${dl.length})`,
      h('div', { class: 'note' }, 'window.dataLayer is the queue the site uses to feed Google Tag Manager / gtag. It shows exactly what the site chose to report (events, products, user info).'),
      dl.length ? dl.slice(-40).reverse().map((d, i) => row('dl:' + d.time + d.label + i, [dim(d.time + ' '), d.label, d.info ? dim(' — ' + d.info) : ''], () => pre(d.json))) : dim('No dataLayer found.')));

    const gl = [...state.globals];
    if (gl.length) body.append(sec('Tracker JavaScript objects on window', dim(gl.map(([g, v]) => `window.${g} (${v})`).join(' · '))));
  }
  function setFilter(v) { filter = v.toLowerCase(); root.querySelector('input[type=text]').value = v; render(); }

  // --- Pixels -----------------------------------------------------------------
  function renderPixels() {
    const all = [...state.pixels.values()];
    const hits = all.reduce((n, p) => n + p.count, 0);
    body.append(h('div', { class: 'sum' }, `${all.length} unique tracker URLs, ${hits} hits. Click a row for explanation, decoded data, source and location.`));
    const list = all.filter((p) => matches(p.vendor, p.host, p.path, p.type, p.event, p.cat, p.reason, p.pii.length ? 'pii personal' : '')).reverse();
    for (const p of list.slice(0, LIMIT)) {
      body.append(row(p.key, [
        catBadge(p.cat),
        badge(p.vendor, 't'),
        badge(`${p.method} ${p.type}`, 'n'),
        p.count > 1 ? badge(`×${p.count}`, 'n') : null,
        p.pii.length || (p.leaks && p.leaks.length) ? badge('personal data', 'pii') : null,
        p.beforeConsent ? badge('no consent?', 'pii') : null,
        dim(p.last + ' '),
        `${p.host}${trunc(p.path, 60)}`,
        p.event ? h('span', { class: 'chg' }, ` ${p.event}`) : null,
      ], () => pixelDetails(p)));
    }
    body.append(more(list.length));
  }

  function pixelDetails(p) {
    const v = VENDOR_BY_NAME.get(p.vendor);
    const el = p.el || [...document.querySelectorAll('img,iframe,script')].find((e) => e.src === p.url) || null;
    if (el && !p.el) p.el = el;
    const ev = p.event && EVENT_INFO[String(p.event).toLowerCase()];
    const cats = [...new Set(p.params.map((r) => r.cat))].filter((c) => !['tech', 'other', 'account'].includes(c));
    return [
      sec('What is this?',
        h('div', {}, v ? v.desc : CATS[p.cat]?.desc),
        h('div', { class: 'note' }, `How it was sent — ${TYPE_INFO[p.type] || p.type}`),
        h('div', { class: 'note' }, `Why flagged: ${p.reason}${p.thirdParty ? ' · third-party domain' : ' · first-party domain (may be a server-side proxy)'}`),
        ev && h('div', {}, h('b', {}, `Event "${p.event}": `), ev),
        p.beforeConsent && h('div', { class: 'warn' }, `⚠ Fired while consent appears missing: ${p.beforeConsent}`)),
      sec('What data does it send?',
        cats.length ? h('div', {}, 'Contains: ', cats.map((c) => badge(PARAM_CATS[c], c === 'pii' ? 'pii' : c === 'id' ? 'red' : 'n'))) : dim('No meaningful parameters (the request itself — with your IP address, browser and cookies for that domain — is the signal).'),
        p.leaks && p.leaks.length ? h('div', { class: 'warn' }, `⚠ Contains what you typed into: ${p.leaks.join(', ')}`) : null,
        p.ids.length ? h('div', { class: 'note' }, `Identifiers: ${p.ids.map((r) => r.key + (r.cookie ? ` (= cookie ${r.cookie})` : '')).join(', ')}`) : null,
        h('div', { class: 'note' }, 'Every request also carries your IP address, user agent and any cookies the browser holds for the tracker\'s domain (third-party cookies are not visible here).'),
        paramTable(p.params)),
      sec('Request', kv([
        ['URL', pre(p.url)],
        ['Method / type', `${p.method} · ${p.type}`],
        ['Hits', `${p.count} (first ${p.first}, last ${p.last})`],
        p.body && ['Body', pre(prettyBody(p.body))],
        p.bodySize != null && p.bodySize > 0 && ['Body size', fmtBytes(p.bodySize)],
        p.messages && ['WebSocket', `${p.messages} messages sent, ${fmtBytes(p.bytesOut)}`],
        p.timing && ['Timing', `${p.timing.duration} ms, ${p.timing.startMs} ms after page start${p.timing.status ? ', HTTP ' + p.timing.status : ''}${p.timing.protocol ? ', ' + p.timing.protocol : ''}, transferred ${p.timing.transferSize ? fmtBytes(p.timing.transferSize) : '0 B / cross-origin hidden'}`],
      ])),
      sec('Where did it come from?', locationView(p.caller, 'Sent by script')),
      el ? sec('Where is it on the page?', elementFacts(el), h('div', { class: 'acts' }, elementActions(el, `${p.vendor} ${p.type}`))) : sec('Where is it on the page?', dim(p.type === 'img' || p.type === 'beacon' || p.type === 'fetch' || p.type === 'xhr' ? 'Not an element — sent directly from JavaScript (e.g. new Image(), sendBeacon, fetch), invisible to you.' : 'No matching element found in the page.')),
      h('div', { class: 'acts' },
        btn('Copy URL', () => copyText(p.url).then(() => toast('Copied'))),
        btn('Copy as cURL', () => copyText(`curl '${p.url.replace(/'/g, "'\\''")}'${p.method !== 'GET' ? ` -X ${p.method}` : ''}${p.body && !p.body.startsWith('[') ? ` --data-raw '${p.body.replace(/'/g, "'\\''")}'` : ''}`).then(() => toast('Copied cURL'))),
        btn('Log to console', () => console.log('[CPM] request', p)),
        btn('Filter same vendor', () => setFilter(p.vendor))),
    ];
  }
  function prettyBody(t) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch {}
    if (/^[^\s=&]+=/.test(t)) return t.split('\n').map((line) => [...new URLSearchParams(line)].map(([k, v]) => `${k} = ${v}`).join('\n')).join('\n-----\n');
    return t;
  }

  // --- Cookies ----------------------------------------------------------------
  function renderCookies() {
    const all = [...state.cookies.values()];
    const tracking = all.filter((c) => c.info.kind === 'tracking');
    body.append(h('div', { class: 'sum' }, `${all.length} cookies visible to JavaScript · ${tracking.length} known tracking · ${all.filter((c) => c.info.kind === 'functional').length} functional${settings.trackingCookiesOnly ? ' · (functional hidden — see ⚙)' : ''}`));
    const order = { tracking: 0, 'tracking?': 1, unknown: 2, consent: 3, functional: 4 };
    const list = all.filter((c) => (!settings.trackingCookiesOnly || c.info.kind !== 'functional') && matches(c.name, c.info.vendor, c.info.kind, c.domain, c.value))
      .sort((a, b) => order[a.info.kind] - order[b.info.kind] || a.name.localeCompare(b.name));
    for (const c of list.slice(0, LIMIT)) {
      body.append(row(c.key, [
        kindBadge(c.info),
        c.info.vendor ? badge(c.info.vendor, 't') : null,
        h('b', {}, c.name), ' ',
        dim(`${lifetime(c)}${c.changes ? ' · changed ×' + c.changes : ''}${c.preexisting ? '' : ' · new'} · `), trunc(c.value, 50),
      ], () => cookieDetails(c)));
    }
    body.append(more(list.length));
    body.append(h('div', { class: 'note' }, 'HttpOnly cookies (usually login sessions) and third-party cookies of tracker domains are invisible to page scripts — see DevTools → Application → Cookies, or Network → a request → Cookies.'));
  }
  function kindBadge(info) {
    const m = { tracking: ['tracking', 'red'], 'tracking?': ['possible ID', 'amber'], consent: ['consent', 'green'], functional: ['functional', 'blue'], unknown: ['unknown', 'n'] };
    const [t, c] = m[info.kind] || m.unknown;
    return badge(t, c);
  }
  function lifetime(c) {
    if (!c.detailed && !c.expires) return 'expiry n/a';
    if (!c.expires) return 'session';
    const days = (c.expires - Date.now()) / 86400000;
    return days < 1 ? `${Math.max(0, Math.round(days * 24))} h left` : `${Math.round(days)} days left`;
  }
  function cookieDetails(c) {
    const sentTo = [...state.pixels.values()].filter((p) => p.params.some((r) => r.cookie === c.name));
    const inForms = [...state.forms.values()].filter((f) => f.trackingFields.some((x) => x.tracking.includes(`"${c.name}"`)));
    const v = c.info.vendor && VENDOR_BY_NAME.get(c.info.vendor);
    const decoded = decodeValue(c.name, c.value);
    const days = c.expires ? (c.expires - Date.now()) / 86400000 : null;
    return [
      sec('What is this cookie?',
        h('div', {}, c.info.purpose),
        v && h('div', { class: 'note' }, `${v.name} (${v.company}): ${v.desc}`),
        c.info.typical && h('div', { class: 'note' }, `Typical lifetime: ${c.info.typical}`)),
      sec('Value', pre(c.value || '(empty)'), decoded.length ? kv(decoded.map(([k, val]) => [k, /\n/.test(val) ? pre(val) : val])) : null),
      sec('Properties', kv([
        ['Domain', c.domain ? `${c.domain} — shared with all subdomains of ${c.domain.replace(/^\./, '')}` : c.detailed ? `${location.hostname} (host-only)` : dim('n/a (cookieStore API unavailable)')],
        ['Path', c.path || (c.detailed ? '/' : 'n/a')],
        ['Expires', c.expires ? `${new Date(c.expires).toLocaleString()} — ${Math.round(days)} days${days > 395 ? ' ⚠ longer than 13 months' : ''}` : c.detailed ? 'session (deleted when the browser closes)' : 'n/a'],
        ['Secure', c.detailed ? (c.secure ? 'yes (HTTPS only)' : 'no') : 'n/a'],
        ['SameSite', c.sameSite ? `${c.sameSite}${c.sameSite === 'none' ? ' — also sent on cross-site requests' : ''}` : 'n/a'],
        c.partitioned && ['Partitioned', 'yes (CHIPS — isolated per top-level site)'],
        ['First seen', `${c.firstSeen}${c.preexisting ? ' (already existed when monitoring started)' : ''}`],
      ])),
      sec('Who set it?', c.setBy ? h('div', {}, locationView(c.setBy.caller, 'Written by'), kv([['Raw write', pre(c.setBy.raw)]]))
        : dim(c.preexisting ? 'Existed before the snippet started (set by an earlier page, a script that ran earlier, or the server via Set-Cookie). Reload the page and run the snippet quickly to catch the writer.' : 'Set by the server (Set-Cookie header) or by code that bypassed document.cookie.')),
      sec('Where is it used?',
        sentTo.length ? h('div', {}, 'Its value was sent to: ', sentTo.slice(0, 20).map((p) => h('span', { class: 'clink', onclick: () => goTo('pixels', p.key) }, badge(p.vendor, 't')))) : dim('Not seen in any recorded tracker request (it is still sent automatically to this site\'s own server with every request).'),
        inForms.length ? h('div', {}, `Copied into hidden field(s) of ${inForms.length} form(s)`) : null),
      c.history.length ? sec('Previous values', kv(c.history.map((x) => [x.time, trunc(x.value, 200)]))) : null,
      h('div', { class: 'acts' },
        btn('Copy value', () => copyText(c.value).then(() => toast('Copied'))),
        btn('Log to console', () => console.log('[CPM] cookie', c)),
        btn('Delete cookie', () => { if (confirm(`Delete cookie "${c.name}"? The site may set it again.`)) deleteCookie(c); })),
    ];
  }

  // --- Storage ----------------------------------------------------------------
  function renderStorage() {
    if (!settings.watchStorage) { body.append(dim('Storage monitoring is off (⚙ Settings).')); return; }
    const all = [...state.storage.values()];
    body.append(h('div', { class: 'sum' }, `${all.length} storage entries · ${all.filter((s) => s.vendor).length} from known trackers. Trackers copy their IDs here because web storage survives some cookie-clearing tools and is not sent to the server automatically.`));
    const list = all.filter((s) => matches(s.kind, s.name, s.vendor, s.value)).sort((a, b) => !!b.vendor - !!a.vendor || a.name.localeCompare(b.name));
    for (const s of list.slice(0, LIMIT)) {
      body.append(row(s.key, [
        badge(s.kind === 'local' ? 'localStorage' : s.kind === 'session' ? 'sessionStorage' : 'IndexedDB', 'n'),
        s.vendor ? badge(s.vendor, 't') : kindBadge(s.info),
        h('b', {}, trunc(s.name, 60)), ' ', dim(fmtBytes(s.value.length) + ' · '), trunc(s.value, 50),
      ], () => [
        sec('What is this?', h('div', {}, s.info.purpose || (s.vendor ? VENDOR_BY_NAME.get(s.vendor)?.desc : '')),
          h('div', { class: 'note' }, s.kind === 'local' ? 'localStorage: persists until explicitly cleared; readable by every script on this site.' : s.kind === 'session' ? 'sessionStorage: lives until this tab is closed.' : 'IndexedDB: structured database; persists until cleared.')),
        sec('Value', pre(trunc(s.value, 5000) || '(empty)'), (() => { const d = decodeValue(s.name, s.value); return d.length ? kv(d.map(([k, val]) => [k, /\n/.test(val) ? pre(val) : val])) : null; })()),
        sec('Who wrote it?', s.setBy ? locationView(s.setBy.caller, 'Written by') : dim(s.preexisting ? 'Existed before monitoring started.' : 'unknown')),
        s.kind !== 'indexedDB' && h('div', { class: 'acts' },
          btn('Copy value', () => copyText(s.value).then(() => toast('Copied'))),
          btn('Remove key', () => { if (confirm(`Remove ${s.kind}Storage key "${s.name}"?`)) { storageArea(s.kind).removeItem(s.name); syncStorage(); } })),
      ]));
    }
    body.append(more(list.length));
  }

  // --- Forms ------------------------------------------------------------------
  function renderForms() {
    if (!settings.watchForms && !settings.detectListeners) { body.append(dim('Form analysis and listener detection are off (⚙ Settings).')); return; }
    const forms = [...state.forms.values()].filter((f) => matches(f.actionHost, f.vendor, f.sensitive.join(' '), f.fields.map((x) => x.name).join(' ')));
    body.append(h('div', { class: 'sum' }, `${state.forms.size} forms · ${[...state.forms.values()].filter((f) => f.thirdParty).length} send to a third party · ${state.listeners.size} third-party scripts with input/mouse listeners · ${state.submissions.length} submissions seen`));
    body.append(sec('Forms on this page', forms.length ? forms.map((f) => row(f.key, [
      badge(f.kind === 'embedded' ? 'embedded form' : 'form', f.thirdParty ? 'red' : 'blue'),
      f.vendor ? badge(f.vendor, 't') : null,
      f.sensitive.map((s) => badge(s, s === 'password' || s === 'payment' ? 'pii' : 'amber')),
      f.trackingFields.length ? badge(`${f.trackingFields.length} hidden tracking`, 'red') : null,
      `→ ${f.actionHost || 'same page'} `, dim(f.method), f.submits ? dim(` · submitted ×${f.submits}`) : null,
    ], () => formDetails(f))) : dim('No forms found.')));

    const ls = [...state.listeners.values()].filter((l) => matches(l.host, l.vendor, [...l.types].join(' ')));
    body.append(sec('Third-party scripts listening to your input',
      h('div', { class: 'note' }, 'Scripts from other companies that registered handlers for typing, clipboard, mouse movement or leaving the page (only listeners added after the snippet started are seen). Session-recording tools need these to capture what you do.'),
      ls.length ? ls.map((l) => row(l.key, [
        l.vendor ? badge(l.vendor, 't') : badge(l.host, 'n'),
        EVENT_GROUPS.filter(([re]) => [...l.types].some((t) => re.test(t))).map(([, g]) => badge(g, g === 'typing' || g.startsWith('clip') ? 'red' : 'n')),
      ], () => [
        kv([['Script', l.script], ['Events', [...l.types].join(', ')], ['Attached to', [...l.targets].join(', ')], ['First seen', l.first]]),
        [...l.types].some((t) => KEY_EVENTS.has(t)) && h('div', { class: 'warn' }, 'This script can observe what you type (keystrokes / input values) on the elements above. Legitimate for autocomplete/validation, but also how session recorders and some "form abandonment" tools capture data.'),
        sec('Registered by', locationView(l.caller, 'First listener added by')),
      ])) : dim('None seen.')));

    if (state.submissions.length) body.append(sec('Form submissions', kv(state.submissions.slice(-20).reverse().map((s) => [s.time, `→ ${s.action} · ${s.fields.join(', ') || '-'}`]))));
    if (state.typed.length) body.append(sec('Watched typed values', h('div', { class: 'note' }, `${state.typed.length} email address(es) you typed are compared (plain and SHA-256) against every tracker request. Kept in memory only.`)));
  }
  function formDetails(f) {
    const el = f.el && f.el.isConnected ? f.el : null;
    return [
      sec('What is this?',
        h('div', {}, f.kind === 'embedded' ? `A form embedded from ${f.actionHost}. Everything you type goes directly to that company.` : f.thirdParty ? `This form submits to a different company's domain (${f.actionHost}). Whatever you enter is sent to them.` : 'This form submits to the site itself.'),
        f.sensitive.length ? h('div', { class: 'note' }, `Collects: ${f.sensitive.join(', ')}.`) : null,
        f.trackingFields.length ? h('div', { class: 'warn' }, 'Hidden fields silently attach tracking/attribution data (campaign, cookie IDs) to your submission, linking your identity to your browsing history.') : null,
        vendorSummary().some((e) => e.v.cat === 'replay') && f.sensitive.length ? h('div', { class: 'warn' }, 'A session-recording tool is active on this page — typed values may be captured unless the site masks these fields.') : null),
      f.fields.length ? sec(`Fields (${f.fields.length})`, h('table', { class: 'params' }, f.fields.map((x) => h('tr', {},
        h('td', {}, x.name), h('td', { class: 'dim' }, x.type), h('td', {}, x.sensitive ? badge(x.sensitive, 'amber') : '', x.hidden ? trunc(x.value, 80) : ''), h('td', { class: x.tracking ? 'warn' : 'dim' }, x.tracking || ''))))) : null,
      sec('Destination', kv([['Action', f.action || '-'], ['Method', f.method], ['Third party', f.thirdParty ? 'yes' : 'no'], ['Submitted', `${f.submits} time(s)`]])),
      el ? sec('Where is it on the page?', elementFacts(el), h('div', { class: 'acts' }, elementActions(el, 'form → ' + f.actionHost))) : null,
    ];
  }

  // --- Fingerprint ------------------------------------------------------------
  function renderFingerprint() {
    if (!settings.detectFingerprinting) { body.append(dim('Fingerprinting detection is off (⚙ Settings).')); return; }
    const all = [...state.fp.values()];
    const strong = all.filter(fpStrong);
    body.append(h('div', { class: 'sum' }, `${strong.length} fingerprinting signal(s) from ${new Set(strong.map((f) => f.host)).size} script host(s)${settings.showWeakFingerprint ? '' : ` · ${all.length - strong.length} weak signals hidden (⚙)`}.\nOnly API calls after the snippet started are seen — reload + run quickly to catch fingerprinting on page load.`));
    const list = (settings.showWeakFingerprint ? all : strong).filter((f) => matches(f.tech, f.host, f.vendor, FP_TECH[f.tech].label)).sort((a, b) => b.thirdParty - a.thirdParty);
    for (const f of list.slice(0, LIMIT)) {
      body.append(row(f.key, [
        badge(FP_TECH[f.tech].label, fpStrong(f) ? (f.tech === 'navigator' || f.tech === 'webrtc' ? 'amber' : 'red') : 'n'),
        f.vendor ? badge(f.vendor, 't') : null,
        f.thirdParty ? badge('third party', 'n') : badge('first party', 'blue'),
        dim(`${f.host || 'inline'} · ${f.count} calls`),
      ], () => [
        sec('What is this?', h('div', {}, FP_TECH[f.tech].desc), !fpStrong(f) && h('div', { class: 'note' }, 'Weak signal: below the threshold usually seen in fingerprinting scripts.')),
        sec('API calls', kv(Object.entries(f.apis).map(([k, n]) => [k, `${n}×`]))),
        f.samples.size ? sec(f.tech === 'fonts' ? `Fonts measured (${f.samples.size})` : 'What the script learned', pre([...f.samples].join('\n'))) : null,
        sec('Where did it come from?', locationView(f.caller, 'Called from')),
      ]));
    }
    body.append(more(list.length));
  }

  // --- Domains ----------------------------------------------------------------
  function renderDomains() {
    const all = [...state.domains.values()].sort((a, b) => b.requests - a.requests);
    body.append(h('div', { class: 'sum' }, `${all.length} third-party domains contacted · ${all.filter((d) => d.vendor).length} identified. Each one receives your IP address and browser details, and can set/read its own cookies.`));
    const list = all.filter((d) => matches(d.domain, d.vendor, [...d.hosts].join(' ')));
    for (const d of list.slice(0, LIMIT)) {
      body.append(row(d.key, [
        d.cat ? catBadge(d.cat) : badge('third party', 'n'),
        d.vendor ? badge(d.vendor, 't') : null,
        h('b', {}, d.domain), dim(` · ${d.requests} req · ${fmtBytes(d.bytes)} · ${Object.keys(d.types).join(', ')}`),
      ], () => {
        const v = d.vendor && VENDOR_BY_NAME.get(d.vendor);
        const px = [...state.pixels.values()].filter((p) => baseDomain(p.host.split(':')[0]) === d.domain);
        return [
          sec('Who is this?', v ? h('div', {}, `${v.name} (${v.company}) — ${v.desc}`) : dim('Not in the built-in list. Could be a CDN, font/image host, API, or an unlisted tracker.')),
          kv([
            ['Hosts', [...d.hosts].join(', ')],
            ['Requests', Object.entries(d.types).map(([t, n]) => `${t}: ${n}`).join(', ')],
            ['Transferred', fmtBytes(d.bytes) + (d.bytes === 0 ? ' (sizes hidden cross-origin)' : '')],
            d.scripts.size && ['Scripts', pre([...d.scripts].slice(0, 20).join('\n'))],
            px.length && ['Tracker hits', `${px.length} URLs flagged (see Pixels)`],
          ]),
          h('div', { class: 'acts' }, px.length && btn('Show tracker hits', () => { goTo('pixels'); setFilter(d.domain.split('.')[0]); })),
        ];
      }));
    }
    body.append(more(list.length));
  }

  // --- Log --------------------------------------------------------------------
  function renderLog() {
    const cls = { pixel: 'warn', 'cookie+': 'add', 'cookie~': 'chg', 'cookie-': 'del', cookie: 'dim', 'storage+': 'add', 'storage-': 'del', storage: 'dim', fingerprint: 'warn', listener: 'chg', form: 'chg', submit: 'chg', consent: 'add', global: 'dim', dataLayer: 'dim', input: 'chg' };
    const tabFor = (ref) => ({ p: 'pixels', c: 'cookies', s: 'storage', f: 'forms', l: 'forms', fp: 'fingerprint' })[String(ref).split(':')[0]];
    body.append(h('div', { class: 'sum' }, `Monitoring since ${state.startedAt.toLocaleTimeString()} on ${state.page}\nClick an entry to jump to its details.`, h('div', { class: 'acts' }, btn('Clear log', () => { state.log = []; render(); }))));
    const list = state.log.filter((e) => matches(e.kind, e.text));
    for (const e of list.slice(-LIMIT).reverse()) {
      body.append(h('div', { class: 'row' }, h('div', { class: 'head', style: e.ref ? '' : 'cursor:default', onclick: () => e.ref && tabFor(e.ref) && goTo(tabFor(e.ref), e.ref) },
        dim(e.time + ' '), badge(e.kind, 'n'), h('span', { class: cls[e.kind] || '' }, e.text))));
    }
  }

  // --- Settings ---------------------------------------------------------------
  function renderSettings() {
    body.append(h('div', { class: 'sum' }, 'Saved in this site\'s localStorage (key __cpm_settings). Detection hooks stay installed; switching off just ignores their data.'));
    for (const [k, label, desc] of SETTING_INFO) {
      body.append(h('label', { class: 'set' },
        h('input', { type: 'checkbox', checked: settings[k], onchange: (e) => { settings[k] = e.target.checked; saveSettings(); applySettings(); render(); } }),
        h('div', {}, h('b', {}, label), h('div', { class: 'dim' }, desc))));
    }
    body.append(sec('Data', h('div', { class: 'acts' },
      btn('Rescan page now', () => { rescan(); toast('Rescanned'); }),
      btn('Reset collected data', () => { if (confirm('Clear everything collected so far?')) { for (const k of ['pixels', 'cookies', 'storage', 'forms', 'listeners', 'fp', 'domains', 'globals']) state[k].clear(); state.log = []; state.dataLayer = []; dlSeen = 0; firstCookieSync = true; firstStorageSync = true; rescan(); } }),
      btn('Print report to console', () => api.report()),
      btn('Stop monitor & remove hooks', () => api.stop()))));
    body.append(sec('About', h('div', { class: 'note' }, 'Grades and classifications are heuristics based on a built-in list of ~50 vendors, known cookie names and URL patterns. Things run before you start the snippet are only partly visible (network requests are recovered from the browser buffer; who set a cookie is not). For complete coverage, reload the page and run the snippet immediately, or combine with DevTools → Network / Application.')));
  }

  let outlined = [];
  function applySettings() {
    box.classList.toggle('light', !!settings.lightTheme);
    outlined.forEach(([el, v]) => { el.style.outline = v; });
    outlined = [];
    if (settings.outlineElements) {
      const els = new Set([...state.pixels.values()].map((p) => p.el).concat([...state.forms.values()].map((f) => f.el)).filter((el) => el && el.isConnected && el.style));
      for (const el of els) { outlined.push([el, el.style.outline]); el.style.outline = '2px dashed #ff3b5c'; }
    }
  }

  // --- render loop ------------------------------------------------------------
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(render, 300);
  }
  function render() {
    renderQueued = false;
    if (!host.isConnected) return;
    const n = {
      overview: '', pixels: state.pixels.size, cookies: state.cookies.size, storage: state.storage.size, forms: state.forms.size + state.listeners.size,
      fingerprint: [...state.fp.values()].filter(fpStrong).length, domains: state.domains.size, log: state.log.length, settings: '',
    };
    for (const [id] of TABS) { counts[id].textContent = n[id] === '' ? '' : `(${n[id]})`; tabEls[id].classList.toggle('on', id === tab); }
    const g = grade();
    gradeEl.textContent = g.letter;
    gradeEl.className = `grade g${g.letter}`;
    // Don't rebuild the list under the mouse (it would jump / lose text selection).
    if (hovering && renderedTab === tab && renderedFilter === filter && !forceRender) { pendingWhileHover = true; newDot.textContent = '●'; return; }
    forceRender = false;
    pendingWhileHover = false;
    newDot.textContent = '';
    const scroll = body.scrollTop;
    body.replaceChildren();
    try {
      ({ overview: renderOverview, pixels: renderPixels, cookies: renderCookies, storage: renderStorage, forms: renderForms, fingerprint: renderFingerprint, domains: renderDomains, log: renderLog, settings: renderSettings })[tab]();
    } catch (e) {
      body.append(pre('Render error: ' + (e && e.stack)));
    }
    if (renderedTab === tab) body.scrollTop = scroll;
    renderedTab = tab;
    renderedFilter = filter;
  }
  let renderedTab = null, renderedFilter = '', forceRender = false;
  // Clicks inside the panel are deliberate — always re-render for them.
  body.addEventListener('click', () => { forceRender = true; }, true);
  root.querySelector('.tabs').addEventListener('click', () => { forceRender = true; }, true);

  // ====================================================================== API ==

  function plain(rec) {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'el') out.element = v ? describeEl(v) : null;
      else if (v instanceof Set) out[k] = [...v];
      else out[k] = v;
    }
    return out;
  }

  const api = {
    show() { if (!host.isConnected) document.documentElement.append(host); box.classList.remove('min'); forceRender = true; render(); },
    data() {
      const g = grade();
      return {
        page: state.page, startedAt: state.startedAt.toISOString(), exportedAt: new Date().toISOString(),
        grade: { letter: g.letter, score: g.score }, concerns: g.concerns.map(({ level, text }) => ({ level, text })),
        companies: g.vendors.map((e) => ({ name: e.name, category: CATS[e.v.cat]?.label, company: e.v.company, hits: e.hits, cookies: e.cookies, storage: e.storage, fingerprinting: e.fp })),
        consent: { ...state.consent },
        pixels: [...state.pixels.values()].map(plain),
        cookies: [...state.cookies.values()].map(plain),
        storage: [...state.storage.values()].map(plain),
        forms: [...state.forms.values()].map((f) => plain({ ...f })),
        listeners: [...state.listeners.values()].map(plain),
        fingerprinting: [...state.fp.values()].map(plain),
        domains: [...state.domains.values()].map(plain),
        urlParams: state.urlParams,
        dataLayer: state.dataLayer,
        log: state.log.map(({ time, kind, text }) => ({ time, kind, text })),
      };
    },
    summary() {
      const g = grade();
      const lines = [`Cookie & Pixel Monitor — ${location.href}`, `Grade ${g.letter} (score ${g.score}) · ${new Date().toLocaleString()}`, '', 'Concerns:'];
      g.concerns.forEach((c) => lines.push(`  [${c.level}] ${c.text}`));
      lines.push('', 'Companies:');
      g.vendors.forEach((e) => lines.push(`  - ${e.name} (${CATS[e.v.cat]?.label}) — ${e.hits} hits, cookies: ${e.cookies.join(', ') || '-'}`));
      lines.push('', 'Tracking cookies:');
      [...state.cookies.values()].filter((c) => c.info.kind === 'tracking').forEach((c) => lines.push(`  - ${c.name} [${c.info.vendor || '?'}] ${lifetime(c)} — ${c.info.purpose}`));
      lines.push('', `Tracker requests: ${state.pixels.size} unique · third-party domains: ${state.domains.size}`);
      return lines.join('\n');
    },
    report() {
      console.group('%c[CPM] Report', 'color:#0a7;font-weight:bold');
      console.log(api.summary());
      console.table([...state.pixels.values()].map((p) => ({ vendor: p.vendor, type: p.type, method: p.method, host: p.host, path: p.path, event: p.event, hits: p.count, pii: p.pii.map((x) => x.key).join(',') })));
      console.table([...state.cookies.values()].map((c) => ({ name: c.name, kind: c.info.kind, vendor: c.info.vendor, lifetime: lifetime(c), purpose: c.info.purpose })));
      console.groupEnd();
    },
    export() {
      const blob = new Blob([JSON.stringify(api.data(), null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `cpm-${location.hostname}-${Date.now()}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    stop() {
      cleanups.forEach((fn) => { try { fn(); } catch {} });
      outlined.forEach(([el, v]) => { el.style.outline = v; });
      clearHighlight();
      host.remove();
      delete window.__cpm;
      console.log('%c[CPM] stopped, hooks removed', 'color:#0a7');
    },
    settings,
    state,
  };
  window.__cpm = api;

  // ==================================================================== start ==

  function rescan() {
    syncCookies();
    syncStorage();
    scanNode(document.documentElement);
    scanForms();
    scanGlobals();
    scanDataLayer();
    scanLinks();
    checkConsent();
    applySettings();
    forceRender = true;
    render();
  }

  // Hooks first so nothing slips through while we set up.
  installNetworkHooks();
  installCookieHooks();
  installStorageHooks();
  installListenerHook();
  installFingerprintHooks();
  watchFormEvents();

  api.show();
  scanUrl();
  syncCookies().then(() => {
    // Cookies and consent are known now, so earlier requests are judged correctly.
    scanDataLayer();
    checkConsent();
    watchResources();
    watchCookies();
    watchDom();
    rescan();
    const t1 = setInterval(() => { if (paused) return; scanGlobals(); scanDataLayer(); checkConsent(); if (settings.watchStorage) syncStorage(); }, 1500);
    const t2 = setInterval(() => { if (!paused) { scanForms(); scanLinks(); applySettings(); } }, 5000);
    cleanups.push(() => { clearInterval(t1); clearInterval(t2); });
  });

  console.log('%c[CPM] Cookie & Pixel Monitor v2 running. Commands: __cpm.report(), __cpm.export(), __cpm.data(), __cpm.stop()', 'color:#0a7;font-weight:bold');
})();
