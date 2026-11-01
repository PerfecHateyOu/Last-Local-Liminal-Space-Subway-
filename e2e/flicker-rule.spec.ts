// The flicker rule (design doc): the door tick is the only thing that takes the whole car to dark
// or flickers it. Single-tube flickers and Nightmare bulbs touch one tube at a time. The slow dim
// during the Restraint moment and per sanity tier is allowed, but it must be gradual: never near
// zero and never flickering. Adapted from the GPT-Astra rebuild's door-tick-flicker spec.
import { test, expect } from './game';

const READ = `G.applyLighting(); return {
  car: G.carBuilder.carLights.map((l) => l.intensity),
  hemi: G.carBuilder.hemiLight.intensity,
  tubesOff: G.carBuilder.lightSegs.map((l, i) => (l.m.visible ? -1 : i)).filter((i) => i >= 0),
};`;

test.describe('Flicker rule: only the door tick darkens the whole car', () => {
  test('the door tick takes every car light to zero, and only while it lasts', async ({ game }) => {
    const r = await game(`
      G.flickerUntil = -1; G.tubeFlicker = null; G.bulbOut = [];
      const before = (() => { ${READ} })();
      G.flickerUntil = G.GT + 0.16;
      const during = (() => { ${READ} })();
      G.flickerUntil = -1;
      const after = (() => { ${READ} })();
      return { before, during, after, tubes: G.carBuilder.lightSegs.length };
    `);
    expect(r.before.car.length).toBeGreaterThan(2);
    expect(r.before.car.every((v: number) => v > 0.3)).toBe(true);
    expect(r.before.tubesOff).toEqual([]);
    expect(r.during.car.every((v: number) => v === 0)).toBe(true);
    expect(r.during.hemi).toBeLessThan(0.1);
    expect(r.during.tubesOff).toHaveLength(r.tubes);
    expect(r.after).toEqual(r.before);
  });

  test('a single-tube flicker puts out one tube and leaves the car lit', async ({ game }) => {
    const r = await game(`
      G.flickerUntil = -1; G.tubeFlicker = null; G.bulbOut = [];
      const before = (() => { ${READ} })();
      const i = G.flickerOneTube();
      const during = (() => { ${READ} })();
      return { before, during, i };
    `);
    expect(r.i).toBeGreaterThanOrEqual(0);
    expect(r.during.tubesOff).toEqual([r.i]);
    expect(r.during.car).toEqual(r.before.car);
    expect(r.during.hemi).toBe(r.before.hemi);
  });

  test('Nightmare bulbs go out one tube at a time and never dim the car', async ({ game }) => {
    const r = await game(`
      G.flickerUntil = -1; G.tubeFlicker = null; G.bulbOut = [];
      const before = (() => { ${READ} })();
      G.bulbOut[2] = G.GT + 1;
      const one = (() => { ${READ} })();
      G.bulbOut[5] = G.GT + 1;
      const two = (() => { ${READ} })();
      G.bulbOut = [];
      return { before, one, two };
    `);
    expect(r.one.tubesOff).toEqual([2]);
    expect(r.two.tubesOff).toEqual([2, 5]);
    expect(r.one.car).toEqual(r.before.car);
    expect(r.two.car).toEqual(r.before.car);
  });

  test('the Restraint dim is gradual: never near zero, never flickering', async ({ game }) => {
    const r = await game(`
      G.flickerUntil = -1; G.tubeFlicker = null; G.bulbOut = [];
      const start = G.carBuilder.carLights[0].intensity;
      G.startRestraintMoment(); G.flagHeld = true;
      const xs = [];
      for (let k = 0; k < 120; k++) {
        G.flickerUntil = -1; G.update(0.05);
        if (!G.restraint) break;
        xs.push(G.carBuilder.carLights[0].intensity);
      }
      return { start, xs, dim: G.dim };
    `);
    expect(r.xs.length).toBeGreaterThan(20);
    const min = Math.min(...r.xs);
    expect(min).toBeLessThan(r.start); // it does dim (allowed)
    expect(min).toBeGreaterThan(r.start * 0.3); // but never to ~0
    // No flicker: frame-to-frame steps are small and the light only turns around once at most.
    let turns = 0;
    for (let i = 2; i < r.xs.length; i++) {
      expect(Math.abs(r.xs[i] - r.xs[i - 1])).toBeLessThan(r.start * 0.1);
      const a = r.xs[i - 1] - r.xs[i - 2], b = r.xs[i] - r.xs[i - 1];
      if (Math.abs(a) > 1e-6 && Math.abs(b) > 1e-6 && Math.sign(a) !== Math.sign(b)) turns++;
    }
    expect(turns).toBeLessThanOrEqual(1);
  });

  test('sanity tiers dim the car a little per tier, never to dark', async ({ game }) => {
    const r = await game(`
      G.flickerUntil = -1; G.tubeFlicker = null; G.bulbOut = [];
      const out = [];
      for (let san = 100; san >= 0; san -= 10) {
        G.san = san; advance(0.05); G.flickerUntil = -1;
        G.applyLighting();
        out.push({ tier: G.tier, v: G.carBuilder.carLights[0].intensity });
      }
      return out;
    `);
    const tiers = new Set(r.map((x: any) => x.tier));
    expect(tiers.size).toBeGreaterThan(2);
    const top = r[0].v;
    for (const x of r) expect(x.v).toBeGreaterThan(top * 0.5);
    for (let i = 1; i < r.length; i++) expect(r[i].v).toBeLessThanOrEqual(r[i - 1].v + 1e-9);
  });
});
