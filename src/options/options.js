/* Clipper for Rumble — options page. */
(function () {
  'use strict';
  var U = window.RCUtil, DB = window.RCDB, SET = window.RCSettings;
  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ['clipLengthSec', 'bufferSec', 'defaultFormat', 'defaultLayout', 'quality', 'filenameTemplate', 'hashtags'];
  var CHECKS = ['bufferEnabled', 'openEditorAfterClip', 'preferMp4', 'addAttribution'];
  var NUMBERS = { clipLengthSec: 1, bufferSec: 1 };

  if (new URLSearchParams(location.search).get('welcome') === '1') $('welcome').hidden = false;

  function fill(s) {
    FIELDS.forEach(function (f) { if ($(f)) $(f).value = s[f]; });
    CHECKS.forEach(function (f) { if ($(f)) $(f).checked = !!s[f]; });
  }
  function read() {
    var out = {};
    FIELDS.forEach(function (f) { out[f] = NUMBERS[f] ? Number($(f).value) : $(f).value; });
    CHECKS.forEach(function (f) { out[f] = $(f).checked; });
    // Keep the buffer comfortably longer than a clip.
    if (out.bufferSec < out.clipLengthSec + 10) out.bufferSec = out.clipLengthSec + 15;
    return out;
  }

  function refreshLib() {
    Promise.all([DB.listClips(500), DB.storageEstimate()]).then(function (r) {
      $('libInfo').textContent = r[0].length + ' clip(s) stored locally' +
        (r[1].usage ? ' · ' + U.formatBytes(r[1].usage) + ' used on this device' : '') +
        '. Clips never leave this device unless you download/share them.';
    });
  }

  SET.load().then(fill);
  refreshLib();

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    SET.save(read()).then(function () {
      $('savedNote').hidden = false;
      setTimeout(function () { $('savedNote').hidden = true; }, 2000);
      SET.load().then(fill);
    });
  });
  $('openEditor').addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
  });
  $('wipe').addEventListener('click', function () {
    if (!confirm('Delete ALL stored clips and exports from this device? Downloaded files are unaffected.')) return;
    DB.listClips(1000).then(function (clips) {
      return clips.reduce(function (p, c) { return p.then(function () { return DB.deleteClip(c.id); }); }, Promise.resolve());
    }).then(refreshLib);
  });
  $('shortcuts').addEventListener('click', function () {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
})();
