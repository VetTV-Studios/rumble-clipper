/* Clipper for Rumble — clip export engine.
 *
 * Renders captured segment(s) through a <canvas> at the target aspect
 * (16:9 horizontal, 9:16 vertical, 1:1, 4:5), mixing the source audio
 * track in, and records with MediaRecorder. Everything happens locally.
 *
 * Pure geometry helpers are unit-tested in test/logic.test.js.
 */
(function (global) {
  'use strict';
  var U = global.RCUtil || (typeof require !== 'undefined' ? require('./util.js') : null);
  var clamp = U ? U.clamp : function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  var FORMATS = {
    '16x9': { label: '16:9 Horizontal', w: 1920, h: 1080, fileLabel: '16x9' },
    '9x16': { label: '9:16 Vertical', w: 1080, h: 1920, fileLabel: '9x16' },
    '1x1': { label: '1:1 Square', w: 1080, h: 1080, fileLabel: '1x1' },
    '4x5': { label: '4:5 Portrait', w: 1080, h: 1350, fileLabel: '4x5' }
  };

  /**
   * Output size: never upscale beyond the source's capable resolution.
   * Keeps the format aspect; width is capped by format w and by what the
   * source can supply for a "fill" crop (source height drives vertical).
   */
  function outputSize(srcW, srcH, formatKey) {
    var f = FORMATS[formatKey] || FORMATS['16x9'];
    var aspect = f.w / f.h;
    var w = f.w, h = f.h;
    if (srcW > 0 && srcH > 0) {
      // For fill, the limiting source dimension is the one that maps to
      // the smaller side of the target. Cap so we upscale at most 1x.
      var maxWFromSrc = aspect >= 1 ? srcW : Math.round(srcH * aspect);
      var maxHFromSrc = aspect >= 1 ? Math.round(srcW / aspect) : srcH;
      w = Math.min(w, Math.max(320, maxWFromSrc));
      h = Math.round(w / aspect);
      if (h > maxHFromSrc && aspect < 1) { h = Math.max(320, maxHFromSrc); w = Math.round(h * aspect); }
    }
    // Encoders like even dimensions.
    return { w: w - (w % 2), h: h - (h % 2) };
  }

  /**
   * Compute draw rectangles for one frame.
   * layout: 'fill' (crop to fill) | 'fit-blur' | 'fit-bars'
   * focusX/focusY: 0..1 crop focus for fill (0.5 = centre)
   * zoom: >=1 extra magnification for fill (1 = none)
   * Returns { main:{sx,sy,sw,sh,dx,dy,dw,dh}, bg?:{...same} }
   * bg is the full-frame blurred backdrop for fit-blur.
   */
  function computeDrawRects(srcW, srcH, dstW, dstH, layout, focusX, focusY, zoom) {
    focusX = clamp(focusX == null ? 0.5 : focusX, 0, 1);
    focusY = clamp(focusY == null ? 0.5 : focusY, 0, 1);
    zoom = clamp(zoom || 1, 1, 4);
    var srcAspect = srcW / srcH, dstAspect = dstW / dstH;

    if (layout === 'fill') {
      var sw, sh;
      if (srcAspect > dstAspect) { sh = srcH; sw = sh * dstAspect; }
      else { sw = srcW; sh = sw / dstAspect; }
      sw /= zoom; sh /= zoom;
      var sx = (srcW - sw) * focusX, sy = (srcH - sh) * focusY;
      return { main: { sx: sx, sy: sy, sw: sw, sh: sh, dx: 0, dy: 0, dw: dstW, dh: dstH } };
    }

    // fit: whole source visible, centred (zoom>1 pushes into a mild crop)
    var scale = Math.min(dstW / srcW, dstH / srcH) * zoom;
    var dw = Math.min(dstW, srcW * scale), dh = Math.min(dstH, srcH * scale);
    var res = {
      main: {
        sx: 0, sy: 0, sw: srcW, sh: srcH,
        dx: (dstW - dw) / 2, dy: (dstH - dh) * focusY, dw: dw, dh: dh
      }
    };
    if (layout === 'fit-blur') {
      // backdrop = fill-cropped copy, drawn blurred + darkened by caller
      var bsw, bsh;
      if (srcAspect > dstAspect) { bsh = srcH; bsw = bsh * dstAspect; }
      else { bsw = srcW; bsh = bsw / dstAspect; }
      res.bg = {
        sx: (srcW - bsw) / 2, sy: (srcH - bsh) / 2, sw: bsw, sh: bsh,
        dx: 0, dy: 0, dw: dstW, dh: dstH
      };
    }
    return res;
  }

  /** Map a global time (across segments) to {index, offset}. */
  function locateTime(durations, t) {
    var total = durations.reduce(function (a, b) { return a + b; }, 0);
    t = clamp(t, 0, Math.max(0, total - 0.001));
    var acc = 0;
    for (var i = 0; i < durations.length; i++) {
      if (t < acc + durations[i] || i === durations.length - 1) {
        return { index: i, offset: t - acc, total: total };
      }
      acc += durations[i];
    }
    return { index: 0, offset: 0, total: total };
  }

  function totalDuration(durations) {
    return durations.reduce(function (a, b) { return a + (b || 0); }, 0);
  }

  var pure = {
    FORMATS: FORMATS, outputSize: outputSize,
    computeDrawRects: computeDrawRects, locateTime: locateTime,
    totalDuration: totalDuration
  };
  global.RCExportMath = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;

  /* ------------- browser-only rendering below ------------- */
  if (typeof document === 'undefined') return;

  /**
   * MediaRecorder WebMs often report duration = Infinity until seeked.
   * Force the browser to compute it, then restore position.
   */
  function probeDuration(video) {
    return new Promise(function (resolve) {
      if (isFinite(video.duration) && video.duration > 0) return resolve(video.duration);
      var onChange = function () {
        if (isFinite(video.duration) && video.duration > 0) {
          video.removeEventListener('durationchange', onChange);
          try { video.currentTime = 0; } catch (e) { /* noop */ }
          resolve(video.duration);
        }
      };
      video.addEventListener('durationchange', onChange);
      try { video.currentTime = 1e7; } catch (e) { resolve(0); }
      setTimeout(function () {
        video.removeEventListener('durationchange', onChange);
        resolve(isFinite(video.duration) ? video.duration : 0);
      }, 4000);
    });
  }

  function loadSegment(video, blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var cleanup = function () {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onErr);
      };
      var onMeta = function () {
        cleanup();
        probeDuration(video).then(function (d) { resolve({ url: url, duration: d }); });
      };
      var onErr = function () { cleanup(); URL.revokeObjectURL(url); reject(new Error('Could not load captured segment.')); };
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('error', onErr);
      video.src = url;
    });
  }

  /** Probe every segment's real duration + dimensions. */
  function probeSegments(blobs) {
    var video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    var results = [];
    var chain = Promise.resolve();
    blobs.forEach(function (blob, i) {
      chain = chain.then(function () {
        return loadSegment(video, blob).then(function (r) {
          results[i] = {
            duration: r.duration, url: r.url,
            width: video.videoWidth, height: video.videoHeight
          };
        });
      });
    });
    return chain.then(function () {
      video.removeAttribute('src'); video.load();
      return results;
    });
  }

  function drawFrame(ctx, video, opts, size) {
    var rects = computeDrawRects(video.videoWidth, video.videoHeight,
      size.w, size.h, opts.layout, opts.focusX, opts.focusY, opts.zoom);
    ctx.save();
    if (opts.layout === 'fit-blur' && rects.bg) {
      ctx.filter = 'blur(40px) brightness(0.55) saturate(1.2)';
      var b = rects.bg;
      // overdraw edges so blur doesn't reveal transparency
      ctx.drawImage(video, b.sx, b.sy, b.sw, b.sh, -size.w * 0.05, -size.h * 0.05, size.w * 1.1, size.h * 1.1);
      ctx.filter = 'none';
    } else if (opts.layout === 'fit-bars') {
      ctx.fillStyle = opts.barColor || '#000000';
      ctx.fillRect(0, 0, size.w, size.h);
    }
    var m = rects.main;
    if (opts.sourceCrop) { // tab-capture fallback: only draw the video's rect of the tab
      var c = opts.sourceCrop;
      ctx.drawImage(video, c.sx + m.sx * (c.sw / video.videoWidth), c.sy + m.sy * (c.sh / video.videoHeight),
        m.sw * (c.sw / video.videoWidth), m.sh * (c.sh / video.videoHeight), m.dx, m.dy, m.dw, m.dh);
    } else {
      ctx.drawImage(video, m.sx, m.sy, m.sw, m.sh, m.dx, m.dy, m.dw, m.dh);
    }
    drawOverlays(ctx, size, opts);
    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  function drawOverlays(ctx, size, opts) {
    var pad = Math.round(size.w * 0.045);
    if (opts.captionText) {
      var fontPx = Math.max(20, Math.round(size.w * 0.042));
      ctx.font = '700 ' + fontPx + 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var lines = wrapText(ctx, opts.captionText, size.w - pad * 2);
      var lh = fontPx * 1.25, boxH = lines.length * lh + pad * 0.8;
      var y = opts.captionPosition === 'top' ? pad : size.h - boxH - pad - (opts.attribution ? fontPx * 1.1 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, pad * 0.5, y - pad * 0.35, size.w - pad, boxH, Math.round(fontPx * 0.35));
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      lines.forEach(function (line, i) { ctx.fillText(line, size.w / 2, y + i * lh); });
    }
    if (opts.attribution) {
      var apx = Math.max(14, Math.round(size.w * 0.026));
      ctx.font = '500 ' + apx + 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(opts.attribution, size.w / 2, size.h - Math.round(size.h * 0.018));
      ctx.shadowBlur = 0;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Wait (briefly) for a capture stream to expose an audio track. */
  function waitForAudioTracks(stream, ms) {
    if (!stream) return Promise.resolve([]);
    if (stream.getAudioTracks().length) return Promise.resolve(stream.getAudioTracks());
    return new Promise(function (resolve) {
      var done = false;
      var iv = setInterval(function () { if (stream.getAudioTracks().length) finish(); }, 50);
      function finish() {
        if (done) return; done = true; clearInterval(iv);
        resolve(stream.getAudioTracks());
      }
      if (stream.addEventListener) stream.addEventListener('addtrack', finish);
      setTimeout(finish, ms);
    });
  }

  /**
   * Acquire audio track(s) for the export recording. MUST be called only
   * after media has loaded — captureStream() on an empty element has no
   * audio tracks yet (that ordering shipped silent exports in v1.0.0).
   * Falls back to WebAudio routing if captureStream exposes no audio.
   */
  function acquireAudioTracks(video) {
    var stream = null;
    try { stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null); }
    catch (e) { stream = null; }
    // Some builds only publish capture tracks once playback starts.
    var primed = Promise.resolve();
    try { var p = video.play(); if (p && p.catch) primed = p.catch(function () { /* retried in loop */ }); } catch (e) { /* noop */ }
    return primed.then(function () { return waitForAudioTracks(stream, 1500); }).then(function (tracks) {
      try { video.pause(); } catch (e) { /* noop */ }
      if (tracks.length) return { tracks: tracks, audioCtx: null };
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return { tracks: [], audioCtx: null };
        var ac = new AC();
        var sourceNode = ac.createMediaElementSource(video);
        var dest = ac.createMediaStreamDestination();
        sourceNode.connect(dest);
        if (ac.resume) ac.resume().catch(function () { /* noop */ });
        return { tracks: dest.stream.getAudioTracks(), audioCtx: ac };
      } catch (e) {
        return { tracks: [], audioCtx: null };
      }
    });
  }

  /**
   * Render an export.
   * opts: { format, layout, focusX, focusY, zoom, barColor,
   *         captionText, captionPosition, attribution,
   *         startSec, endSec, preferMp4, videoBitsPerSecond,
   *         sourceCrop?, onProgress(0..1) }
   * Returns { promise<Blob>, cancel() }
   */
  function exportClip(blobs, probed, opts) {
    var cancelled = false;
    var durations = probed.map(function (p) { return p.duration; });
    var total = totalDuration(durations);
    var startSec = clamp(opts.startSec || 0, 0, total);
    var endSec = clamp(opts.endSec == null ? total : opts.endSec, startSec + 0.1, total);
    var src = probed[0] || { width: 1280, height: 720 };
    var size = outputSize(src.width, src.height, opts.format);

    var promise = (async function () {
      var video = document.createElement('video');
      video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
      var canvas = document.createElement('canvas');
      canvas.width = size.w; canvas.height = size.h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.w, size.h);

      var loc = locateTime(durations, startSec);
      var segIndex = loc.index;
      var segStartOffset = loc.offset;
      var elapsedBeforeSeg = startSec - segStartOffset;

      // Load media BEFORE acquiring capture audio: captureStream() on an
      // empty element exposes no audio tracks, which silently produced
      // video-only exports (v1.0.0 bug — user clips had no sound).
      video.muted = false; video.volume = 1;
      var preloaded = await loadSegment(video, blobs[segIndex]);
      var preloadedFor = segIndex;
      await seek(video, segStartOffset);
      var audio = await acquireAudioTracks(video);

      var canvasStream = canvas.captureStream(30);
      var tracks = canvasStream.getVideoTracks().slice().concat(audio.tracks);
      var combined = new MediaStream(tracks);
      var mime = U.pickMimeType(opts.preferMp4);
      var recorder = new MediaRecorder(combined, {
        mimeType: mime || undefined,
        videoBitsPerSecond: opts.videoBitsPerSecond || 8000000,
        audioBitsPerSecond: 192000
      });
      var chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var stopped = new Promise(function (res) { recorder.onstop = res; });

      recorder.start(200);

      var rafId = 0;
      var draw = function () {
        if (cancelled) return;
        if (video.readyState >= 2 && video.videoWidth) drawFrame(ctx, video, opts, size);
        rafId = requestAnimationFrame(draw);
      };

      try {
        while (segIndex < blobs.length && !cancelled) {
          var loaded;
          if (preloaded && segIndex === preloadedFor) { loaded = preloaded; preloaded = null; }
          else loaded = await loadSegment(video, blobs[segIndex]);
          var segDur = durations[segIndex] || loaded.duration || 0;
          var segGlobalStart = durations.slice(0, segIndex).reduce(function (a, b) { return a + b; }, 0);
          var playFrom = segIndex === loc.index ? segStartOffset : 0;
          var playTo = Math.min(segDur, endSec - segGlobalStart);
          if (playTo <= playFrom) { URL.revokeObjectURL(loaded.url); segIndex++; continue; }
          await seek(video, playFrom);
          video.muted = false; video.volume = 1;
          await video.play().catch(function () { /* editor page gesture chain keeps this allowed */ });
          draw();
          await waitUntil(video, playTo, function () {
            if (opts.onProgress) {
              var g = segGlobalStart + video.currentTime;
              opts.onProgress(clamp((g - startSec) / (endSec - startSec), 0, 1));
            }
            return cancelled;
          });
          video.pause();
          URL.revokeObjectURL(loaded.url);
          segIndex++;
          void elapsedBeforeSeg;
        }
      } finally {
        cancelAnimationFrame(rafId);
        if (recorder.state !== 'inactive') recorder.stop();
      }
      // Stop source tracks only after the recorder has finalized, so the
      // tail of the audio is not dropped before muxing completes.
      await stopped;
      tracks.forEach(function (t) { try { t.stop(); } catch (e) { /* noop */ } });
      if (audio.audioCtx) { try { await audio.audioCtx.close(); } catch (e) { /* noop */ } }
      if (preloaded) URL.revokeObjectURL(preloaded.url);
      if (cancelled) throw new Error('Export cancelled');
      return new Blob(chunks, { type: recorder.mimeType || mime || 'video/webm' });
    })();

    return { promise: promise, cancel: function () { cancelled = true; }, size: size };
  }

  function seek(video, t) {
    return new Promise(function (resolve) {
      if (Math.abs(video.currentTime - t) < 0.05 && video.readyState >= 2) return resolve();
      var onSeeked = function () { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
      try { video.currentTime = t; } catch (e) { video.removeEventListener('seeked', onSeeked); resolve(); }
      setTimeout(resolve, 2500);
    });
  }

  function waitUntil(video, targetTime, tick) {
    return new Promise(function (resolve) {
      var iv = setInterval(function () {
        var abort = tick && tick();
        if (abort || video.ended || video.currentTime >= targetTime - 0.02) {
          clearInterval(iv); resolve();
        }
      }, 50);
    });
  }

  /** Grab a poster frame (JPEG blob) at global time t — used for thumbnails. */
  function captureThumbnail(blobs, probed, tSec) {
    var durations = probed.map(function (p) { return p.duration; });
    var loc = locateTime(durations, tSec || 0);
    var video = document.createElement('video');
    video.muted = true; video.playsInline = true;
    return loadSegment(video, blobs[loc.index]).then(function (loaded) {
      return seek(video, Math.min(loc.offset, Math.max(0, (durations[loc.index] || 1) - 0.1))).then(function () {
        var c = document.createElement('canvas');
        var scale = Math.min(1, 320 / (video.videoWidth || 320));
        c.width = Math.round((video.videoWidth || 320) * scale);
        c.height = Math.round((video.videoHeight || 180) * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        URL.revokeObjectURL(loaded.url);
        return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.7); });
      });
    });
  }

  global.RCExporter = {
    FORMATS: FORMATS, outputSize: outputSize, computeDrawRects: computeDrawRects,
    locateTime: locateTime, totalDuration: totalDuration,
    probeSegments: probeSegments, exportClip: exportClip,
    captureThumbnail: captureThumbnail, drawFrame: drawFrame
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
