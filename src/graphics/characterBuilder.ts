/**
 * 3D Stylized Character Mesh Generator for LAST LOCAL
 * Builds stylized passengers with realistic anatomical proportions, layered clothing,
 * articulated heads for gaze tracking, and specific anomaly state controls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PersonArchetype, PersonObject } from '../types';
import { TextureGenerator } from './textureGenerator';
import { modelLoader } from './modelLoader';

/** A small deterministic RNG seeded from a string (FNV-1a hash into mulberry32). */
export function seededRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PersonConfig {
  tid: string;
  label: string;
  x: number;
  z: number;
  ry?: number;
  hy?: number;
  hp?: number;
  standing?: boolean;
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  longHair?: boolean;
  phone?: boolean;
  glasses?: boolean;
  coat?: boolean;
  /** Distinct outfit with its own silhouette and accessories (see PersonArchetype). */
  archetype?: PersonArchetype;
  keep?: () => boolean;
}

export class CharacterBuilder {
  /**
   * Builds an articulated passenger mesh group
   */
  public createPerson(cfg: PersonConfig): PersonObject {
    const g = new THREE.Group();
    const up = cfg.standing ? 0.48 : 0;

    // This passenger's own small, repeatable variation (cloth hue and shade).
    const rng = seededRandom(cfg.tid);
    this.tint = { dh: (rng() - 0.5) * 0.03, dl: (rng() - 0.5) * 0.08 };

    // Materials. Skin stays its own material per person (an anomaly recolours Mom's); every
    // garment is woven cloth (fabric), shared with anyone wearing the same thing.
    const skMat = new THREE.MeshLambertMaterial({ color: cfg.skin });
    skMat.name = 'Skin_Mat';
    const clothMat = this.fabric(cfg.shirt);
    const pantsMat = this.fabric(cfg.pants);
    const hairMat = new THREE.MeshLambertMaterial({ color: cfg.hair });
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0x18181a });
    const eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x111113 });
    const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xe6e3dc });

    if (cfg.archetype) {
      this.buildArchetypeBody(g, cfg, skMat, up);
    } else {
      // Torso / Jacket
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.52, 0.24), clothMat);
      torso.position.set(0, 0.78 + up, 0);
      g.add(torso);

      // Collar / Scarf accent
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.22), clothMat);
      collar.position.set(0, 1.02 + up, 0);
      g.add(collar);

      // Shoulders
      const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.44, 8), clothMat);
      shoulders.rotation.z = Math.PI / 2;
      shoulders.position.set(0, 0.98 + up, 0);
      g.add(shoulders);

      // Legs / Pants
      if (cfg.standing) {
        [-0.09, 0.09].forEach((dx) => {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.84, 0.15), pantsMat);
          leg.position.set(dx, 0.42, 0);
          g.add(leg);

          const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.26), shoeMat);
          shoe.position.set(dx, 0.04, 0.05);
          g.add(shoe);
        });
      } else {
        // Seated hips and thighs
        const lap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.44), pantsMat);
        lap.position.set(0, 0.55, 0.2);
        g.add(lap);

        [-0.1, 0.1].forEach((dx) => {
          const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.48, 0.13), pantsMat);
          shin.position.set(dx, 0.25, 0.38);
          g.add(shin);

          const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.24), shoeMat);
          shoe.position.set(dx, 0.04, 0.45);
          g.add(shoe);
        });
      }

      // Arms. The forearm runs from the elbow to the wrist and the hand is its child, at its
      // end, so the two always touch. With a phone the hands meet to hold it.
      [-1, 1].forEach((s) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.1), clothMat);
        arm.position.set(s * 0.24, 0.86 + up, 0.02);
        g.add(arm);

        const elbow = new THREE.Vector3(s * 0.235, 0.71 + up, 0.03);
        const wrist = cfg.phone ? new THREE.Vector3(s * 0.085, 0.71 + up, 0.27) : new THREE.Vector3(s * 0.165, 0.69 + up, 0.27);
        const forearm = this.limb(g, elbow, wrist, 0.08, 0.08, clothMat);
        const len = elbow.distanceTo(wrist);
        const hand = this.box(forearm, 0.07, 0.085, 0.065, skMat, 0, len / 2 + 0.04, 0);
        // Thumb on the inside, toward the phone or the other knee.
        this.box(hand, 0.022, 0.04, 0.03, skMat, -s * 0.04, 0.005, 0.02);
      });

      // Neck
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8), skMat);
      neck.position.set(0, 1.07 + up, 0);
      g.add(neck);
    }

    // Articulated Head
    const head = new THREE.Group();
    head.name = 'Head';
    head.rotation.order = 'YXZ';
    head.position.set(0, 1.22 + up, 0);
    g.add(head);

    // Cranium
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.112, 16, 14), skMat);
    skull.scale.set(0.92, 1.08, 1.02);
    head.add(skull);

    // Hair
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hair.position.set(0, 0.02, -0.015);
    hair.rotation.x = -0.22;
    head.add(hair);

    if (cfg.longHair) {
      const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.12), hairMat);
      hairBack.position.set(0, -0.08, -0.08);
      head.add(hairBack);
      // Side lengths, narrower and a little forward, so it isn't a flat panel from the side.
      [-1, 1].forEach((s) => {
        const side = this.box(head, 0.035, 0.26, 0.1, hairMat, s * 0.112, -0.06, -0.015);
        side.rotation.z = s * 0.06;
      });
    }

    // Stylized facial features: Nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 4), skMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.01, 0.114);
    head.add(nose);

    // Mouth / subtle lip line
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.015), new THREE.MeshLambertMaterial({ color: 0x6e3832 }));
    mouth.position.set(0, -0.054, 0.102);
    head.add(mouth);
    // A faint jaw line under it, so the face doesn't read as a mask. Subtle: anomalies change faces.
    // A translucent shade rather than a colour, so it follows the skin if an anomaly changes it.
    this.box(head, 0.11, 0.012, 0.07, CharacterBuilder.jawShade, 0, -0.096, 0.05);

    // Eyes
    const eyes: THREE.Mesh[] = [];
    [-0.038, 0.038].forEach((ex) => {
      // Set into the face rather than stuck on it: a smaller white, the pupil just proud of it.
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), eyeWhiteMat);
      eyeWhite.scale.set(1.0, 0.68, 0.55);
      eyeWhite.position.set(ex, 0.016, 0.094);
      head.add(eyeWhite);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 8, 6), eyePupilMat);
      pupil.name = ex < 0 ? 'Pupil_L' : 'Pupil_R';
      pupil.position.set(ex, 0.016, 0.1);
      head.add(pupil);
      eyes.push(pupil);
    });

    // Glasses for Dad
    if (cfg.glasses) {
      const glassFrameMat = new THREE.MeshBasicMaterial({ color: 0x222225 });
      [-0.038, 0.038].forEach((gx) => {
        const rim = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 12), glassFrameMat);
        rim.position.set(gx, 0.016, 0.109);
        head.add(rim);
        // Arms back to the ears, so the frames sit on the head from the side too.
        this.box(head, 0.006, 0.006, 0.09, glassFrameMat, Math.sign(gx) * 0.1, 0.018, 0.065);
      });
      // A bridge over the nose that joins the two rims.
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.007, 0.01), glassFrameMat);
      bridge.position.set(0, 0.02, 0.111);
      head.add(bridge);
    }

    if (cfg.archetype) this.addHeadwear(head, cfg.archetype, hairMat);

    // Smartphone: a thin dark slab held in both hands, its lit screen tipped up and out over the lap.
    let phone: THREE.Object3D | null = null;
    if (cfg.phone) {
      const phoneGroup = this.makePhone(0x1b1d20);
      phoneGroup.name = 'Phone';
      phoneGroup.position.set(0, 0.735 + up, 0.3);
      // Tipped the same way as before §5 (screen up and toward the aisle), so from your seat you see
      // the lit screen between the hands. Mom's pale-skin anomaly hides her phone, and that only reads
      // as a tell if the phone is plain to see; turned toward her face it was a dark slab you missed.
      phoneGroup.rotation.x = -0.92;
      g.add(phoneGroup);
      phone = phoneGroup;
    }

    // One material per look, shared by everyone (skin excepted: an anomaly recolours Mom's).
    this.shareMaterials(g, skMat);
    // Fewer draw calls: the static parts of the body, and of the head, merged per material.
    // Left alone: the pupils (they're scaled), the phone and any prop with a habit (they move).
    this.mergeStatic(g, new Set<THREE.Object3D>([head, ...(phone ? [phone] : []), ...eyes]));
    this.mergeStatic(head, new Set<THREE.Object3D>(eyes));

    // Position and orientation
    g.position.set(cfg.x, 0, cfg.z);
    g.rotation.y = cfg.ry || 0;

    const person: PersonObject = {
      g,
      head,
      phone,
      eyes,
      skMat,
      skin: cfg.skin,
      tid: cfg.tid,
      label: cfg.label,
      home: new THREE.Vector3(cfg.x, 0, cfg.z),
      pose: [cfg.hy || 0, cfg.hp || 0],
      archetype: cfg.archetype,
      standing: !!cfg.standing,
    };

    head.rotation.set(person.pose[1], person.pose[0], 0);
    modelLoader.bindPerson(person, cfg);
    return person;
  }

  /**
   * Builds a standalone uncanny anomaly head/neck overlay mesh for Blender `.glb` export & runtime use.
   */
  public createAnomalyOverlay(kind: 'anomaly_faceless' | 'anomaly_stretched'): THREE.Group {
    const g = new THREE.Group();
    g.name = kind;
    const paleSkin = new THREE.MeshLambertMaterial({ color: 0xdfd9ce });
    paleSkin.name = 'Skin_Mat';
    const hollowMat = new THREE.MeshBasicMaterial({ color: 0x080709 });
    hollowMat.name = 'Hollow_Socket_Mat';

    if (kind === 'anomaly_faceless') {
      [-0.038, 0.038].forEach((ex, idx) => {
        const socket = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.035, 10), hollowMat);
        socket.name = idx === 0 ? 'Socket_L' : 'Socket_R';
        socket.position.set(ex, 0.016, 0.103);
        g.add(socket);
      });
      const blankMask = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.026, 0.018), paleSkin);
      blankMask.name = 'Faceless_Seal';
      blankMask.position.set(0, -0.054, 0.104);
      g.add(blankMask);
    } else {
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.052 - i * 0.004, 0.058 - i * 0.003, 0.056, 8),
          paleSkin
        );
        seg.name = `Neck_Vertebra_${i + 1}`;
        seg.position.set(0, -0.11 - i * 0.042, -0.01 * i);
        seg.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.14;
        g.add(seg);
      }
    }
    return g;
  }

  // ---------------------------------------------------------------------------
  // Archetype passengers: same blocky language as the rest of the car, but with a
  // tapered torso, shoulder caps, a box neck, jointed hands, and an outfit that reads
  // by silhouette (long coat + bag, hi-vis vest + hard hat, puffer + headphones).
  // Built facing +Z with feet on the floor, seated by default, raised by `up` when standing.
  // ---------------------------------------------------------------------------

  private static grain: THREE.CanvasTexture | null = null;

  private static jawShade = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });

  /** This passenger's cloth variation (set at the top of createPerson). */
  private tint = { dh: 0, dl: 0 };
  /** Cloth materials by final colour, shared across passengers. */
  private static cloth = new Map<number, THREE.MeshLambertMaterial>();

  /** Woven cloth in `color`, nudged by this passenger's tint. */
  private fabric(color: number): THREE.MeshLambertMaterial {
    if (!CharacterBuilder.grain && typeof document !== 'undefined') {
      CharacterBuilder.grain = new TextureGenerator().createClothGrainTexture();
    }
    const c = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL((hsl.h + this.tint.dh + 1) % 1, hsl.s, Math.min(1, hsl.l * (1 + this.tint.dl)));
    const hex = c.getHex();
    let m = CharacterBuilder.cloth.get(hex);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: hex, map: CharacterBuilder.grain });
      CharacterBuilder.cloth.set(hex, m);
    }
    return m;
  }

  /** Materials by look, shared across every passenger. */
  private static looks = new Map<string, THREE.Material>();

  /** Swap each material under `root` for the shared one that looks the same. */
  private shareMaterials(root: THREE.Object3D, keep: THREE.Material) {
    const key = (m: THREE.Material) => {
      const a = m as THREE.MeshPhongMaterial;
      return [m.type, a.color?.getHex(), a.emissive?.getHex(), a.emissiveIntensity, a.map?.uuid, m.transparent, m.opacity, m.blending, m.depthWrite, a.shininess, a.specular?.getHex(), m.side, m.alphaTest].join('|');
    };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material === keep) return;
      const k = key(mesh.material);
      const shared = CharacterBuilder.looks.get(k);
      if (!shared) CharacterBuilder.looks.set(k, mesh.material);
      else if (shared !== mesh.material) {
        mesh.material.dispose();
        mesh.material = shared;
      }
    });
  }

  /** A phone: dark body, a lit screen inset a hair from its edges, and a faint glow on the hands. */
  private makePhone(body: number): THREE.Group {
    const phone = new THREE.Group();
    this.box(phone, 0.074, 0.145, 0.011, new THREE.MeshLambertMaterial({ color: body }), 0, 0, 0);
    // Self-lit at full strength so it reads from across the car under any lighting, as on main.
    const screenMat = new THREE.MeshLambertMaterial({ color: 0x0b1018, emissive: 0xb5d4ff, emissiveIntensity: 1 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.132), screenMat);
    screen.position.z = 0.0058;
    phone.add(screen);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x6f9fd6, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    glow.position.z = 0.009;
    phone.add(glow);
    return phone;
  }

  /**
   * Merge the static meshes under `root` into one mesh per material (same look, far fewer draw
   * calls). Children in `skip`, and anything with a carLife habit, keep their own meshes.
   */
  private mergeStatic(root: THREE.Object3D, skip: Set<THREE.Object3D>) {
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (skip.has(c) || c.userData.habit) continue;
        const m = c as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material)) {
          const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
          const g = groups.get(m.material) ?? { geos: [], meshes: [] };
          g.geos.push(geo);
          g.meshes.push(m);
          groups.set(m.material, g);
        }
        walk(c);
      }
    };
    walk(root);
    for (const [mat, { geos, meshes }] of groups) {
      if (meshes.length < 2) {
        geos.forEach((g) => g.dispose());
        continue;
      }
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of meshes) {
        // Keep anything a merged mesh carries that isn't merged itself (a prop on a hand).
        for (const child of [...m.children]) {
          if (skip.has(child) || child.userData.habit) root.attach(child);
        }
        m.removeFromParent();
        m.geometry.dispose();
      }
      const mergedMesh = new THREE.Mesh(merged, mat);
      if (mat.name === 'Skin_Mat') {
        mergedMesh.name = root.name === 'Head' ? 'Head_Skin' : 'Body_Skin';
      }
      root.add(mergedMesh);
    }
  }

  private box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** Legs, hips and shoes for either pose. */
  private addLegs(g: THREE.Group, standing: boolean, pantsMat: THREE.Material, shoeMat: THREE.Material, shoeScale = 1, soleMat?: THREE.Material, legScale = 1) {
    const sw = 0.13 * shoeScale;
    const sh = 0.08 * shoeScale;
    const L = legScale;
    if (standing) {
      this.box(g, 0.34 * Math.min(L, 1.06), 0.16, 0.22 * L, pantsMat, 0, 0.9, 0);
      [-0.09, 0.09].forEach((dx) => {
        this.box(g, 0.15 * L, 0.44, 0.16 * L, pantsMat, dx, 0.62, 0);
        // Baggy legs flare a little at the ankle.
        this.box(g, 0.13 * L * L, 0.42, 0.14 * L * L, pantsMat, dx, 0.25 + (L > 1 ? 0.02 : 0), 0.005);
        this.box(g, sw, sh, 0.27, shoeMat, dx, sh / 2, 0.05);
        if (soleMat) this.box(g, sw + 0.006, 0.025, 0.275, soleMat, dx, 0.0125, 0.05);
      });
    } else {
      this.box(g, 0.35 * Math.min(L, 1.06), 0.15 * L, 0.44, pantsMat, 0, 0.55, 0.2);
      [-0.1, 0.1].forEach((dx) => {
        this.box(g, 0.13 * L, 0.48, 0.13 * L, pantsMat, dx, 0.25, 0.38);
        this.box(g, sw * 0.95, sh, 0.25, shoeMat, dx, sh / 2, 0.45);
        if (soleMat) this.box(g, sw * 0.95 + 0.006, 0.025, 0.255, soleMat, dx, 0.0125, 0.45);
      });
    }
  }

  /** Tapered two-block torso with shoulder caps. Returns the front face z. */
  private addTorso(g: THREE.Group, up: number, tw: number, td: number, mat: THREE.Material): number {
    this.box(g, tw, 0.3, td, mat, 0, 0.89 + up, 0);
    this.box(g, tw * 0.86, 0.25, td * 0.92, mat, 0, 0.625 + up, 0);
    [-1, 1].forEach((s) => {
      const cap = this.box(g, 0.12, 0.1, td * 0.92, mat, s * (tw / 2 - 0.01), 0.995 + up, 0);
      cap.rotation.z = s * -0.18;
    });
    return td / 2;
  }

  /**
   * One arm: 'lap' rests the forearm forward like the original passengers,
   * 'down' hangs at the side (for carrying). Returns the hand mesh.
   */
  private addArm(g: THREE.Group, s: number, pose: 'lap' | 'down', up: number, ax: number, sleeve: THREE.Material, skMat: THREE.Material, thick = 1, cuff?: THREE.Material, reach = 0, splay = 0): THREE.Mesh {
    const t = thick;
    if (pose === 'lap') {
      this.box(g, 0.095 * t, 0.32, 0.105 * t, sleeve, s * ax, 0.85 + up, 0.02);
      this.box(g, 0.085 * t, 0.085 * t, 0.25, sleeve, s * (ax - 0.035), 0.69 + up, 0.15);
      if (cuff) this.box(g, 0.09 * t, 0.09 * t, 0.03, cuff, s * (ax - 0.04), 0.69 + up, 0.27);
      const hand = this.box(g, 0.075, 0.045, 0.09, skMat, s * (ax - 0.07), 0.69 + up, 0.315);
      this.box(g, 0.025, 0.03, 0.045, skMat, s * (ax - 0.07) - s * 0.045, 0.7 + up, 0.29);
      return hand;
    }
    // Straight arm on a shoulder pivot, tipped forward by `reach` (radians).
    const pivot = new THREE.Group();
    pivot.position.set(s * ax, 1.0 + up, 0);
    pivot.rotation.x = -reach;
    pivot.rotation.z = s * splay;
    g.add(pivot);
    this.box(pivot, 0.095 * t, 0.32, 0.105 * t, sleeve, 0, -0.16, 0);
    this.box(pivot, 0.085 * t, 0.26, 0.09 * t, sleeve, 0, -0.43, 0);
    if (cuff) this.box(pivot, 0.09 * t, 0.03, 0.095 * t, cuff, 0, -0.555, 0);
    const hand = this.box(pivot, 0.065, 0.09, 0.08, skMat, 0, -0.61, 0);
    this.box(pivot, 0.022, 0.04, 0.03, skMat, -s * 0.04, -0.6, 0.025);
    return hand;
  }

  /** Resting arm: forearm on the lap when seated, hanging loose at the side when standing. */
  private restArm(g: THREE.Group, s: number, standing: boolean, up: number, ax: number, sleeve: THREE.Material, skMat: THREE.Material, thick = 1, cuff?: THREE.Material, splay = 0.05): THREE.Mesh {
    return standing ? this.addArm(g, s, 'down', up, ax, sleeve, skMat, thick, cuff, 0.04, splay) : this.addArm(g, s, 'lap', up, ax, sleeve, skMat, thick, cuff);
  }

  /** A box stretched between two points (for bent limbs and straps). */
  private limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, dir.length(), d), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    parent.add(m);
    return m;
  }

  /** Backpack: straps over the front of the shoulders; the pack sits on the back standing, on the floor by the right foot seated. */
  private addBackpack(g: THREE.Group, standing: boolean, up: number, tw: number, td: number, packMat: THREE.Material, strapMat: THREE.Material) {
    const front = td / 2;
    if (standing) {
      [-1, 1].forEach((s) => {
        this.box(g, 0.04, 0.3, 0.012, strapMat, s * tw * 0.27, 0.86 + up, front + 0.008);
        this.box(g, 0.04, 0.012, td + 0.02, strapMat, s * tw * 0.27, 1.02 + up, 0);
      });
      this.box(g, tw * 0.72, 0.38, 0.14, packMat, 0, 0.8 + up, -front - 0.07);
      this.box(g, tw * 0.6, 0.15, 0.04, packMat, 0, 0.72 + up, -front - 0.155);
      this.box(g, tw * 0.6, 0.012, 0.045, strapMat, 0, 0.8 + up, -front - 0.155);
    } else {
      // Seated, the straps hang loose and the pack leans against the right shin.
      const pack = new THREE.Group();
      this.box(pack, 0.28, 0.36, 0.13, packMat, 0, 0.18, 0);
      this.box(pack, 0.22, 0.14, 0.04, packMat, 0, 0.11, 0.08);
      this.box(pack, 0.22, 0.012, 0.045, strapMat, 0, 0.19, 0.08);
      pack.position.set(0.33, 0, 0.42);
      pack.rotation.set(-0.12, -0.5, 0);
      g.add(pack);
    }
  }

  private buildArchetypeBody(g: THREE.Group, cfg: PersonConfig, skMat: THREE.Material, up: number) {
    const standing = !!cfg.standing;
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0x18181a });
    // Box neck, a touch longer than the mannequin's.
    this.box(g, 0.085, 0.12, 0.085, skMat, 0, 1.075 + up, 0);

    if (cfg.archetype === 'coat') {
      // Burgundy knee-length wool coat, belted, with lapels; shopping bag in the right hand.
      const coat = this.fabric(0x5e1f2a);
      const trim = this.fabric(0x431620);
      const under = this.fabric(cfg.shirt);
      const tw = 0.4;
      const td = 0.26;
      const front = this.addTorso(g, up, tw, td, coat);
      this.addLegs(g, standing, this.fabric(cfg.pants), shoeMat);
      // Shirt showing in the V, lapels over it, raised collar.
      this.box(g, 0.1, 0.12, 0.01, under, 0, 0.97 + up, front + 0.002);
      [-1, 1].forEach((s) => {
        const lapel = this.box(g, 0.075, 0.22, 0.02, trim, s * 0.06, 0.93 + up, front + 0.006);
        lapel.rotation.z = s * 0.32;
      });
      this.box(g, 0.3, 0.08, td + 0.01, trim, 0, 1.04 + up, -0.01);
      // Belt and buttons.
      this.box(g, tw * 0.86 + 0.01, 0.035, td * 0.92 + 0.01, trim, 0, 0.7 + up, 0);
      this.box(g, 0.022, 0.022, 0.01, shoeMat, 0.05, 0.8 + up, front + 0.005);
      this.box(g, 0.022, 0.022, 0.01, shoeMat, 0.05, 0.6 + up, td * 0.46 + 0.005);
      // Coat skirt: a slightly flared block down to the knees standing, draped over the lap seated.
      if (standing) {
        const geo = new THREE.CylinderGeometry(0.707, 0.8, 1, 4, 1);
        geo.rotateY(Math.PI / 4);
        const skirt = new THREE.Mesh(geo, coat);
        skirt.scale.set(0.4, 0.58, 0.27);
        skirt.position.set(0, 0.73, 0);
        g.add(skirt);
        this.box(g, 0.012, 0.56, 0.01, trim, 0.03, 0.73, 0.156);
      } else {
        this.box(g, 0.4, 0.06, 0.47, coat, 0, 0.645, 0.2);
        this.box(g, 0.39, 0.2, 0.04, coat, 0, 0.53, 0.44);
        [-1, 1].forEach((s) => this.box(g, 0.03, 0.2, 0.4, coat, s * 0.2, 0.53, 0.15));
      }
      // Arms: left on the lap (loose at her side standing), right hanging with the tote.
      const ax = tw / 2 + 0.05;
      this.restArm(g, -1, standing, up, ax, coat, skMat, 1, trim);
      // Standing the bag hangs at her side; seated it rests on the floor by her right shin.
      const reach = standing ? 0 : 0.57;
      this.addArm(g, 1, 'down', up, ax, coat, skMat, 1, trim, reach);
      // Cream canvas tote with long canvas straps, hanging from the right hand.
      const bag = new THREE.Group();
      const canvas = this.fabric(0xc9c0a3);
      const strap = this.fabric(0x9e9579);
      this.box(bag, 0.06, 0.32, 0.3, canvas, 0, -0.2, 0);
      this.box(bag, 0.062, 0.03, 0.302, strap, 0, -0.355, 0);
      [-1, 1].forEach((s) => {
        this.limb(bag, new THREE.Vector3(0, 0.1, s * 0.012), new THREE.Vector3(0, -0.045, s * 0.09), 0.016, 0.02, strap);
        this.box(bag, 0.064, 0.2, 0.022, strap, 0, -0.14, s * 0.09);
      });
      bag.position.set(ax + 0.03, 1.0 + up - 0.61 * Math.cos(reach) - 0.1, 0.61 * Math.sin(reach));
      g.add(bag);
      return;
    }

    if (cfg.archetype === 'mta') {
      // MTA maintenance: navy work uniform, orange hi-vis vest with reflective bands, tool belt.
      const navy = this.fabric(0x1e283a);
      const navyPants = this.fabric(0x1b2230);
      const vest = this.fabric(0xe8892e);
      vest.emissive.setHex(0x2a1406); // hi-vis fabric glows a little under the fluorescents
      const reflect = new THREE.MeshLambertMaterial({ color: 0xe4e6cf, emissive: 0x55574a });
      const tw = 0.4;
      const td = 0.25;
      const front = this.addTorso(g, up, tw, td, navy);
      this.addLegs(g, standing, navyPants, new THREE.MeshLambertMaterial({ color: 0x2a2119 }), 1.15);
      // Vest shell over chest and waist (sleeveless, so the navy sleeves and collar show).
      this.box(g, tw + 0.02, 0.29, td + 0.02, vest, 0, 0.88 + up, 0);
      this.box(g, tw * 0.86 + 0.02, 0.25, td * 0.92 + 0.02, vest, 0, 0.625 + up, 0);
      this.box(g, 0.13, 0.12, 0.012, navy, 0, 0.97 + up, front + 0.012);
      // Reflective bands: two around the body, two up over the shoulders front and back.
      this.box(g, tw + 0.03, 0.035, td + 0.03, reflect, 0, 0.8 + up, 0);
      this.box(g, tw * 0.86 + 0.03, 0.035, td * 0.92 + 0.03, reflect, 0, 0.62 + up, 0);
      [-1, 1].forEach((s) => {
        [1, -1].forEach((side) => this.box(g, 0.035, 0.26, 0.006, reflect, s * 0.1, 0.9 + up, side * (front + 0.014)));
      });
      // Collar, radio on the chest, tool belt with a pouch.
      this.box(g, 0.24, 0.07, td, navy, 0, 1.035 + up, -0.005);
      this.box(g, 0.05, 0.08, 0.03, shoeMat, -0.11, 0.93 + up, front + 0.025);
      this.box(g, 0.012, 0.06, 0.012, shoeMat, -0.125, 1.0 + up, front + 0.025);
      const leather = new THREE.MeshLambertMaterial({ color: 0x2b241c });
      this.box(g, tw * 0.86 + 0.035, 0.05, td * 0.92 + 0.035, leather, 0, 0.52 + up, 0);
      this.box(g, 0.07, 0.09, 0.08, leather, 0.19, 0.49 + up, 0.04);
      const ax = tw / 2 + 0.05;
      [-1, 1].forEach((s) => this.restArm(g, s, standing, up, ax, navy, skMat));
      return;
    }

    if (cfg.archetype === 'office') {
      // Office worker: light grey dress shirt, dark tie, dark trousers, messenger bag, folded newspaper.
      const shirt = this.fabric(0xa9aca9);
      const shirtShade = this.fabric(0x8d908e);
      const tie = new THREE.MeshLambertMaterial({ color: 0x1f2531 });
      const trousers = this.fabric(0x26282d);
      const leather = new THREE.MeshLambertMaterial({ color: 0x3a2d22 });
      const paper = new THREE.MeshLambertMaterial({ color: 0xcdc8b6 });
      const ink = new THREE.MeshLambertMaterial({ color: 0x3b3a37 });
      const tw = 0.38;
      const td = 0.23;
      const front = this.addTorso(g, up, tw, td, shirt);
      this.addLegs(g, standing, trousers, shoeMat, 1.05);
      // Collar points, knot, and a tie that narrows at the waist.
      [-1, 1].forEach((s) => {
        const pt = this.box(g, 0.06, 0.035, 0.012, shirtShade, s * 0.035, 1.03 + up, front + 0.004);
        pt.rotation.z = s * 0.5;
      });
      this.box(g, 0.13, 0.05, td * 0.7, shirt, 0, 1.04 + up, -0.01);
      this.box(g, 0.035, 0.035, 0.015, tie, 0, 1.0 + up, front + 0.008);
      this.box(g, 0.045, 0.2, 0.008, tie, 0, 0.88 + up, front + 0.006);
      const tip = this.box(g, 0.032, 0.032, 0.008, tie, 0, 0.775 + up, front + 0.006);
      tip.rotation.z = Math.PI / 4;
      this.box(g, tw * 0.86 + 0.01, 0.035, td * 0.92 + 0.01, trousers, 0, 0.52 + up, 0);
      const ax = tw / 2 + 0.05;
      // Messenger bag: strap from the left shoulder across to the right hip.
      this.limb(g, new THREE.Vector3(-0.12, 1.03 + up, front + 0.01), new THREE.Vector3(0.17, 0.6 + up, front + 0.01), 0.035, 0.01, leather);
      this.limb(g, new THREE.Vector3(-0.12, 1.03 + up, -front - 0.01), new THREE.Vector3(0.17, 0.6 + up, -front - 0.01), 0.035, 0.01, leather);
      if (standing) {
        this.box(g, 0.07, 0.24, 0.3, leather, ax + 0.06, 0.52 + up, -0.02);
        this.box(g, 0.075, 0.1, 0.305, this.fabric(0x2c2219), ax + 0.06, 0.6 + up, -0.02);
        // Arms loose; the folded paper is tucked in the left hand.
        this.restArm(g, 1, standing, up, ax, shirt, skMat, 1, shirtShade, 0.12);
        const hand = this.restArm(g, -1, standing, up, ax, shirt, skMat, 1, shirtShade, 0.05);
        const fold = new THREE.Group();
        this.box(fold, 0.03, 0.26, 0.17, paper, 0, 0, 0);
        [1, -1].forEach((side) => {
          this.box(fold, 0.004, 0.045, 0.13, ink, side * 0.016, 0.08, 0.0);
          [0.02, -0.02, -0.06].forEach((y) => this.box(fold, 0.004, 0.012, 0.13, ink, side * 0.016, y, 0));
        });
        fold.position.set(0.0, -0.06, 0.07);
        fold.rotation.set(0.15, -0.9, 0);
        fold.name = 'HabitProp_paper';
        fold.userData.habit = 'paper'; // carLife: turns a page now and then
        hand.add(fold);
      } else {
        // Seated: bag on the bench by his hip, reading the folded paper over his lap.
        this.box(g, 0.08, 0.24, 0.3, leather, -(tw / 2 + 0.18), 0.62, 0.05);
        [-1, 1].forEach((s) => this.addArm(g, s, 'lap', up, ax - 0.03, shirt, skMat, 1, shirtShade));
        const read = new THREE.Group();
        this.box(read, 0.3, 0.2, 0.012, paper, 0, 0, 0);
        this.box(read, 0.26, 0.04, 0.014, ink, 0, 0.065, 0);
        [-0.06, 0.06].forEach((x) => [0.0, -0.035, -0.07].forEach((y) => this.box(read, 0.11, 0.01, 0.014, ink, x, y, 0)));
        read.position.set(0, 0.79, 0.37);
        read.rotation.x = -0.55;
        read.name = 'HabitProp_paper';
        read.userData.habit = 'paper'; // carLife: turns a page now and then
        g.add(read);
      }
      return;
    }

    if (cfg.archetype === 'hoodie') {
      // Teen: dark navy hoodie with drawstrings and pouch, baggy light-wash jeans, white sneakers, backpack.
      const hood = this.fabric(0x222a3d);
      const hoodShade = this.fabric(0x1a2030);
      const cord = new THREE.MeshLambertMaterial({ color: 0xd6d3c8 });
      const tw = 0.42;
      const td = 0.27;
      const front = this.addTorso(g, up, tw, td, hood);
      // Ribbed hem and a kangaroo pouch.
      this.box(g, tw * 0.86 + 0.02, 0.05, td * 0.92 + 0.02, hoodShade, 0, 0.525 + up, 0);
      this.box(g, 0.24, 0.12, 0.014, hoodShade, 0, 0.64 + up, td * 0.46 + 0.006);
      // Hood bunched behind the neck, drawstrings down the chest.
      this.box(g, 0.28, 0.13, 0.12, hood, 0, 1.08 + up, -0.09);
      this.box(g, 0.26, 0.06, 0.24, hood, 0, 1.05 + up, 0);
      [-1, 1].forEach((s) => {
        this.box(g, 0.012, 0.15, 0.012, cord, s * 0.04, 0.95 + up, front + 0.008);
        this.box(g, 0.018, 0.025, 0.018, cord, s * 0.04, 0.87 + up, front + 0.008);
      });
      this.addLegs(g, standing, this.fabric(0x7a8ba1), new THREE.MeshLambertMaterial({ color: 0xdedbd2 }), 1.15, new THREE.MeshLambertMaterial({ color: 0xf1efe8 }), 1.18);
      this.addBackpack(g, standing, up, tw, td, this.fabric(0x2b2b2e), new THREE.MeshLambertMaterial({ color: 0x141416 }));
      const ax = tw / 2 + 0.055;
      [-1, 1].forEach((s) => this.restArm(g, s, standing, up, ax, hood, skMat, 1.12, hoodShade, 0.06));
      return;
    }

    if (cfg.archetype === 'texter') {
      // Young woman: navy puffer, phone held up in front of her chest, backpack, baggy light jeans, white sneakers.
      const shell = this.fabric(0x283148);
      const seam = new THREE.MeshLambertMaterial({ color: 0x151a27 });
      const tw = 0.44;
      const td = 0.3;
      this.box(g, tw - 0.05, 0.54, td - 0.05, seam, 0, 0.78 + up, 0);
      [0.575, 0.705, 0.835, 0.965].forEach((by, i) => {
        const shrink = i === 0 ? 0.05 : i % 2 ? 0 : 0.015;
        this.box(g, tw - shrink, 0.118, td - shrink, shell, 0, by + up, 0);
      });
      [-1, 1].forEach((s) => {
        const cap = this.box(g, 0.13, 0.12, td * 0.9, shell, s * (tw / 2 - 0.02), 0.99 + up, 0);
        cap.rotation.z = s * -0.15;
      });
      this.box(g, 0.25, 0.1, 0.25, shell, 0, 1.07 + up, -0.01);
      this.box(g, 0.012, 0.54, 0.006, seam, 0, 0.78 + up, td / 2 + 0.004);
      this.addLegs(g, standing, this.fabric(0x9aa6b4), new THREE.MeshLambertMaterial({ color: 0xdfdcd3 }), 1.1, new THREE.MeshLambertMaterial({ color: 0xf1efe8 }), 1.1);
      this.addBackpack(g, standing, up, tw, td, this.fabric(0x3a3633), new THREE.MeshLambertMaterial({ color: 0x18171a }));
      // Arms bent up, both hands meeting at the phone in front of her chest.
      const ax = tw / 2 + 0.05;
      const t = 1.3;
      const hy = 0.86 + up;
      const hz = td / 2 + 0.13;
      [-1, 1].forEach((s) => {
        const sh = new THREE.Vector3(s * ax, 1.0 + up, 0);
        const el = new THREE.Vector3(s * (ax + 0.01), 0.74 + up, 0.03);
        const wr = new THREE.Vector3(s * 0.06, hy - 0.02, hz - 0.03);
        this.limb(g, sh, el, 0.095 * t, 0.105 * t, shell);
        this.limb(g, el, wr, 0.085 * t, 0.085 * t, shell);
        this.box(g, 0.05, 0.08, 0.06, skMat, s * 0.045, hy, hz);
      });
      const phone = new THREE.Group();
      const handset = this.makePhone(0xb79a96);
      handset.rotation.y = Math.PI; // screen toward her
      phone.add(handset);
      phone.position.set(0, hy + 0.03, hz + 0.01);
      phone.rotation.x = -0.35;
      phone.name = 'HabitProp_phone';
      phone.userData.habit = 'phone'; // carLife: thumb-scroll flicks
      g.add(phone);
      return;
    }

    if (cfg.archetype === 'overcoat') {
      // Long warm charcoal-brown overcoat to the knees, near-black turtleneck, dark trousers. Built to stand very still.
      // Lifted just enough to read under the car lights while staying the most sombre passenger.
      const coat = this.fabric(0x726256);
      const trim = this.fabric(0x5a4c42);
      const knit = new THREE.MeshLambertMaterial({ color: 0x26262a });
      const tw = 0.43;
      const td = 0.27;
      const front = this.addTorso(g, up, tw, td, coat);
      this.addLegs(g, standing, this.fabric(0x3a3a40), new THREE.MeshLambertMaterial({ color: 0x242427 }), 1.05);
      // Turtleneck rolled up the neck, showing down the open front of the coat.
      this.box(g, 0.115, 0.1, 0.115, knit, 0, 1.065 + up, 0);
      this.box(g, 0.12, 0.38, 0.012, knit, 0, 0.84 + up, front + 0.002);
      // Wide notched lapels and a stand collar.
      [-1, 1].forEach((s) => {
        const lapel = this.box(g, 0.09, 0.3, 0.022, trim, s * 0.085, 0.88 + up, front + 0.008);
        lapel.rotation.z = s * 0.22;
        const notch = this.box(g, 0.07, 0.05, 0.022, trim, s * 0.13, 1.0 + up, front + 0.01);
        notch.rotation.z = s * -0.5;
      });
      this.box(g, 0.32, 0.08, td + 0.01, trim, 0, 1.04 + up, -0.015);
      [0.66, 0.56].forEach((by) => this.box(g, 0.022, 0.022, 0.01, knit, 0.1, by + up, td * 0.46 + 0.005));
      if (standing) {
        const geo = new THREE.CylinderGeometry(0.707, 0.76, 1, 4, 1);
        geo.rotateY(Math.PI / 4);
        const skirt = new THREE.Mesh(geo, coat);
        skirt.scale.set(0.44, 0.68, 0.29);
        skirt.position.set(0, 0.68, 0);
        g.add(skirt);
        // Front opening and back vent.
        this.box(g, 0.012, 0.66, 0.01, trim, 0.0, 0.68, 0.152);
        this.box(g, 0.012, 0.3, 0.01, trim, 0.0, 0.5, -0.152);
      } else {
        this.box(g, 0.44, 0.06, 0.48, coat, 0, 0.645, 0.2);
        this.box(g, 0.43, 0.3, 0.04, coat, 0, 0.48, 0.45);
        [-1, 1].forEach((s) => this.box(g, 0.03, 0.26, 0.42, coat, s * 0.22, 0.5, 0.16));
        this.box(g, 0.012, 0.3, 0.045, trim, 0.0, 0.48, 0.455);
      }
      // Arms straight down (standing) or hands flat on the knees (seated). No props, nothing moving.
      const ax = tw / 2 + 0.05;
      [-1, 1].forEach((s) => this.restArm(g, s, standing, up, ax, coat, skMat, 1.05, trim, 0.02));
      return;
    }

    // 'puffer': bulky quilted jacket (wider, deeper torso), jeans, light sneakers.
    const shell = this.fabric(0x557a70);
    const seam = new THREE.MeshLambertMaterial({ color: 0x23332f });
    const tw = 0.48;
    const td = 0.32;
    this.box(g, tw - 0.05, 0.56, td - 0.05, seam, 0, 0.78 + up, 0);
    // Four horizontal baffles with dark seams between them.
    [0.565, 0.7, 0.835, 0.97].forEach((by, i) => {
      const shrink = i === 0 ? 0.05 : i % 2 ? 0 : 0.015;
      this.box(g, tw - shrink, 0.122, td - shrink, shell, 0, by + up, 0);
    });
    [-1, 1].forEach((s) => {
      const cap = this.box(g, 0.14, 0.13, td * 0.9, shell, s * (tw / 2 - 0.02), 0.995 + up, 0);
      cap.rotation.z = s * -0.15;
    });
    // High puffy collar and zip.
    this.box(g, 0.27, 0.11, 0.27, shell, 0, 1.08 + up, -0.01);
    this.box(g, 0.012, 0.56, 0.006, seam, 0, 0.78 + up, td / 2 + 0.004);
    this.addLegs(g, standing, this.fabric(0x3a4456), new THREE.MeshLambertMaterial({ color: 0xb9b3a6 }), 1.05, seam);
    const ax = tw / 2 + 0.06;
    [-1, 1].forEach((s) => this.restArm(g, s, standing, up, ax, shell, skMat, 1.35, seam, 0.1));
  }

  /** Accessories that ride on the head group, so they turn with every gaze/stare. */
  private addHeadwear(head: THREE.Group, archetype: PersonArchetype, hairMat: THREE.MeshLambertMaterial) {
    if (archetype === 'coat') {
      // Small dark felt hat sitting high on the grey hair.
      const felt = this.fabric(0x1f1c22);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.075, 8), felt);
      crown.position.set(0, 0.115, -0.015);
      crown.rotation.x = -0.15;
      head.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 8), felt);
      brim.position.set(0, 0.08, -0.01);
      brim.rotation.x = -0.15;
      head.add(brim);
      this.box(head, 0.01, 0.02, 0.06, new THREE.MeshLambertMaterial({ color: 0x4a1a24 }), 0.1, 0.095, -0.01);
      return;
    }
    if (archetype === 'hoodie') {
      // Dark beanie with a folded cuff, white over-ear headphones over it.
      const knit = this.fabric(0x34343a);
      const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.128, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), knit);
      beanie.position.set(0, 0.03, -0.012);
      beanie.scale.set(0.98, 1.25, 1.04);
      head.add(beanie);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.045, 8), knit);
      cuff.position.set(0, 0.035, -0.012);
      cuff.rotation.x = -0.08;
      head.add(cuff);
      const white = new THREE.MeshLambertMaterial({ color: 0xdedcd6 });
      const grey = new THREE.MeshLambertMaterial({ color: 0x8e8d8a });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.014, 4, 10, Math.PI), white);
      band.position.set(0, 0.0, -0.01);
      head.add(band);
      [-1, 1].forEach((s) => {
        this.box(head, 0.05, 0.1, 0.09, white, s * 0.13, -0.015, -0.01);
        this.box(head, 0.008, 0.06, 0.06, grey, s * 0.158, -0.015, -0.01);
      });
      return;
    }
    if (archetype === 'texter') {
      // Dark hair pulled back into a bun.
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 5), hairMat);
      bun.position.set(0, 0.105, -0.07);
      head.add(bun);
      this.box(head, 0.2, 0.08, 0.08, hairMat, 0, 0.04, -0.07);
      return;
    }
    if (archetype === 'overcoat') {
      // Slicked-back hair: a flat glossy cap swept to the back of the head.
      const slick = new THREE.MeshPhongMaterial({ color: hairMat.color.getHex(), shininess: 70, specular: 0x3a3a3a });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), slick);
      cap.position.set(0, 0.012, -0.02);
      cap.scale.set(0.97, 0.78, 1.06);
      cap.rotation.x = -0.12;
      head.add(cap);
      this.box(head, 0.19, 0.09, 0.05, slick, 0, -0.02, -0.1);
      return;
    }
    if (archetype === 'mta') {
      // Low-poly hard hat: faceted dome, brim, centre ridge.
      const hat = new THREE.MeshLambertMaterial({ color: 0xd3cebf });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), hat);
      dome.position.set(0, 0.035, -0.005);
      dome.scale.set(0.97, 0.9, 1.05);
      head.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.014, 8), hat);
      brim.position.set(0, 0.035, 0.012);
      brim.scale.set(1, 1, 1.12);
      head.add(brim);
      this.box(head, 0.03, 0.025, 0.25, hat, 0, 0.145, -0.005);
      return;
    }
    if (archetype === 'puffer') {
      // Over-ear headphones: band over the crown, boxy cups with a muted red plate.
      const dark = new THREE.MeshLambertMaterial({ color: 0x19191c });
      const accent = new THREE.MeshLambertMaterial({ color: 0x7c2e2a });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.013, 4, 10, Math.PI), dark);
      band.position.set(0, 0.0, -0.005);
      head.add(band);
      [-1, 1].forEach((s) => {
        this.box(head, 0.045, 0.095, 0.085, dark, s * 0.122, -0.01, -0.005);
        this.box(head, 0.008, 0.06, 0.055, accent, s * 0.147, -0.01, -0.005);
      });
    }
  }
}
