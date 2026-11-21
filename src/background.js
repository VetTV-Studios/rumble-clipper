/* Clipper for Rumble — MV3 service worker.
 * Handles keyboard commands, the context menu, opening the editor,
 * downloads, badge feedback, and the offscreen tabCapture fallback.
 * No network calls are made from here. */

var EDITOR_PATH = 'src/editor/editor.html';

function isRumbleTab(tab) {
  try {
    var u = new URL(tab.url || '');
    return u.hostname === 'rumble.com' || u.hostname.endsWith('.rumble.com');
  } catch (e) { return false; }
}

function sendToActiveRumbleTab(message) {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    var tab = tabs[0];
    if (!tab || !isRumbleTab(tab)) return null;
    return chrome.tabs.sendMessage(tab.id, message).catch(function () { return null; });
  });
}

function openEditor(clipId) {
  var url = chrome.runtime.getURL(EDITOR_PATH) + (clipId ? '?clip=' + encodeURIComponent(clipId) : '');
  return chrome.tabs.create({ url: url, active: true });
}

function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text: text || '' });
    if (color) chrome.action.setBadgeBackgroundColor({ color: color });
    if (text) setTimeout(function () { chrome.action.setBadgeText({ text: '' }); }, 4000);
  } catch (e) { /* noop */ }
}

/* ---------------- install / menus / commands ---------------- */
chrome.runtime.onInstalled.addListener(function (details) {
  chrome.contextMenus.create({
    id: 'rc-clip-last', title: 'Clip last 30 seconds',
    contexts: ['page', 'video'], documentUrlPatterns: ['*://rumble.com/*', '*://*.rumble.com/*']
  });
  chrome.contextMenus.create({
    id: 'rc-record-next', title: 'Record next 30 seconds',
    contexts: ['page', 'video'], documentUrlPatterns: ['*://rumble.com/*', '*://*.rumble.com/*']
  });
  chrome.contextMenus.create({
    id: 'rc-open-library', title: 'Open my clips',
    contexts: ['action']
  });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') + '?welcome=1' });
  }
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'rc-open-library') return void openEditor(null);
  if (!tab || !isRumbleTab(tab)) return;
  var type = info.menuItemId === 'rc-clip-last' ? 'rc:clip-last' : 'rc:record-next';
  chrome.tabs.sendMessage(tab.id, { type: type }).catch(function () { /* content script not ready */ });
});

chrome.commands.onCommand.addListener(function (command) {
  if (command === 'clip-last-30') sendToActiveRumbleTab({ type: 'rc:clip-last' });
  else if (command === 'record-next-30') sendToActiveRumbleTab({ type: 'rc:record-next' });
});

/* ---------------- messages ---------------- */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  if (msg.type === 'rc:open-editor') {
    openEditor(msg.clipId).then(function () { sendResponse({ ok: true }); });
    return true;
  }
  if (msg.type === 'rc:clip-created') {
    setBadge('✓', '#8dc63f');
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'rc:capture-blocked') {
    setBadge('!', '#d93025');
    if (sender.tab) chrome.storage.local.set({ rcPendingRect: { tabId: sender.tab.id, rect: msg.rect, at: Date.now() } });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'rc:start-tab-capture') {
    startTabCapture(msg).then(
      function (r) { sendResponse({ ok: true, result: r }); },
      function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    );
    return true;
  }
  if (msg.type === 'rc:stop-tab-capture') {
    stopTabCapture().then(
      function () { sendResponse({ ok: true }); },
      function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    );
    return true;
  }
  if (msg.type === 'rc:download-export') {
    // Editor passes a blob: URL it minted, or asks us to download by export id.
    if (msg.url && msg.filename) {
      chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: !!msg.saveAs })
        .then(function (id) { sendResponse({ ok: true, downloadId: id }); })
        .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
      return true;
    }
    sendResponse({ ok: false, error: 'Missing url/filename' });
    return;
  }
});

/* ---------------- tabCapture fallback (offscreen) ----------------
 * Used only when the player's media is not origin-clean and
 * video.captureStream() is unavailable. Records the whole tab;
 * the editor crops to the video's rectangle during export.
 * Requires the optional "tabCapture" permission (requested from the
 * popup with a user gesture) and the "offscreen" permission.
 */
var offscreenCreating = null;

function ensureOffscreen() {
  if (offscreenCreating) return offscreenCreating;
  offscreenCreating = chrome.offscreen.hasDocument().then(function (has) {
    if (has) return true;
    return chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Record the active Rumble tab (video + audio) when the player blocks direct media capture, so the user can save a 30-second clip locally.'
    }).then(function () { return true; });
  }).catch(function (e) { offscreenCreating = null; throw e; });
  return offscreenCreating;
}

function startTabCapture(opts) {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    var tab = tabs[0];
    if (!tab || !isRumbleTab(tab)) throw new Error('Open a Rumble video tab first.');
    return ensureOffscreen().then(function () {
      return chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    }).then(function (streamId) {
      return chrome.runtime.sendMessage({
        target: 'rc-offscreen', type: 'rc:offscreen-start',
        streamId: streamId,
        seconds: opts.seconds || 30,
        rect: opts.rect || null,
        meta: opts.meta || { title: tab.title || 'Rumble clip', channel: '', pageUrl: tab.url || '' }
      });
    });
  });
}

function stopTabCapture() {
  return chrome.runtime.sendMessage({ target: 'rc-offscreen', type: 'rc:offscreen-stop' })
    .catch(function () { /* offscreen document may not exist */ });
}
