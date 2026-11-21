/* Pre-flight checks before uploading to the Chrome Web Store.
   Run: npm run validate */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let failures = 0, checks = 0;
function check(cond, msg) {
  checks++;
  if (cond) console.log('  ✔ ' + msg);
  else { failures++; console.log('  ✘ ' + msg); }
}
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

console.log('Validating manifest…');
let m;
try { m = JSON.parse(read('manifest.json')); check(true, 'manifest.json is valid JSON'); }
catch (e) { check(false, 'manifest.json parses (' + e.message + ')'); process.exit(1); }

check(m.manifest_version === 3, 'Manifest V3');

// Locales: declaring default_locale without _locales/<locale>/messages.json
// makes Chrome refuse to load the extension at all — guard it here.
let messages = {};
if (m.default_locale) {
  const msgPath = '_locales/' + m.default_locale + '/messages.json';
  check(exists(msgPath), 'default_locale "' + m.default_locale + '" has ' + msgPath);
  if (exists(msgPath)) {
    try { messages = JSON.parse(read(msgPath)); check(true, msgPath + ' is valid JSON'); }
    catch (e) { check(false, msgPath + ' parses (' + e.message + ')'); }
  }
}
function resolveMsg(v) {
  const hit = /^__MSG_([A-Za-z0-9_]+)__$/.exec(v || '');
  return hit && messages[hit[1]] ? messages[hit[1]].message : v;
}
const usedKeys = [...new Set((JSON.stringify(m).match(/__MSG_([A-Za-z0-9_]+)__/g) || [])
  .map(s => s.slice(6, -2)))];
usedKeys.forEach(k => check(!!(messages[k] && messages[k].message),
  'manifest __MSG_' + k + '__ exists in messages.json'));
if (usedKeys.length) check(!!m.default_locale, '__MSG__ keys require default_locale');

const resolvedName = resolveMsg(m.name), resolvedDesc = resolveMsg(m.description);
check(!!resolvedName && !/^__MSG_/.test(resolvedName) && resolvedName.length <= 75, 'name set (≤75 chars): ' + resolvedName);
check(!!resolvedDesc && !/^__MSG_/.test(resolvedDesc) && resolvedDesc.length <= 132, 'description ≤132 chars (' + (resolvedDesc || '').length + ')');
check(!!m.version, 'version: ' + m.version);

// Every file referenced by the manifest must exist.
const refs = new Set();
Object.values(m.icons || {}).forEach(p => refs.add(p));
if (m.action) { refs.add(m.action.default_popup); Object.values(m.action.default_icon || {}).forEach(p => refs.add(p)); }
if (m.background) refs.add(m.background.service_worker);
if (m.options_page) refs.add(m.options_page);
(m.content_scripts || []).forEach(cs => { (cs.js || []).concat(cs.css || []).forEach(p => refs.add(p)); });
refs.forEach(p => check(exists(p), 'exists: ' + p));
// web_accessible_resources (allow simple globs)
(m.web_accessible_resources || []).forEach(w => (w.resources || []).forEach(r => {
  if (r.includes('*')) {
    const dir = path.join(ROOT, path.dirname(r));
    check(fs.existsSync(dir) && fs.readdirSync(dir).length > 0, 'glob has files: ' + r);
  } else check(exists(r), 'exists: ' + r);
}));

// HTML script/link references resolve.
console.log('Checking page asset references…');
function htmlRefs(htmlRel) {
  const html = read(htmlRel), dir = path.dirname(htmlRel);
  const out = [];
  for (const m2 of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(https?:|data:|chrome)/.test(m2[1])) continue;
    out.push(path.posix.normalize(path.posix.join(dir.replace(/\\/g, '/'), m2[1])));
  }
  return out;
}
['src/editor/editor.html', 'src/popup/popup.html', 'src/options/options.html',
 'src/bridge/bridge.html', 'src/offscreen.html'].forEach(h => {
  check(exists(h), 'exists: ' + h);
  if (exists(h)) htmlRefs(h).forEach(r => check(exists(r), h + ' -> ' + r));
});

// Icons are real PNGs of the right size.
console.log('Checking icons…');
[16, 32, 48, 128].forEach(s => {
  const p = 'icons/icon' + s + '.png';
  if (!exists(p)) return check(false, 'icon exists: ' + p);
  const buf = fs.readFileSync(path.join(ROOT, p));
  const isPng = buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const w = buf.readUInt32BE(16), hgt = buf.readUInt32BE(20);
  check(isPng && w === s && hgt === s, p + ' is a ' + s + 'x' + s + ' PNG');
});

// Web Store policy tripwires: no remote code, no eval, minimal surprises.
console.log('Checking store-policy tripwires…');
function walk(dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|html)$/.test(e.name)) acc.push(p);
  });
  return acc;
}
const srcFiles = walk(path.join(ROOT, 'src'), []);
let remoteSrc = [], evalUse = [], innerRemote = [];
srcFiles.forEach(f => {
  const t = fs.readFileSync(f, 'utf8'), rel = path.relative(ROOT, f);
  if (/<script[^>]+src=["']https?:/i.test(t)) remoteSrc.push(rel);
  if (/[^.\w]eval\s*\(|new\s+Function\s*\(/.test(t)) evalUse.push(rel);
  if (/fetch\s*\(\s*["']https?:|XMLHttpRequest/.test(t)) innerRemote.push(rel);
});
check(remoteSrc.length === 0, 'no remotely-hosted <script> tags' + (remoteSrc.length ? ' in ' + remoteSrc : ''));
check(evalUse.length === 0, 'no eval()/new Function()' + (evalUse.length ? ' in ' + evalUse : ''));
check(innerRemote.length === 0, 'no fetch/XHR to the network (fully local)' + (innerRemote.length ? ' in ' + innerRemote : ''));

// Host permissions scoped to Rumble only.
const hosts = m.host_permissions || [];
check(hosts.length > 0 && hosts.every(hp => hp.includes('rumble.com')), 'host permissions limited to rumble.com: ' + hosts.join(', '));
check(!(m.permissions || []).includes('<all_urls>'), 'no <all_urls> permission');
check((m.optional_permissions || []).includes('tabCapture'), 'tabCapture is optional (requested on demand)');

// Regression guard (silent exports, Nov 2026): captureStream() on an empty
// <video> yields no audio tracks, so exports shipped with no audio at all.
// The exporter must load media before acquiring capture audio.
console.log('Checking export audio ordering…');
const exporterSrc = read('src/lib/exporter.js');
const exportBody = exporterSrc.slice(exporterSrc.indexOf('function exportClip'));
const firstLoad = exportBody.indexOf('loadSegment(');
const acquireAt = exportBody.indexOf('acquireAudioTracks(');
const directCaptureAt = exportBody.indexOf('.captureStream(');
check(firstLoad !== -1 && acquireAt > firstLoad,
  'exportClip loads a segment before acquiring capture audio');
check(directCaptureAt === -1 || directCaptureAt > firstLoad,
  'exportClip never calls captureStream() before media is loaded');

// JS syntax.
console.log('Syntax-checking JavaScript…');
const { execFileSync } = require('child_process');
walk(path.join(ROOT, 'src'), []).filter(f => f.endsWith('.js')).forEach(f => {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); check(true, 'node --check ' + path.relative(ROOT, f)); }
  catch (e) { check(false, 'node --check ' + path.relative(ROOT, f) + ' — ' + (e.stderr || e.stdout || e.message).toString().split('\n')[0]); }
});

console.log(`\n${checks - failures}/${checks} checks passed` + (failures ? ` — ${failures} FAILED` : ' ✔'));
process.exit(failures ? 1 : 0);
