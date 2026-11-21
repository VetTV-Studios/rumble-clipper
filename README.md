# Clipper for Rumble — 30s Clips for Shorts & Reels

A Google Chrome extension (Manifest V3, ready for the Chrome Web Store)
that lets viewers make **30-second clips** from any Rumble video or live
stream, export them in **vertical 9:16** or **horizontal 16:9** (plus 1:1
and 4:5) **with audio**, **download** them, and post them to TikTok,
YouTube Shorts, Instagram/Facebook Reels, X, and more.

Everything happens **locally in the browser** — no accounts, no servers,
no uploads, no tracking. See [PRIVACY.md](PRIVACY.md).

> Unofficial tool. Not affiliated with Rumble Inc. Please respect
> creators' rights and Rumble's Terms of Service when clipping.

## Features

- **Clip last 30s** — an in-memory instant-replay buffer means the
  moment already happened? No problem. Works on VOD and live streams.
- **Record next 30s** — forward recording with on-page countdown.
- **Replay capture fallback** — on VOD, seeks back 30s, records, and
  restores your position automatically.
- **Tab-capture fallback** — if a player ever blocks direct capture,
  record the tab instead; the editor crops to the player.
- **Editor** — trim (15s / 30s / 60s / full presets + fine sliders),
  live framing preview, layouts (fill/crop, blurred-background fit,
  bars), crop focus + zoom, burned-in caption text and source credit.
- **Formats** — 9:16 vertical (1080×1920), 16:9 horizontal
  (1920×1080), 1:1, 4:5 — never upscaled beyond the source, audio always
  included, MP4 where Chrome supports it (WebM otherwise).
- **Share** — download, OS share sheet (where supported), one-click
  "Post to TikTok / Shorts / Reels / X / Rumble" buttons that open the
  platform's upload page with your caption pre-copied, plus link-share
  intents for the source video.
- **Library** — clips and exports stored locally (IndexedDB), with
  thumbnails and re-download anytime.
- **Shortcuts** — `Alt+C` clip last 30s · `Alt+Shift+R` record next 30s.

### About "posting to socials"

TikTok, Instagram, and YouTube do not allow browser extensions to
upload on a user's behalf without each platform's approved API app and
OAuth review. So the fastest honest flow is built in: **Download →
click "Post to …" → attach the file → paste the auto-copied caption →
post.** If you later get approved API access, direct posting can be
added behind those same buttons.

## Install for testing (unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder (`rumble-clipper`).
3. Open any video on <https://rumble.com> and press play — the
   **Clip last 30s / Record 30s** bar appears under the player.

No build step is needed; the folder *is* the extension.

## How to use

1. Watch something on Rumble. When a moment lands, click **Clip last
   30s** (or `Alt+C`). For upcoming moments, **Record 30s** instead.
2. The editor opens. Trim with the sliders, pick **9:16** or **16:9**,
   choose framing, add a caption if you like.
3. **Export clip** (renders in real time with audio — keep the tab
   visible), then **Download**.
4. Click **Post to TikTok / YouTube Shorts / …** — the caption is
   copied for you; attach the downloaded file and post.

## How it works

- `src/content.js` runs on rumble.com, finds the player, and captures
  the element's media stream (`captureStream` + `MediaRecorder`) in 5s
  ring-buffer segments. Nothing touches the network.
- Segments move to extension storage through a hidden extension-origin
  bridge iframe (`src/bridge/`) because content scripts can't access
  extension IndexedDB directly.
- The editor (`src/editor/`) plays segments back through a formatting
  canvas (`src/lib/exporter.js`) — the same drawing code powers the
  live preview and the final export, so what you see is what uploads.
- `src/background.js` handles shortcuts, menus, downloads, and the
  optional tabCapture fallback via `src/offscreen.js`.

## Project layout

```
manifest.json            MV3 manifest (store metadata lives here + STORE.md)
icons/                   16/32/48/128 PNGs (scripts/make_icons.py)
src/
  content.js/.css        Rumble page UI, replay buffer, recording
  background.js          Service worker (commands, menus, downloads)
  bridge/                Page → extension IndexedDB blob bridge
  editor/                Clip editor + library (trim/format/export/share)
  popup/                 Toolbar popup
  options/               Settings page
  offscreen.*            Tab-capture fallback recorder
  lib/                   util, clipdb (IndexedDB), exporter, share, settings
scripts/                 validate.js · package.ps1 · make_icons.py
test/                    logic.test.js (node) · harness.html (browser E2E)
```

## Development

```powershell
npm test          # 44 unit assertions over crop/format/trim/share logic
npm run validate  # 79 Chrome Web Store pre-flight checks
npm run package   # builds dist/rumble-clipper-v1.0.1.zip for upload
```

Browser end-to-end probe: load `test/harness.html` in Chrome (with the
folder served or via file://) — it records a synthetic video+audio
stream, probes it, exports 9:16 and 16:9, and verifies dimensions and
that exported audio actually decodes with signal.

## Manual QA checklist

- [ ] Load unpacked; options page opens once on install.
- [ ] On a Rumble VOD: play 40s+, click **Clip last 30s** → editor
      opens, preview plays with sound, 9:16 fit-blur looks right.
- [ ] Change format to 16:9 / 1:1 / 4:5; try Fill + focus + zoom.
- [ ] Trim to ~10s, export → progress completes → Download → file
      plays in VLC/Chrome with audio, correct orientation.
- [ ] Export 30s vertical → upload test file to TikTok/Shorts/Reels
      drafts; confirm accepted as vertical video.
- [ ] On a live stream: Clip last 30s and Record next 30s both work.
- [ ] `Alt+C` / `Alt+Shift+R` and right-click menu items work.
- [ ] Popup shows buffer status + recent clips; Settings persist.
- [ ] Delete a clip from the library; storage figure updates.

## Publishing to the Chrome Web Store

1. `npm run package` → `dist/rumble-clipper-v1.0.1.zip`.
2. Privacy policy (already hosted):
   https://www.vettvstudios.com/rumble-clipper/privacy
   (mirror: https://vettv-studios.github.io/rumble-clipper/privacy ).
3. Follow [STORE.md](STORE.md) — it has copy-paste listing text,
   permission justifications, the data-use questionnaire answers, and
   reviewer test instructions.

## Known limitations

- Export renders in **real time** (a 30s clip takes ~30s) — this is a
  browser `MediaRecorder` constraint; there's no silent ffmpeg in MV3.
- Very old Chrome (<126) exports **WebM** only; TikTok/YouTube accept
  it, Instagram may want MP4 (convert, or use current Chrome).
- If Rumble changes its player so media is no longer origin-clean,
  direct capture may fail on some videos — use the popup's
  **Record tab** fallback.
- Buffer segments join with tiny (<0.2s) seams in rare cases; trimming
  a hair inside a seam avoids any audible tick.

## Licence / credits

Your project — add a licence of your choice before publishing.
Name and branding must stay clearly unofficial (no "Rumble" logos) to
pass Web Store review; the current name/copy already follow that rule.
