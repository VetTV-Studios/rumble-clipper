/* Clipper for Rumble — sharing helpers.
 *
 * Reality check baked into the UX: TikTok, Instagram and YouTube do not
 * let a browser extension upload on a user's behalf without each
 * platform's approved API app + OAuth. So "post to socials" here means:
 *   1. Web Share API with the actual file (mobile / supported desktops)
 *   2. One-click open of each platform's upload page + caption copied
 *      to the clipboard, so posting is: click -> pick file -> paste -> post
 *   3. Link-share intents (X / Facebook / etc.) for the source video
 */
(function (global) {
  'use strict';

  function buildCaption(opts) {
    var parts = [];
    if (opts.title) parts.push(opts.title);
    if (opts.channel) parts.push('via ' + opts.channel + ' on Rumble');
    var tags = (opts.hashtags || ['Rumble', 'clips']).map(function (t) {
      return '#' + String(t).replace(/[^A-Za-z0-9_]/g, '');
    }).filter(function (t) { return t.length > 1; });
    var text = parts.join(' — ');
    if (opts.pageUrl) text += '\nFull video: ' + opts.pageUrl;
    if (tags.length) text += '\n' + tags.join(' ');
    return text.trim();
  }

  var UPLOAD_PAGES = [
    { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/upload', hint: 'Upload page — choose your downloaded clip, paste the caption.' },
    { id: 'youtube', name: 'YouTube Shorts', url: 'https://www.youtube.com/upload', hint: 'Upload page — vertical clips under 60s become Shorts automatically. Add #Shorts.' },
    { id: 'instagram', name: 'Instagram Reels', url: 'https://www.instagram.com/', hint: 'Instagram web upload: use the + Create button, then pick your clip.' },
    { id: 'facebook', name: 'Facebook Reels', url: 'https://www.facebook.com/reels/create', hint: 'Reels composer — add your downloaded clip.' },
    { id: 'x', name: 'X (Twitter)', url: 'https://x.com/compose/post', hint: 'Composer — attach the clip with the media button, paste the caption.' },
    { id: 'rumble', name: 'Rumble', url: 'https://rumble.com/upload.php', hint: 'Upload the clip back to your own Rumble channel.' }
  ];

  function linkShareUrls(pageUrl, text) {
    var u = encodeURIComponent(pageUrl || ''), t = encodeURIComponent(text || '');
    return [
      { id: 'x', name: 'X', url: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t },
      { id: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/sharer/sharer.php?u=' + u },
      { id: 'telegram', name: 'Telegram', url: 'https://t.me/share/url?url=' + u + '&text=' + t },
      { id: 'whatsapp', name: 'WhatsApp', url: 'https://wa.me/?text=' + t + '%20' + u },
      { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/submit?url=' + u + '&title=' + t },
      { id: 'email', name: 'Email', url: 'mailto:?subject=' + t + '&body=' + u }
    ];
  }

  /** Share the exported file via the OS share sheet when supported. */
  function canShareFile(blob, filename) {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    try {
      var f = new File([blob], filename, { type: blob.type || 'video/webm' });
      return navigator.canShare({ files: [f] });
    } catch (e) { return false; }
  }

  function shareFile(blob, filename, caption) {
    var f = new File([blob], filename, { type: blob.type || 'video/webm' });
    return navigator.share({ files: [f], title: filename, text: caption });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); resolve(); }
      catch (e) { reject(e); }
      ta.remove();
    });
  }

  var api = {
    buildCaption: buildCaption, UPLOAD_PAGES: UPLOAD_PAGES,
    linkShareUrls: linkShareUrls, canShareFile: canShareFile,
    shareFile: shareFile, copyText: copyText
  };
  global.RCShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
