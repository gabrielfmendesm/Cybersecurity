/*
  Privacy Guard – background script
  - Loads EasyList and extracts tracking domains
  - Blocks requests to matching domains
  - Tracks third-party connections, cookies, storage, cookie sync, fingerprinting
  - Serves stats to popup
*/

// Utility: simple eTLD+1 approximation (not perfect, but good enough for scoring)
function baseDomain(hostname) {
  if (!hostname) return '';
  const parts = String(hostname).toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  // Heuristic: handle some common multi-part TLDs
  const tlds2 = new Set(['co.uk', 'com.br', 'com.au', 'com.ar', 'co.jp', 'co.kr', 'co.in']);
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (tlds2.has(last2)) return parts.slice(-3).join('.');
  if (tlds2.has(last3)) return parts.slice(-4).join('.');
  return parts.slice(-2).join('.');
}

function isSubdomainOf(host, domain) {
  host = host.toLowerCase();
  domain = domain.toLowerCase();
  return host === domain || host.endsWith('.' + domain);
}

// Parse EasyList domains from file. We only use host-based rules like ||domain^
async function loadEasyListDomains() {
  const url = browser.runtime.getURL('assets/easylist.txt');
  const text = await fetch(url).then(r => r.text());
  const domains = new Set();
  const re = /^\|\|([^\^\/\*]+)\^/; // capture hostname from ||domain^
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    const m = line.match(re);
    if (m) {
      const host = m[1].toLowerCase();
      // skip if contains wildcards in middle of domain
      if (host.includes('*') || host.includes('^')) continue;
      // keep only plausible hostnames
      if (/^[a-z0-9.-]+$/.test(host) && host.includes('.')) {
        domains.add(host);
      }
    }
  }
  return domains;
}

const state = {
  trackerDomains: new Set(),
  userBlocklist: new Set(),
  userAllowlist: new Set(),
  // per tab stats
  tabs: new Map(),
};

function resetTab(tabId, topUrl) {
  state.tabs.set(tabId, {
    topUrl: topUrl || '',
    topDomain: topUrl ? baseDomain(new URL(topUrl).hostname) : '',
    thirdPartyConnections: {}, // domain -> count
    requests: [], // recent requests summary
    blockedTrackers: {}, // domain -> count (combined)
    blockedTrackersFirst: {}, // domain -> count (1P)
    blockedTrackersThird: {}, // domain -> count (3P)
    setCookieCount: 0,
    sessionCookieSets: 0,
    persistentCookieSets: 0,
    cookieHeaderCount: 0,
    firstPartyCookieSets: 0,
    thirdPartyCookieSets: 0,
    hookRiskEvents: 0,
    cookieSyncEvents: [],
    canvasFingerprintEvents: 0,
    storage: { local: {keys:0, bytes:0}, session: {keys:0, bytes:0}, idb: {dbs:0} },
    privacyScore: 100,
    knownCookies: { names: new Set(), values: new Set() },
    updatedAt: Date.now(),
  });
}

// Update privacy score with a simple heuristic
function computeScore(t) {
  let score = 100;
  const blocked = Object.values(t.blockedTrackers).reduce((a,b)=>a+b,0);
  const thirdParties = Object.values(t.thirdPartyConnections).reduce((a,b)=>a+b,0);
  score -= Math.min(40, blocked * 2);
  score -= Math.min(20, Math.floor(thirdParties / 5));
  score -= Math.min(10, Math.floor(t.setCookieCount / 5));
  score -= Math.min(10, Math.floor((t.storage.local.keys + t.storage.session.keys)/10));
  if (t.canvasFingerprintEvents>0) score -= 15;
  if (t.hookRiskEvents>0) score -= Math.min(15, Math.floor(t.hookRiskEvents/5)*5);
  if (t.cookieSyncEvents.length>0) score -= 15;
  if (score < 0) score = 0;
  return score;
}

