import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect, board } from './game';

// Blender models for Mom and Dad (src/graphics/modelLoader.ts, public/models/characters/manifest.json).
// The manifest maps mom/dad to models/characters/{mom,dad}.glb; models swap in after the car is
// built, and anything missing or broken leaves the procedural figure in place. The fixtures are the
// exporter's own Mom and Dad (`bun run export:glb`).
const glb = (n: string) => readFileSync(join(dirname(test.info().config.configFile!), 'fixtures', 'models', n));

const INSPECT = `
  await sleep(600);
  const out = {};
  for (const p of G.carBuilder.parents) {
    p.g.updateMatrixWorld(true);
    const hp = p.head.getWorldPosition(p.home.clone());
    const tids = new Set();
    p.g.traverse((o) => { if (o.isMesh) tids.add(o.userData.tid); });
    const cam = R.camera.position.clone(); const dir = hp.clone().sub(cam).normalize();
    G.raycaster.set(cam, dir); const hit = G.raycaster.intersectObjects(G.carBuilder.getActiveTargets(), false)[0];
    out[p.tid] = {
      imported: !!p.isImportedModel, meshTids: [...tids], headY: +hp.y.toFixed(3),
      order: p.head.rotation.order, eyes: p.eyes.length, skinName: p.skMat.name,
      gaze: hit ? hit.object.userData.tid : null,
    };
  }
  return out;`;

/** Serve only the given files from models/characters/ (everything else 404s). */
async function serve(page: import('@playwright/test').Page, files: Record<string, Buffer | string | 404>) {
  await page.route('**/models/characters/*.glb', (r) => {
    const name = r.request().url().split('/').pop()!.split('?')[0];
    const f = files[name];
    if (f === undefined || f === 404) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ body: f as any, contentType: 'model/gltf-binary' });
  });
}

test.describe('Blender models for Mom and Dad (.glb via the manifest)', () => {
  test('no manifest: procedural parents, no page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/models/characters/manifest.json', (r) => r.fulfill({ status: 404, body: '' }));
    const r = await (await board(page))(INSPECT);
    expect([r.mom.imported, r.dad.imported]).toEqual([false, false]);
    expect(r.mom.gaze).toBe('mom');
    expect(errors).toEqual([]);
  });

  test('loads the exported Mom and Dad: tid, head pivot, eyes, skin, gaze, flag and the frozen face', async ({ page }) => {
    await page.route('**/models/characters/manifest.json', (r) => r.fulfill({ status: 404, body: '' }));
    const ref = await (await board(page))(INSPECT);
    await page.unrouteAll();

    await serve(page, { 'mom.glb': glb('npc_mom.glb'), 'dad.glb': glb('npc_dad.glb') });
    const game = await board(page);
    const r = await game(INSPECT);
    for (const tid of ['mom', 'dad'] as const) {
      const a = r[tid], b = ref[tid];
      expect(a.imported, tid).toBe(true);
      expect(a.meshTids).toEqual([tid]); // every mesh is a gaze target for this parent
      expect(a.order).toBe('YXZ');
      expect(Math.abs(a.headY - b.headY), `${tid} head pivot`).toBeLessThan(0.02);
      expect(a.eyes).toBe(2);
      expect(a.skinName).toMatch(/^Skin/);
      expect(a.gaze, `${tid} gaze`).toBe(tid);
    }

    // The frozen-face anomaly on the imported Mom: eyes scale, skin recolours, and both revert.
    const f = await game(`
      const mom = G.carBuilder.parents[0]; const skin0 = mom.skMat.color.getHex();
      const a = G.anomalyMgr.createAnomaly('momface', 0); a.apply();
      const on = { frozen: mom.frozen, eye: mom.eyes[0].scale.x, skin: mom.skMat.color.getHex(), phone: mom.phone && mom.phone.visible };
      a.revert();
      const off = { frozen: mom.frozen, eye: mom.eyes[0].scale.x, skin: mom.skMat.color.getHex() };
      ride(0); flag('mom');
      return { on, off, skin0, flagged: G.segFlags.map((x) => x.tid) };`);
    expect(f.on).toEqual({ frozen: true, eye: 2.2, skin: 0xdfd9ce, phone: false });
    expect(f.off).toEqual({ frozen: false, eye: 1, skin: f.skin0 });
    expect(f.flagged).toContain('mom');
  });

  test('a bad or missing model falls back to the procedural figure', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await serve(page, { 'mom.glb': 'not a glb', 'dad.glb': 404 });
    const r = await (await board(page))(INSPECT);
    expect([r.mom.imported, r.dad.imported]).toEqual([false, false]);
    expect(r.mom.gaze).toBe('mom');
    expect(errors).toEqual([]);
  });
});
