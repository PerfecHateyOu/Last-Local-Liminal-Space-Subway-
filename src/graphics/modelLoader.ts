/**
 * Blender 3D GLTF/GLB Character & Anomaly Model Loader for LAST LOCAL
 *
 * Loads 3D character, parent, and uncanny anomaly models (.glb / .gltf) from
 * `/models/characters/` (configured via `/models/characters/manifest.json`) or
 * via live drag-and-drop, adapting imported Blender scene graphs to the game's
 * articulated `PersonObject` rig (`g`, `head`, `eyes`, `phone`, `skMat`) while
 * guaranteeing a zero-latency procedural PS1 fallback if any asset is absent.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PersonObject } from '../types';
import type { PersonConfig } from './characterBuilder';

export type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'fallback' | 'error';

export interface ModelManifestEntry {
  file: string;
  role: 'parent' | 'archetype' | 'passenger' | 'anomaly';
  scale?: number;
  yOffset?: number;
  rotationY?: number;
  retroMaterials?: boolean;
  autoNormalize?: boolean;
  standing?: boolean;
}

export interface ModelManifest {
  version: number;
  basePath: string;
  models: Record<string, ModelManifestEntry>;
}

/**
 * Model URLs resolve against the page (Vite's BASE_URL), never the site root, so the game works
 * from a subpath such as itch.io's `html/<id>/index.html`. A manifest basePath written as
 * `/models/...` is treated the same as `models/...`.
 */
