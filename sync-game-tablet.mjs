// Regenerates gameHtmlTablet.js from ../game/loot-hollow-tablet.html, which is
// itself derived from ../game/loot-hollow.html by ../game/build-tablet-html.mjs.
// Run after editing the phone game AND regenerating the tablet HTML:
//   node ../game/build-tablet-html.mjs   (loot-hollow.html -> loot-hollow-tablet.html)
//   node sync-game-tablet.mjs            (loot-hollow-tablet.html -> gameHtmlTablet.js)
//
// This mirrors sync-game.mjs's embed transforms exactly (mascots, wheel icons,
// backgrounds, village pieces) so the tablet bundle is just as offline-capable
// as the phone one. Keep the two scripts' transform steps in sync.
import fs from 'node:fs';

const BANNED = [String.fromCharCode(96), String.fromCharCode(92), '$' + '{'];
const checkBanned = (s, where) => {
  for (const bad of BANNED) {
    if (s.includes(bad)) { console.error('ABORT: ' + where + ' contains a char that breaks the embed.'); process.exit(1); }
  }
};

const htmlPath = new URL('../game/loot-hollow-tablet.html', import.meta.url);
let html = fs.readFileSync(htmlPath, 'utf8');
checkBanned(html, 'tablet game HTML');

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

function inlineToken(file, token){
  let p; try { p = fs.readFileSync(new URL(file, assetDir)); }
  catch (e) { console.warn('WARN: ' + file + ' not found - wheel icon falls back to emoji.'); return; }
  const uri = 'data:image/webp;base64,' + p.toString('base64');
  html = html.split(token).join(uri);
}
inlineToken('reels/coin.webp', '__IMG_coin__');
inlineToken('reels/gem.webp', '__IMG_gem__');
inlineToken('reels/shield.webp', '__IMG_shield__');
inlineToken('reels/star.webp', '__IMG_star__');

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

// 3) inline the 25 village-piece images as data URIs
async function bundlePieces() {
  const marker = 'var PIECE_DATA={};/*__PIECE_DATA__*/';
  if (!html.includes(marker)) { console.warn('WARN: PIECE_DATA marker not found - skipping piece bundling.'); return; }
  const pf = new URL('./pieces-data.mjs', import.meta.url);
  if (!fs.existsSync(pf)) { console.warn('WARN: pieces-data.mjs not found - village art falls back to emoji.'); return; }
  const mod = await import(pf.href + '?t=' + Date.now());
  const data = mod.PIECE_DATA || {};
  const keys = Object.keys(data);
  const lit = keys.map(k => "'" + k + "':'" + data[k] + "'").join(',');
  html = html.split(marker).join('var PIECE_DATA={' + lit + '};');
  console.log('  pieces: ' + keys.length + ' inlined offline');
}
await bundlePieces();
checkBanned(html, 'tablet embed after inlining');

const TICK = String.fromCharCode(96);
const header =
  '// Auto-generated from game/loot-hollow-tablet.html - do not edit by hand.\n' +
  '// Run: node ../game/build-tablet-html.mjs then node sync-game-tablet.mjs to regenerate.\n' +
  'export const GAME_HTML_TABLET = ';
fs.writeFileSync(new URL('./gameHtmlTablet.js', import.meta.url), header + TICK + html + TICK + ';\n');
console.log('gameHtmlTablet.js regenerated (' + html.length + ' chars).');
