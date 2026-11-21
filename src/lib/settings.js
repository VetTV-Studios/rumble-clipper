/* Clipper for Rumble — user settings (chrome.storage.sync with local fallback). */
(function (global) {
  'use strict';

  var DEFAULTS = {
    clipLengthSec: 30,          // headline feature: 30-second clips
    bufferSec: 45,              // rolling replay buffer kept in memory
    bufferEnabled: true,        // "clip that!" instant-replay buffer
    defaultFormat: '9x16',      // vertical first — Shorts/Reels/TikTok
    defaultLayout: 'fit-blur',  // blurred backdrop looks best for 16:9 -> 9:16
    preferMp4: true,            // MP4 where Chrome supports it, else WebM
    quality: 'high',            // low | medium | high
    addAttribution: true,       // burn "via <channel> on Rumble" into exports
    filenameTemplate: 'rumble-clip-{title}-{duration}s-{format}.{ext}',
    openEditorAfterClip: true,
    hashtags: 'Rumble, clips'
  };

  var QUALITY_BPS = { low: 2500000, medium: 5000000, high: 9000000 };

  function area() {
    return (global.chrome && chrome.storage && (chrome.storage.sync || chrome.storage.local)) || null;
  }

  function load() {
    var a = area();
    if (!a) return Promise.resolve(Object.assign({}, DEFAULTS));
    return new Promise(function (resolve) {
      a.get(DEFAULTS, function (items) {
        void (global.chrome && chrome.runtime && chrome.runtime.lastError);
        resolve(Object.assign({}, DEFAULTS, items || {}));
      });
    });
  }

  function save(patch) {
    var a = area();
    if (!a) return Promise.resolve(patch);
    return new Promise(function (resolve) {
      a.set(patch, function () {
        void (global.chrome && chrome.runtime && chrome.runtime.lastError);
        resolve(patch);
      });
    });
  }

  var api = { DEFAULTS: DEFAULTS, QUALITY_BPS: QUALITY_BPS, load: load, save: save };
  global.RCSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
