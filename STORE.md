# Chrome Web Store submission kit — Clipper for Rumble

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Upload `dist/rumble-clipper-v1.0.1.zip` (from `npm run package`), then
fill the listing from this file.

## Listing

- **Name (from manifest):** Clipper for Rumble — 30s Clips for Shorts & Reels
- **Summary (from manifest, ≤132 chars):** Make 30s clips from Rumble
  videos & live streams. Export vertical 9:16 or horizontal 16:9 with
  audio, download & post anywhere.
- **Category:** Entertainment (secondary fit: Social & Communication)
- **Language:** English

### Detailed description

```
Turn any Rumble moment into a ready-to-post clip — in about 30 seconds.

✂ CLIP THE LAST 30 SECONDS
Something great just happened? Click "Clip last 30s" (or press Alt+C).
A rolling instant-replay buffer means the moment is already captured —
on regular videos and live streams alike. Prefer to aim ahead? Record
the next 30 seconds with a tap.

📐 VERTICAL OR HORIZONTAL — WITH AUDIO
• 9:16 vertical (1080×1920) for TikTok, YouTube Shorts & Reels
• 16:9 horizontal (1920×1080) for YouTube & X
• 1:1 and 4:5 for feeds
Framing your way: fill/crop with focus + zoom controls, blurred-
background fit, or classic bars. Add a caption and an automatic credit
line for the creator.

⬇ DOWNLOAD & POST IN SECONDS
Export locally as MP4 (where supported) or WebM — audio always
included. Download, then use the one-click "Post to…" buttons
(TikTok, YouTube Shorts, Instagram/Facebook Reels, X, Rumble): the
upload page opens with your caption already copied. Attach, paste, post.

🔒 PRIVATE BY DESIGN
No account. No servers. No tracking. Capturing, editing, rendering and
storage all happen on your device. The extension makes zero network
requests and only runs on rumble.com.

ALSO INCLUDED
• Trim presets (15s / 30s / 60s / full) + fine sliders
• Local clip library with thumbnails and re-download
• Keyboard shortcuts & right-click menu
• Tab-capture fallback if a player ever blocks direct capture

Unofficial tool — not affiliated with Rumble Inc. Please respect
creators' rights and Rumble's Terms of Service when sharing clips.
```

### Screenshots to capture (1280×800 or 640×400, up to 5)

1. Rumble video playing with the "Clip last 30s / Record 30s" bar.
2. Editor in 9:16 vertical with blurred background + caption.
3. Editor in 16:9 horizontal with trim sliders.
4. "Your clip is ready" panel with Download + Post to… buttons.
5. Popup showing buffer status and recent clips.

Promotional tile: reuse `icons/icon128.png` art on the dark-green
background (#0c100c) at 440×280.

## Privacy practices tab

- **Privacy policy URL:** https://www.vettvstudios.com/rumble-clipper/privacy
  (GitHub Pages mirror: https://vettv-studios.github.io/rumble-clipper/privacy ).
  _Required — the extension handles media._
- **Single purpose:** "Create short clips from Rumble videos the user
  is watching and export them locally for sharing."
- **Data usage:** the extension does **not** collect or transmit any
  user data. Check every "does not collect" affirmation; disclose no
  data types. (Clips/settings stay in local browser storage.)

### Permission justifications (paste into each field)

| Permission | Justification |
|---|---|
| `storage` | Save the user's clips library and settings locally on their device. |
| `downloads` | Save the exported clip file when the user clicks Download. |
| `contextMenus` | Right-click "Clip last 30 seconds" / "Record next 30 seconds" on Rumble pages. |
| `activeTab` | Let the popup talk to the clipper already running in the active Rumble tab when the user clicks a clip action. |
| `offscreen` | Hosts the fallback recorder used only when the player blocks direct media capture, so the user can still save their clip. |
| `tabCapture` *(optional, requested at runtime)* | Records the active tab's video+audio as a fallback clip source; requested only when the user clicks "Record tab" in the popup. |
| Host: `*://rumble.com/*`, `*://*.rumble.com/*` | The extension's single purpose is clipping Rumble videos; it runs nowhere else. |

- **Remote code:** None. All JavaScript ships in the package; there
  are no external scripts, no `eval`, and no network calls
  (`npm run validate` asserts this).

## Reviewer test instructions

```
No account or login is needed.
1. Install the extension. Open any public video on rumble.com and play
   it for ~40 seconds.
2. Click "Clip last 30s" under the player (or press Alt+C). The editor
   tab opens with the captured clip.
3. In the editor, pick 9:16 or 16:9, click Export (renders in real
   time; ~30s for a full clip — trim to ~5s for a faster test), then
   Download. The file plays with audio.
4. Optional fallback: if a video blocks direct capture, the popup
   offers "Record tab", which requests the optional tabCapture
   permission at that moment.
All processing is local; the extension makes no network requests.
```

## Branding / trademark notes (to pass review)

- Name is "Clipper **for** Rumble" (descriptive, not "Rumble Clipper"
  as a brand claim) and the listing + UI state it is unofficial.
- No Rumble logos or trade dress are used; the icon is original art.
- Don't use screenshots implying endorsement.

## Pre-submit checklist

- [ ] `npm test` (44 assertions) and `npm run validate` (79 checks) pass.
- [ ] Fresh `npm run package` zip; version bumped in `manifest.json`
      if this is an update.
- [ ] Privacy policy hosted and URL pasted in the dashboard.
- [ ] 128px icon in zip (present), screenshots uploaded, promo tile.
- [ ] Support email / website filled in on the account & listing.
- [ ] Manually tested: VOD clip, live clip, vertical + horizontal
      export with audio, download, each "Post to…" button.
- One-time developer registration fee ($5) paid on the account.
