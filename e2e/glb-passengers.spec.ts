import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect, board } from './game';

// Blender models for ordinary passengers (src/graphics/modelLoader.ts), shared per outfit and pose
// through public/models/characters/manifest.json (passenger_<archetype>[_seated|_standing].glb).
// The fixture is the exporter's seated Mom, which fits the same node contract.
const glb = (n: string) => readFileSync(join(dirname(test.info().config.configFile!), 'fixtures', 'models', n));

const INSPECT = `
  await sleep(600);
  const cb = G.carBuilder;
  const all = [...cb.parents, ...cb.strangers, cb.extraPerson, ...cb.crowd, ...(cb.carAPassengers || []), ...(cb.carCPassengers || [])];
  const out = {};
  for (const p of all) {
    const tids = new Set(); const mats = new Set();
    p.g.traverse((o) => { if (!o.isMesh) return; tids.add(o.userData.tid); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m.uuid)); });
    out[p.tid] = { imported: !!p.isImportedModel, meshTids: [...tids], order: p.head.rotation.order, eyes: p.eyes.length, skin: p.skMat.uuid, skinName: p.skMat.name, mats: [...mats] };
  }
  return out;`;

test.describe('Blender models for passengers (.glb via the manifest)', () => {
  test('files missing: everyone stays procedural, no page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/models/characters/*.glb', (r) => r.fulfill({ status: 404, body: '' }));
    const r = await (await board(page))(INSPECT);
    expect(Object.values(r).some((p: any) => p.imported)).toBe(false);
    expect(r.s1.meshTids).toEqual(['s1']);
    expect(errors).toEqual([]);
  });

  test('with models: matching passengers use them, each with their own skin; parents untouched', async ({ page }) => {
    await page.route('**/models/characters/*.glb', (r) => {
      const u = r.request().url();
      if (/passenger_(mta|overcoat)\.glb$/.test(u)) return r.fulfill({ body: glb('npc_mom.glb'), contentType: 'model/gltf-binary' });
      return r.fulfill({ status: 404, body: '' });
    });
    const g2 = await board(page);
    const r = await g2(INSPECT);
    // s1 is the 'mta' outfit (seated); c3 and pa2 share the seated 'overcoat' file.
    for (const tid of ['s1', 'c3', 'pa2']) {
      expect(r[tid].imported, tid).toBe(true);
      expect(r[tid].meshTids, tid).toEqual([tid]);
      expect(r[tid].order).toBe('YXZ');
      expect(r[tid].eyes).toBeGreaterThan(0);
      expect(r[tid].skinName).toMatch(/^Skin/);
    }
    // One file, two people: the skin isn't shared, so a recolour on one never shows on the other.
    expect(r.c3.skin).not.toBe(r.pa2.skin);
    for (const tid of ['mom', 'dad', 's2', 's3', 'c1', 'c5', 'seat6']) expect(r[tid].imported, tid).toBe(false);

    const tint = await g2(`
      const [a, b] = [G.carBuilder.crowd[2], G.carBuilder.carAPassengers[1]];
      const b0 = b.skMat.color.getHex(); a.skMat.color.setHex(0x123456);
      return { a: a.skMat.color.getHex(), b: b.skMat.color.getHex(), b0 };`);
    expect(tint.a).toBe(0x123456);
    expect(tint.b).toBe(tint.b0);
  });
});
