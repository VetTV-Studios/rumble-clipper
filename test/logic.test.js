/* Unit tests for the extension's pure logic (no browser needed).
   Run: npm test   (or: node test/logic.test.js) */
'use strict';
const assert = require('assert');
const U = require('../src/lib/util.js');
const M = require('../src/lib/exporter.js');
const SH = require('../src/lib/share.js');

let passed = 0;
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); passed++; }
function ok(cond, label) { assert.ok(cond, label); passed++; }
function near(a, b, eps, label) { assert.ok(Math.abs(a - b) <= eps, `${label}: ${a} !~= ${b}`); passed++; }

/* ---- util ---- */
eq(U.formatTime(0), '0:00', 'formatTime 0');
eq(U.formatTime(30), '0:30', 'formatTime 30');
eq(U.formatTime(75), '1:15', 'formatTime 75');
eq(U.formatTime(3725), '1:02:05', 'formatTime hours');
eq(U.formatTimeFine(30), '0:30.0', 'formatTimeFine');
eq(U.slugify('My Crazy Video!! Part 2'), 'my-crazy-video-part-2', 'slugify');
eq(U.clipFilename({ title: 'Epic Moment', durationSec: 30, formatLabel: '9x16', ext: 'mp4' }),
  'rumble-clip-epic-moment-30s-9x16.mp4', 'clipFilename vertical mp4');
eq(U.clipFilename({ title: 'Epic Moment', durationSec: 30, formatLabel: '16x9', ext: 'webm' }),
  'rumble-clip-epic-moment-30s-16x9.webm', 'clipFilename horizontal webm');
ok(!/[\\/:*?"<>|]/.test(U.clipFilename({ title: 'a/b:c', durationSec: 5, formatLabel: '1x1' })), 'filename sanitised');
eq(U.extForMime('video/mp4;codecs=avc1'), 'mp4', 'ext mp4');
eq(U.extForMime('video/webm;codecs=vp9,opus'), 'webm', 'ext webm');

/* ---- output sizes: vertical + horizontal ---- */
let v = M.outputSize(1920, 1080, '9x16');
near(v.w / v.h, 9 / 16, 0.01, 'vertical aspect');
ok(v.h <= 1920 && v.w <= 1080, 'vertical not upscaled absurdly');
ok(v.w % 2 === 0 && v.h % 2 === 0, 'even dimensions');
let h = M.outputSize(1920, 1080, '16x9');
eq(h, { w: 1920, h: 1080 }, 'horizontal matches 1080p source');
let low = M.outputSize(640, 360, '16x9');
ok(low.w <= 640, 'does not upscale beyond source');
let sq = M.outputSize(1280, 720, '1x1');
eq(sq.w, sq.h, 'square is square');

/* ---- fill crop: 16:9 source into 9:16 frame crops the sides ---- */
let fill = M.computeDrawRects(1920, 1080, 1080, 1920, 'fill', 0.5, 0.5, 1).main;
near(fill.sw, 1080 * (9 / 16), 0.5, 'fill crop width from height');
near(fill.sh, 1080, 0.5, 'fill keeps full height');
near(fill.sx, (1920 - fill.sw) / 2, 0.5, 'fill centred');
eq([fill.dw, fill.dh], [1080, 1920], 'fill covers destination');
// focus shifts the crop window
let left = M.computeDrawRects(1920, 1080, 1080, 1920, 'fill', 0, 0.5, 1).main;
let right = M.computeDrawRects(1920, 1080, 1080, 1920, 'fill', 1, 0.5, 1).main;
near(left.sx, 0, 0.5, 'focus left');
near(right.sx + right.sw, 1920, 0.5, 'focus right');
// zoom shrinks the sampled window (magnifies)
let zoomed = M.computeDrawRects(1920, 1080, 1080, 1920, 'fill', 0.5, 0.5, 2).main;
near(zoomed.sw, fill.sw / 2, 0.5, 'zoom 2x halves sample width');

/* ---- fit layouts keep the whole frame visible ---- */
let fit = M.computeDrawRects(1920, 1080, 1080, 1920, 'fit-bars', 0.5, 0.5, 1).main;
eq([fit.sw, fit.sh], [1920, 1080], 'fit samples whole source');
near(fit.dw, 1080, 0.5, 'fit width = canvas width');
near(fit.dh, 1080 * (1080 / 1920), 0.5, 'fit height letterboxed');
near(fit.dy, (1920 - fit.dh) / 2, 0.5, 'fit vertically centred');
let blur = M.computeDrawRects(1920, 1080, 1080, 1920, 'fit-blur', 0.5, 0.5, 1);
ok(blur.bg && blur.bg.dw === 1080 && blur.bg.dh === 1920, 'fit-blur has full-frame backdrop');
// horizontal target from vertical source (phone footage -> 16:9)
let v2h = M.computeDrawRects(1080, 1920, 1920, 1080, 'fill', 0.5, 0.5, 1).main;
near(v2h.sw, 1080, 0.5, 'vertical->horizontal fill keeps width');
near(v2h.sh, 1080 / (16 / 9), 0.5, 'vertical->horizontal fill crops height');

/* ---- segment timeline mapping (30s out of 5s segments) ---- */
const durs = [5, 5, 5, 5, 5, 5];
eq(M.totalDuration(durs), 30, 'six 5s segments = 30s');
eq(M.locateTime(durs, 0).index, 0, 't=0 -> segment 0');
eq(M.locateTime(durs, 12), { index: 2, offset: 2, total: 30 }, 't=12 -> seg 2 +2s');
eq(M.locateTime(durs, 29.9).index, 5, 't near end -> last segment');
ok(M.locateTime(durs, 999).offset < 5, 't clamps inside last segment');

/* ---- share helpers ---- */
const cap = SH.buildCaption({ title: 'Wild ending', channel: 'ExampleChan', pageUrl: 'https://rumble.com/v123', hashtags: ['Rumble', 'clips'] });
ok(cap.includes('Wild ending') && cap.includes('#Rumble') && cap.includes('rumble.com/v123'), 'caption has title, tags, link');
const pages = SH.UPLOAD_PAGES.map(p => p.id);
['tiktok', 'youtube', 'instagram', 'facebook', 'x'].forEach(id => ok(pages.includes(id), 'upload page: ' + id));
const links = SH.linkShareUrls('https://rumble.com/v123', 'Hi there');
ok(links.every(l => /^https:|^mailto:/.test(l.url)), 'link-share urls valid');
ok(links.find(l => l.id === 'x').url.includes(encodeURIComponent('https://rumble.com/v123')), 'x intent carries url');

console.log(`All ${passed} assertions passed ✔`);
