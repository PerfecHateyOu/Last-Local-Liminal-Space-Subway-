import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect, board } from './game';

// Optional Blender models for Mom and Dad (src/graphics/modelLoader.ts), round-tripped: the
// fixtures are the exporter's own Mom and Dad (`bun run export:glb`, character_parent_0*.glb),
// served as models/characters/{mom,dad}.glb, loaded through GLTFLoader and the adapter.
const glb = (n: string) => readFileSync(join(dirname(test.info().config.configFile!), 'fixtures', 'models', n));

// What each parent looks like to the game: tid, head pivot, eyes, skin, bounds, gaze target.
const INSPECT = `
  const out = {};
  for (const p of G.carBuilder.parents) {
    p.g.updateMatrixWorld(true);
    const hp = p.head.getWorldPosition(p.home.clone());
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const tids = new Set(); const skins = new Set(); let meshes = 0;
    p.g.traverse((o) => {
      if (!o.isMesh) return; meshes++; tids.add(o.userData.tid);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => /^skin/i.test(m.name) && skins.add(m.uuid));
      o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      for (let i = 0; i < 3; i++) { const k = 'xyz'[i]; box.min[i] = Math.min(box.min[i], b.min[k]); box.max[i] = Math.max(box.max[i], b.max[k]); }
    });
    // Gaze: a ray from the camera to the head hits this parent first.
    const cam = R.camera.position.clone(); const dir = hp.clone().sub(cam).normalize();
    G.raycaster.set(cam, dir); const hit = G.raycaster.intersectObjects(G.carBuilder.getActiveTargets(), false)[0];
    out[p.tid] = {
      tid: p.tid, imported: p.skMat.type !== 'MeshLambertMaterial', meshTids: [...tids],
      headY: +hp.y.toFixed(3), order: p.head.rotation.order, eyes: p.eyes.length,
      eyeNames: p.eyes.map((e) => e.name).sort(), skinName: p.skMat.name, skins: skins.size, skinIsSk: skins.has(p.skMat.uuid),
      height: +(box.max[1] - box.min[1]).toFixed(3), width: +(box.max[0] - box.min[0]).toFixed(3),
      gaze: hit ? hit.object.userData.tid : null,
    };
  }
  return out;`;

test.describe('Blender models for Mom and Dad (.glb, off by default)', () => {
  test('off by default: procedural parents, no model requests', async ({ page }) => {
    const reqs: string[] = [];
    page.on('request', (r) => /models\/characters|GLTFLoader/.test(r.url()) && reqs.push(r.url()));
    const game = await board(page);
    const r = await game(INSPECT);
    expect(r.mom.imported).toBe(false);
    expect(r.dad.imported).toBe(false);
    expect(reqs).toEqual([]);
  });

  test('round-trips the exported Mom and Dad: tid, head pivot, eyes, skin, bounds, gaze, flag and the frozen face', async ({ page }) => {
    // Procedural reference first.
    const ref = await (await board(page))(INSPECT);

    await page.route('**/models/characters/mom.glb', (r) => r.fulfill({ body: glb('npc_mom.glb'), contentType: 'model/gltf-binary' }));
    await page.route('**/models/characters/dad.glb', (r) => r.fulfill({ body: glb('npc_dad.glb'), contentType: 'model/gltf-binary' }));
    await page.addInitScript(() => localStorage.setItem('gtrain-glb-parents', '1'));
    const game = await board(page);
    const r = await game(INSPECT);
    for (const tid of ['mom', 'dad'] as const) {
      const a = r[tid], b = ref[tid];
      expect(a.imported, tid).toBe(true);
      expect(a.tid).toBe(tid);
      expect(a.meshTids).toEqual([tid]); // every mesh is a gaze target for this parent
      expect(a.order).toBe('YXZ');
      expect(Math.abs(a.headY - b.headY), `${tid} head pivot`).toBeLessThan(0.01);
      expect(a.eyes).toBe(2);
      expect(a.eyeNames).toEqual(['Eye_L', 'Eye_R']);
      expect(a.skinName).toMatch(/^Skin/);
      expect([a.skins, a.skinIsSk]).toEqual([1, true]);
      expect(Math.abs(a.height - b.height), `${tid} height`).toBeLessThan(0.02);
      expect(Math.abs(a.width - b.width), `${tid} width`).toBeLessThan(0.02);
      expect(a.gaze, `${tid} gaze`).toBe(tid);
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await game(`G.yaw = 0; G.ty = 0; G.pitch = -0.1; G.tp = -0.1; await sleep(1500);`);
    await page.screenshot({ path: test.info().outputPath('glb-parents.png') });

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

  test('a bad model falls back to the procedural figure with a warning', async ({ page }) => {
    const warns: string[] = [];
    page.on('console', (m) => m.type() === 'warning' && warns.push(m.text()));
    await page.route('**/models/characters/mom.glb', (r) => r.fulfill({ body: 'not a glb', contentType: 'model/gltf-binary' }));
    await page.route('**/models/characters/dad.glb', (r) => r.fulfill({ status: 404, body: '' }));
    await page.addInitScript(() => localStorage.setItem('gtrain-glb-parents', '1'));
    const game = await board(page);
    const r = await game(INSPECT);
    expect([r.mom.imported, r.dad.imported]).toEqual([false, false]);
    expect(r.mom.gaze).toBe('mom');
    // One warning per file per load (board() loads the page twice).
    expect(warns.some((w) => w.includes('mom.glb') && w.includes('procedural'))).toBe(true);
    expect(warns.some((w) => w.includes('dad.glb') && w.includes('404'))).toBe(true);
  });
});
