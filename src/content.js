/* Clipper for Rumble — content script (runs on rumble.com pages).
 *
 * Three ways to make a clip, all captured locally with audio:
 *   1. "Clip last 30s"  — instant-replay ring buffer (5s segments)
 *   2. "Replay last 30s"— VOD fallback: seek back, record, restore position
 *   3. "Record next 30s"— forward recording (great for live streams)
 *
 * Captured segments are handed to an extension-origin bridge iframe
 * (structured-clone Blob transfer) which stores them in IndexedDB,
 * then the editor tab opens. Nothing is uploaded anywhere.
 */
(function () {
  'use strict';
  if (window.__rcClipperLoaded) return;
  window.__rcClipperLoaded = true;

  var U = window.RCUtil;
  var SEGMENT_MS = 5000;
  var DEFAULTS = {
    clipLengthSec: 30, bufferSec: 45, bufferEnabled: true,
    openEditorAfterClip: true, preferMp4: true
  };
  var settings = Object.assign({}, DEFAULTS);

  var state = {
    video: null, stream: null, mime: '',
    bufferRecorder: null, bufferChunks: [], segments: [], // {blob, at:performance.now, vTime}
    bufferTimer: 0, bufferRunning: false,
    manual: null, // {recorder, chunks, startedAt, timer, mode, restore}
    ui: {}, bridgeReady: null, lastUrl: location.href
  };

  /* ---------------- settings ---------------- */
  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, function (items) {
        if (!chrome.runtime.lastError && items) settings = Object.assign({}, DEFAULTS, items);
        syncBufferWithSettings();
        refreshButtonLabels();
      });
    } catch (e) { /* extension context gone */ }
  }
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync' && area !== 'local') return;
      Object.keys(changes).forEach(function (k) { settings[k] = changes[k].newValue; });
      syncBufferWithSettings(); refreshButtonLabels();
    });
  } catch (e) { /* noop */ }

  /* ---------------- video discovery ---------------- */
  function findMainVideo() {
    var videos = Array.prototype.slice.call(document.querySelectorAll('video'));
    var best = null, bestArea = 0;
    videos.forEach(function (v) {
      var r = v.getBoundingClientRect();
      var area = Math.max(0, r.width) * Math.max(0, r.height);
      if (v.readyState > 0 || v.currentSrc || v.srcObject) area *= 2;
      if (area > bestArea) { bestArea = area; best = v; }
    });
    return best;
  }

  function pageMeta() {
    var title = '';
    var og = document.querySelector('meta[property="og:title"]');
    if (og) title = og.getAttribute('content') || '';
    if (!title) {
      var h1 = document.querySelector('h1');
      title = h1 ? h1.textContent.trim() : document.title.replace(/\s*[-|]\s*Rumble.*$/i, '').trim();
    }
    var channel = '';
    var ch = document.querySelector('[rel="author"], .media-heading a, a[data-testid="channel-name"], .channel-name, .video-poster a');
    if (ch) channel = ch.textContent.trim();
    if (!channel) {
      var m = location.pathname.match(/^\/c\/([^/]+)/) || document.title.match(/by\s+(.+?)\s+on Rumble/i);
      if (m) channel = decodeURIComponent(m[1]);
    }
    return { title: title || 'Rumble clip', channel: channel, pageUrl: location.href };
  }

  function isLive(v) {
    if (!v) return false;
    if (v.duration === Infinity) return true;
    return !!document.querySelector('.live-badge, [data-live="true"], .rumbles-vote-live');
  }

  /* ---------------- capture stream ---------------- */
  function getCaptureStream(video) {
    if (state.stream && state.video === video &&
        state.stream.getTracks().some(function (t) { return t.readyState === 'live'; })) {
      return state.stream;
    }
    var s = null;
    try { s = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null); }
    catch (e) { s = null; }
    if (!s || !s.getVideoTracks().length) return null;
    state.stream = s; state.video = video;
    return s;
  }

  function captureAvailable(video) { return !!getCaptureStream(video); }

  /* ---------------- rolling replay buffer ---------------- */
  function startBuffer() {
    if (state.bufferRunning || !settings.bufferEnabled) return;
    var video = findMainVideo();
    if (!video) return;
    var stream = getCaptureStream(video);
    if (!stream) return;
    state.bufferRunning = true;
    nextSegment();
  }

  function nextSegment() {
    if (!state.bufferRunning) return;
    var stream = state.stream;
    if (!stream) { state.bufferRunning = false; return; }
    var chunks = [];
    var rec;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: state.mime || undefined, videoBitsPerSecond: 8000000, audioBitsPerSecond: 192000
      });
    } catch (e) { state.bufferRunning = false; return; }
    state.mime = rec.mimeType || state.mime;
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      if (chunks.length && state.video && !state.video.paused || chunks.length) {
        var blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
        if (blob.size > 1000) {
          state.segments.push({ blob: blob, at: Date.now(), vTime: state.video ? state.video.currentTime : 0 });
          trimSegments();
        }
      }
      if (state.bufferRunning) nextSegment();
    };
    state.bufferRecorder = rec;
    try { rec.start(250); } catch (e) { state.bufferRunning = false; return; }
    state.bufferTimer = setTimeout(function () {
      if (rec.state !== 'inactive') { try { rec.stop(); } catch (e) { /* noop */ } }
    }, SEGMENT_MS);
  }

  function trimSegments() {
    var keepMs = Math.max(settings.bufferSec, settings.clipLengthSec + 10) * 1000;
    var now = Date.now();
    while (state.segments.length > 1 && (now - state.segments[0].at > keepMs ||
           state.segments.length > Math.ceil(keepMs / SEGMENT_MS) + 2)) {
      state.segments.shift();
    }
  }

  function stopBuffer() {
    state.bufferRunning = false;
    clearTimeout(state.bufferTimer);
    if (state.bufferRecorder && state.bufferRecorder.state !== 'inactive') {
      try { state.bufferRecorder.stop(); } catch (e) { /* noop */ }
    }
    state.bufferRecorder = null;
  }

  function syncBufferWithSettings() {
    if (settings.bufferEnabled) startBuffer(); else { stopBuffer(); state.segments = []; }
  }

  /** Flush the in-progress segment so "clip now" includes up to this frame. */
  function flushBuffer() {
    return new Promise(function (resolve) {
      var rec = state.bufferRecorder;
      if (!state.bufferRunning || !rec || rec.state === 'inactive') return resolve();
      var prevStop = rec.onstop;
      rec.onstop = function () { if (prevStop) prevStop(); resolve(); };
      clearTimeout(state.bufferTimer);
      try { rec.stop(); } catch (e) { resolve(); }
      setTimeout(resolve, 1200);
    });
  }

  function bufferedSeconds() {
    return state.segments.length * (SEGMENT_MS / 1000);
  }

  /* ---------------- clip actions ---------------- */
  function clipFromBuffer() {
    var video = findMainVideo();
    if (!video) return toast('No video found on this page yet.', 'error');
    if (!captureAvailable(video)) return offerTabCaptureFallback('buffer');
    var need = settings.clipLengthSec;
    return flushBuffer().then(function () {
      var have = bufferedSeconds();
      if (have < 3) {
        // Not enough buffer yet (just landed / paused a lot): fall back to replay on VOD.
        if (!isLive(video) && isFinite(video.duration) && video.currentTime > 3) {
          return replayClip(video);
        }
        return toast('Buffering… try again in a few seconds (' + Math.round(have) + 's captured so far).', 'error');
      }
      var count = Math.min(state.segments.length, Math.ceil(need / (SEGMENT_MS / 1000)));
      var picked = state.segments.slice(-count);
      var meta = pageMeta();
      return saveClip(picked.map(function (s) { return s.blob; }), 'buffer', meta).then(function (clipId) {
        toast('Clip saved — opening editor…');
        afterClipSaved(clipId);
      });
    }).catch(reportError);
  }

  function replayClip(video) {
    var len = settings.clipLengthSec;
    var startAt = Math.max(0, video.currentTime - len);
    var restore = { time: video.currentTime, wasPlaying: !video.paused };
    toast('Capturing the last ' + len + 's — playback will resume where you left off.');
    beginManualRecord(video, Math.min(len, video.currentTime - startAt), 'replay', function () {
      try { video.currentTime = restore.time; } catch (e) { /* noop */ }
      if (restore.wasPlaying) video.play().catch(function () { /* noop */ });
    });
    try { video.currentTime = startAt; } catch (e) { /* noop */ }
    video.play().catch(function () { /* noop */ });
  }

  function recordNext() {
    var video = findMainVideo();
    if (!video) return toast('No video found on this page yet.', 'error');
    if (state.manual) return stopManualRecord(true);
    if (!captureAvailable(video)) return offerTabCaptureFallback('forward');
    if (video.paused) video.play().catch(function () { /* noop */ });
    beginManualRecord(video, settings.clipLengthSec, 'forward', null);
  }

  function beginManualRecord(video, seconds, mode, onDone) {
    var stream = getCaptureStream(video);
    if (!stream) return offerTabCaptureFallback(mode);
    var chunks = [];
    var rec;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: state.mime || undefined, videoBitsPerSecond: 9000000, audioBitsPerSecond: 192000
      });
    } catch (e) { return offerTabCaptureFallback(mode); }
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var m = state.manual; state.manual = null;
      hideCountdown();
      if (onDone) onDone();
      if (!m || m.discard || !chunks.length) return;
      var blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      saveClip([blob], mode, pageMeta()).then(function (clipId) {
        toast('Clip saved — opening editor…');
        afterClipSaved(clipId);
      }).catch(reportError);
    };
    state.manual = { recorder: rec, startedAt: Date.now(), seconds: seconds, mode: mode, discard: false };
    rec.start(250);
    showCountdown(seconds, mode);
    state.manual.timer = setTimeout(function () { stopManualRecord(true); }, seconds * 1000 + 150);
  }

  function stopManualRecord(keep) {
    var m = state.manual;
    if (!m) return;
    m.discard = !keep;
    clearTimeout(m.timer);
    if (m.recorder.state !== 'inactive') { try { m.recorder.stop(); } catch (e) { state.manual = null; hideCountdown(); } }
  }

  function offerTabCaptureFallback(mode) {
    toast('This player blocks direct capture. Use “Tab capture” in the extension popup instead.', 'error', 7000);
    try {
      chrome.runtime.sendMessage({ type: 'rc:capture-blocked', mode: mode, rect: videoRect() });
    } catch (e) { /* noop */ }
  }

  function videoRect() {
    var v = findMainVideo();
    if (!v) return null;
    var r = v.getBoundingClientRect();
    return {
      x: r.left, y: r.top, width: r.width, height: r.height,
      dpr: window.devicePixelRatio || 1,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight
    };
  }

  /* ---------------- bridge (page -> extension IndexedDB) ---------------- */
  function ensureBridge() {
    if (state.bridgeReady) return state.bridgeReady;
    state.bridgeReady = new Promise(function (resolve, reject) {
      var iframe = document.createElement('iframe');
      iframe.src = chrome.runtime.getURL('src/bridge/bridge.html');
      iframe.style.cssText = 'display:none!important';
      iframe.setAttribute('aria-hidden', 'true');
      var extOrigin = new URL(chrome.runtime.getURL('')).origin;
      var onMsg = function (e) {
        if (e.origin !== extOrigin || !e.data || e.data.type !== 'rc:bridge-ready') return;
        window.removeEventListener('message', onMsg);
        resolve({ iframe: iframe, origin: extOrigin });
      };
      window.addEventListener('message', onMsg);
      (document.documentElement || document.body).appendChild(iframe);
      setTimeout(function () { reject(new Error('Clip storage bridge timed out.')); }, 8000);
    });
    return state.bridgeReady;
  }

  function saveClip(blobs, mode, meta, extra) {
    return ensureBridge().then(function (bridge) {
      return new Promise(function (resolve, reject) {
        var reqId = U.uid();
        var onMsg = function (e) {
          if (e.origin !== bridge.origin || !e.data || e.data.reqId !== reqId) return;
          window.removeEventListener('message', onMsg);
          if (e.data.type === 'rc:clip-saved') resolve(e.data.clipId);
          else reject(new Error(e.data.error || 'Could not save the clip.'));
        };
        window.addEventListener('message', onMsg);
        bridge.iframe.contentWindow.postMessage({
          type: 'rc:save-clip', reqId: reqId,
          clip: Object.assign({
            id: U.uid(), createdAt: Date.now(), mode: mode,
            title: meta.title, channel: meta.channel, pageUrl: meta.pageUrl,
            segments: blobs
          }, extra || {})
        }, bridge.origin);
        setTimeout(function () {
          window.removeEventListener('message', onMsg);
          reject(new Error('Saving the clip timed out.'));
        }, 30000);
      });
    });
  }

  function afterClipSaved(clipId) {
    if (settings.openEditorAfterClip) {
      try { chrome.runtime.sendMessage({ type: 'rc:open-editor', clipId: clipId }); } catch (e) { /* noop */ }
    }
    try { chrome.runtime.sendMessage({ type: 'rc:clip-created', clipId: clipId }); } catch (e) { /* noop */ }
  }

  function reportError(err) {
    toast('Clip failed: ' + (err && err.message ? err.message : 'unknown error'), 'error', 7000);
  }

  /* ---------------- UI: player button + floating panel ---------------- */
  var SCISSORS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.8 20 19M8.2 16.2 20 5"/></svg>';

  function buildUI() {
    if (document.getElementById('rc-clipper-root')) return;
    var root = document.createElement('div');
    root.id = 'rc-clipper-root';
    root.innerHTML =
      '<div class="rc-panel" role="group" aria-label="Rumble Clipper">' +
        '<button class="rc-btn rc-btn-main" id="rc-btn-clip" title="Save the last 30 seconds as a clip (Alt+C)">' + SCISSORS + '<span id="rc-btn-clip-label">Clip last 30s</span></button>' +
        '<button class="rc-btn" id="rc-btn-rec" title="Record the next 30 seconds (Alt+Shift+R)"><span class="rc-dot"></span><span id="rc-btn-rec-label">Record 30s</span></button>' +
        '<span class="rc-buffer" id="rc-buffer-meter" title="Replay buffer"><span class="rc-buffer-fill" id="rc-buffer-fill"></span></span>' +
      '</div>' +
      '<div class="rc-toast" id="rc-toast" role="status"></div>' +
      '<div class="rc-countdown" id="rc-countdown" hidden>' +
        '<span class="rc-rec-dot"></span><span id="rc-countdown-text">Recording…</span>' +
        '<button class="rc-btn rc-btn-small" id="rc-countdown-stop">Stop &amp; save</button>' +
        '<button class="rc-btn rc-btn-small rc-btn-ghost" id="rc-countdown-cancel">Cancel</button>' +
      '</div>';
    document.documentElement.appendChild(root);
    state.ui = {
      root: root,
      clipBtn: root.querySelector('#rc-btn-clip'),
      recBtn: root.querySelector('#rc-btn-rec'),
      toastEl: root.querySelector('#rc-toast'),
      countdown: root.querySelector('#rc-countdown'),
      countdownText: root.querySelector('#rc-countdown-text'),
      bufferFill: root.querySelector('#rc-buffer-fill')
    };
    state.ui.clipBtn.addEventListener('click', function () { clipFromBuffer(); });
    state.ui.recBtn.addEventListener('click', function () { recordNext(); });
    root.querySelector('#rc-countdown-stop').addEventListener('click', function () { stopManualRecord(true); });
    root.querySelector('#rc-countdown-cancel').addEventListener('click', function () { stopManualRecord(false); toast('Recording discarded.'); });
    setInterval(updateBufferMeter, 1000);
    positionPanel();
  }

  function positionPanel() {
    // Sit just under the player when we can find it; else float bottom-right.
    var panel = state.ui.root && state.ui.root.querySelector('.rc-panel');
    if (!panel) return;
    var v = findMainVideo();
    if (v) {
      var r = v.getBoundingClientRect();
      if (r.width > 200) {
        panel.style.left = Math.max(8, r.left + window.scrollX) + 'px';
        panel.style.top = (r.bottom + window.scrollY + 8) + 'px';
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
        panel.style.position = 'absolute';
        return;
      }
    }
    panel.style.position = 'fixed'; panel.style.right = '16px'; panel.style.bottom = '16px';
    panel.style.left = 'auto'; panel.style.top = 'auto';
  }

  function refreshButtonLabels() {
    if (!state.ui.clipBtn) return;
    state.ui.root.querySelector('#rc-btn-clip-label').textContent = 'Clip last ' + settings.clipLengthSec + 's';
    state.ui.root.querySelector('#rc-btn-rec-label').textContent = 'Record ' + settings.clipLengthSec + 's';
  }

  function updateBufferMeter() {
    if (!state.ui.bufferFill) return;
    var pct = Math.min(100, (bufferedSeconds() / Math.max(1, settings.clipLengthSec)) * 100);
    state.ui.bufferFill.style.width = pct + '%';
    state.ui.bufferFill.parentElement.title = settings.bufferEnabled
      ? 'Replay buffer: ~' + Math.round(bufferedSeconds()) + 's captured'
      : 'Replay buffer is off (enable it in options)';
  }

  var toastTimer = 0;
  function toast(msg, kind, ms) {
    if (!state.ui.toastEl) buildUI();
    var el = state.ui.toastEl;
    el.textContent = msg;
    el.className = 'rc-toast rc-toast-show' + (kind === 'error' ? ' rc-toast-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'rc-toast'; }, ms || 3500);
  }

  var countdownIv = 0;
  function showCountdown(seconds, mode) {
    if (!state.ui.countdown) return;
    state.ui.countdown.hidden = false;
    var label = mode === 'replay' ? 'Capturing replay' : 'Recording clip';
    var tick = function () {
      if (!state.manual) return hideCountdown();
      var left = Math.max(0, seconds - (Date.now() - state.manual.startedAt) / 1000);
      state.ui.countdownText.textContent = label + ' — ' + U.formatTime(left) + ' left';
    };
    tick();
    countdownIv = setInterval(tick, 200);
  }
  function hideCountdown() {
    clearInterval(countdownIv);
    if (state.ui.countdown) state.ui.countdown.hidden = true;
  }

  /* ---------------- messaging ---------------- */
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return;
      if (msg.type === 'rc:clip-last') { clipFromBuffer(); sendResponse({ ok: true }); }
      else if (msg.type === 'rc:record-next') { recordNext(); sendResponse({ ok: true }); }
      else if (msg.type === 'rc:stop-record') { stopManualRecord(true); sendResponse({ ok: true }); }
      else if (msg.type === 'rc:status') {
        var v = findMainVideo();
        sendResponse({
          ok: true, hasVideo: !!v, live: isLive(v),
          captureAvailable: v ? captureAvailable(v) : false,
          bufferedSec: Math.round(bufferedSeconds()),
          recording: !!state.manual,
          meta: pageMeta(), rect: videoRect(),
          settings: settings
        });
      }
      return true;
    });
  } catch (e) { /* noop */ }

  /* ---------------- lifecycle / SPA ---------------- */
  function onVideoChange() {
    var v = findMainVideo();
    if (v && v !== state.video) {
      stopBuffer(); state.segments = []; state.stream = null; state.video = v;
      state.mime = U.pickMimeType(settings.preferMp4);
      startBuffer();
    }
    positionPanel();
  }

  var mo = new MutationObserver(function () {
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      state.video = null; state.stream = null; state.segments = [];
      stopBuffer();
      setTimeout(onVideoChange, 400);
    } else if (!state.video || !document.contains(state.video)) {
      onVideoChange();
    }
  });

  function init() {
    loadSettings();
    buildUI();
    refreshButtonLabels();
    state.mime = U.pickMimeType(true);
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(onVideoChange, 600);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, { passive: true });
    document.addEventListener('play', function (e) {
      if (e.target && e.target.tagName === 'VIDEO') onVideoChange();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
