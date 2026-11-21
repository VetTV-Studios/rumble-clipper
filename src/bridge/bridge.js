/* Bridge iframe (extension origin, embedded hidden on rumble.com).
 * Receives captured Blobs from the content script via postMessage
 * (structured clone) and persists them to extension IndexedDB,
 * which content scripts cannot reach (they see the page origin). */
(function () {
  'use strict';
  function isRumbleOrigin(origin) {
    try {
      var u = new URL(origin);
      return u.protocol === 'https:' && (u.hostname === 'rumble.com' || u.hostname.endsWith('.rumble.com'));
    } catch (e) { return false; }
  }

  window.addEventListener('message', function (e) {
    if (!isRumbleOrigin(e.origin)) return;
    var d = e.data;
    if (!d || d.type !== 'rc:save-clip' || !d.clip || !Array.isArray(d.clip.segments)) return;
    var reply = function (payload) {
      e.source.postMessage(Object.assign({ reqId: d.reqId }, payload), e.origin);
    };
    var clip = d.clip;
    // Validate blobs before touching storage.
    var ok = clip.segments.length > 0 && clip.segments.every(function (s) { return s instanceof Blob; });
    if (!ok) return reply({ type: 'rc:clip-error', error: 'Invalid clip data.' });
    clip.segments = clip.segments.slice(0, 24); // sanity cap (~2 min of buffer)
    window.RCDB.putClip(clip).then(function () {
      reply({ type: 'rc:clip-saved', clipId: clip.id });
    }).catch(function (err) {
      reply({ type: 'rc:clip-error', error: String((err && err.message) || err) });
    });
  });

  // Announce readiness to the parent frame only (content script verifies origin).
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'rc:bridge-ready' }, '*');
  }
})();
