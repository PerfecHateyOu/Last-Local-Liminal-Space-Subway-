/**
 * Optional Blender models for Mom and Dad (.glb), off by default.
 *
 * The game's people are procedural (doc v5.3 §2.2, "no asset files"). This relaxes that only
 * behind a flag, for Mom and Dad only: when it's on, `preloadParentModels()` fetches
 * models/characters/mom.glb and dad.glb BEFORE the car is built, and `createPerson` swaps the
 * procedural body for the model. No hot-swap: whatever is ready when the car is built is used.
 * Any failure (flag off, missing file, bad file, wrong node names) leaves the procedural figure
 * and logs a warning. Production and offline builds ship no model files.
 *
 * Turn it on with `?models=parents` in the URL, or localStorage `gtrain-glb-parents` = "1".
 *
 * Ordinary passengers (everyone but Mom and Dad) have their own flag: `?models=passengers`
 * (or `?models=parents,passengers`, or `?models=all`), or localStorage `gtrain-glb-passengers` = "1".
 * Their files are shared by outfit and pose, `passenger-<archetype>[-standing].glb` (the archetype
 * is `plain` for people with no outfit), so one file can stand in for several people: each gets
 * its own clone (SkeletonUtils.clone) with its own copy of every material, so a recolour on one
 * never shows on another. A missing or bad file leaves just those people procedural.
 * Node contract (see docs/blender-models.md):
 *   Head    a node with its origin at the neck (the pivot the head turns on), made YXZ here
 *   Eye_*   one or more meshes (the pupils: the frozen-face anomaly scales them)
 *   Skin    exactly one material named Skin*, shared by every skin mesh (anomalies recolour it)
 *   Phone   optional node (hidden by the frozen-face anomaly)
 * Built facing +Z, feet at y = 0, metres, origin between the feet, seated pose.
 */
import * as THREE from 'three';

/** The embedded manifest: which tids may be replaced, and from which file. */
export const PARENT_MODELS: Record<string, { file: string }> = {
  mom: { file: 'mom.glb' },
  dad: { file: 'dad.glb' },
};
export const MODELS_FLAG_KEY = 'gtrain-glb-parents';
export const PASSENGER_FLAG_KEY = 'gtrain-glb-passengers';

/** Outfit-and-pose keys of the ordinary passengers the cars build (subwayCarBuilder.ts). */
export const PASSENGER_MODELS = [
  'mta', 'coat', 'puffer-standing', 'plain', 'hoodie', 'hoodie-standing', 'texter', 'texter-standing',
  'overcoat', 'office', 'office-standing',
] as const;
export function passengerModelKey(archetype: string | undefined, standing: boolean | undefined): string {
  return `${archetype || 'plain'}${standing ? '-standing' : ''}`;
}
/** Per-key result for passengers ('passenger-office-standing' and so on). */
export const passengerStatus: Record<string, ModelStatus> = Object.fromEntries(
  PASSENGER_MODELS.map((k) => [`passenger-${k}`, 'off' as ModelStatus])
);
const passengerScenes = new Map<string, THREE.Object3D>();
let cloneScene: ((o: THREE.Object3D) => THREE.Object3D) | null = null;
const LOAD_TIMEOUT_MS = 5000;

export interface AdaptedModel {
  root: THREE.Object3D;
  head: THREE.Object3D;
  eyes: THREE.Mesh[];
  skMat: THREE.Material;
  phone: THREE.Object3D | null;
}

export type ModelStatus = 'off' | 'loaded' | 'fallback';
/** Per-tid result, for tests and the debug overlay. */
export const modelStatus: Record<string, ModelStatus> = { mom: 'off', dad: 'off' };
const ready = new Map<string, AdaptedModel>();

function modelsFlag(group: 'parents' | 'passengers', key: string): boolean {
  if (import.meta.env.MODE === 'offline') return false; // file:// can't fetch; the offline build stays procedural
  try {
    const q = (new URLSearchParams(location.search).get('models') || '').split(',').map((x) => x.trim());
    if (q.includes(group) || q.includes('all')) return true;
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function parentModelsEnabled(): boolean {
  return modelsFlag('parents', MODELS_FLAG_KEY);
}

export function passengerModelsEnabled(): boolean {
  return modelsFlag('passengers', PASSENGER_FLAG_KEY);
}

/**
 * Check a loaded scene against the node contract and return its parts, or throw saying what's wrong.
 * Exported for the round-trip test.
 */
export function adaptModel(scene: THREE.Object3D, name = 'model'): AdaptedModel {
  scene.updateMatrixWorld(true);
  let head: THREE.Object3D | null = null;
  let phone: THREE.Object3D | null = null;
  const eyes: THREE.Mesh[] = [];
  const skins = new Set<THREE.Material>();
  let meshes = 0;
  scene.traverse((o) => {
    if (!head && /^head$/i.test(o.name)) head = o;
    if (!phone && /^phone$/i.test(o.name)) phone = o;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      meshes++;
      if (/^eye_/i.test(o.name)) eyes.push(m);
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
        if (/^skin/i.test(mat.name)) skins.add(mat);
      });
    }
  });
  if (!meshes) throw new Error(`${name}: no meshes`);
  if (!head) throw new Error(`${name}: no node named Head`);
  if (!eyes.length) throw new Error(`${name}: no Eye_* meshes`);
  if (eyes.some((e) => !isUnder(e, head!))) throw new Error(`${name}: Eye_* meshes must be inside Head`);
  if (skins.size !== 1) throw new Error(`${name}: expected one Skin material, found ${skins.size}`);
  const skMat = [...skins][0];
  if (!('color' in skMat) || !((skMat as THREE.MeshStandardMaterial).color instanceof THREE.Color))
    throw new Error(`${name}: the Skin material has no colour`);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0.6 && size.y < 2.4) || size.x > 2 || size.z > 2)
    throw new Error(`${name}: size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m is not a person`);
  const neck = (head as THREE.Object3D).getWorldPosition(new THREE.Vector3());
  if (neck.y < 0.7 || neck.y > 2) throw new Error(`${name}: Head pivot at y=${neck.y.toFixed(2)} m, expected the neck (0.7–2 m)`);
  (head as THREE.Object3D).rotation.order = 'YXZ';
  return { root: scene, head: head!, eyes, skMat, phone };
}

