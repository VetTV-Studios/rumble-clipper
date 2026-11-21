/* Clipper for Rumble — clip editor page.
 * Preview = captured segments played through a formatting canvas, so what
 * you see is exactly what exports. Export, download and share all happen
 * locally on this device. */
(function () {
  'use strict';
  var U = window.RCUtil, DB = window.RCDB, EX = window.RCExporter,
      SH = window.RCShare, SET = window.RCSettings;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    settings: Object.assign({}, SET.DEFAULTS),
    clip: null, probed: [], durations: [], total: 0,
    trimStart: 0, trimEnd: 0,
    segIndex: 0, segUrls: [], playing: false,
    format: '9x16', sourceCrop: null,
    exportHandle: null, lastExport: null, raf: 0
  };

  var video = $('srcVideo'), canvas = $('previewCanvas'), ctx = canvas.getContext('2d');

  /* ---------------- toast ---------------- */
  var toastTimer = 0;
  function toast(msg, isError, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 3200);
  }

  /* ---------------- library ---------------- */
  function modeLabel(m) {
    return { buffer: 'Instant replay', replay: 'Replay capture', forward: 'Recorded', tab: 'Tab capture' }[m] || m || 'Clip';
  }

  function refreshLibrary(activeId) {
    return DB.listClips(100).then(function (clips) {
      $('clipCount').textContent = clips.length ? clips.length + ' saved' : '';
      var list = $('clipList');
      list.textContent = '';
      if (!clips.length) {
        list.innerHTML = '<p class="muted pad">No clips yet.<br>Go to a Rumble video and hit “Clip last 30s”.</p>';
        return clips;
      }
      clips.forEach(function (c) {
        var item = document.createElement('div');
        item.className = 'clip-item' + (c.id === activeId ? ' active' : '');
        var img = document.createElement('img'); img.alt = '';
        if (c.thumb) img.src = URL.createObjectURL(c.thumb);
        var mid = document.createElement('span');
        var when = new Date(c.createdAt);
        mid.innerHTML = '<span class="t"></span><span class="m"></span>';
        mid.querySelector('.t').textContent = c.title || 'Rumble clip';
        mid.querySelector('.m').textContent = modeLabel(c.mode) + ' · ' +
          when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
          when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        var del = document.createElement('button');
        del.className = 'del'; del.textContent = '🗑'; del.title = 'Delete clip and its exports';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('Delete this clip and its exports?')) return;
          DB.deleteClip(c.id).then(function () {
            if (state.clip && state.clip.id === c.id) closeEditor();
            refreshLibrary(state.clip ? state.clip.id : null);
            refreshStorage();
          });
        });
        item.appendChild(img); item.appendChild(mid); item.appendChild(del);
        item.addEventListener('click', function () { openClip(c.id); });
        list.appendChild(item);
      });
      return clips;
    });
  }

  function refreshStorage() {
    DB.storageEstimate().then(function (e) {
      $('storageInfo').textContent = e.usage ? ('Local storage: ' + U.formatBytes(e.usage)) : '';
    });
  }

  /* ---------------- open / probe a clip ---------------- */
  function computeSourceCrop() {
    state.sourceCrop = null;
    var c = state.clip;
    if (!c || c.mode !== 'tab' || !c.tabRect || !state.probed[0]) return;
    var vw = state.probed[0].width, vh = state.probed[0].height;
    var r = c.tabRect;
    if (!vw || !r.innerWidth) return;
    var scaleX = vw / r.innerWidth, scaleY = vh / r.innerHeight;
    state.sourceCrop = {
      sx: Math.max(0, r.x * scaleX), sy: Math.max(0, r.y * scaleY),
      sw: Math.min(vw, r.width * scaleX), sh: Math.min(vh, r.height * scaleY)
    };
    $('previewNote').textContent = 'Tab capture: exports are cropped to the player area.';
  }

  function openClip(id) {
    stopPreview();
    return DB.getClip(id).then(function (clip) {
      if (!clip) { toast('Clip not found (it may have been deleted).', true); return; }
      state.clip = clip;
      $('emptyState').hidden = true;
      $('editorCard').hidden = false;
      $('resultPanel').hidden = true;
      state.lastExport = null;
      $('clipTitle').textContent = clip.title || 'Rumble clip';
      $('clipMeta').textContent = [clip.channel ? 'by ' + clip.channel : '', modeLabel(clip.mode),
        new Date(clip.createdAt).toLocaleString()].filter(Boolean).join(' · ');
      var link = $('sourceLink');
      if (clip.pageUrl) { link.href = clip.pageUrl; link.hidden = false; } else link.hidden = true;
      $('attributionText').value = defaultAttribution(clip);
      $('attributionOn').checked = !!state.settings.addAttribution;
      history.replaceState(null, '', '?clip=' + encodeURIComponent(id));
      refreshLibrary(id);

      return EX.probeSegments(clip.segments).then(function (probed) {
        state.probed = probed;
        state.durations = probed.map(function (p) { return p.duration || 0; });
        state.total = EX.totalDuration(state.durations);
        if (state.total <= 0) {
          toast('This capture could not be read back. Try clipping again.', true, 6000);
          return;
        }
        computeSourceCrop();
        applySettingsToControls();
        setTrimToLength(Math.min(state.settings.clipLengthSec, state.total));
        updateFilename();
        return loadSegmentAt(0, state.trimStart).then(function () {
          drawPreviewFrame();
          refreshExports();
          ensureThumbnail(clip, probed);
        });
      });
    }).catch(function (e) { toast('Could not open clip: ' + e.message, true, 6000); });
  }

  function ensureThumbnail(clip, probed) {
    if (clip.thumb) return;
    EX.captureThumbnail(clip.segments, probed, Math.min(1, state.total / 2)).then(function (blob) {
      if (!blob) return;
      clip.thumb = blob;
      DB.putClip(clip).then(function () { refreshLibrary(clip.id); });
    }).catch(function () { /* thumbnail is best-effort */ });
  }

  function closeEditor() {
    stopPreview();
    state.clip = null;
    $('editorCard').hidden = true;
    $('emptyState').hidden = false;
    history.replaceState(null, '', location.pathname);
  }

  function defaultAttribution(clip) {
    var who = clip.channel ? clip.channel + ' on Rumble' : 'via Rumble';
    return 'Clipped from ' + who;
  }

  /* ---------------- segment-chained preview ---------------- */
  function globalTime() {
    var before = state.durations.slice(0, state.segIndex).reduce(function (a, b) { return a + b; }, 0);
    return before + (video.currentTime || 0);
  }

  function loadSegmentAt(index, offset) {
    state.segIndex = index;
    var url = state.segUrls[index];
    if (!url) { url = URL.createObjectURL(state.clip.segments[index]); state.segUrls[index] = url; }
    return new Promise(function (resolve) {
      var onMeta = function () {
        video.removeEventListener('loadedmetadata', onMeta);
        var target = Math.min(offset || 0, Math.max(0, (state.durations[index] || 0) - 0.05));
        var done = function () { video.removeEventListener('seeked', done); resolve(); };
        if (target > 0.03) { video.addEventListener('seeked', done); try { video.currentTime = target; } catch (e) { resolve(); } setTimeout(resolve, 2000); }
        else resolve();
      };
      if (video.src !== url) { video.addEventListener('loadedmetadata', onMeta); video.src = url; }
      else onMeta();
    });
  }

  function seekGlobal(t) {
    var loc = EX.locateTime(state.durations, U.clamp(t, 0, state.total));
    if (loc.index !== state.segIndex) return loadSegmentAt(loc.index, loc.offset).then(drawPreviewFrame);
    try { video.currentTime = loc.offset; } catch (e) { /* noop */ }
    drawPreviewFrameSoon();
    return Promise.resolve();
  }

  function playPreview() {
    if (globalTime() >= state.trimEnd - 0.05 || globalTime() < state.trimStart) {
      seekGlobal(state.trimStart);
    }
    video.play().then(function () {
      state.playing = true; $('playBtn').textContent = '⏸';
      cancelAnimationFrame(state.raf); previewLoop();
    }).catch(function () { toast('Press play again — the browser blocked autoplay with sound.', true); });
  }

  function pausePreview() {
    video.pause(); state.playing = false; $('playBtn').textContent = '▶';
    cancelAnimationFrame(state.raf); drawPreviewFrame();
  }

  function stopPreview() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* noop */ }
    state.segUrls.forEach(function (u) { if (u) URL.revokeObjectURL(u); });
    state.segUrls = []; state.segIndex = 0;
    $('playBtn').textContent = '▶';
  }

  function previewLoop() {
    drawPreviewFrame();
    updateTransport();
    if (!state.playing) return;
    state.raf = requestAnimationFrame(previewLoop);
  }

  video.addEventListener('ended', function () {
    if (state.segIndex < state.clip.segments.length - 1) {
      loadSegmentAt(state.segIndex + 1, 0).then(function () { if (state.playing) video.play().catch(function () {}); });
    } else if ($('loopSel').checked) {
      seekGlobal(state.trimStart).then(function () { video.play().catch(function () {}); });
    } else pausePreview();
  });
  video.addEventListener('timeupdate', function () {
    updateTransport();
    if (!state.playing) drawPreviewFrame();
    var g = globalTime();
    if (state.playing && g >= state.trimEnd - 0.03) {
      if ($('loopSel').checked) seekGlobal(state.trimStart);
      else pausePreview();
    }
    // roll into the next segment a hair early to hide the join
    var segDur = state.durations[state.segIndex] || 0;
    if (state.playing && segDur && video.currentTime >= segDur - 0.04 && state.segIndex < state.clip.segments.length - 1) {
      loadSegmentAt(state.segIndex + 1, 0).then(function () { video.play().catch(function () {}); });
    }
  });
  video.addEventListener('seeked', drawPreviewFrame);

  function updateTransport() {
    var g = globalTime();
    $('timeLabel').textContent = U.formatTimeFine(g) + ' / ' + U.formatTimeFine(state.total);
    var bar = $('seekBar');
    if (document.activeElement !== bar) bar.value = state.total ? Math.round((g / state.total) * 1000) : 0;
  }

  /* ---------------- framing preview ---------------- */
  function currentOpts() {
    return {
      format: state.format,
      layout: $('layoutSel').value,
      focusX: Number($('focusX').value) / 100,
      focusY: Number($('focusY').value) / 100,
      zoom: Number($('zoom').value) / 100,
      barColor: $('barColor').value,
      captionText: $('captionText').value.trim(),
      captionPosition: $('captionPos').value,
      attribution: $('attributionOn').checked ? $('attributionText').value.trim() : '',
      sourceCrop: state.sourceCrop
    };
  }

  function previewSize() {
    var src = state.probed[0] || { width: 1280, height: 720 };
    var full = EX.outputSize(src.width, src.height, state.format);
    var scale = Math.min(1, 540 / full.w, 720 / full.h);
    return { w: Math.max(2, Math.round(full.w * scale / 2) * 2), h: Math.max(2, Math.round(full.h * scale / 2) * 2), full: full };
  }

  function drawPreviewFrame() {
    if (!state.clip || !video.videoWidth) return;
    var ps = previewSize();
    if (canvas.width !== ps.w || canvas.height !== ps.h) { canvas.width = ps.w; canvas.height = ps.h; }
    EX.drawFrame(ctx, video, currentOpts(), ps);
    $('outputSizeLabel').textContent = 'Exports at ' + ps.full.w + '×' + ps.full.h +
      ' (' + EX.FORMATS[state.format].label + ') with audio.';
  }
  var drawSoonTimer = 0;
  function drawPreviewFrameSoon() { clearTimeout(drawSoonTimer); drawSoonTimer = setTimeout(drawPreviewFrame, 60); }

  /* ---------------- trim controls ---------------- */
  function setTrim(start, end, fromSlider) {
    start = U.clamp(start, 0, state.total);
    end = U.clamp(end, 0, state.total);
    if (end - start < 0.5) { if (fromSlider === 'start') start = end - 0.5; else end = start + 0.5; }
    state.trimStart = Math.max(0, start); state.trimEnd = Math.min(state.total, end);
    $('trimStart').value = state.total ? Math.round(state.trimStart / state.total * 1000) : 0;
    $('trimEnd').value = state.total ? Math.round(state.trimEnd / state.total * 1000) : 1000;
    $('trimStartNum').value = state.trimStart.toFixed(1);
    $('trimEndNum').value = state.trimEnd.toFixed(1);
    $('selDur').textContent = (state.trimEnd - state.trimStart).toFixed(1) + 's selected';
    updateFilename();
  }

  function setTrimToLength(len) {
    if (len === 'full' || len >= state.total) setTrim(0, state.total);
    else setTrim(state.total - len, state.total);
    document.querySelectorAll('.chip').forEach(function (ch) {
      ch.classList.toggle('chip-on', String(len) === ch.getAttribute('data-len') ||
        (len === 'full' && ch.getAttribute('data-len') === 'full'));
    });
  }

  function selectedDuration() { return Math.max(0.1, state.trimEnd - state.trimStart); }

  function updateFilename() {
    if (!state.clip) return;
    var ext = $('fileType').value === 'mp4' ? 'mp4' : 'webm';
    $('filenameBox').value = U.clipFilename({
      title: state.clip.title, durationSec: selectedDuration(),
      formatLabel: EX.FORMATS[state.format].fileLabel, ext: ext,
      template: state.settings.filenameTemplate
    });
  }

  /* ---------------- export / download / share ---------------- */
  function doExport() {
    if (!state.clip || state.exportHandle) return;
    pausePreview();
    var opts = currentOpts();
    opts.startSec = state.trimStart; opts.endSec = state.trimEnd;
    opts.preferMp4 = $('fileType').value === 'mp4';
    opts.videoBitsPerSecond = SET.QUALITY_BPS[$('quality').value] || SET.QUALITY_BPS.high;
    opts.onProgress = function (p) {
      $('exportBarFill').style.width = Math.round(p * 100) + '%';
      $('exportPct').textContent = Math.round(p * 100) + '%';
    };
    $('exportBtn').disabled = true;
    $('exportProgress').hidden = false;
    $('exportBarFill').style.width = '0%'; $('exportPct').textContent = '0%';
    opts.onProgress(0);

    var handle = EX.exportClip(state.clip.segments, state.probed, opts);
    state.exportHandle = handle;
    handle.promise.then(function (blob) {
      var ext = U.extForMime(blob.type);
      var name = ($('filenameBox').value.trim() || 'rumble-clip').replace(/[\\/:*?"<>|]+/g, '-');
      if (!/\.(webm|mp4)$/i.test(name)) name += '.' + ext;
      else name = name.replace(/\.(webm|mp4)$/i, '.' + ext);
      var rec = {
        id: U.uid(), clipId: state.clip.id, createdAt: Date.now(), blob: blob,
        filename: name, formatLabel: EX.FORMATS[state.format].fileLabel,
        durationSec: Math.round(selectedDuration() * 10) / 10
      };
      return DB.putExport(rec).then(function () {
        state.lastExport = rec;
        showResult(rec);
        refreshExports(); refreshStorage();
        toast('Export finished — ready to download and post.');
      });
    }).catch(function (e) {
      if (!/cancelled/i.test(e.message || '')) toast('Export failed: ' + e.message, true, 6000);
      else toast('Export cancelled.');
    }).then(function () {
      state.exportHandle = null;
      $('exportBtn').disabled = false;
      $('exportProgress').hidden = true;
    });
  }

  function showResult(rec) {
    $('resultPanel').hidden = false;
    var v = $('resultVideo');
    if (v.src) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(rec.blob);
    $('resultInfo').textContent = rec.filename + ' · ' + U.formatBytes(rec.blob.size) +
      ' · ' + rec.durationSec + 's · ' + (rec.blob.type.indexOf('mp4') !== -1 ? 'MP4' : 'WebM') + ' with audio';
    $('shareFileBtn').hidden = !SH.canShareFile(rec.blob, rec.filename);
    $('postCaption').value = SH.buildCaption({
      title: $('captionText').value.trim() || state.clip.title,
      channel: state.clip.channel, pageUrl: state.clip.pageUrl,
      hashtags: hashtagsList()
    });
    buildPostButtons();
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hashtagsList() {
    return String(state.settings.hashtags || 'Rumble, clips')
      .split(/[,\s]+/).filter(Boolean);
  }

  function buildPostButtons() {
    var grid = $('postGrid'); grid.textContent = '';
    SH.UPLOAD_PAGES.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'post-btn'; b.textContent = 'Post to ' + p.name; b.title = p.hint;
      b.addEventListener('click', function () {
        SH.copyText($('postCaption').value).catch(function () { /* clipboard best effort */ })
          .then(function () {
            toast('Caption copied — now attach your downloaded clip on ' + p.name + ' and paste.');
            window.open(p.url, '_blank', 'noopener');
          });
      });
      grid.appendChild(b);
    });
    var lg = $('linkShareGrid'); lg.textContent = '';
    SH.linkShareUrls(state.clip.pageUrl, state.clip.title).forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'post-btn'; b.textContent = s.name;
      b.addEventListener('click', function () { window.open(s.url, '_blank', 'noopener,width=640,height=560'); });
      lg.appendChild(b);
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    // Prefer chrome.downloads (nice filename + shelf UI); fall back to <a download>.
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: url, filename: filename, saveAs: false }, function () {
        if (chrome.runtime.lastError) anchorDownload(url, filename);
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      });
    } else anchorDownload(url, filename);
  }
  function anchorDownload(url, filename) {
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function refreshExports() {
    if (!state.clip) return;
    DB.listExportsForClip(state.clip.id).then(function (list) {
      var wrap = $('exportsList'); wrap.textContent = '';
      if (!list.length) { wrap.innerHTML = '<p class="muted">No exports yet.</p>'; return; }
      list.forEach(function (rec) {
        var row = document.createElement('div'); row.className = 'export-row';
        var grow = document.createElement('span'); grow.className = 'grow';
        grow.innerHTML = '<span class="fn"></span><br><span class="muted small"></span>';
        grow.querySelector('.fn').textContent = rec.filename;
        grow.querySelector('.muted').textContent =
          U.formatBytes(rec.blob.size) + ' · ' + rec.durationSec + 's · ' +
          new Date(rec.createdAt).toLocaleString();
        var dl = document.createElement('button'); dl.className = 'btn'; dl.textContent = '⬇ Download';
        dl.addEventListener('click', function () { downloadBlob(rec.blob, rec.filename); });
        var view = document.createElement('button'); view.className = 'btn btn-ghost'; view.textContent = 'View / share';
        view.addEventListener('click', function () { state.lastExport = rec; showResult(rec); });
        var del = document.createElement('button'); del.className = 'btn btn-ghost'; del.textContent = 'Delete';
        del.addEventListener('click', function () { DB.deleteExport(rec.id).then(refreshExports).then(refreshStorage); });
        row.appendChild(grow); row.appendChild(dl); row.appendChild(view); row.appendChild(del);
        wrap.appendChild(row);
      });
    });
  }

  /* ---------------- wiring ---------------- */
  function applySettingsToControls() {
    setFormat(state.settings.defaultFormat || '9x16', false);
    $('layoutSel').value = state.settings.defaultLayout || 'fit-blur';
    $('fileType').value = state.settings.preferMp4 ? 'mp4' : 'webm';
    $('quality').value = state.settings.quality || 'high';
    onLayoutChange();
  }

  function setFormat(fmt, redraw) {
    if (!EX.FORMATS[fmt]) fmt = '9x16';
    state.format = fmt;
    document.querySelectorAll('#formatCards .fcard').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-format') === fmt);
    });
    // Vertical portraits look best fit-blur from a 16:9 source and vice versa;
    // only the canvas changes here — the layout stays the user's choice.
    updateFilename();
    if (redraw !== false) drawPreviewFrame();
  }

  function onLayoutChange() {
    $('barColorRow').hidden = $('layoutSel').value !== 'fit-bars';
    drawPreviewFrame();
  }

  function focusLabel(v, lo, hi) { return v < 40 ? lo : (v > 60 ? hi : 'Centre'); }

  function wire() {
    $('playBtn').addEventListener('click', function () { state.playing ? pausePreview() : playPreview(); });
    $('seekBar').addEventListener('input', function () { seekGlobal(state.total * Number(this.value) / 1000); });
    $('trimStart').addEventListener('input', function () { setTrim(state.total * Number(this.value) / 1000, state.trimEnd, 'start'); seekGlobal(state.trimStart); });
    $('trimEnd').addEventListener('input', function () { setTrim(state.trimStart, state.total * Number(this.value) / 1000, 'end'); seekGlobal(Math.max(state.trimStart, state.trimEnd - 0.5)); });
    $('trimStartNum').addEventListener('change', function () { setTrim(Number(this.value) || 0, state.trimEnd, 'start'); });
    $('trimEndNum').addEventListener('change', function () { setTrim(state.trimStart, Number(this.value) || state.total, 'end'); });
    document.querySelectorAll('.chip').forEach(function (ch) {
      ch.addEventListener('click', function () {
        var v = ch.getAttribute('data-len');
        setTrimToLength(v === 'full' ? 'full' : Number(v));
        seekGlobal(state.trimStart);
      });
    });
    document.querySelectorAll('#formatCards .fcard').forEach(function (c) {
      c.addEventListener('click', function () { setFormat(c.getAttribute('data-format')); });
    });
    $('layoutSel').addEventListener('change', onLayoutChange);
    $('barColor').addEventListener('input', drawPreviewFrame);
    $('focusX').addEventListener('input', function () { $('focusXVal').textContent = focusLabel(Number(this.value), 'Left', 'Right'); drawPreviewFrame(); });
    $('focusY').addEventListener('input', function () { $('focusYVal').textContent = focusLabel(Number(this.value), 'Top', 'Bottom'); drawPreviewFrame(); });
    $('zoom').addEventListener('input', function () { $('zoomVal').textContent = (Number(this.value) / 100).toFixed(2) + '×'; drawPreviewFrame(); });
    ['captionText', 'captionPos', 'attributionText'].forEach(function (id) {
      $(id).addEventListener('input', drawPreviewFrame);
      $(id).addEventListener('change', drawPreviewFrame);
    });
    $('attributionOn').addEventListener('change', drawPreviewFrame);
    $('fileType').addEventListener('change', updateFilename);
    $('exportBtn').addEventListener('click', doExport);
    $('cancelExport').addEventListener('click', function () { if (state.exportHandle) state.exportHandle.cancel(); });
    $('downloadBtn').addEventListener('click', function () {
      if (state.lastExport) downloadBlob(state.lastExport.blob, state.lastExport.filename);
    });
    $('shareFileBtn').addEventListener('click', function () {
      if (!state.lastExport) return;
      SH.shareFile(state.lastExport.blob, state.lastExport.filename, $('postCaption').value)
        .catch(function () { /* user closed the share sheet */ });
    });
    $('copyCaptionBtn').addEventListener('click', function () {
      SH.copyText($('postCaption').value).then(function () { toast('Caption copied.'); });
    });
    $('openOptions').addEventListener('click', function () {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open('../options/options.html', '_blank');
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code === 'Space' && state.clip) { e.preventDefault(); state.playing ? pausePreview() : playPreview(); }
    });
  }

  /* ---------------- init ---------------- */
  SET.load().then(function (s) {
    state.settings = s;
    wire();
    refreshStorage();
    var wanted = new URLSearchParams(location.search).get('clip');
    return refreshLibrary(wanted).then(function (clips) {
      if (wanted) return openClip(wanted);
      if (clips && clips.length) return openClip(clips[0].id);
    });
  });
})();
