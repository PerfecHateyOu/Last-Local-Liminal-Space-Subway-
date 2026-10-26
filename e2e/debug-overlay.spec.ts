import { test, expect, board } from './game';

// The opt-in spoiler overlay (Settings > Spoilers > "Debug overlay (spoilers)"). These run on the
// test-mode build, which is a production build, so they cover the built game.
const SAVED = ['gtrain-runs', 'gtrain-psychlog', 'gtrain-tapes', 'gtrain-endings', 'courtSq_endingsArchive', 'gtrain-polaroids', 'gtrain-achievements'];
const snapshot = `return Object.fromEntries(${JSON.stringify(SAVED)}.map((k) => [k, localStorage.getItem(k)]));`;
// Finish the ride with things worth saving: a caught anomaly, no suspicion (badges) and an ending.
const FINISH = `ride(6); G.seg._masks = [];
  G.stopLog.push({ stop: 7, b: false, name: 'Flushing Av', fps: [], anoms: [{ id: 'sticker', desc: 'The sticker', hit: true }] });
  G.acc.correct = 1; G.peak = 0; G.finalExitChoice = 'escalators'; G.endGame();`;

test.describe('Debug overlay setting', () => {
  test('is off by default; backquote does nothing until it is turned on', async ({ page }) => {
    const game = await board(page);
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('debug-overlay')).toHaveCount(0);
    expect(await game(`return G.debug;`)).toBe(false);
  });

  test('turns on in Settings, persists after reload, and backquote shows the overlay in the built game', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('gtrain-settings', JSON.stringify({ fullscreenOnBoard: false }));
    });
    await page.reload();
    await page.getByRole('button', { name: /Settings/i }).first().click();
    const box = page.getByLabel('Debug overlay (spoilers)');
    await expect(box).not.toBeChecked();
    await expect(page.getByText(/Spoiler warning/)).toBeVisible();
    await box.check({ force: true });
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('gtrain-settings')))!).debugOverlay).toBe(true);

    await page.reload();
    await page.getByRole('button', { name: /Settings/i }).first().click();
    await expect(page.getByLabel('Debug overlay (spoilers)')).toBeChecked();
    await page.keyboard.press('Escape');

    const game = await board(page, { keepStorage: true });
    expect(await game(`return G.isDebugRun;`)).toBe(false);
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('debug-overlay')).toBeVisible();
    await expect(page.getByTestId('debug-overlay')).toContainText('DEBUG: Stop');
    expect(await game(`return G.isDebugRun;`)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('debug-overlay.png') });
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('debug-overlay')).toHaveCount(0);
    expect(await game(`return G.isDebugRun;`)).toBe(true); // once shown, the whole ride stays a debug run
  });

  test('a debug run saves nothing and says so; the next normal ride saves as usual', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('gtrain-settings', JSON.stringify({ fullscreenOnBoard: false, debugOverlay: true }));
    });
    const game = await board(page, { keepStorage: true });
    const before = await game(snapshot);
    await page.keyboard.press('Backquote');
    await game(`advance(12); ${FINISH}`);
    await expect(page.getByTestId('debug-run-tag')).toHaveText('DEBUG RUN');
    await expect(page.getByTestId('debug-run-note')).toContainText('nothing from this ride is saved');
    await expect(page.getByText('STATUS: NOT FILED')).toBeVisible();
    expect(await game(`return G.psychLog.ride.map((e) => [e.id, e.hit, e.isNew]);`)).toEqual([['sticker', true, false]]);
    expect(await game(snapshot)).toEqual(before);

    // A fresh ride with the overlay never shown is a normal, saved ride.
    await game(`G.debug = false; G.startIntro(); advance(12); ${FINISH}`);
    await expect(page.getByTestId('debug-run-tag')).toHaveCount(0);
    const after = await game(snapshot);
    expect(JSON.parse(after['gtrain-runs'])).toHaveLength(1);
    expect(JSON.parse(after['gtrain-psychlog']).sticker).toMatchObject({ seen: 1, caught: 1 });
  });
});