async function refreshKnownCookies(tabId, url) {
  try {
    const u = new URL(url);
    const cookies = await browser.cookies.getAll({url: u.origin});
    const names = new Set();
    const values = new Set();
    for (const c of cookies) {
      if (c.name) names.add(c.name);
      if (c.value && c.value.length >= 8) values.add(c.value);
    }
    const t = state.tabs.get(tabId);
    if (t) t.knownCookies = {names, values};
  } catch (e) {
    // ignore
  }
}

function parseQueryParams(urlStr) {
  try {
    const url = new URL(urlStr);
    const out = [];
    url.searchParams.forEach((v,k)=>{ out.push({k, v}); });
    return out;
  } catch { return []; }
}

function detectCookieSync(t, reqUrl) {
  const params = parseQueryParams(reqUrl);
  if (!params.length) return;
  const hits = [];
  for (const {k,v} of params) {
    if (!v || v.length < 8) continue;
    if (t.knownCookies.names.has(k)) hits.push({type:'name-match', key:k, value:v});
    if (t.knownCookies.values.has(v)) hits.push({type:'value-match', key:k, value:v});
    // common id parameter names
    if (/(sid|session|uid|userid|user_id|guid|cid|clientid|deviceid|did|aid|adid|ga|_ga|fbp|fbc)/i.test(k)) {
      hits.push({type:'suspicious-param', key:k, value:v});
    }
  }
  if (hits.length) {
    t.cookieSyncEvents.push({ url: reqUrl, matches: hits.slice(0,3), time: Date.now() });
  }
}

// Handle navigation to reset stats
browser.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  resetTab(details.tabId, details.url);
  await refreshKnownCookies(details.tabId, details.url);
});

