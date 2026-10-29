import type { Page } from '@playwright/test';
import { test, expect } from './game';

// Mouse capture (src/input/pointerLock.ts): raw mouse input with a plain fallback, a hint when a
// lock request fails, one shared lock state, and the optional smooth walking.
// Headless browsers can't lock the pointer, so requestPointerLock is stubbed.

/** Stub pointer lock. `mode` decides what a request with { unadjustedMovement } does. */
const stubLock = (page: Page, mode: 'ok' | 'reject-raw' | 'undefined' | 'reject-all') =>
  page.evaluate((mode) => {
    const w = window as any;
    w.__lockCalls = [];
    let locked: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    document.exitPointerLock = () => {
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    Element.prototype.requestPointerLock = function (this: Element, opts?: any) {
      const raw = !!opts?.unadjustedMovement;
      w.__lockCalls.push(raw ? 'raw' : 'plain');
      const grant = () => {
        locked = this;
        document.dispatchEvent(new Event('pointerlockchange'));
      };
      if (mode === 'undefined') {
        grant();
        return undefined;
      }
      if (mode === 'reject-all' || (mode === 'reject-raw' && raw)) {
        document.dispatchEvent(new Event('pointerlockerror'));
        return Promise.reject(new DOMException('nope', 'NotSupportedError'));
      }
      grant();
      return Promise.resolve();
    } as never;
  }, mode);

const lockNow = (page: Page) =>
  page.evaluate(async () => {
    (window as any).__PL.lock(document.querySelector('canvas'));
    await new Promise((r) => setTimeout(r, 50));
    return { calls: (window as any).__lockCalls, locked: (window as any).__PL.isLocked };
  });

test.describe('pointer lock', () => {
  test('asks for raw mouse input first', async ({ page, game }) => {
    await game(`ride(0);`);
    await stubLock(page, 'ok');
    expect(await lockNow(page)).toEqual({ calls: ['raw'], locked: true });
  });

  test('falls back to a plain lock when raw input is rejected', async ({ page, game }) => {
    await game(`ride(0);`);
    await stubLock(page, 'reject-raw');
    expect(await lockNow(page)).toEqual({ calls: ['raw', 'plain'], locked: true });
    // The lock went through, so no hint.
    await expect(page.getByTestId('lock-hint')).toHaveCount(0);
  });

  test('older browsers that return nothing still lock (one call)', async ({ page, game }) => {
    await game(`ride(0);`);
    await stubLock(page, 'undefined');
    expect(await lockNow(page)).toEqual({ calls: ['raw'], locked: true });
  });

  test('with "Raw mouse input" off, only a plain lock is asked for', async ({ page, game }) => {
    await game(`ride(0); window.__S.set({ rawMouse: false });`);
    await stubLock(page, 'ok');
    expect(await lockNow(page)).toEqual({ calls: ['plain'], locked: true });
  });

  test('a failed lock shows "Click to look around"; a later lock hides it', async ({ page, game }) => {
    await game(`ride(0);`);
    await stubLock(page, 'reject-all');
    const r = await lockNow(page);
    expect(r.locked).toBe(false);
    await expect(page.getByTestId('lock-hint')).toHaveText('Click to look around');
    expect(await game(`return G.paused;`)).toBe(false);
    await stubLock(page, 'ok');
    await lockNow(page);
    await expect(page.getByTestId('lock-hint')).toHaveCount(0);
  });

  test('the shared state: a quiet unlock does not pause, a browser unlock does', async ({ page, game }) => {
    await game(`ride(0);`);
    await stubLock(page, 'ok');
    await lockNow(page);
    const seen = await page.evaluate(() => {
      const PL = (window as any).__PL;
      const log: string[] = [];
      const off = PL.subscribe((c: any) => log.push(`${c.locked}/${c.quiet}`));
      PL.unlock({ quiet: true });
      off();
      return { log, locked: PL.isLocked };
    });
    expect(seen).toEqual({ log: ['false/true'], locked: false });
    expect(await game(`return G.paused;`)).toBe(false);
    await lockNow(page);
    await page.evaluate(() => document.exitPointerLock());
    expect(await game(`return G.paused;`)).toBe(true);
  });
});

test.describe('smooth walking', () => {
  // Walk forward for `s` seconds of game time in 0.05 s steps; returns speed samples (m/s).
  const walk = (game: any, smooth: boolean) =>
    game(`
      window.__S.set({ smoothWalking: ${smooth} });
      ride(0); G.ty = Math.PI / 2; G.yaw = G.ty; G.eyePos.x = 0; G.eyePos.z = 0;
      const speeds = [];
      G.setMoveInput(1, 0);
      for (let i = 0; i < 16; i++) { const x0 = G.eyePos.x; G.update(0.05); speeds.push(Math.abs(G.eyePos.x - x0) / 0.05); }
      G.setMoveInput(0, 0);
      const stop = [];
      for (let i = 0; i < 16; i++) { const x0 = G.eyePos.x; G.update(0.05); stop.push(Math.abs(G.eyePos.x - x0) / 0.05); }
      return { speeds, stop };
    `);

  test('off (default): full speed at once, stops at once', async ({ game }) => {
    expect(await game(`return window.__S.get().smoothWalking;`)).toBe(false);
    const { speeds, stop } = await walk(game, false);
    expect(speeds[0]).toBeCloseTo(2.4, 1);
    expect(stop[0]).toBe(0);
  });

  test('on: speeds up and slows down gradually, same top speed', async ({ game }) => {
    const { speeds, stop } = await walk(game, true);
    expect(speeds[0]).toBeLessThan(1.5);
    expect(speeds[15]).toBeGreaterThan(2.35);
    expect(speeds[15]).toBeLessThanOrEqual(2.4001);
    expect(stop[0]).toBeGreaterThan(0.5);
    expect(stop[15]).toBe(0);
  });
});
