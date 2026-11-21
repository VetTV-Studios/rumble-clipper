# Privacy Policy — Clipper for Rumble

_Last updated: 2026-11-20_

**The short version: this extension collects nothing.** There are no
accounts, no analytics, no tracking, no advertising, and no servers.
Clips are captured, edited, rendered, and stored entirely on your own
device, in your browser.

## What the extension accesses

- **The video you are watching on rumble.com.** When you use a clip
  action, the extension captures the playing video and its audio using
  your browser's built-in media APIs, on your device.
- **An optional replay buffer.** If "Instant-replay buffer" is enabled
  in settings, a rolling buffer of recent playback is kept **in memory
  only** while a Rumble tab plays, so "Clip last 30s" works instantly.
  Buffered media is discarded continuously and is only saved if you
  explicitly clip it. You can turn the buffer off at any time.
- **Local storage.** Clips you save, exports you render, and your
  settings are stored in your browser's local extension storage
  (IndexedDB / `chrome.storage`) on your device. Settings may sync
  between your own signed-in Chrome browsers via `chrome.storage.sync`;
  they are not sent to us (we have no server to receive them).

## What is sent over the network

Nothing. The extension makes **no network requests** of its own. It
contains no analytics SDKs, no remotely hosted code, and no third-party
services. When you click a "Post to…" button, your browser simply opens
that platform's normal upload page in a new tab; anything you then
upload there is governed by that platform's own privacy policy.

## Data sharing

We do not collect, sell, rent, or share any personal data, browsing
history, or media, because none of it ever reaches us.

## Deleting your data

Use the trash controls in the clip editor, or "Delete all clips &
exports" in Settings, or uninstall the extension — uninstalling removes
all locally stored clips, exports, and settings.

## Children

The extension is a general-purpose media tool and is not directed at
children under 13.

## Changes

If a future version ever changes this policy, the updated policy will
be published at this URL and the version above will change before the
new behaviour ships.

## Contact

Questions: open an issue on the project repository:
https://github.com/VetTV-Studios/rumble-clipper/issues.

---

_Clipper for Rumble is an unofficial tool and is not affiliated with
Rumble Inc._
