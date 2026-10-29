#!/usr/bin/env node
/**
 * `bun run export:glb`: writes every procedural model to exports/*.glb (gitignored), no clicks,
 * then a preview PNG per file (exports/previews/) and a contact sheet (exports/LAST_LOCAL-contact-sheet.png).
 *
 * `bun run export:glb -- --previews <dir>` skips the export and only renders previews and the
 * contact sheet for the .glb files already in <dir> (e.g. a set someone edited in Blender).
 *
 * Starts the Vite dev server, opens dev/export.html in headless Chromium (the Playwright install
 * from e2e/), runs the exporter, reloads each file with GLTFLoader as a check, and saves it.
 * Needs `cd e2e && bun install && bunx playwright install chromium` once.
 */
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pi = process.argv.indexOf('--previews');
const charsOnly = process.argv.includes('--characters');
const previewsOnly = pi > 0 ? path.resolve(process.argv[pi + 1]) : null;
const outDir = charsOnly
  ? path.join(root, 'public', 'models', 'characters')
  : previewsOnly ?? path.join(root, 'exports');
const require = createRequire(path.join(root, 'e2e', 'package.json'));
const { chromium } = require('@playwright/test');

const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}dev/export.html`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__exportReady, null, { timeout: 120_000 });
  mkdirSync(outDir, { recursive: true });
  if (!previewsOnly) {
    const files = await page.evaluate((cOnly) => (cOnly ? window.__exportCharacterGLBs() : window.__exportGLB()), charsOnly);
    for (const f of files) {
      const buf = Buffer.from(f.b64, 'base64');
      writeFileSync(path.join(outDir, f.name), buf);
      const v = await page.evaluate((b) => window.__verifyGLB(b), f.b64);
      const note = f.notes.length ? `  (${f.notes.join('; ')})` : '';
      console.log(`${f.name.padEnd(48)} ${(buf.length / 1024).toFixed(1).padStart(8)} KB  ${v.meshes} meshes, ${v.triangles} tris, ${v.materials} materials, ${v.textures} textures${note}`);
      if (!v.meshes) failed = true;
    }
    console.log(`\n${files.length} files written to ${outDir}`);
  }
  if (!charsOnly) {
  // Previews and contact sheet for every .glb in outDir.
  const prevDir = path.join(outDir, 'previews');
  mkdirSync(prevDir, { recursive: true });
  const urls = [];
  for (const f of readdirSync(outDir).filter((n) => n.endsWith('.glb')).sort()) {
    const b64 = readFileSync(path.join(outDir, f)).toString('base64');
    const d = await page.evaluate(([b, n]) => window.__previewGLB(b, n), [b64, f]);
    writeFileSync(path.join(prevDir, f.replace(/\.glb$/, '.png')), png(d));
    urls.push(d);
  }
    const sheet = await page.evaluate((u) => window.__contactSheet(u), urls);
    writeFileSync(path.join(outDir, 'LAST_LOCAL-contact-sheet.png'), png(sheet));
    console.log(`${urls.length} previews in ${prevDir}, contact sheet LAST_LOCAL-contact-sheet.png`);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
