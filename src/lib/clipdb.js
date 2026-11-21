/* Clipper for Rumble — IndexedDB clip store (extension origin only).
 *
 * IMPORTANT: content scripts run against the page's origin, so they must NOT
 * use this directly. Captured segments travel page -> bridge iframe
 * (extension origin, via structured-clone postMessage) -> here.
 * Editor / popup / options / offscreen all share this database.
 *
 * Stores:
 *   clips   { id, createdAt, title, channel, pageUrl, mode,
 *             segments: [Blob], estDuration, thumb?: Blob, note? }
 *   exports { id, clipId, createdAt, blob, filename, formatLabel, durationSec }
 */
(function (global) {
  'use strict';
  var DB_NAME = 'rumble-clipper', DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('clips')) {
          var clips = db.createObjectStore('clips', { keyPath: 'id' });
          clips.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('exports')) {
          var ex = db.createObjectStore('exports', { keyPath: 'id' });
          ex.createIndex('createdAt', 'createdAt');
          ex.createIndex('clipId', 'clipId');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(storeNames, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeNames, mode);
        var done = false;
        var finish = function (v) { if (!done) { done = true; resolve(v); } };
        t.oncomplete = function () { finish(lastResult); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaction aborted')); };
        var lastResult;
        Promise.resolve(fn(t, function (v) { lastResult = v; })).catch(reject);
      });
    });
  }

  function requestToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function putClip(clip) {
    return tx(['clips'], 'readwrite', function (t, set) {
      return requestToPromise(t.objectStore('clips').put(clip)).then(set);
    }).then(function () { return clip; });
  }

  function getClip(id) {
    return tx(['clips'], 'readonly', function (t, set) {
      return requestToPromise(t.objectStore('clips').get(id)).then(set);
    });
  }

  function listClips(limit) {
    return tx(['clips'], 'readonly', function (t, set) {
      return requestToPromise(t.objectStore('clips').index('createdAt').getAll())
        .then(function (all) {
          all.sort(function (a, b) { return b.createdAt - a.createdAt; });
          set(limit ? all.slice(0, limit) : all);
        });
    });
  }

  function deleteClip(id) {
    return tx(['clips', 'exports'], 'readwrite', function (t) {
      t.objectStore('clips').delete(id);
      var idx = t.objectStore('exports').index('clipId');
      return requestToPromise(idx.getAllKeys(id)).then(function (keys) {
        keys.forEach(function (k) { t.objectStore('exports').delete(k); });
      });
    });
  }

  function putExport(rec) {
    return tx(['exports'], 'readwrite', function (t, set) {
      return requestToPromise(t.objectStore('exports').put(rec)).then(set);
    }).then(function () { return rec; });
  }

  function getExport(id) {
    return tx(['exports'], 'readonly', function (t, set) {
      return requestToPromise(t.objectStore('exports').get(id)).then(set);
    });
  }

  function listExportsForClip(clipId) {
    return tx(['exports'], 'readonly', function (t, set) {
      return requestToPromise(t.objectStore('exports').index('clipId').getAll(clipId))
        .then(function (all) {
          all.sort(function (a, b) { return b.createdAt - a.createdAt; });
          set(all);
        });
    });
  }

  function deleteExport(id) {
    return tx(['exports'], 'readwrite', function (t) {
      t.objectStore('exports').delete(id);
    });
  }

  /** Total bytes used by stored segments + exports (for the library UI). */
  function storageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return { usage: 0, quota: 0 }; });
    }
    return Promise.resolve({ usage: 0, quota: 0 });
  }

  var api = {
    putClip: putClip, getClip: getClip, listClips: listClips, deleteClip: deleteClip,
    putExport: putExport, getExport: getExport, listExportsForClip: listExportsForClip,
    deleteExport: deleteExport, storageEstimate: storageEstimate
  };
  global.RCDB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
