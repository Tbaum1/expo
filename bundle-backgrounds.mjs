// bundle-backgrounds.mjs - ONE-TIME prep to make the 250 worlds playable OFFLINE.
// Run once on your PC (needs internet):  node bundle-backgrounds.mjs
// Then:  node sync-game.mjs   (picks up the bundled art)  ->  build.
//
// Downloads the unique world backgrounds referenced by the game, compresses them
// to small WebP (if `sharp` is installed), and writes ./bg-data.mjs which maps each
// background URL to a base64 data URI. sync-game.mjs inlines those so the app no
// longer needs the network to show world art.
import fs from 'node:fs';

const TARGET_WIDTH = 360;   // backgrounds sit behind the UI; 360px keeps the app small
const WEBP_QUALITY = 58;

let sharp = null;
try { sharp = (await import('sharp')).default; }
catch (e) { console.warn('NOTE: `sharp` not installed - bundling images at full size (bigger app).\n      For a smaller app run:  npm install --save-dev sharp   then re-run this.'); }

const html = fs.readFileSync(new URL('../game/lucky-lair.html', import.meta.url), 'utf8');
const m = html.match(/const WORLD_BG=\[([\s\S]*?)\];/);
if (!m) { console.error('Could not find WORLD_BG in the game. Aborting.'); process.exit(1); }
const urls = [...new Set((m[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)))]
  .filter(u => u.startsWith('http'));
console.log('Found ' + urls.length + ' unique background images to bundle.');

async function getOne(url, i) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let buf = Buffer.from(await res.arrayBuffer());
      if (sharp) {
        buf = await sharp(buf).resize({ width: TARGET_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY }).toBuffer();
      }
      return 'data:image/webp;base64,' + buf.toString('base64');
    } catch (e) {
      if (attempt === 3) { console.error('  FAILED ' + (i + 1) + ': ' + url + ' (' + e.message + ')'); return null; }
      await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
}

const out = {};
let done = 0, bytes = 0;
for (let i = 0; i < urls.length; i++) {
  const uri = await getOne(urls[i], i);
  if (uri) { out[urls[i]] = uri; bytes += uri.length; done++; }
  if ((i + 1) % 10 === 0 || i === urls.length - 1)
    console.log('  ' + (i + 1) + '/' + urls.length + ' (' + (bytes / 1048576).toFixed(1) + ' MB so far)');
}

if (done === 0) { console.error('No images downloaded - check your internet. Aborting.'); process.exit(1); }
const TICK = String.fromCharCode(96);
let body = 'export const BG_DATA = {\n';
for (const u of Object.keys(out)) body += '  ' + JSON.stringify(u) + ': ' + JSON.stringify(out[u]) + ',\n';
body += '};\n';
fs.writeFileSync(new URL('./bg-data.mjs', import.meta.url), body);
console.log('\nWrote bg-data.mjs: ' + done + '/' + urls.length + ' backgrounds, ' + (bytes / 1048576).toFixed(1) + ' MB total.');
console.log('Next:  node sync-game.mjs   then build.');
