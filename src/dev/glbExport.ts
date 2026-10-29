/**
 * Dev-only: export the procedural geometry to .glb files for Blender.
 *
 * Never imported by the game. It is loaded only by dev/export.html (served by the Vite dev
 * server, not part of `vite build`) and by `bun run export:glb` (scripts/export-glb.mjs).
 *
 * Each builder runs in its own throwaway scene, exactly as the game builds it, then the parts
 * are detached, made visible, named and exported with three's GLTFExporter (binary, textures
 * embedded as PNG).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SubwayCarBuilder } from '../graphics/subwayCarBuilder';
import { TrialBuilder } from '../graphics/trialBuilder';
import type { PersonObject } from '../types';
import { STOPS } from '../constants';

export interface ExportedFile {
  name: string;
  bytes: ArrayBuffer;
  /** Things that could not be exported faithfully (shader materials etc.). */
  notes: string[];
}

const slug = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'unnamed';

const hex = (c?: THREE.Color) => (c ? c.getHexString() : 'none');

/**
 * Blender-friendly names: every unnamed node gets `<parent>_<kind>_<n>`, every material
 * `<type>_<colour>[_<texture>]`. Shader materials (the trestle sky) can't be expressed in glTF,
 * so they become a flat unlit material of a representative colour and are listed in `notes`.
 */
