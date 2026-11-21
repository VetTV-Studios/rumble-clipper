/* Clipper for Rumble — shared utilities. Attaches to globalThis.RCUtil.
   Also exportable for Node unit tests (see bottom guard). */
(function (global) {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** seconds -> "m:ss" (or "h:mm:ss" when >= 1h) */
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  /** seconds -> "0:30.0" tenths, for trim readouts */
  function formatTimeFine(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'], i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function slugify(text, maxLen) {
    var s = String(text || 'clip').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!s) s = 'clip';
    return s.slice(0, maxLen || 48).replace(/-+$/g, '') || 'clip';
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Build a download filename, e.g.
   * rumble-clip-my-video-title-30s-9x16.webm
   */
  function clipFilename(opts) {
    var title = slugify(opts.title || 'rumble-clip');
    var dur = Math.max(1, Math.round(opts.durationSec || 30));
    var fmt = opts.formatLabel || '16x9'; // "9x16" | "16x9" | "1x1" | "4x5"
    var ext = opts.ext || 'webm';
    var tpl = opts.template || 'rumble-clip-{title}-{duration}s-{format}.{ext}';
    return tpl.replace('{title}', title).replace('{duration}', String(dur))
      .replace('{format}', fmt).replace('{ext}', ext)
      .replace(/[\\/:*?"<>|]+/g, '-');
  }

  /** Pick the best MediaRecorder mime type the browser actually supports. */
  function pickMimeType(preferMp4) {
    if (typeof MediaRecorder === 'undefined') return '';
    var candidates = preferMp4
      ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4',
         'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
         'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      try { if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i]; } catch (e) { /* keep trying */ }
    }
    return '';
  }

  function extForMime(mime) { return mime && mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm'; }

  var api = {
    formatTime: formatTime, formatTimeFine: formatTimeFine, formatBytes: formatBytes,
    slugify: slugify, clamp: clamp, uid: uid, clipFilename: clipFilename,
    pickMimeType: pickMimeType, extForMime: extForMime
  };
  global.RCUtil = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
