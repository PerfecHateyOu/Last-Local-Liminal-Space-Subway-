/**
 * Anomaly Management Engine for LAST LOCAL
 * Implements the 13 cataloged procedural anomalies across High, Medium, Low, and Critical tiers,
 * unobserved manifestation angle checks, and lifecycle reversion.
 */
import * as THREE from 'three';
import { setMaterialColor } from '../graphics/modelLoader';
import { SWAP_CHAR_MAP } from '../constants';
import { SubwayCarBuilder, AdObject } from '../graphics/subwayCarBuilder';
import { ActiveAnomaly, AnomalyDef } from '../types';
import { shuffle } from './shuffle';

/** How far along the car (m, either side of your seat) the small, close-look anomalies may happen. */
export const NEAR_X = 5;

export class AnomalyManager {
  private carBuilder: SubwayCarBuilder;
  private catalog: Record<string, AnomalyDef> = {};
  private pools: string[][] = [[], [], [], []];

  constructor(carBuilder: SubwayCarBuilder) {
    this.carBuilder = carBuilder;
    this.initCatalog();
  }

  private initCatalog() {
    const cb = this.carBuilder;

    // Fair reach: changes you'd have to read or spot small (a typo, warped words, a sticker, one
    // cold light) only happen within NEAR_X of your seat. At the far end of the car you can't
    // read an ad's letters, however hard you look.
    const near = (x: number) => Math.abs(x) <= NEAR_X;
    const freeAd = (usedTids: Set<string>, nearOnly = false): AdObject | null => {
      const shuffled = shuffle(cb.acrossAds.filter((a) => !nearOnly || near(a.mesh.position.x)));
      return shuffled.find((a) => !usedTids.has(a.tid)) || null;
    };

    this.catalog = {
      // Tier 0: High
      adswap: {
        tier: 0,
        make: () => {
          const ad = freeAd(new Set(), true);
          if (!ad) return null;
          const h = ad.def.h;
          const idx = [...h].map((c, i) => (SWAP_CHAR_MAP[c] ? i : -1)).filter((i) => i >= 0);
          if (!idx.length) return null;
          const i = idx[Math.floor(Math.random() * idx.length)];
          const swapped = h.slice(0, i) + SWAP_CHAR_MAP[h[i]] + h.slice(i + 1);

          return {
            tids: [ad.tid],
            obj: ad.mesh,
            desc: `The ${h} ad had a typo: "${swapped}"`,
            apply: () => {
              cb.textureGen.drawAdOnCanvas(ad.canvas, ad.def, swapped);
              ad.tex.needsUpdate = true;
            },
            revert: () => {
              cb.textureGen.drawAdOnCanvas(ad.canvas, ad.def, h);
              ad.tex.needsUpdate = true;
            },
          };
        },
      },
      sticker: {
        tier: 0,
        make: () => {
          const shuffledPanes = shuffle(cb.panes.filter((p) => near(p.x)));
          const p = shuffledPanes[0];
          if (!p) return null;
          const kind = Math.random() < 0.5 ? 'sticker' : 'stain';

          return {
            tids: [p.tid],
            obj: p.decal,
            desc: kind === 'sticker' ? 'A bright yellow smiley sticker appeared on a window' : 'A grimy liquid drip stain formed on a window',
            apply: () => {
              (p.decal.material as THREE.MeshBasicMaterial).map = kind === 'sticker' ? p.decalTexSticker : p.decalTexStain;
              (p.decal.material as THREE.MeshBasicMaterial).needsUpdate = true;
              p.decal.visible = true;
            },
            revert: () => {
              p.decal.visible = false;
            },
          };
        },
      },
      lighttemp: {
        tier: 0,
        make: () => {
          const shuffledLights = shuffle(cb.lightSegs.filter((l) => near(l.m.position.x)));
          const l = shuffledLights[0];
          if (!l) return null;

          return {
            tids: [l.tid],
            obj: l.m,
            desc: 'One ceiling fluorescent light turned cold sterile blue',
            apply: () => {
              l.mat.color.set(0x8cc2ff); // cold blue, clear against the warm strip
            },
            revert: () => {
              l.mat.color.set(0xfff4de);
            },
          };
        },
      },
      stare: {
        tier: 0,
        make: () => {
          const s = cb.strangers[0]; // s1 across aisle
          return {
            tids: [s.tid],
            obj: s.head,
            desc: 'The man sitting across the aisle stared directly at you without blinking',
            apply: () => {
              s.stare = true;
            },
            revert: () => {
              s.stare = false;
              s.head.rotation.set(s.pose[1], s.pose[0], 0);
            },
          };
        },
      },

      // Tier 1: Medium
      mapstop: {
        tier: 1,
        make: () => {
          const m = cb.maps[Math.floor(Math.random() * cb.maps.length)];
          const v = Math.random() < 0.6 ? 'extra' : 'color';

          return {
            tids: [m.tid],
            obj: m.mesh,
            desc: v === 'extra' ? 'The route map showed an impossible station: "Hollow St"' : 'The G train line on the route map shifted to the wrong color',
            apply: () => {
              cb.textureGen.drawRouteMap(m.canvas, v);
              m.tex.needsUpdate = true;
            },
            revert: () => {
              cb.textureGen.drawRouteMap(m.canvas, 'normal');
              m.tex.needsUpdate = true;
            },
          };
        },
      },
      adcolor: {
        tier: 1,
        make: () => {
          const ad = freeAd(new Set());
          if (!ad || !ad.def.alt) return null;

          return {
            tids: [ad.tid],
            obj: ad.mesh,
            desc: `The ${ad.def.h} advertisement shifted its background color`,
            apply: () => {
              cb.textureGen.drawAdOnCanvas(ad.canvas, ad.def, ad.def.h, ad.def.alt);
              ad.tex.needsUpdate = true;
            },
            revert: () => {
              cb.textureGen.drawAdOnCanvas(ad.canvas, ad.def, ad.def.h);
              ad.tex.needsUpdate = true;
            },
          };
        },
      },
      moved: {
        tier: 1,
        make: () => {
          const s = cb.strangers[2]; // s3 standing commuter
          return {
            tids: [s.tid],
            obj: s.head,
            desc: 'The standing passenger was abruptly standing at the far doors',
            apply: () => {
              s.g.position.x = -5.0;
            },
            revert: () => {
              s.g.position.copy(s.home);
            },
          };
        },
      },
      extra: {
        tier: 1,
        make: () => {
          return {
            tids: [cb.extraPerson.tid],
            obj: cb.extraPerson.head,
            desc: 'An unrecognized silent passenger was suddenly seated at the far end',
            apply: () => {
              cb.extraPerson.g.visible = true;
            },
            revert: () => {
              cb.extraPerson.g.visible = false;
            },
          };
        },
      },

      // Tier 2: Low
      nearword: {
        tier: 2,
        make: () => {
          const ad = freeAd(new Set(), true);
          if (!ad || !ad.def.warp) return null;

          return {
            tids: [ad.tid],
            obj: ad.mesh,
            desc: `The ${ad.def.h} ad warped into disturbing words: "${ad.def.warp}"`,
            apply: () => {
              cb.textureGen.drawAdOnCanvas(ad.canvas, ad.def, ad.def.warp!);
              ad.tex.needsUpdate = true;
            },
            revert: () => {
              cb.textureGen.drawAdOnCanvas(ad.canvas, ad.def, ad.def.h);
              ad.tex.needsUpdate = true;
            },
          };
        },
      },
      faceturn: {
        tier: 2,
        make: () => {
          const s = cb.strangers[1]; // s2 on player's bench
          return {
            tids: [s.tid],
            obj: s.head,
            desc: 'The woman on your bench twisted her neck beyond anatomical limits to look at you',
            apply: () => {
              s.twist = true;
            },
            revert: () => {
              s.twist = false;
              s.head.rotation.set(s.pose[1], s.pose[0], 0);
              s.head.rotation.z = 0;
            },
          };
        },
      },

      // Tier 3: Critical
      momface: {
        tier: 3,
        make: () => {
          const mom = cb.parents[0];
          return {
            tids: [mom.tid],
            obj: mom.head,
            desc: 'Mom\u2019s face froze into an uncanny expression with unnervingly dilated eyes',
            apply: () => {
              mom.frozen = true;
              mom.eyes.forEach((e) => e.scale.set(2.2, 2.2, 1.8));
              setMaterialColor(mom.skMat, 0xdfd9ce);
              if (mom.phone) mom.phone.visible = false;
            },
            revert: () => {
              mom.frozen = false;
              mom.eyes.forEach((e) => e.scale.set(1, 1, 1));
              setMaterialColor(mom.skMat, mom.skin);
            },
          };
        },
      },
      dadanswer: {
        tier: 3,
        make: () => {
          const dad = cb.parents[1];
          const lines = [
            'No, I didn\u2019t hear it either.',
            'Because you didn\u2019t ask.',
            'Two more. Don\u2019t count them.',
          ];
          const line = lines[Math.floor(Math.random() * lines.length)];

          return {
            tids: [dad.tid],
            obj: null,
            desc: `Dad answered an unspoken thought aloud: "${line}"`,
            line,
            ready: () => true,
            apply: () => {
              // Triggered via game state subtitle dispatcher
            },
            revert: () => {},
          };
        },
      },
      empty: {
        tier: 3,
        make: () => {
          return {
            tids: [...cb.strangers.map((s) => s.tid), cb.extraPerson.tid, ...cb.crowd.map((c) => c.tid)],
            obj: null,
            desc: 'Every single stranger vanished; the train car was completely empty',
            apply: () => {
              cb.strangers.forEach((s) => (s.g.visible = false));
              cb.crowd.forEach((c) => (c.g.visible = false));
            },
            revert: () => {
              cb.strangers.forEach((s) => (s.g.visible = true));
            },
          };
        },
      },
    };

    [0, 1, 2, 3].forEach((t) => {
      this.pools[t] = Object.keys(this.catalog).filter((k) => this.catalog[k].tier === t);
    });
  }

  public createAnomaly(id: string, triggerTime: number): ActiveAnomaly | null {
    const def = this.catalog[id];
    if (!def) return null;
    const inst = def.make();
    if (!inst) return null;

    return {
      id,
      tier: def.tier,
      tids: inst.tids,
      obj: inst.obj,
      desc: inst.desc,
      line: inst.line,
      trigger: triggerTime,
      at: null,
      apply: inst.apply,
      revert: inst.revert,
      ready: inst.ready,
    };
  }

  /**
   * A random anomaly id for this sanity tier, never one in `exclude` (already planned for this
   * stretch). If every anomaly in the rolled tier is taken, it steps down a tier; null only when
   * nothing is left at all.
   */
  public pickPoolTier(currentTier: number, stop: number, exclude: ReadonlySet<string> = new Set()): string | null {
    let t = Math.random() < 0.7 ? currentTier : Math.floor(Math.random() * (currentTier + 1));
    if (t === 3 && stop < 10) t = 2;
    for (let tt = t; tt >= 0; tt--) {
      const pool = this.pools[tt].filter((id) => !exclude.has(id));
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    return null;
  }
}
