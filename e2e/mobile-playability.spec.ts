// Phone play in portrait and landscape: big enough tool buttons, a route panel that stays clear
// of them, and subtitles that stay on screen. Adapted from the GPT-Astra rebuild's
// mobile-playability spec.
import { test, expect } from './game';

const VIEWPORTS = [
  { name: 'portrait 390x844', width: 390, height: 844 },
  { name: 'landscape 844x390', width: 844, height: 390 },
];
const TOOLS = ['Polaroid Camera', 'Recorder', 'Evidence Log', 'Route Lines', 'Mute', 'Pause'];

for (const vp of VIEWPORTS) {
  test.describe(`Phone, ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });

    test('tool buttons are at least 44px and the route panel does not cover them', async ({ page, game }) => {
      await game(`window.__EVP.hasRecorder = true; G.startSegment(1); G.notifyUI();`);
      await expect(page.getByTestId('move-stick')).toBeVisible();
      const panel = (await page.getByTestId('hud-route-panel').boundingBox())!;
      expect(panel).not.toBeNull();
      for (const name of TOOLS) {
        const btn = page.getByRole('button', { name, exact: true });
        await expect(btn, name).toBeVisible();
        const b = (await btn.boundingBox())!;
        expect(b.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(b.height, `${name} height`).toBeGreaterThanOrEqual(44);
        expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1, `${name} on screen`).toBe(true);
        const overlap =
          panel.x < b.x + b.width && panel.x + panel.width > b.x && panel.y < b.y + b.height && panel.y + panel.height > b.y;
        expect(overlap, `route panel overlaps ${name}`).toBe(false);
      }
    });

    test('a long subtitle stays fully on screen', async ({ page, game }) => {
      await game(`G.setSub('<b>Dad:</b> Grab a seat. It\\u2019s a long one, all the way out past Queens Plaza and then some.', 10);`);
      const sub = page.locator('div:has-text("Grab a seat")').last();
      await expect(sub).toBeVisible();
      const b = (await sub.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
    });
  });
}
