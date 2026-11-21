/* Clipper for Rumble — action popup. */
(function () {
  'use strict';
  var U = window.RCUtil, DB = window.RCDB, SET = window.RCSettings;
  var $ = function (id) { return document.getElementById(id); };
  var tab = null, pageStatus = null, settings = Object.assign({}, SET.DEFAULTS);

  var toastTimer = 0;
  function toast(msg, isError, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 3000);
  }

  function isRumble(url) {
    try { var u = new URL(url || ''); return u.hostname === 'rumble.com' || u.hostname.endsWith('.rumble.com'); }
    catch (e) { return false; }
  }

  function send(type) {
    if (!tab) return Promise.resolve(null);
    return chrome.tabs.sendMessage(tab.id, { type: type }).catch(function () { return null; });
  }

  function refreshStatus() {
    return send('rc:status').then(function (st) {
      pageStatus = st;
      if (st && st.ok) {
        $('statusLine').textContent = st.live ? 'Live stream detected' : 'Ready to clip';
        $('videoTitle').textContent = (st.meta && st.meta.title) || '';
        $('bufferHint').textContent = st.captureAvailable
          ? ('Replay buffer: ~' + st.bufferedSec + 's captured' + (st.recording ? ' · recording in progress…' : ''))
          : 'Direct capture unavailable on this player.';
        $('fallbackBox').hidden = st.captureAvailable;
        $('clipLast').disabled = !st.hasVideo;
        $('recordNext').disabled = !st.hasVideo;
        $('recordNext').innerHTML = st.recording ? '■ Stop &amp; save' : '● Record next <span class="len">' + settings.clipLengthSec + '</span>s';
      } else {
        $('statusLine').textContent = 'Reload the Rumble tab to activate the clipper';
        $('bufferHint').textContent = 'If you just installed, refresh the page once.';
      }
    });
  }

  function refreshRecent() {
    DB.listClips(5).then(function (clips) {
      var wrap = $('recentList'); wrap.textContent = '';
      if (!clips.length) { wrap.innerHTML = '<p class="muted">No clips yet.</p>'; return; }
      clips.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'recent';
        var img = document.createElement('img'); img.alt = '';
        if (c.thumb) img.src = URL.createObjectURL(c.thumb);
        var mid = document.createElement('span');
        mid.innerHTML = '<span class="t"></span><span class="m"></span>';
        mid.querySelector('.t').textContent = c.title || 'Rumble clip';
        mid.querySelector('.m').textContent = new Date(c.createdAt).toLocaleString(undefined,
          { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        b.appendChild(img); b.appendChild(mid);
        b.addEventListener('click', function () {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') + '?clip=' + encodeURIComponent(c.id) });
          window.close();
        });
        wrap.appendChild(b);
      });
    });
  }

  function setFormatUI(fmt) {
    document.querySelectorAll('.seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-format') === fmt);
    });
  }

  function startTabCapture() {
    // Optional permission must be requested from a user gesture — this click.
    chrome.permissions.request({ permissions: ['tabCapture'] }, function (granted) {
      if (!granted) { toast('Tab capture permission is needed for the fallback recorder.', true, 5000); return; }
      $('tabCaptureBtn').hidden = true; $('tabStopBtn').hidden = false;
      toast('Recording this tab for ' + settings.clipLengthSec + 's — keep it playing. The editor opens when done.', false, 6000);
      chrome.runtime.sendMessage({
        type: 'rc:start-tab-capture',
        seconds: settings.clipLengthSec,
        rect: pageStatus ? pageStatus.rect : null,
        meta: pageStatus ? pageStatus.meta : null
      }, function (resp) {
        $('tabCaptureBtn').hidden = false; $('tabStopBtn').hidden = true;
        if (resp && resp.ok) { toast('Tab clip saved.'); refreshRecent(); }
        else toast('Tab capture failed: ' + ((resp && resp.error) || 'unknown'), true, 6000);
      });
    });
  }

  function wire() {
    $('clipLast').addEventListener('click', function () {
      send('rc:clip-last').then(function () { toast('Clipping… watch the page for confirmation.'); setTimeout(refreshRecent, 1500); });
    });
    $('recordNext').addEventListener('click', function () {
      var recording = pageStatus && pageStatus.recording;
      send(recording ? 'rc:stop-record' : 'rc:record-next').then(function () {
        toast(recording ? 'Saving clip…' : 'Recording the next ' + settings.clipLengthSec + 's on the page.');
        setTimeout(refreshStatus, 600);
      });
    });
    $('tabCaptureBtn').addEventListener('click', startTabCapture);
    $('tabStopBtn').addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'rc:stop-tab-capture' }, function () {
        $('tabCaptureBtn').hidden = false; $('tabStopBtn').hidden = true;
      });
    });
    document.querySelectorAll('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var fmt = b.getAttribute('data-format');
        setFormatUI(fmt);
        SET.save({ defaultFormat: fmt }).then(function () { toast('Default: ' + (fmt === '9x16' ? 'vertical 9:16' : 'horizontal 16:9')); });
      });
    });
    $('openLibrary').addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
      window.close();
    });
    $('openOptions').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
    $('goRumble').addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://rumble.com/' }); window.close();
    });
    setInterval(refreshStatus, 2000);
  }

  SET.load().then(function (s) {
    settings = s;
    document.querySelectorAll('.len').forEach(function (el) { el.textContent = settings.clipLengthSec; });
    setFormatUI(settings.defaultFormat);
    wire();
    refreshRecent();
    return chrome.tabs.query({ active: true, currentWindow: true });
  }).then(function (tabs) {
    tab = tabs[0] || null;
    var on = !!(tab && isRumble(tab.url));
    $('onRumble').hidden = !on;
    $('offRumble').hidden = on;
    if (on) refreshStatus(); else $('statusLine').textContent = 'Not on a Rumble page';
  });
})();
