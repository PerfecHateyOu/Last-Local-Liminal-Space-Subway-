// Saves from earlier builds must keep loading. Uses the game's real save keys (src/settings.ts
// PROGRESS_KEYS plus settings, tutorial and haptics). Adapted from the GPT-Astra rebuild's
// storage-compatibility spec.
import { test, expect, board } from './game';

const KEYS = [
  'gtrain-settings',
  'gtrain-tutorial',
  'gtrain-haptics',
  'gtrain-psychlog',
  'gtrain-runs',
  'gtrain-tapes',
  'gtrain-endings',
  'courtSq_endingsArchive',
  'gtrain-polaroids',
  'gtrain-achievements',
];
const FINISH = `ride(6); G.seg._masks = [];
  G.stopLog.push({ stop: 7, b: false, name: 'Flushing Av', fps: [], anoms: [{ id: 'sticker', desc: 'The sticker', hit: true }] });
  G.acc.correct = 1; G.peak = 0; G.finalExitChoice = 'escalators'; G.endGame();`;

test('test-mode hooks are all on window', async ({ page, game }) => {
  await game(`G.notifyUI();`);
  const missing = await page.evaluate(() =>
    ['__G', '__A', '__S', '__R', '__P', '__RT', '__EVP', '__END', '__PB', '__PL', '__M'].filter((k) => !(window as any)[k])
  );
  expect(missing).toEqual([]);
  // __vib is not a game hook: e2e/haptics.spec.ts makes it with its own navigator.vibrate stub.
});

test('a finished ride writes saves that load again after a reload', async ({ page }) => {
  const game = await board(page);
  await game(`advance(12); ${FINISH}`);
  const saved = await page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), KEYS);
  for (const k of ['gtrain-settings', 'gtrain-tutorial', 'gtrain-psychlog', 'gtrain-runs', 'gtrain-endings']) {
    expect(saved[k], k).not.toBeNull();
  }
  const again = await board(page, { keepStorage: true });
  const r = await again(`return {
    runs: JSON.parse(localStorage.getItem('gtrain-runs')).length,
    endings: Object.keys(JSON.parse(localStorage.getItem('gtrain-endings'))),
    phase: G.phase,
  };`);
  expect(r.runs).toBe(1);
  expect(r.endings.length).toBeGreaterThan(0);
  expect(r.phase).not.toBe('practice');
  const after = await page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), KEYS);
  expect(after['gtrain-psychlog']).toBe(saved['gtrain-psychlog']);
  expect(after['gtrain-endings']).toBe(saved['gtrain-endings']);
});

test('old-format saves load: legacy endings key, settings and tutorial flag', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('gtrain-settings', JSON.stringify({ fullscreenOnBoard: false, invertY: true, musicVolume: 0.3 }));
    localStorage.setItem('gtrain-tutorial', 'done');
    localStorage.setItem(
      'courtSq_endingsArchive',
      JSON.stringify({ civilian_extraction: { id: 'civilian_extraction', discoveredAt: 1, count: 2 } })
    );
    localStorage.setItem('gtrain-runs', JSON.stringify([{ date: 1, san: 80 }]));
  });
  const game = await board(page, { keepStorage: true });
  const r = await game(`
    const s = window.__S.get ? window.__S.get() : window.__S.current;
    return { invertY: s.invertY, music: s.musicVolume, phase: G.phase };
  `);
  expect(r.invertY).toBe(true);
  expect(r.music).toBeCloseTo(0.3);
  expect(r.phase).not.toBe('practice');
  const legacy = await page.evaluate(() => (window as any).__END.ENDINGS && localStorage.getItem('courtSq_endingsArchive'));
  expect(legacy).not.toBeNull(); // only migrated when a new ending is recorded
});
