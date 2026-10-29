import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SKIP_TUTORIAL } from './game';

// The offline copy (scripts/build-offline.mjs): one index.html opened from disk, no network.
// The repo root is the folder above Playwright's config (e2e/).
const root = () => join(dirname(test.info().config.configFile!), '..');
const file = () => join(root(), 'dist-offline', 'Last-Local', 'index.html');

test.describe('offline copy', () => {
  test.describe.configure({ mode: 'serial' });
  // These check the ride's controls; e2e/tutorial.spec.ts covers the first-ride practice stretch.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(SKIP_TUTORIAL);
  });

  test.beforeAll(() => {
    // CI builds it in its own step; build it here if it's missing (e.g. a local run).
    if (!existsSync(file())) execFileSync('node', [join(root(), 'scripts', 'build-offline.mjs')], { cwd: root(), stdio: 'inherit' });
  });

  test('is one self-contained file under 3 MB, zipped with its README', () => {
    expect(statSync(file()).size).toBeLessThan(3_000_000);
    expect(existsSync(join(root(), 'dist-offline', 'Last-Local', 'README.txt'))).toBe(true);
    expect(existsSync(join(root(), 'dist-offline', 'Last-Local-offline.zip'))).toBe(true);
  });

  test('opens from a double-click with no network, boards, rides and goes full screen', async ({ page, context }) => {
    const requests: string[] = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      requests.push(url);
      return route.abort();
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('file://' + file());
    await expect(page.locator('text=/Board the train/i')).toBeVisible();
    // The embedded fonts are used (no fallback to the system font).
    expect(await page.evaluate(() => document.fonts.check('16px Archivo'))).toBe(true);

    await page.locator('text=/Board the train/i').click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    // The ride starts: the HUD shows the next stop and the 3D view draws.
    await expect(page.getByTestId('hud-route-panel')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    const drawn = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return !!c && c.width > 0 && c.height > 0;
    });
    expect(drawn).toBe(true);

    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });

  // The offline copy is a production build (no test hooks), so these drive it the way a player does.
  test('the core UI and controls work offline: Settings (saved), Case Files, camera, log, route, mute, pause, restart', async ({ page, context }) => {
    const { requests, errors } = await offline(page, context);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('file://' + file());

    // Settings are saved where a file:// page can keep them, and survive a reload.
    // Headless Chromium sometimes drops a file:// page's localStorage writes across a reload (measured
    // Oct 23 on #82's and #83's builds alike, about 1 run in 3 under load; the page itself had the new
    // value every time, and a real browser keeps it). So the change-reload-check round is retried a
    // few times: a save that never survives still fails here, a lost write in the test browser doesn't.
    const fullscreenBox = page.getByRole('checkbox', { name: /Full screen when boarding/ });
    await expect(async () => {
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings' }).click();
      await fullscreenBox.uncheck();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gtrain-settings') || '{}').fullscreenOnBoard)).toBe(false);
      await page.reload();
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(fullscreenBox).not.toBeChecked({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }).toPass({ timeout: 90_000 });
    // The Case Files open and close with Esc.
    await page.getByRole('button', { name: /Case Files/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('text=/Board the train/i').click();
    await expect(page.getByTestId('hud-route-panel')).toBeVisible({ timeout: 20_000 });

    // Camera: raise, snap, lower.
    await page.keyboard.press('KeyC');
    await page.getByRole('button', { name: /SNAP PHOTO/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Lower Camera' }).click();
    await expect(page.getByRole('button', { name: /SNAP PHOTO/ })).toHaveCount(0);
    // Evidence log: Tab in, Tab out.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tablist', { name: 'Evidence' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tablist', { name: 'Evidence' })).toHaveCount(0);
    // Route selector: switch to the L.
    await page.keyboard.press('KeyL');
    await page.getByRole('dialog', { name: 'MTA Transit Line Switching' }).getByRole('button', { name: /^L 14th/ }).click();
    await expect(page.getByTestId('hud-route-panel')).toHaveAccessibleName(/^L train/);
    // Mute.
    await page.keyboard.press('KeyM');
    await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();
    await page.keyboard.press('KeyM');
    // Pause, Settings from the pause menu, resume; then restart from the pause menu.
    await page.keyboard.press('KeyP');
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Resume Ride' }).click();
    await expect(page.getByRole('button', { name: 'Resume Ride' })).toHaveCount(0);
    await page.keyboard.press('KeyP');
    await page.locator('text=/Restart Ride/i').click();
    await expect(page.getByTestId('hud-route-panel')).toHaveAccessibleName(/^G train/); // a new ride is on the G

    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
    test('touch controls work offline: board, the HUD buttons, the log, pause and resume', async ({ page, context }) => {
      const { requests, errors } = await offline(page, context);
      await page.goto('file://' + file());
      await page.evaluate(() => localStorage.setItem('gtrain-settings', JSON.stringify({ fullscreenOnBoard: false })));
      await page.reload();
      await page.locator('text=/Board the train/i').tap();
      await expect(page.getByTestId('hud-route-panel')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('WALK')).toBeVisible(); // the touch stick

      await page.getByRole('button', { name: 'Evidence Log' }).tap();
      await expect(page.getByRole('tablist', { name: 'Evidence' })).toBeVisible();
      await page.getByRole('button', { name: 'Close Album' }).tap();
      await expect(page.getByRole('tablist', { name: 'Evidence' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Polaroid Camera' }).tap();
      await page.getByRole('button', { name: /SNAP PHOTO/ }).tap();
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Lower Camera' }).tap();
      await page.getByRole('button', { name: 'Pause', exact: true }).tap();
      await page.getByRole('button', { name: 'Resume Ride' }).tap();
      await expect(page.getByRole('button', { name: 'Resume Ride' })).toHaveCount(0);

      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
});

/** Block everything but file:, data: and blob: URLs, and collect what was asked for and any errors. */
async function offline(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  const requests: string[] = [];
  const errors: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    requests.push(url);
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { requests, errors };
}

// itch.io serves the HTML5 zip from a subpath (html-classic.itch.zone/html/<id>/index.html), with
// models/characters/ beside index.html. Model URLs must resolve against the page, not the site root.
test('served over http from a subpath, the Blender models load from beside index.html', async ({ page }) => {
  const r = root();
  const index = join(r, 'dist-offline', 'Last-Local', 'index.html');
  if (!existsSync(index)) execFileSync('node', [join(r, 'scripts', 'build-offline.mjs')], { cwd: r, stdio: 'inherit' });
  const prefix = 'http://itch.test/html/123/';
  const hits: Array<{ url: string; status: number }> = [];
  const outside: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url().split('?')[0];
    if (!url.startsWith('http://itch.test/')) return route.continue();
    if (!url.startsWith(prefix)) { outside.push(url); return route.fulfill({ status: 404, body: '' }); }
    const rel = url.slice(prefix.length) || 'index.html';
    const path = rel === 'index.html' ? index : join(r, 'public', rel);
    const ok = (rel === 'index.html' || rel.startsWith('models/')) && existsSync(path);
    if (rel.startsWith('models/')) hits.push({ url: rel, status: ok ? 200 : 404 });
    if (!ok) return route.fulfill({ status: 404, body: '' });
    const type = rel.endsWith('.html') ? 'text/html' : rel.endsWith('.json') ? 'application/json' : 'model/gltf-binary';
    return route.fulfill({ body: readFileSync(path), contentType: type });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(SKIP_TUTORIAL);
  await page.addInitScript(() => localStorage.setItem('gtrain-settings', JSON.stringify({ fullscreenOnBoard: false })));
  await page.goto(prefix + 'index.html');
  await page.locator('text=/Board the train/i').click();
  await expect.poll(() => hits.filter((h) => h.url.endsWith('.glb') && h.status === 200).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(hits.find((h) => h.url === 'models/characters/manifest.json')?.status).toBe(200);
  expect(hits.filter((h) => h.status !== 200)).toEqual([]);
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
