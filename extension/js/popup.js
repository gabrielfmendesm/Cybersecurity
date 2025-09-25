async function getActiveTabId() {
  const tabs = await browser.tabs.query({active: true, currentWindow: true});
  return tabs[0]?.id;
}

function setThemeClass(isLight){
  document.documentElement.classList.toggle('light', !!isLight);
}

async function loadTheme() {
  const { theme } = await browser.storage.sync.get('theme');
  setThemeClass(theme === 'light');
}

async function saveTheme(isLight) {
  await browser.storage.sync.set({ theme: isLight ? 'light' : 'dark' });
}

function renderStats(t) {
  const scoreNum = document.getElementById('scoreNum');
  const scoreBar = document.getElementById('scoreBar');
  const scoreFill = document.getElementById('scoreFill');
  const blocked = document.getElementById('blocked');
  const thirdParty = document.getElementById('thirdParty');
  const setCookies = document.getElementById('setCookies');
  const cookieSent = document.getElementById('cookieSent');
  const cookieSetFP = document.getElementById('cookieSetFP');
  const cookieSetTP = document.getElementById('cookieSetTP');
  const cookieSession = document.getElementById('cookieSession');
  const cookiePersistent = document.getElementById('cookiePersistent');
  const lsKeys = document.getElementById('lsKeys');
  const lsBytes = document.getElementById('lsBytes');
  const ssKeys = document.getElementById('ssKeys');
  const ssBytes = document.getElementById('ssBytes');
  const idbCount = document.getElementById('idbCount');
  const fpCanvas = document.getElementById('fpCanvas');
  const hookRisk = document.getElementById('hookRisk');
  const blockedList = document.getElementById('blockedList');
  const connList = document.getElementById('connList');
  const syncList = document.getElementById('syncList');

  const blockedCount = Object.values(t.blockedTrackers||{}).reduce((a,b)=>a+b,0) || 0;
  const tpCount = Object.values(t.thirdPartyConnections||{}).reduce((a,b)=>a+b,0) || 0;

  const s = Math.max(0, Math.min(100, t.privacyScore ?? 0));
  scoreNum.textContent = s.toString();
  scoreBar.setAttribute('aria-valuenow', String(s));
  scoreFill.style.width = s + '%';
  scoreBar.classList.remove('good','ok','bad');
  if (s >= 80) scoreBar.classList.add('good');
  else if (s >= 50) scoreBar.classList.add('ok');
  else scoreBar.classList.add('bad');
  const nf = new Intl.NumberFormat();
  const humanBytes = (n) => {
    const x = Number(n||0);
    if (x < 1024) return nf.format(x) + ' B';
    const units = ['KB','MB','GB','TB'];
    let v = x/1024, i = 0;
    while (v >= 1024 && i < units.length-1) { v/=1024; i++; }
    return v.toFixed(v<10?1:0) + ' ' + units[i];
  };

  blocked.textContent = nf.format(blockedCount);
  thirdParty.textContent = nf.format(tpCount);
  setCookies.textContent = nf.format(t.setCookieCount||0);
  cookieSent.textContent = nf.format(t.cookieHeaderCount||0);
  cookieSetFP.textContent = nf.format(t.firstPartyCookieSets||0);
  cookieSetTP.textContent = nf.format(t.thirdPartyCookieSets||0);
  cookieSession.textContent = nf.format(t.sessionCookieSets||0);
  cookiePersistent.textContent = nf.format(t.persistentCookieSets||0);
  lsKeys.textContent = nf.format(t.storage?.local?.keys||0);
  lsBytes.textContent = humanBytes(t.storage?.local?.bytes||0);
  ssKeys.textContent = nf.format(t.storage?.session?.keys||0);
  ssBytes.textContent = humanBytes(t.storage?.session?.bytes||0);
  idbCount.textContent = nf.format(t.storage?.idb?.dbs||0);
  fpCanvas.textContent = nf.format(t.canvasFingerprintEvents||0);
  hookRisk.textContent = nf.format(t.hookRiskEvents||0);

  // Helper to format numbers and truncate text
  const trunc = (s, n=36) => (s.length > n ? s.slice(0, n-1) + '…' : s);

  // Blocked trackers list
  blockedList.innerHTML = '';
  const blockedEntries = Object.entries(t.blockedTrackers||{}).sort((a,b)=>b[1]-a[1]).slice(0,50);
  if (blockedEntries.length === 0) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nenhum rastreador bloqueado';
    blockedList.appendChild(li);
  } else {
    blockedEntries.forEach(([host,count])=>{
      const li = document.createElement('li');
      const left = document.createElement('div'); left.className = 'left';
      const dot = document.createElement('span'); dot.className = 'dot';
      const h = document.createElement('span'); h.className = 'host'; h.textContent = trunc(host, 34); h.title = host;
      left.appendChild(dot); left.appendChild(h);
      const right = document.createElement('div'); right.className = 'right';
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = nf.format(count);
      right.appendChild(badge);
      li.appendChild(left); li.appendChild(right);
      blockedList.appendChild(li);
    });
  }

  connList.innerHTML = '';
  const connEntries = Object.entries(t.thirdPartyConnections||{}).sort((a,b)=>b[1]-a[1]).slice(0,50);
  if (connEntries.length === 0) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Sem conexões de terceiros';
    connList.appendChild(li);
  } else {
    connEntries.forEach(([host,count])=>{
      const li = document.createElement('li');
      const left = document.createElement('div'); left.className = 'left';
      const dot = document.createElement('span'); dot.className = 'dot';
      const h = document.createElement('span'); h.className = 'host'; h.textContent = trunc(host, 34); h.title = host;
      left.appendChild(dot); left.appendChild(h);
      const right = document.createElement('div'); right.className = 'right';
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = nf.format(count);
      right.appendChild(badge);
      li.appendChild(left); li.appendChild(right);
      connList.appendChild(li);
    });
  }

  syncList.innerHTML = '';
  const syncEvents = (t.cookieSyncEvents||[]).slice(-10).reverse();
  if (syncEvents.length === 0) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nenhum evento recente';
    syncList.appendChild(li);
  } else {
    syncEvents.forEach(ev => {
      const li = document.createElement('li');
      const left = document.createElement('div'); left.className = 'left';
      const u = new URL(ev.url);
      const dot = document.createElement('span'); dot.className = 'dot';
      const h = document.createElement('span'); h.className = 'host';
      const text = `${u.host}${u.pathname}`;
      h.textContent = trunc(text, 34); h.title = text;
      left.appendChild(dot); left.appendChild(h);
      const right = document.createElement('div'); right.className = 'right';
      const key = ev.matches?.[0]?.key || 'param';
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = key;
      right.appendChild(badge);
      li.appendChild(left); li.appendChild(right);
      syncList.appendChild(li);
    });
  }
}

async function refresh() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const tabs = await browser.tabs.query({active: true, currentWindow: true});
  const url = tabs[0]?.url;
  // Ask background to refresh known cookies for sync detection context
  browser.runtime.sendMessage({ type: 'refresh-cookies', tabId, url });
  const t = await browser.runtime.sendMessage({ type: 'get-stats', tabId });
  renderStats(t || {});
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme();
  await refresh();
  setInterval(refresh, 1500);

  const btn = document.getElementById('themeBtn');
  btn.addEventListener('click', async () => {
    const isLight = !document.documentElement.classList.contains('light');
    setThemeClass(isLight);
    await saveTheme(isLight);
  });
});