// Load EasyList and set up listeners
(async function init() {
  try {
    state.trackerDomains = await loadEasyListDomains();
  } catch (e) {
    console.error('Failed to load EasyList:', e);
    state.trackerDomains = new Set();
  }

  // Load user lists from storage
  async function loadUserLists() {
    try {
      const { userBlocklist = [], userAllowlist = [] } = await browser.storage.sync.get(['userBlocklist','userAllowlist']);
      const norm = (arr) => new Set((Array.isArray(arr)?arr:[]).map(x => String(x || '').toLowerCase().trim()).filter(Boolean));
      state.userBlocklist = norm(userBlocklist);
      state.userAllowlist = norm(userAllowlist);
    } catch (e) {
      // keep previous
    }
  }
  await loadUserLists();

  // React to storage changes (sync lists)
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let need = false;
    if (changes.userBlocklist) need = true;
    if (changes.userAllowlist) need = true;
    if (need) {
      // refresh asynchronously
      Promise.resolve().then(() => loadUserLists());
    }
  });

  // Intercept requests
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const { tabId, url, type, originUrl, documentUrl, initiator } = details;
      if (tabId < 0) return {}; // not a tab
      const t = state.tabs.get(tabId) || (resetTab(tabId), state.tabs.get(tabId));
      const reqHost = (()=>{ try { return new URL(url).hostname; } catch { return ''; } })();
      const topDom = t.topDomain || (documentUrl ? baseDomain(new URL(documentUrl).hostname) : '');
      const reqBase = baseDomain(reqHost);
      const isThird = topDom && reqBase && topDom !== reqBase;

      if (isThird) {
        t.thirdPartyConnections[reqBase] = (t.thirdPartyConnections[reqBase]||0)+1;
      }

      // Tracker match with personalization (allowlist > userBlocklist > EasyList)
      let isTracker = false;
      let matchedDomain = '';
      if (reqHost) {
        // If host or its parents are allowlisted, never treat as tracker
        const allowHit = (() => {
          if (!state.userAllowlist || state.userAllowlist.size === 0) return false;
          for (const d of state.userAllowlist) {
            if (isSubdomainOf(reqHost, d)) return true;
          }
          return false;
        })();
        if (!allowHit) {
          // user blocklist
          let userBlockHit = false;
          for (const d of state.userBlocklist) {
            if (isSubdomainOf(reqHost, d)) { userBlockHit = true; matchedDomain = d; break; }
          }
          if (userBlockHit) {
            isTracker = true;
          } else {
            // EasyList domains: check host and parent domains
            if (state.trackerDomains.has(reqHost)) { isTracker = true; matchedDomain = reqHost; }
            else {
              const parts = reqHost.split('.');
              for (let i=1;i<parts.length-1 && !isTracker;i++) {
                const cand = parts.slice(i).join('.');
                if (state.trackerDomains.has(cand)) { isTracker = true; matchedDomain = cand; }
              }
            }
          }
        }
      }

      // Detect possible cookie sync on third-party request
      if (isThird) detectCookieSync(t, url);

      if (isTracker) {
        const key = reqBase || reqHost || matchedDomain || 'unknown';
        t.blockedTrackers[key] = (t.blockedTrackers[key]||0)+1;
        if (isThird) {
          t.blockedTrackersThird[key] = (t.blockedTrackersThird[key]||0)+1;
        } else {
          t.blockedTrackersFirst[key] = (t.blockedTrackersFirst[key]||0)+1;
        }
        t.requests.push({ url, type, action: 'blocked' });
        t.privacyScore = computeScore(t);
        return { cancel: true };
      } else {
        if (isThird && type === 'script') {
          t.hookRiskEvents += 1; // heuristic: third-party script request
        }
        t.requests.push({ url, type, action: isThird? 'allowed-3p':'allowed' });
        if (t.requests.length > 50) t.requests.shift();
        t.privacyScore = computeScore(t);
        return {};
      }
    },
    { urls: ["<all_urls>"] },
    ["blocking"]
  );

  // Inspect response headers for Set-Cookie
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      const { tabId, responseHeaders, url } = details;
      if (tabId < 0) return;
      const t = state.tabs.get(tabId); if (!t) return;
      const reqHost = (()=>{ try { return new URL(url).hostname; } catch { return ''; } })();
      const isFP = t.topDomain && baseDomain(reqHost) === t.topDomain;
      const setCookies = (responseHeaders||[]).filter(h=>/^(set-cookie)$/i.test(h.name));
      if (setCookies.length) {
        t.setCookieCount += setCookies.length;
        // session vs persistent
        for (const sc of setCookies) {
          const v = String(sc.value || '');
          const hasExpiry = /(?:;\s*max-age\s*=|;\s*expires\s*=)/i.test(v);
          if (hasExpiry) t.persistentCookieSets += 1; else t.sessionCookieSets += 1;
        }
        // 1st vs 3rd party
        if (isFP) t.firstPartyCookieSets += setCookies.length; else t.thirdPartyCookieSets += setCookies.length;
        t.privacyScore = computeScore(t);
      }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
  );

  // Inspect outgoing cookie headers count (approximation of cookies sent)
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const { tabId, requestHeaders } = details;
      if (tabId < 0) return;
      const t = state.tabs.get(tabId); if (!t) return;
      const cookieHdr = (requestHeaders||[]).find(h=>/^(cookie)$/i.test(h.name));
      if (cookieHdr && cookieHdr.value) {
        t.cookieHeaderCount += 1;
        t.privacyScore = computeScore(t);
      }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );

  // Listen to messages from content script and popup
  browser.runtime.onMessage.addListener(async (msg, sender) => {
    if (msg && msg.type === 'get-stats') {
      const tabId = msg.tabId;
      const t = state.tabs.get(tabId) || {};
      return t;
    }
    if (msg && msg.type === 'storage-stats') {
      const tabId = msg.tabId ?? sender?.tab?.id;
      const t = state.tabs.get(tabId); if (!t) return;
      t.storage = msg.payload;
      t.privacyScore = computeScore(t);
      return;
    }
    if (msg && msg.type === 'canvas-fingerprint') {
      const tabId = msg.tabId ?? sender?.tab?.id;
      const t = state.tabs.get(tabId); if (!t) return;
      t.canvasFingerprintEvents += 1;
      t.privacyScore = computeScore(t);
      return;
    }
    if (msg && msg.type === 'refresh-cookies') {
      await refreshKnownCookies(msg.tabId, msg.url);
      return;
    }
  });
})();