function isUnder(o: THREE.Object3D, parent: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === parent) return true;
  return false;
}

/** Fetch and adapt the optional models (parents and/or passengers). Resolves when done; never rejects. */
export async function preloadParentModels(base = import.meta.env.BASE_URL): Promise<void> {
  const parents = parentModelsEnabled();
  const passengers = passengerModelsEnabled();
  if (!parents && !passengers) return;
  let GLTFLoader: typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;
  try {
    // A constant condition, so the offline build (which never loads models) drops the loader entirely.
    const mod = import.meta.env.MODE === 'offline' ? null : await import('three/examples/jsm/loaders/GLTFLoader.js');
    if (!mod) return;
    GLTFLoader = mod.GLTFLoader;
    if (passengers) {
      const su = import.meta.env.MODE === 'offline' ? null : await import('three/examples/jsm/utils/SkeletonUtils.js');
      if (su) cloneScene = su.clone;
    }
  } catch (e) {
    console.warn('[models] GLTFLoader failed to load; using procedural figures', e);
    if (parents) for (const tid of Object.keys(PARENT_MODELS)) modelStatus[tid] = 'fallback';
    if (passengers) for (const k of Object.keys(passengerStatus)) passengerStatus[k] = 'fallback';
    return;
  }
  const loader = new GLTFLoader();
  const load = (url: string) =>
    Promise.race([
      loader.loadAsync(url),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), LOAD_TIMEOUT_MS)),
    ]);
  const jobs: Promise<void>[] = [];
  if (parents)
    for (const [tid, { file }] of Object.entries(PARENT_MODELS))
      jobs.push(
        (async () => {
          const url = `${base}models/characters/${file}`;
          try {
            ready.set(tid, adaptModel((await load(url)).scene, file));
            modelStatus[tid] = 'loaded';
          } catch (e) {
            modelStatus[tid] = 'fallback';
            console.warn(`[models] ${url}: ${(e as Error).message || e}; using the procedural figure`);
          }
        })()
      );
  if (passengers)
    for (const k of PASSENGER_MODELS)
      jobs.push(
        (async () => {
          const file = `passenger-${k}.glb`;
          const url = `${base}models/characters/${file}`;
          try {
            const scene = (await load(url)).scene;
            adaptModel(scene, file); // check the contract once, on the shared original
            passengerScenes.set(k, scene);
            passengerStatus[`passenger-${k}`] = 'loaded';
          } catch (e) {
            passengerStatus[`passenger-${k}`] = 'fallback';
            console.warn(`[models] ${url}: ${(e as Error).message || e}; using the procedural figures`);
          }
        })()
      );
  await Promise.all(jobs);
}

/**
 * A passenger's own copy of the shared model for this outfit and pose, or null (flag off, file
 * missing or bad). Geometry is shared; every material is this passenger's own.
 */
export function takePassengerModel(archetype: string | undefined, standing: boolean | undefined): AdaptedModel | null {
  const src = passengerScenes.get(passengerModelKey(archetype, standing));
  if (!src || !cloneScene) return null;
  try {
    const copy = cloneScene(src);
    const own = new Map<THREE.Material, THREE.Material>();
    const mine = (m: THREE.Material) => {
      let c = own.get(m);
      if (!c) own.set(m, (c = m.clone()));
      return c;
    };
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(mine) : mine(m.material);
    });
    return adaptModel(copy);
  } catch (e) {
    console.warn('[models] passenger clone failed; using the procedural figure', e);
    return null;
  }
}

/** The adapted model for this tid, once (each is used by one figure). */
export function takeParentModel(tid: string): AdaptedModel | null {
  const m = ready.get(tid) ?? null;
  ready.delete(tid);
  return m;
}

/** Set a material's colour if it has one (imported Skin may be Standard rather than Lambert). */
export function setMaterialColor(mat: THREE.Material, hex: number) {
  const c = (mat as THREE.MeshLambertMaterial).color;
  if (c instanceof THREE.Color) c.setHex(hex);
}