export function resolveModelPath(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
  return base + path.replace(/^\.?\//, '');
}

const DEFAULT_BASE_PATH = 'models/characters/';
const DEFAULT_MANIFEST_URL = DEFAULT_BASE_PATH + 'manifest.json';

export class BlenderModelLoader {
  private loader = new GLTFLoader();
  private manifest: ModelManifest | null = null;
  private manifestPromise: Promise<ModelManifest | null> | null = null;
  private cache = new Map<string, THREE.Group>();
  private loadingPromises = new Map<string, Promise<THREE.Group | null>>();
  private status = new Map<string, ModelLoadStatus>();
  private boundPeople = new Map<string, Array<{ person: PersonObject; cfg: PersonConfig }>>();
  private activeAnomalyOverlays = new WeakMap<PersonObject, THREE.Object3D[]>();

  /** Optional callback fired whenever a Blender model swaps into a passenger or anomaly. */
  public onModelSwapped?: (key: string, tid: string) => void;

  /**
   * Returns whether external asset fetching is disabled (e.g. single-file `file://` offline build).
   */
  public isOfflineFileProtocol(): boolean {
    return typeof window !== 'undefined' && window.location?.protocol === 'file:';
  }

  /**
   * Fetches and caches `/models/characters/manifest.json`.
   * Never throws or logs console errors on missing manifest; falls back gracefully.
   */
  public async loadManifest(url: string = DEFAULT_MANIFEST_URL): Promise<ModelManifest | null> {
    if (this.manifest) return this.manifest;
    if (this.isOfflineFileProtocol()) return null;
    if (this.manifestPromise) return this.manifestPromise;

    this.manifestPromise = (async () => {
      try {
        const res = await fetch(resolveModelPath(url), { cache: 'no-cache' });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) return null;
        const data = (await res.json()) as ModelManifest;
        if (!data || typeof data !== 'object' || !data.models) return null;
        this.manifest = data;
        for (const [k, entry] of Object.entries(data.models)) {
          if (entry.role === 'anomaly') {
            void this.loadModelEntry(k, entry, data.basePath || DEFAULT_BASE_PATH);
          }
        }
        return data;
      } catch {
        return null;
      }
    })();

    return this.manifestPromise;
  }

  /**
   * Resolves the manifest model key for a passenger configuration (`tid` or pose-matched `archetype`).
   */
  public resolveKeyForConfig(cfg: PersonConfig, manifest: ModelManifest | null = this.manifest): string | null {
    const models = manifest?.models;
    if (!models) {
      // Even before manifest finishes loading, return candidate key for registration
      return cfg.tid || cfg.archetype || null;
    }

    // 1. Direct tid match (e.g. 'mom', 'dad', 'seat6', 's1', 's2', 's3')
    if (models[cfg.tid]) {
      const entry = models[cfg.tid];
      if (entry.standing === undefined || entry.standing === !!cfg.standing) {
        return cfg.tid;
      }
    }

    // 2. Pose-qualified archetype match (e.g. 'hoodie_standing', 'office_seated')
    if (cfg.archetype) {
      const poseKey = `${cfg.archetype}_${cfg.standing ? 'standing' : 'seated'}`;
      if (models[poseKey]) return poseKey;

      const archEntry = models[cfg.archetype];
      if (archEntry && (archEntry.standing === undefined || archEntry.standing === !!cfg.standing)) {
        return cfg.archetype;
      }
    }

    return null;
  }

  /**
   * Registers a procedurally built `PersonObject` and asynchronously upgrades it with its
   * corresponding Blender `.glb` model if present in `/models/characters/`.
   */
  public bindPerson(person: PersonObject, cfg: PersonConfig): void {
    // Store procedural backup so we can always revert or inspect
    const registerUnderKey = (key: string) => {
      const list = this.boundPeople.get(key) ?? [];
      if (!list.some((item) => item.person === person)) {
        list.push({ person, cfg });
        this.boundPeople.set(key, list);
      }
    };

    registerUnderKey(cfg.tid);
    if (cfg.archetype) {
      registerUnderKey(cfg.archetype);
      registerUnderKey(`${cfg.archetype}_${cfg.standing ? 'standing' : 'seated'}`);
    }

    if (this.isOfflineFileProtocol()) {
      this.status.set(cfg.tid, 'fallback');
      return;
    }

    void this.upgradePersonFromManifest(person, cfg);
  }

  private async upgradePersonFromManifest(person: PersonObject, cfg: PersonConfig): Promise<boolean> {
    const manifest = await this.loadManifest();
    if (!manifest) {
      this.status.set(cfg.tid, 'fallback');
      return false;
    }

    const key = this.resolveKeyForConfig(cfg, manifest);
    if (!key || !manifest.models[key]) {
      this.status.set(cfg.tid, 'fallback');
      return false;
    }

    const entry = manifest.models[key];
    const template = await this.loadModelEntry(key, entry, manifest.basePath || DEFAULT_BASE_PATH);
    if (!template) {
      this.status.set(cfg.tid, 'fallback');
      return false;
    }

    this.applyModelToPerson(person, cfg, template, entry);
    this.status.set(key, 'loaded');
    this.status.set(cfg.tid, 'loaded');
    this.onModelSwapped?.(key, person.tid);
    return true;
  }

  /**
   * Loads a single model entry from `/models/characters/`, caching the parsed scene graph.
   */
  public async loadModelEntry(
    key: string,
    entry: ModelManifestEntry,
    basePath: string = DEFAULT_BASE_PATH
  ): Promise<THREE.Group | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const existing = this.loadingPromises.get(key);
    if (existing) return existing;

    this.status.set(key, 'loading');
    const url = resolveModelPath(`${basePath.replace(/\/?$/, '/')}${entry.file.replace(/^\//, '')}`);

    const promise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          this.status.set(key, 'fallback');
          return null;
        }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          this.status.set(key, 'fallback');
          return null;
        }
        const buffer = await res.arrayBuffer();
        if (!buffer || buffer.byteLength < 20) {
          this.status.set(key, 'fallback');
          return null;
        }
        const parsed = await this.parseGLBBuffer(buffer, url);
        if (!parsed) {
          this.status.set(key, 'fallback');
          return null;
        }
        this.cache.set(key, parsed);
        this.status.set(key, 'loaded');
        return parsed;
      } catch {
        this.status.set(key, 'fallback');
        return null;
      } finally {
        this.loadingPromises.delete(key);
      }
    })();

    this.loadingPromises.set(key, promise);
    return promise;
  }

  /**
   * Parses an ArrayBuffer (`.glb` or `.gltf`) into a validated `THREE.Group` with at least 1 mesh.
   */
  public async parseGLBBuffer(buffer: ArrayBuffer, pathHint: string = ''): Promise<THREE.Group | null> {
    try {
      const gltf = await this.loader.parseAsync(buffer, pathHint);
      if (!gltf || !gltf.scene) return null;
      let meshCount = 0;
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshCount++;
      });
      if (meshCount === 0) return null;
      return gltf.scene;
    } catch {
      return null;
    }
  }

  /**
   * Hot-swaps a custom Blender `.glb` buffer at runtime (e.g. from drag-and-drop or test harness)
   * onto any matching character key (`mom`, `dad`, `mta`, `coat`, `s1`, `anomaly_faceless`, etc.).
   */
  public async loadCustomGLB(
    targetKey: string,
    buffer: ArrayBuffer,
    options: Partial<ModelManifestEntry> = {}
  ): Promise<boolean> {
    const parsed = await this.parseGLBBuffer(buffer);
    if (!parsed) {
      this.status.set(targetKey, 'error');
      return false;
    }

    const cleanKey = targetKey
      .replace(/\.(glb|gltf)$/i, '')
      .replace(/^character_/, '')
      .replace(/^passenger_/, '');

    this.cache.set(cleanKey, parsed);
    this.cache.set(targetKey, parsed);
    this.status.set(cleanKey, 'loaded');
    this.status.set(targetKey, 'loaded');

    const entry: ModelManifestEntry = {
      file: `${cleanKey}.glb`,
      role: cleanKey.startsWith('anomaly_') ? 'anomaly' : 'passenger',
      retroMaterials: true,
      autoNormalize: true,
      ...options,
    };

    const targets = this.boundPeople.get(cleanKey) || this.boundPeople.get(targetKey) || [];
    for (const { person, cfg } of targets) {
      this.applyModelToPerson(person, cfg, parsed, entry);
      this.onModelSwapped?.(cleanKey, person.tid);
    }

    return true;
  }

  /**
   * Applies an uncanny Blender anomaly model overlay (`anomaly_faceless` or `anomaly_stretched`)
   * onto a passenger when an anomaly triggers, while keeping all `PersonObject` invariants intact.
   */
  public applyAnomalyVariant(
    person: PersonObject,
    variantKey: 'anomaly_faceless' | 'anomaly_stretched'
  ): boolean {
    this.revertAnomalyVariant(person);

    const template = this.cache.get(variantKey);
    const overlays: THREE.Object3D[] = [];

    if (template) {
      const clone = this.cloneSceneGraph(template);
      this.normalizeRetroMaterials(clone, person.skMat, person.skin, true);
      clone.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.userData.tid = person.tid;
        }
      });
      clone.name = `BlenderAnomaly_${variantKey}`;
      person.head.add(clone);
      overlays.push(clone);
    } else {
      // Procedural uncanny fallback if anomaly .glb hasn't finished loading yet
      const fallback = this.buildProceduralAnomalyOverlay(variantKey, person);
      person.head.add(fallback);
      overlays.push(fallback);
    }

    this.activeAnomalyOverlays.set(person, overlays);
    this.syncTargetMeshes(person);
    return true;
  }

  /**
   * Removes any active anomaly model overlay from a passenger when the anomaly reverts.
   */
  public revertAnomalyVariant(person: PersonObject): void {
    const overlays = this.activeAnomalyOverlays.get(person);
    if (!overlays) return;
    for (const obj of overlays) {
      obj.removeFromParent();
    }
    this.activeAnomalyOverlays.delete(person);
    this.syncTargetMeshes(person);
  }

  private buildProceduralAnomalyOverlay(
    variantKey: 'anomaly_faceless' | 'anomaly_stretched',
    person: PersonObject
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = `ProceduralAnomaly_${variantKey}`;
    const darkHollowMat = new THREE.MeshBasicMaterial({ color: 0x09080a });

    if (variantKey === 'anomaly_faceless') {
      // Sunken hollow orbital shadows around the dilated eyes and a blank facial ridge
      [-0.038, 0.038].forEach((ex) => {
        const socket = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.034, 10), darkHollowMat);
        socket.position.set(ex, 0.016, 0.103);
        g.add(socket);
      });
      const blankMask = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.024, 0.018), person.skMat);
      blankMask.position.set(0, -0.054, 0.104);
      g.add(blankMask);
    } else if (variantKey === 'anomaly_stretched') {
      // Elongated twisted cervical neck rings beneath the turned head
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(0.052 - i * 0.004, 0.058 - i * 0.003, 0.055, 8),
          person.skMat
        );
        ring.position.set(0, -0.11 - i * 0.042, -0.01 * i);
        ring.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.14;
        g.add(ring);
      }
    }

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.userData.tid = person.tid;
      }
    });
    return g;
  }

  /**
   * Adapts a cloned Blender GLTF scene graph into `person` (`PersonObject`), preserving:
   * - `person.g` (root Group)
   * - `person.head` (articulated YXZ Group for gaze tracking)
   * - `person.eyes` (the 2 pupil Meshes inside `person.head`)
   * - `person.phone` (if present, direct child of `person.g`)
   * - `person.skMat` (unique skin Material used by at least 1 body mesh and 1 head mesh)
   * - `userData.habit` props for `carLife`
   * - total mesh count <= 24 via static material merging
   */
  public applyModelToPerson(
    person: PersonObject,
    cfg: PersonConfig,
    template: THREE.Group,
    entry: ModelManifestEntry
  ): void {
    const up = cfg.standing ? 0.48 : 0;
    const headBaseY = 1.22 + up;
    const clone = this.cloneSceneGraph(template);

    // Unwrap wrapper groups exported by `detach()` in glbExport (`character_*` -> `*_root`)
    let modelRoot: THREE.Object3D = clone;
    while (
      modelRoot.children.length === 1 &&
      !(modelRoot.children[0] as THREE.Mesh).isMesh &&
      !/^(Head|Phone|Pupil)/i.test(modelRoot.children[0].name)
    ) {
      modelRoot = modelRoot.children[0];
    }

    // Optional bounding-box scale normalization for external Blender models
    if (entry.autoNormalize !== false) {
      modelRoot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelRoot);
      const size = box.getSize(new THREE.Vector3());
      const targetHeight = cfg.standing ? 1.72 : 1.34;
      if (size.y > 0.01 && (size.y < 0.65 || size.y > 2.4)) {
        const s = targetHeight / size.y;
        modelRoot.scale.multiplyScalar(s);
        modelRoot.updateMatrixWorld(true);
        const newBox = new THREE.Box3().setFromObject(modelRoot);
        modelRoot.position.y -= newBox.min.y;
      }
    }

    if (entry.scale && entry.scale !== 1) {
      modelRoot.scale.multiplyScalar(entry.scale);
    }
    if (entry.yOffset) {
      modelRoot.position.y += entry.yOffset;
    }
    if (entry.rotationY) {
      modelRoot.rotation.y += entry.rotationY;
    }

    // Normalize materials to PS1 Lambert + NearestFilter and bind person.skMat
    this.normalizeRetroMaterials(modelRoot, person.skMat, cfg.skin, entry.retroMaterials !== false);

    // Restore habit tags from node names (`HabitProp_radio`, `HabitProp_paper`, `HabitProp_phone`)
    modelRoot.traverse((o) => {
      const m = o.name.match(/HabitProp_(radio|paper|phone)/i);
      if (m) {
        o.userData.habit = m[1].toLowerCase();
      }
    });

    // Locate articulated nodes in the imported Blender hierarchy
    let importedHead: THREE.Object3D | null = null;
    let importedPhone: THREE.Object3D | null = null;
    const importedPupils: THREE.Mesh[] = [];

    modelRoot.traverse((o) => {
      if (o === modelRoot) return;
      if (!importedHead && (/^Head$/i.test(o.name) || /_Head(_\d+)?$/i.test(o.name) || o.userData?.role === 'head')) {
        importedHead = o;
      }
      if (!importedPhone && (/^Phone$/i.test(o.name) || /_Phone(_\d+)?$/i.test(o.name) || o.userData?.role === 'phone')) {
        importedPhone = o;
      }
      if ((o as THREE.Mesh).isMesh && (/^Pupil_[LR]/i.test(o.name) || /^Eye_[LR]/i.test(o.name) || o.userData?.isPupil)) {
        importedPupils.push(o as THREE.Mesh);
      }
    });

    // Preserve existing procedural pupils and phone as fallback if custom GLB omitted them
    const fallbackPupils = [...person.eyes];
    const fallbackPhone = person.phone;

    // 1. Rebuild `person.head` while keeping the exact same `person.head` Group reference
    for (const child of [...person.head.children]) {
      person.head.remove(child);
    }
    person.head.position.set(0, headBaseY, 0);
    person.head.rotation.order = 'YXZ';
    person.head.rotation.set(person.pose[1], person.pose[0], 0);

    if (importedHead) {
      const headNode = importedHead as THREE.Object3D;
      headNode.removeFromParent();
      for (const child of [...headNode.children]) {
        person.head.add(child);
      }
    } else {
      // Unrigged Blender mesh: Partition meshes in the head height region into `person.head`
      modelRoot.updateMatrixWorld(true);
      const rootInv = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
      const toMoveToHead: THREE.Mesh[] = [];
      modelRoot.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3()).applyMatrix4(rootInv);
        if (center.y >= 1.12 + up) {
          toMoveToHead.push(mesh);
        }
      });
      for (const mesh of toMoveToHead) {
        mesh.removeFromParent();
        mesh.position.y -= headBaseY;
        person.head.add(mesh);
      }
    }

    // 2. Bind `person.eyes` (must be 2 pupil meshes parented directly to `person.head`)
    person.eyes.length = 0;
    if (importedPupils.length >= 2) {
      const twoPupils = importedPupils.slice(0, 2);
      for (const pMesh of twoPupils) {
        if (pMesh.parent !== person.head) {
          person.head.add(pMesh);
        }
        person.eyes.push(pMesh);
      }
    } else {
      for (const pMesh of fallbackPupils) {
        person.head.add(pMesh);
        person.eyes.push(pMesh);
      }
    }

    // 3. Rebuild `person.g` body children (keeping `person.head` and `person.phone`)
    for (const child of [...person.g.children]) {
      if (child !== person.head) {
        person.g.remove(child);
      }
    }

    // Handle phone node if this passenger has a phone
    if (cfg.phone) {
      if (importedPhone) {
        const phoneNode = importedPhone as THREE.Object3D;
        phoneNode.removeFromParent();
        if (fallbackPhone) {
          // Keep the `person.phone` reference intact and swap its children
          for (const c of [...fallbackPhone.children]) fallbackPhone.remove(c);
          for (const c of [...phoneNode.children]) fallbackPhone.add(c);
          fallbackPhone.position.copy(phoneNode.position);
          fallbackPhone.rotation.copy(phoneNode.rotation);
          fallbackPhone.scale.copy(phoneNode.scale);
          person.g.add(fallbackPhone);
          person.phone = fallbackPhone;
        } else {
          person.g.add(phoneNode);
          person.phone = phoneNode;
        }
      } else if (fallbackPhone) {
        person.g.add(fallbackPhone);
        person.phone = fallbackPhone;
      }
    }

    // Move remaining body children from `modelRoot` into `person.g`
    for (const child of [...modelRoot.children]) {
      if (child === importedHead || child === importedPhone) continue;
      person.g.add(child);
    }

    // 4. Guarantee at least 1 skin mesh on body (`person.g`) and 1 on `person.head`
    this.ensureSkinMaterialBinding(person, up);

    // 5. Merge static meshes per material so draw calls stay low (`count(p.g) <= 24`)
    const skipBody = new Set<THREE.Object3D>([
      person.head,
      ...(person.phone ? [person.phone] : []),
      ...person.eyes,
    ]);
    this.mergeStaticMeshes(person.g, skipBody);
    this.mergeStaticMeshes(person.head, new Set<THREE.Object3D>(person.eyes));

    // 6. Reset carLife state and sync raycast target meshes
    person.life = undefined;
    person.isImportedModel = true;
    person.modelSource = entry.file;
    this.syncTargetMeshes(person);
  }

  /**
   * Synchronizes `userData.tid` on all meshes in `person.g` and updates `person.g.userData.targetMeshes`
   * in-place so `SubwayCarBuilder.getActiveTargets()` immediately detects the loaded Blender meshes.
   */
  public syncTargetMeshes(person: PersonObject): void {
    const targetMeshes: THREE.Mesh[] | undefined = person.g.userData?.targetMeshes;
    if (targetMeshes) targetMeshes.length = 0;

    person.g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.userData.tid = person.tid;
        if (targetMeshes) targetMeshes.push(m);
      }
    });
  }

  private cloneSceneGraph(source: THREE.Group): THREE.Group {
    const clone = source.clone(true);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry = m.geometry.clone();
        if (Array.isArray(m.material)) {
          m.material = m.material.map((mat) => mat.clone());
        } else if (m.material) {
          m.material = m.material.clone();
        }
      }
    });
    return clone;
  }

  private normalizeRetroMaterials(
    root: THREE.Object3D,
    skMat: THREE.Material,
    skinHex: number,
    retroFilter: boolean
  ): void {
    const targetSkinColor = new THREE.Color(skinHex);

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;

      const convertMat = (mat: THREE.Material): THREE.Material => {
        const anyMat = mat as THREE.MeshStandardMaterial & {
          color?: THREE.Color;
          map?: THREE.Texture | null;
          emissive?: THREE.Color;
          emissiveIntensity?: number;
        };

        if (retroFilter && anyMat.map) {
          anyMat.map.magFilter = THREE.NearestFilter;
          anyMat.map.minFilter = THREE.NearestFilter;
          anyMat.map.needsUpdate = true;
        }

        // Check if this material or mesh represents character skin
        const isNamedSkin =
          /skin/i.test(mat.name || '') ||
          /skin/i.test(mesh.name || '') ||
          mesh.userData?.isSkin === true;

        const isColorMatchSkin =
          !anyMat.map &&
          anyMat.color &&
          Math.abs(anyMat.color.r - targetSkinColor.r) < 0.035 &&
          Math.abs(anyMat.color.g - targetSkinColor.g) < 0.035 &&
          Math.abs(anyMat.color.b - targetSkinColor.b) < 0.035;

        if (isNamedSkin || isColorMatchSkin) {
          return skMat;
        }

        if (retroFilter && (mat.type === 'MeshStandardMaterial' || mat.type === 'MeshPhysicalMaterial')) {
          // Convert Blender Principled BSDF (MeshStandardMaterial) to PS1 MeshLambertMaterial
          const lambert = new THREE.MeshLambertMaterial({
            color: anyMat.color ? anyMat.color.clone() : new THREE.Color(0xffffff),
            map: anyMat.map || null,
            transparent: mat.transparent,
            opacity: mat.opacity,
            side: mat.side,
            alphaTest: mat.alphaTest,
            depthWrite: mat.depthWrite,
            vertexColors: mat.vertexColors,
          });
          if (anyMat.emissive && anyMat.emissive.getHex() !== 0x000000) {
            lambert.emissive.copy(anyMat.emissive);
            lambert.emissiveIntensity = anyMat.emissiveIntensity ?? 1;
          }
          lambert.name = mat.name;
          return lambert;
        }

        return mat;
      };

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(convertMat);
      } else if (mesh.material) {
        mesh.material = convertMat(mesh.material);
      }
    });
  }

  private ensureSkinMaterialBinding(person: PersonObject, up: number): void {
    let bodySkinCount = 0;
    let headSkinCount = 0;

    person.head.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === person.skMat) headSkinCount++;
    });

    for (const child of person.g.children) {
      if (child === person.head) continue;
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material === person.skMat) bodySkinCount++;
      });
    }

    if (headSkinCount === 0) {
      const neckOrSkull = new THREE.Mesh(new THREE.SphereGeometry(0.108, 12, 10), person.skMat);
      neckOrSkull.name = 'Head_Skin';
      person.head.add(neckOrSkull);
    }

    if (bodySkinCount === 0) {
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.11, 8), person.skMat);
      neck.name = 'Body_Skin';
      neck.position.set(0, 1.07 + up, 0);
      person.g.add(neck);
    }
  }

  private mergeStaticMeshes(root: THREE.Object3D, skip: Set<THREE.Object3D>): void {
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();

    const matKey = (m: THREE.Material) => {
      if (m.name === 'Skin_Mat') return `SKIN_${m.uuid}`;
      const a = m as THREE.MeshLambertMaterial;
      return [
        m.type,
        a.color?.getHex(),
        a.emissive?.getHex(),
        a.emissiveIntensity,
        a.map?.uuid,
        m.transparent,
        m.opacity,
        m.blending,
        m.depthWrite,
        m.side,
        m.alphaTest,
      ].join('|');
    };

    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (skip.has(c) || c.userData.habit) continue;
        const m = c as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material)) {
          const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
          const k = matKey(m.material);
          const g = groups.get(k) ?? { mat: m.material, geos: [], meshes: [] };
          g.geos.push(geo);
          g.meshes.push(m);
          groups.set(k, g);
        }
        walk(c);
      }
    };
    walk(root);

    for (const [, { mat, geos, meshes }] of groups) {
      if (meshes.length < 2) {
        geos.forEach((g) => g.dispose());
        continue;
      }
      const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      // Ensure compatible attributes before merging
      const firstAttrs = Object.keys(nonIndexed[0].attributes);
      const canMerge = nonIndexed.every((g) => firstAttrs.every((attr) => !!g.attributes[attr]));
      if (!canMerge) {
        geos.forEach((g) => g.dispose());
        continue;
      }
      const merged = mergeGeometries(nonIndexed, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of meshes) {
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

  /**
   * Returns current loading/fallback status for a given character or model key.
   */
  public getStatus(key: string): ModelLoadStatus {
    return this.status.get(key) ?? 'idle';
  }

  /**
   * Returns a human-readable summary of all tracked character models for debug inspection and tests.
   */
  public getSummary(): { loaded: string[]; fallback: string[]; loading: string[] } {
    const loaded: string[] = [];
    const fallback: string[] = [];
    const loading: string[] = [];
    for (const [k, st] of this.status.entries()) {
      if (st === 'loaded') loaded.push(k);
      else if (st === 'fallback') fallback.push(k);
      else if (st === 'loading') loading.push(k);
    }
    return { loaded, fallback, loading };
  }
}

export const modelLoader = new BlenderModelLoader();

/** Set a material's colour if it has one (imported Skin may be Standard rather than Lambert). */
export function setMaterialColor(mat: THREE.Material, hex: number) {
  const c = (mat as THREE.MeshLambertMaterial).color;
  if (c instanceof THREE.Color) c.setHex(hex);
}
