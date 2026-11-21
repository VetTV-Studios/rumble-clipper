/* Offscreen tab-capture recorder (fallback path only).
 * Records the tab stream handed over by the service worker, stores the
 * result as a clip (mode: 'tab') together with the video's on-page rect,
 * then asks the worker to open the editor, which crops on export. */
(function () {
  'use strict';
  var current = null; // { recorder, tracks, timer, resolve }

  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.target !== 'rc-offscreen') return;
    if (msg.type === 'rc:offscreen-start') {
      start(msg).then(
        function (r) { sendResponse({ ok: true, clipId: r }); },
        function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      );
      return true;
    }
    if (msg.type === 'rc:offscreen-stop') {
      stop(true);
      sendResponse({ ok: true });
    }
  });

  function start(msg) {
    if (current) return Promise.reject(new Error('A tab recording is already running.'));
    return navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } },
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId, maxFrameRate: 30 } }
    }).then(function (stream) {
      return new Promise(function (resolve, reject) {
        var chunks = [];
        var rec = new MediaRecorder(stream, { videoBitsPerSecond: 9000000, audioBitsPerSecond: 192000 });
        current = { recorder: rec, tracks: stream.getTracks(), resolve: resolve, reject: reject };
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          current = null;
          stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* noop */ } });
          if (!chunks.length) return reject(new Error('Tab capture produced no data.'));
          var blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
          var clip = {
            id: uid(), createdAt: Date.now(), mode: 'tab',
            title: (msg.meta && msg.meta.title) || 'Rumble clip',
            channel: (msg.meta && msg.meta.channel) || '',
            pageUrl: (msg.meta && msg.meta.pageUrl) || '',
            segments: [blob],
            tabRect: msg.rect || null,
            tabSize: { width: stream.getVideoTracks()[0] ? (stream.getVideoTracks()[0].getSettings().width || 0) : 0,
                       height: stream.getVideoTracks()[0] ? (stream.getVideoTracks()[0].getSettings().height || 0) : 0 }
          };
          window.RCDB.putClip(clip).then(function () {
            chrome.runtime.sendMessage({ type: 'rc:open-editor', clipId: clip.id });
            chrome.runtime.sendMessage({ type: 'rc:clip-created', clipId: clip.id });
            resolve(clip.id);
          }).catch(reject);
        };
        rec.start(250);
        current.timer = setTimeout(function () { stop(true); }, (msg.seconds || 30) * 1000 + 150);
      });
    });
  }

  function stop(save) {
    if (!current) return;
    clearTimeout(current.timer);
    if (current.recorder.state !== 'inactive') {
      try { current.recorder.stop(); } catch (e) { current = null; }
    }
    void save;
  }
})();
