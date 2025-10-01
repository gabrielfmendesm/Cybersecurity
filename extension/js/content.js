// Content script: collect storage metrics and detect canvas fingerprinting

(function() {
  
  function sizeOfStorage(storage) {
    let keys = 0, bytes = 0;
    try {
      for (let i=0;i<storage.length;i++) {
        const k = storage.key(i);
        const v = storage.getItem(k) || '';
        keys++;
        bytes += k.length + v.length;
      }
    } catch (_) {}
    return { keys, bytes };
  }

  async function detectIndexedDB() {
    try {
      if (indexedDB && typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        return { dbs: (dbs||[]).length };
      }
    } catch(_) {}
    // Fallback: heuristic by attempting to open a test DB and then delete it
    try {
      const name = '__pg_test__';
      await new Promise((res,rej)=>{
        const req = indexedDB.open(name);
        req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase(name); res(); };
        req.onerror = () => res();
      });
      // Can’t enumerate existing DBs without permissions; return 1 if open succeeded
      return { dbs: 1 };
    } catch(_) { return { dbs: 0 }; }
  }

  function reportStorage() {
    const local = sizeOfStorage(window.localStorage);
    const session = sizeOfStorage(window.sessionStorage);
    detectIndexedDB().then(idb => {
      browser.runtime.sendMessage({ type: 'storage-stats', tabId: undefined, payload: { local, session, idb } });
    });
  }

  // Monkey-patch canvas readouts
  function hookCanvas() {
    try {
      const proto = HTMLCanvasElement.prototype;
      const origToDataURL = proto.toDataURL;
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      proto.toDataURL = function(...args) {
        try { browser.runtime.sendMessage({ type: 'canvas-fingerprint', tabId: undefined }); } catch(_){}
        return origToDataURL.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        try { browser.runtime.sendMessage({ type: 'canvas-fingerprint', tabId: undefined }); } catch(_){}
        return origGetImageData.apply(this, args);
      };
    } catch(_) {}
  }

  hookCanvas();
  reportStorage();

  // Re-report storage on events that likely change it
  ['storage'].forEach(evt => window.addEventListener(evt, () => reportStorage()));
  setInterval(reportStorage, 5000);
})();
