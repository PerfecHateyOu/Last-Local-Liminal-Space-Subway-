#!/usr/bin/env node
/**
 * Builds the offline copy: one index.html that opens from a double-click, with no internet,
 * server or install.
 *
 *   bun run build:offline   (or: npm run build:offline)
 *
 * Output:
 *   dist-offline/Last-Local/index.html   the whole game (script, styles and fonts inlined)
 *   dist-offline/Last-Local/README.txt
 *   dist-offline/Last-Local-offline.zip  the folder above, zipped
 *
 * Browsers won't load module scripts from file:// as separate files, so everything is inlined.
 * The fonts come from offline/fonts.css (embedded once, so this build never needs the internet).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(import.meta.dirname, '..');
const out = join(root, 'dist-offline');
const folder = 'Last-Local';

// 1) Vite build in offline mode: one script, one stylesheet (see vite.config.ts).
execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'offline'], {
  cwd: root,
  stdio: 'inherit',
});

const assets = join(out, 'assets');
const files = readdirSync(assets);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile || files.filter((f) => f.endsWith('.js')).length !== 1) {
  throw new Error(`expected exactly one script and one stylesheet in dist-offline/assets, found: ${files.join(', ')}`);
}
const js = readFileSync(join(assets, jsFile), 'utf8');
const css = readFileSync(join(assets, cssFile), 'utf8');
const fonts = readFileSync(join(root, 'offline', 'fonts.css'), 'utf8');
let html = readFileSync(join(out, 'index.html'), 'utf8');

// 2) Inline everything. `</script` inside the code would end the tag early, so escape it.
const take = (re, what) => {
  if (!re.test(html)) throw new Error(`offline build: couldn't find ${what} in index.html`);
  html = html.replace(re, '');
};
take(/\s*<script type="module"[^>]*src="[^"]*\.js"[^>]*><\/script>/, 'the module script tag');
take(/\s*<link rel="stylesheet"[^>]*href="[^"]*assets\/[^"]*\.css"[^>]*>/, 'the stylesheet link');
// Online-only: Google Fonts (replaced by the embedded fonts) and the home-screen manifest and icons.
html = html
  .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
  .replace(/\s*<!-- Add to Home Screen[^>]*-->/g, '')
  .replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '');
if (/https?:\/\//.test(html.replace(/<meta[^>]*>/g, ''))) {
  throw new Error('offline build: index.html still references the internet');
}
const safeJs = js.replace(/<\/script/gi, () => '<\\/script');
// Replacer functions, not strings: minified code is full of `$'` and `$&`, which a replacement
// *string* would expand into copies of the page.
html = html
  .replace('</head>', () => `  <style>\n${fonts}</style>\n    <style>\n${css}</style>\n  </head>`)
  .replace('</body>', () => `  <script type="module">\n${safeJs}</script>\n  </body>`);

// 3) The folder players unzip.
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
} catch {
  /* not a git checkout */
}
const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
const readme = readFileSync(join(root, 'offline', 'README.txt'), 'utf8').replace('{{DATE}}', () => date).replace('{{COMMIT}}', () => commit);

rmSync(join(out, folder), { recursive: true, force: true });
mkdirSync(join(out, folder), { recursive: true });
writeFileSync(join(out, folder, 'index.html'), html);
writeFileSync(join(out, folder, 'README.txt'), readme);
rmSync(assets, { recursive: true, force: true });
rmSync(join(out, 'index.html'), { force: true });

// 4) Zip it (a minimal writer: two deflated files, no dependency needed).
writeFileSync(
  join(out, `${folder}-offline.zip`),
  zip([
    [`${folder}/index.html`, Buffer.from(html)],
    [`${folder}/README.txt`, Buffer.from(readme)],
  ])
);
console.log(`\nOffline copy: dist-offline/${folder}/ and dist-offline/${folder}-offline.zip (${(html.length / 1e6).toFixed(2)} MB)`);

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
