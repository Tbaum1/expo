// Regenerates gameHtml.js from ../game/lucky-lair.html.
// Run after editing the game:  node sync-game.mjs
//
// Two embed-time transforms make the packaged WebView fully offline-capable:
//  1) Inline the raccoon/fox/splash mascots as base64 data URIs (relative
//     asset paths cannot resolve inside an HTML-string WebView).
//  2) Dedupe the 250-entry WORLD_BG into a 125-image pool + index list, and -
//     IF ./bg-data.js exists (produced by bundle-backgrounds.mjs) - swap each
//     pooled background URL for its bundled base64 data URI, so the worlds
//     render offline. Without bg-data.js the backgrounds keep their web URLs.
import fs from 'node:fs';

const BANNED = [String.fromCharCode(96), String.fromCharCode(92), '$' + '{'];
const checkBanned = (s, where) => {
  for (const bad of BANNED) {
    if (s.includes(bad)) { console.error('ABORT: ' + where + ' contains a char that breaks the embed.'); process.exit(1); }
  }
};

const htmlPath = new URL('../game/lucky-lair.html', import.meta.url);
let html = fs.readFileSync(htmlPath, 'utf8');
checkBanned(html, 'game HTML');

// 1) inline mascots
const assetDir = new URL('../game/assets/', import.meta.url);
function inlineImg(file, srcPath) {
  let p;
  try { p = fs.readFileSync(new URL(file, assetDir)); }
  catch (e) { console.warn('WARN: ' + file + ' not found - mascot falls back to hidden.'); return; }
  const uri = 'data:image/webp;base64,' + p.toString('base64');
  html = html.split('src="' + srcPath + '"').join('src="' + uri + '"');
}
inlineImg('raccoon.webp', 'assets/raccoon.png');
inlineImg('foe.webp', 'assets/foe.png');

// 2) dedupe + (optionally) inline backgrounds
async function bundleBackgrounds() {
  const m = html.match(/const WORLD_BG=\[([\s\S]*?)\];/);
  if (!m) { console.warn('WARN: WORLD_BG array not found - skipping background bundling.'); return; }
  const urls = (m[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
  if (urls.length === 0) return;
  const pool = [...new Set(urls)];
  const indexOf = new Map(pool.map((u, i) => [u, i]));

  let dataMap = null;
  const bgFile = new URL('./bg-data.mjs', import.meta.url);
  if (fs.existsSync(bgFile)) {
    const mod = await import(bgFile.href + '?t=' + Date.now());
    dataMap = mod.BG_DATA || null;
  }
  let bundled = 0;
  const poolLiterals = pool.map(u => {
    const v = (dataMap && dataMap[u]) ? (bundled++, dataMap[u]) : u;
    return "'" + v + "'";
  });
  const idxLiterals = urls.map(u => 'BG_POOL[' + indexOf.get(u) + ']').join(',');
  const replacement =
    'const BG_POOL=[' + poolLiterals.join(',') + '];' +
    'const WORLD_BG=[' + idxLiterals + '];';
  html = html.replace(m[0], replacement);
  console.log('  backgrounds: ' + pool.length + ' unique (' + (bundled ? bundled + ' bundled offline' : 'web URLs - run bundle-backgrounds.mjs for offline') + ')');
}

await bundleBackgrounds();
checkBanned(html, 'embed after inlining');

const TICK = String.fromCharCode(96);
const header =
  '// Auto-generated from game/lucky-lair.html - do not edit by hand.\n' +
  '// Run: node sync-game.mjs to regenerate after editing the game.\n' +
  'export const GAME_HTML = ';
fs.writeFileSync(new URL('./gameHtml.js', import.meta.url), header + TICK + html + TICK + ';\n');
console.log('gameHtml.js regenerated (' + html.length + ' chars).');
