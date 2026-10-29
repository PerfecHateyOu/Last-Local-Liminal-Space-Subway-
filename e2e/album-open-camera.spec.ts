import { test, expect, board } from './game';

test.describe('evidence log: empty album opens the camera', () => {
  test('with no prints, "Open camera" closes the log and raises the viewfinder', async ({ page, game }) => {
    await game(`ride(0); window.__P.setAlbum(true);`);
    const btn = page.getByTestId('album-open-camera');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByTestId('evidence-log')).toHaveCount(0);
    expect(await game(`return { vf: window.__P.isViewfinderOpen, album: window.__P.isAlbumOpen };`)).toEqual({ vf: true, album: false });
  });

  test('once a print exists, the button is gone', async ({ page, game }) => {
    await game(`ride(0); await sleep(300); G.takePolaroidPhoto(); window.__P.setViewfinder(false); window.__P.setAlbum(true);`);
    await expect(page.getByTestId('evidence-log')).toBeVisible();
    await expect(page.getByTestId('album-open-camera')).toHaveCount(0);
  });

  test('DEBUG RUN rides keep their prints out of saved storage', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('gtrain-tutorial', 'done');
      localStorage.setItem('gtrain-settings', JSON.stringify({ fullscreenOnBoard: false, debugOverlay: true }));
    });
    const run = await board(page, { keepStorage: true });
    const r = await run(`ride(0); await sleep(300); const p = G.takePolaroidPhoto(); window.__P.develop(); await sleep(800);
      return { took: !!p, saved: localStorage.getItem('gtrain-polaroids') };`);
    expect(r).toEqual({ took: true, saved: null });
  });
});
