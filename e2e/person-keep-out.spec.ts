import { test, expect, board } from './game';

// Walking into a standing passenger used to put the camera inside them (they filled a phone screen,
// half drawn). The eye now stops at the edge of a small circle and slides past (game/personKeepOut.ts).
test.use({ viewport: { width: 390, height: 844 } });

test('walking into the standing passenger stops short and slides past', async ({ page }) => {
  const g = await board(page);
  const r = await g(`
    await sleep(300);
    const s3 = G.carBuilder.strangers[2];
    const at = () => { const p = s3.g.position; return Math.hypot(G.eyePos.x - p.x, G.eyePos.z - p.z); };
    G.eyePos.x = 3.6; G.eyePos.z = 0.4; G.yaw = G.ty = -Math.PI / 2;
    let min = 9;
    G.setMoveInput(1, 0);
    for (let i = 0; i < 60; i++) { G.update(0.05); min = Math.min(min, at()); }
    G.setMoveInput(0, 0);
    return { min, x: G.eyePos.x, standing: s3.standing };`);
  expect(r.standing).toBe(true);
  expect(r.min).toBeGreaterThan(0.74);
  expect(r.x).toBeGreaterThan(5.5); // still got past, along the free side of the aisle
});