function prepare(root: THREE.Object3D, notes: string[]) {
  const counts = new Map<string, number>();
  const matNames = new Map<THREE.Material, string>();
  const usedMat = new Map<string, number>();
  const nameMat = (m: THREE.Material): string => {
    const known = matNames.get(m);
    if (known) return known;
    const anyM = m as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };
    let base = m.name ? slug(m.name) : `${m.type.replace(/^Mesh|Material$/g, '')}_${hex(anyM.color)}${anyM.map ? '_tex' : ''}`;
    const n = usedMat.get(base) ?? 0;
    usedMat.set(base, n + 1);
    if (n) base += `_${n}`;
    m.name = base;
    if (anyM.map && !anyM.map.name) anyM.map.name = `${base}_map`;
    matNames.set(m, base);
    return base;
  };

  root.traverse((o) => {
    o.visible = true;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const fix = (m: THREE.Material): THREE.Material => {
        if ((m as THREE.ShaderMaterial).isShaderMaterial) {
          notes.push(`${o.parent?.name || root.name}: ShaderMaterial replaced with flat unlit colour (glTF has no custom shaders)`);
          const flat = new THREE.MeshBasicMaterial({ color: 0x1b1a33, side: m.side });
          flat.name = 'ShaderSky_placeholder';
          return flat;
        }
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(nameMat);
    }
    if (!o.name && o !== root) {
      const kind = mesh.isMesh
        ? (mesh.geometry?.type || 'Mesh').replace(/Geometry$/, '')
        : (o as THREE.Light).isLight
          ? o.type
          : 'Group';
      const key = `${o.parent?.name || root.name}_${kind}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      o.name = `${key}_${String(n).padStart(2, '0')}`;
    }
  });
}

function detach(o: THREE.Object3D, name: string, atOrigin = true): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  o.removeFromParent();
  if (!o.name) o.name = `${name}_root`;
  if (atOrigin) {
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
  }
  g.add(o);
  return g;
}

async function toGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  root.updateMatrixWorld(true);
  const out = await new GLTFExporter().parseAsync(root, {
    binary: true,
    onlyVisible: true,
    embedImages: true,
    maxTextureSize: 2048,
  });
  return out as ArrayBuffer;
}

/** Build every part, export it, and return the files (names include `.glb`). */
export async function exportAll(): Promise<ExportedFile[]> {
  const files: ExportedFile[] = [];
  const emit = async (name: string, root: THREE.Object3D) => {
    const notes: string[] = [];
    root.name = name;
    prepare(root, notes);
    files.push({ name: `${name}.glb`, bytes: await toGlb(root), notes: [...new Set(notes)] });
  };

  const scene = new THREE.Scene();
  const cb = new SubwayCarBuilder(scene);
  cb.buildScene();

  // People first, so the car exports without its passengers (they're separate files).
  const people: Array<[string, PersonObject]> = [];
  const add = (group: string, list: PersonObject[]) => list.forEach((p, i) => people.push([`${group}_${String(i + 1).padStart(2, '0')}_${slug(p.label || p.tid)}`, p]));
  add('parent', cb.parents);
  add('stranger', cb.strangers);
  if (cb.extraPerson) add('extra', [cb.extraPerson]);
  add('crowd', cb.crowd);
  add('carA_passenger', cb.carAPassengers);
  add('carC_passenger', cb.carCPassengers);
  const seen = new Set<THREE.Object3D>();
  const personGroups: Array<[string, THREE.Group]> = [];
  for (const [n, p] of people) {
    if (seen.has(p.g)) continue;
    seen.add(p.g);
    personGroups.push([n, detach(p.g, `character_${n}`)]);
  }

  // Car and its surroundings (the three cars, gangways, tunnel), in game coordinates.
  const car = new THREE.Group();
  for (const [n, g] of [
    ['carA_lead', cb.carAGroup],
    ['carB_mid', cb.carGroup],
    ['carC_rear', cb.carCGroup],
    ['gangways', cb.gangwayGroup],
    ['tunnel', cb.tunnelGroup],
  ] as const) {
    g.removeFromParent();
    g.name = n;
    car.add(g);
  }
  // Ceiling point lights are hidden in-game (a pooled set stands in); keep them as markers.
  await emit('subway_car', car);

  cb.stA.setName('Court Sq');
  await emit('station_platform', detach(cb.stA.g, 'platform', true));
  cb.stB.setName('21 St');
  cb.stB.setOpenAir(true);
  await emit('station_platform_open_air', detach(cb.stB.g, 'platform', true));

  for (const [n, g] of personGroups) await emit(`character_${n}`, g);

  // trestle_* now come from exportScenes() (bents laid out, rain split out).
  await emit('passing_train', detach(cb.passingTrain.group, 'train', true));

  const trial = new TrialBuilder(new THREE.Scene());
  await emit('trial_room', detach(trial.group, 'room', false));

  files.push(...(await exportScenes()));
  return files;
}

/** Drop lights (the Blender set has none) and return the root. */
function stripLights(root: THREE.Object3D) {
  const lights: THREE.Object3D[] = [];
  root.traverse((o) => (o as THREE.Light).isLight && lights.push(o));
  lights.forEach((l) => l.removeFromParent());
  return root;
}

/** Wrap `children` in a root named `name`, shifted so the bounding-box centre sits on x=z=0 (y untouched). */
function recentre(name: string, children: THREE.Object3D[], keepY = true): THREE.Group {
  const inner = new THREE.Group();
  inner.name = `${name}_parts`;
  children.forEach((c) => {
    c.removeFromParent();
    inner.add(c);
  });
  const root = new THREE.Group();
  root.name = name;
  root.add(inner);
  stripLights(inner);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, keepY ? 0 : -box.min.y, -c.z);
  return root;
}

/**
 * The scenes the first Blender set left out (Bill, Oct 24): Cars A and C, the two gangway
 * bellows, every station, the tunnel and the Newtown Creek trestle. Same naming as that set:
 * snake_case files, a CamelCase root (Car_A, Gangway_A_B, Station_<stop>, Tunnel, Trestle_*),
 * metres, Y up, no lights. Everything comes from the game's own builders.
 */
export async function exportScenes(): Promise<ExportedFile[]> {
  const files: ExportedFile[] = [];
  const emit = async (name: string, root: THREE.Object3D) => {
    const notes: string[] = [];
    prepare(root, notes);
    files.push({ name: `${name}.glb`, bytes: await toGlb(root), notes: [...new Set(notes)] });
  };
  const fresh = () => {
    const cb = new SubwayCarBuilder(new THREE.Scene());
    cb.buildScene();
    // Passengers are their own files (npc_*.glb); take them out of the cars.
    [...cb.carAPassengers, ...cb.carCPassengers].forEach((p) => p.g.removeFromParent());
    return cb;
  };

  let cb = fresh();
  // Cars A and C: every mesh the game adds to their groups (floor, ceiling, walls, seats, poles, cab end).
  await emit('car_A_interior', recentre('Car_A', [...cb.carAGroup.children]));
  await emit('car_C_interior', recentre('Car_C', [...cb.carCGroup.children]));

  // Gangways: the builder puts both in one group; split them at x=0 (A-B is at x=-9.75, B-C at +9.75).
  const gw = [...cb.gangwayGroup.children];
  await emit('gangway_bellows_A_B', recentre('Gangway_A_B', gw.filter((o) => o.position.x < 0)));
  await emit('gangway_bellows_B_C', recentre('Gangway_B_C', gw.filter((o) => o.position.x > 0)));

  // Tunnel: lay the scrolling piers, lamps and signals out at rest (pos = 0) like placeWorld() does.
  const L = cb.tunnelLength;
  cb.tunnelItems.forEach((it) => (it.m.position.x = ((((it.base % L) + L) % L) - L / 2)));
  cb.tunnelWalls.forEach((w) => (w.position.x = 0));
  await emit('tunnel', recentre('Tunnel', [...cb.tunnelGroup.children]));

  // Stations: one builder; the only per-stop differences are the name on the tablets and the
  // open-air variant (21 St, on the trestle approach). Export every stop so each sign is real.
  for (let i = 1; i < STOPS.length; i++) {
    cb = fresh();
    const st = cb.stA;
    st.setName(STOPS[i]);
    const open = STOPS[i] === '21 St';
    st.setOpenAir(open);
    // setOpenAir hides the tiled wall and trim; drop hidden parts so prepare() doesn't re-show them.
    st.g.children.filter((o) => !o.visible).forEach((o) => o.removeFromParent());
    st.g.position.set(0, 0, 0);
    await emit(`station_${String(i).padStart(2, '0')}_${slug(STOPS[i])}${open ? '_open_air' : ''}`, recentre(`Station_${slug(STOPS[i])}`, [...st.g.children]));
  }

  // Trestle: the steel bents laid out at rest, the fixed scenery, and the rain strips separately.
  cb = fresh();
  const tr = cb.trestle;
  const BENT_WRAP = 90;
  tr.steel.forEach((it) => (it.m.position.x = ((it.base % BENT_WRAP) + BENT_WRAP) % BENT_WRAP - BENT_WRAP / 2));
  const rainMats = new Set<THREE.Material>((tr as unknown as { rainMats: THREE.Material[] }).rainMats);
  const rain = tr.group.children.filter((o) => rainMats.has((o as THREE.Mesh).material as THREE.Material));
  const rails = tr.group.children.filter((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry instanceof THREE.BoxGeometry && ((o as THREE.Mesh).geometry as THREE.BoxGeometry).parameters.width === 400);
  await emit('trestle_steel', recentre('Trestle_Steel', [...tr.steelGroup.children, ...rails]));
  await emit('trestle_rain', recentre('Trestle_Rain', rain));
  await emit('trestle_scenery', recentre('Trestle_Scenery', [...tr.group.children]));
  return files;
}

/** Render a .glb (base64) to a PNG data URL: three-quarter view, framed to its bounds. */
export async function previewBase64(b64: string, label: string, w = 640, h = 480): Promise<string> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2d30);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 0.05);
  const cam = new THREE.PerspectiveCamera(35, w / h, r / 100, r * 100);
  const dir = new THREE.Vector3(0.75, 0.55, 1).normalize();
  cam.position.copy(c).addScaledVector(dir, r / Math.sin((35 * Math.PI) / 360) * 0.95);
  cam.lookAt(c);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ren = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  ren.setSize(w, h, false);
  ren.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - 28, w, 28);
  ctx.fillStyle = '#eee';
  ctx.font = '15px monospace';
  ctx.fillText(`${label}   ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m`, 8, h - 9);
  ren.dispose();
  return out.toDataURL('image/png');
}

/** Tile PNG data URLs into one contact sheet. */
export async function contactSheet(urls: string[], cols = 6, tw = 320, th = 240): Promise<string> {
  const rows = Math.ceil(urls.length / cols);
  const cv = document.createElement('canvas');
  cv.width = cols * tw;
  cv.height = rows * th + 40;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#eee';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`LAST LOCAL - Blender export (${urls.length} files)`, 12, 28);
  for (let i = 0; i < urls.length; i++) {
    const img = new Image();
    img.src = urls[i];
    await img.decode();
    ctx.drawImage(img, (i % cols) * tw, 40 + Math.floor(i / cols) * th, tw - 2, th - 2);
  }
  return cv.toDataURL('image/png');
}

/** For the Playwright script: base64 so it survives page.evaluate. */
export async function exportAllBase64() {
  const files = await exportAll();
  return files.map((f) => {
    let s = '';
    const u = new Uint8Array(f.bytes);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { name: f.name, notes: f.notes, b64: btoa(s) };
  });
}

/**
 * Exports the 14 canonical character, parent, and uncanny anomaly `.glb` files
 * used by `public/models/characters/manifest.json`.
 */
export async function exportCharacterManifestModels(): Promise<ExportedFile[]> {
  const files: ExportedFile[] = [];
  const emit = async (name: string, root: THREE.Object3D) => {
    const notes: string[] = [];
    root.name = name;
    prepare(root, notes);
    files.push({ name: `${name}.glb`, bytes: await toGlb(root), notes: [...new Set(notes)] });
  };

  const scene = new THREE.Scene();
  const cb = new SubwayCarBuilder(scene);
  cb.buildScene();

  const characterEntries: Array<[string, PersonObject]> = [
    ['mom', cb.parents[0]],
    ['dad', cb.parents[1]],
    ['passenger_mta', cb.strangers[0]],
    ['passenger_coat', cb.strangers[1]],
    ['passenger_puffer', cb.strangers[2]],
    ['passenger_hoodie_standing', cb.crowd[0]],
    ['passenger_texter_seated', cb.crowd[1]],
    ['passenger_overcoat', cb.crowd[2]],
    ['passenger_office_standing', cb.crowd[3]],
    ['passenger_office_seated', cb.carAPassengers[0]],
    ['passenger_texter_standing', cb.carCPassengers[0]],
    ['passenger_hoodie_seated', cb.carCPassengers[1]],
    ['anomaly_extra', cb.extraPerson],
  ];

  for (const [name, p] of characterEntries) {
    p.head.rotation.set(0, 0, 0);
    await emit(name, detach(p.g, name, true));
  }

  await emit('anomaly_faceless', cb.charBuilder.createAnomalyOverlay('anomaly_faceless'));
  await emit('anomaly_stretched', cb.charBuilder.createAnomalyOverlay('anomaly_stretched'));

  return files;
}

export async function exportCharacterManifestModelsBase64() {
  const files = await exportCharacterManifestModels();
  return files.map((f) => {
    let s = '';
    const u = new Uint8Array(f.bytes);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { name: f.name, notes: f.notes, b64: btoa(s) };
  });
}

/** Reload a .glb with GLTFLoader and count what came back (a round-trip sanity check). */
export async function verifyBase64(b64: string) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
  let meshes = 0;
  let tris = 0;
  const mats = new Set<string>();
  const unnamed: string[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!o.name) unnamed.push(o.type);
    if (m.isMesh) {
      meshes++;
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x.name));
    }
  });
  return { meshes, triangles: Math.round(tris), materials: mats.size, textures: gltf.parser.json.textures?.length ?? 0, unnamedNodes: unnamed.length };
}

