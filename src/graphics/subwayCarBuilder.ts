/**
 * 3D Subway Car, Station, and Tunnel Environment Builder
 * Renders authentic NYC G-train car interior with PBR materials, stainless steel poles,
 * ergonomic fiberglass seating, responsive sliding doors, and tunnel lighting.
 */
import * as THREE from 'three';
import { PassingTrain, FAR_WALL_Z } from './passingTrain';
import { TrestleBuilder } from './trestleBuilder';
import { ACROSS_ADS, NEAR_ADS, STOPS, AdDefinition } from '../constants';
import { TextureGenerator, hiDpiCanvas } from './textureGenerator';
import { CharacterBuilder, seededRandom } from './characterBuilder';
import { PersonObject } from '../types';

export interface TargetEntry {
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  keep: () => boolean;
}

export interface AdObject {
  def: AdDefinition;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  tid: string;
}

export interface RouteMapObject {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  tid: string;
}

export interface LightSegObject {
  m: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tid: string;
}

export interface WindowPaneObject {
  x: number;
  tid: string;
  decal: THREE.Mesh;
  decalTexSticker: THREE.CanvasTexture;
  decalTexStain: THREE.CanvasTexture;
}

export interface DoorLeaf {
  g: THREE.Group;
  x0: number;
  side: number;
}

export interface StationObject {
  g: THREE.Group;
  baseX: number;
  /** The name on the station's signs. */
  name: string;
  setName: (name: string) => void;
  /** Elevated, open-air platform (21 St on the trestle): no tiled back wall. */
  setOpenAir: (on: boolean) => void;
}

export class SubwayCarBuilder {
  public scene: THREE.Scene;
  public worldGroup: THREE.Group;
  public carGroup: THREE.Group; // Car B (Mid/Center)
  public carAGroup: THREE.Group; // Car A (Lead)
  public carCGroup: THREE.Group; // Car C (Rear)
  public gangwayGroup: THREE.Group;
  public tunnelGroup: THREE.Group;
  public textureGen: TextureGenerator;
  public charBuilder: CharacterBuilder;

  // Gangway Doors & Consist Traversal
  public gangwayDoors = {
    frontAngle: 0,
    frontTarget: 0,
    frontGroup: null as THREE.Group | null,
    rearAngle: 0,
    rearTarget: 0,
    rearGroup: null as THREE.Group | null,
  };

  public static readonly LIGHT_ON = 0xfff4de;

  // Game world elements
  /**
   * The 12 ceiling lights, 4 per car. Game code sets their intensity and colour as before, but
   * they aren't rendered: every point light in the scene costs every lit pixel, near or far.
   * `lightPool` holds the few real lights, which copy the ceiling lights nearest the camera each
   * frame (see updateLightPool).
   */
  public carLights: THREE.PointLight[] = [];
  public lightPool: THREE.PointLight[] = [];
  private poolSlot: number[] = [];
  private poolFade: number[] = [];
  private readonly lightWorld: THREE.Vector3[] = [];
  private readonly lightOrder: number[] = [];
  private readonly tmpV = new THREE.Vector3();
  public hemiLight!: THREE.HemisphereLight;
  public ambLight!: THREE.AmbientLight;
  public outLights: THREE.PointLight[] = [];
  public lightSegs: LightSegObject[] = [];
  public farLeaves: DoorLeaf[] = [];
  public panes: WindowPaneObject[] = [];
  public acrossAds: AdObject[] = [];
  public nearAds: AdObject[] = [];
  public maps: RouteMapObject[] = [];
  public tunnelItems: Array<{ m: THREE.Mesh; base: number; s: number; light?: boolean }> = [];
  public tunnelLength: number = 84;
  /** The two long tunnel walls; the engine slides them to make the tunnel mouth. */
  public tunnelWalls: THREE.Mesh[] = [];
  /** A train on the other track, now and then (gameState schedules it). */
  public passingTrain!: PassingTrain;
  public trestle!: TrestleBuilder;

  public stA!: StationObject;
  public stB!: StationObject;

  // Characters
  public parents: PersonObject[] = [];
  public strangers: PersonObject[] = [];
  public extraPerson!: PersonObject;
  public crowd: PersonObject[] = [];
  public carAPassengers: PersonObject[] = [];
  public carCPassengers: PersonObject[] = [];

  // Target registry for gaze & flagging
  public registry: TargetEntry[] = [];
  public targetLabels: Record<string, string> = {};

  constructor(scene: THREE.Scene, maxAniso: number = 8) {
    this.scene = scene;
    this.textureGen = new TextureGenerator(maxAniso);
    this.charBuilder = new CharacterBuilder();
    this.worldGroup = new THREE.Group();
    this.carGroup = new THREE.Group();
    this.carAGroup = new THREE.Group();
    this.carCGroup = new THREE.Group();
    this.gangwayGroup = new THREE.Group();
    this.tunnelGroup = new THREE.Group();

    this.scene.add(this.worldGroup);
    this.worldGroup.add(this.carGroup);
    this.worldGroup.add(this.carAGroup);
    this.worldGroup.add(this.carCGroup);
    this.worldGroup.add(this.gangwayGroup);
    this.worldGroup.add(this.tunnelGroup);
  }

  /** Real lights standing in for the nearest ceiling lights. A fixed count: no shader recompiles. */
  public static readonly LIGHT_POOL_SIZE = 4;
  /** Seconds for a light to fade in when it takes over a new ceiling slot. */
  private static readonly POOL_FADE_S = 0.2;

  private buildLightPool() {
    this.carLights.forEach((l) => {
      l.visible = false; // stays in its car for position and game logic; not rendered
      this.lightWorld.push(new THREE.Vector3());
      this.lightOrder.push(this.lightOrder.length);
    });
    for (let i = 0; i < SubwayCarBuilder.LIGHT_POOL_SIZE; i++) {
      const pl = new THREE.PointLight(0xfff0d4, 0, 9.5, 1.6);
      this.worldGroup.add(pl);
      this.lightPool.push(pl);
      this.poolSlot.push(-1);
      this.poolFade.push(1);
    }
  }

  /** Point the pool at the ceiling lights nearest `camWorld`, copying their intensity, colour and range. */
  public updateLightPool(camWorld: THREE.Vector3, dt: number) {
    const n = this.carLights.length;
    if (!n || !this.lightPool.length) return;
    const lit = (i: number) => {
      const p = this.carLights[i].parent;
      return !!p && p.visible;
    };
    for (let i = 0; i < n; i++) {
      this.carLights[i].getWorldPosition(this.lightWorld[i]);
      this.lightOrder[i] = i;
    }
    const d = (i: number) => (lit(i) ? this.lightWorld[i].distanceToSquared(camWorld) : Infinity);
    this.lightOrder.sort((a, b) => d(a) - d(b));
    const K = this.lightPool.length;
    const wanted = this.lightOrder.slice(0, K).filter((i) => d(i) < Infinity);
    // Pool lights keep slots that are still wanted; free ones take the new slots and fade in.
    for (let p = 0; p < K; p++) if (!wanted.includes(this.poolSlot[p])) this.poolSlot[p] = -1;
    for (const slot of wanted) {
      if (this.poolSlot.includes(slot)) continue;
      const free = this.poolSlot.indexOf(-1);
      if (free < 0) break;
      this.poolSlot[free] = slot;
      this.poolFade[free] = 0;
    }
    for (let p = 0; p < K; p++) {
      const pl = this.lightPool[p];
      const slot = this.poolSlot[p];
      if (slot < 0) {
        pl.intensity = 0;
        continue;
      }
      const src = this.carLights[slot];
      this.poolFade[p] = Math.min(1, this.poolFade[p] + dt / SubwayCarBuilder.POOL_FADE_S);
      pl.position.copy(this.worldGroup.worldToLocal(this.tmpV.copy(this.lightWorld[slot])));
      pl.intensity = src.intensity * this.poolFade[p];
      pl.color.copy(src.color);
      pl.distance = src.distance;
      pl.decay = src.decay;
    }
  }

  public registerTarget(root: THREE.Object3D, tid: string, label: string, keep: () => boolean = () => true) {
    const meshes: THREE.Mesh[] = [];
    root.userData.tid = tid;
    root.userData.targetMeshes = meshes;
    root.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        m.userData.tid = tid;
        meshes.push(m as THREE.Mesh);
      }
    });
    this.registry.push({ root, meshes, keep });
    this.targetLabels[tid] = label;
  }

  public getActiveTargets(): THREE.Mesh[] {
    const active: THREE.Mesh[] = [];
    this.registry.forEach((entry) => {
      if (entry.keep() || entry.root.visible) {
        active.push(...entry.meshes);
      }
    });
    return active;
  }

  public buildScene() {
    this.setupLighting();
    this.buildCar();
    this.buildAdjacentCars();
    this.buildLightPool(); // after every car's ceiling lights exist
    this.buildGangways();
    this.buildAds();
    this.buildRouteMaps();
    this.buildPassengers();
    this.buildTunnel();
    this.passingTrain = new PassingTrain(this.worldGroup);
    this.trestle = new TrestleBuilder(this.worldGroup);
    this.stA = this.buildStationPlatform();
    this.stB = this.buildStationPlatform();
  }

  private setupLighting() {
    // Ground colour raised a little: light bouncing off the floor, so legs and shoes near the
    // camera keep a readable silhouette instead of falling into pure black. Still a dark car.
    this.hemiLight = new THREE.HemisphereLight(0xfff3dc, 0x5a5850, 0.65);
    this.scene.add(this.hemiLight);

    this.ambLight = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(this.ambLight);

    // 4 interior car ceiling lights
    this.carLights = [-6, -2, 2, 6].map((x) => {
      const pl = new THREE.PointLight(0xfff0d4, 0.55, 9.5, 1.6);
      pl.position.set(x, 2.2, 0);
      this.carGroup.add(pl);
      return pl;
    });

    // Passing exterior tunnel lights
    this.outLights = [-1, 1].map((s) => {
      const pl = new THREE.PointLight(0xffcf8a, 0, 4.5, 2.0);
      pl.position.set(0, 1.6, s * 2.1);
      this.worldGroup.add(pl);
      return pl;
    });
  }

  private buildCar() {
    const mWall = new THREE.MeshLambertMaterial({ color: 0xc9ccc4 });
    const mLow = new THREE.MeshLambertMaterial({ color: 0x9fa49e });
    const mSeatOrange = new THREE.MeshLambertMaterial({ color: 0xd8782e });
    const mSeatYellow = new THREE.MeshLambertMaterial({ color: 0xdf9c32 });
    const mBase = new THREE.MeshLambertMaterial({ color: 0x4a4d4f });
    const mDoor = new THREE.MeshLambertMaterial({ color: 0xb2b7b2 });
    const mDark = new THREE.MeshBasicMaterial({ color: 0x060809 });
    const mSteel = new THREE.MeshStandardMaterial({
      color: 0xdcdede,
      metalness: 0.85,
      roughness: 0.22,
    });

    // Floor with non-slip speckle texture
    const floorTex = this.textureGen.createFloorTexture();
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 3.06), floorMat);
    floor.position.set(0, -0.03, 0);
    this.carGroup.add(floor);

    // Tactile door entrance strips
    const tactileTex = this.textureGen.createTactileStripTexture();
    const tactileMat = new THREE.MeshBasicMaterial({ map: tactileTex });
    [-4.5, 4.5].forEach((x) => {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.22), tactileMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, 0.002, -1.38);
      this.carGroup.add(strip);
    });

    // Ceiling
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 3.06), new THREE.MeshLambertMaterial({ color: 0xe6e4db }));
    ceil.position.set(0, 2.43, 0);
    this.carGroup.add(ceil);

    // Ceiling Lights (continuous luminaire strip)
    const LIGHT_ON = SubwayCarBuilder.LIGHT_ON;
    [-0.62, 0.62].forEach((z, si) => {
      for (let i = 0; i < 6; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: LIGHT_ON });
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.03, 0.2), mat);
        m.position.set(-7.25 + i * 2.9, 2.395, z);
        this.carGroup.add(m);

        const ls: LightSegObject = { m, mat, tid: `light:${si * 6 + i}` };
        this.lightSegs.push(ls);
        this.registerTarget(m, ls.tid, 'a ceiling light');
      }
    });

    // Walls, windows, sliding doors, and poles
    [-1, 1].forEach((s) => {
      const z = s * 1.53;
      // Lower wall kickboard
      const lowWall = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 0.06), mLow);
      lowWall.position.set(0, 0.45, z);
      this.carGroup.add(lowWall);

      // Upper wall with ad frieze
      const upWall = new THREE.Mesh(new THREE.BoxGeometry(18, 0.68, 0.06), mWall);
      upWall.position.set(0, 2.06, z);
      this.carGroup.add(upWall);

      // Window vertical mullions
      for (let i = 0; i <= 9; i++) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.08), mWall);
        mullion.position.set(-8.55 + i * 1.9, 1.325, z);
        this.carGroup.add(mullion);
      }

      // Tinted window glass
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 0.85),
        new THREE.MeshBasicMaterial({ color: 0x6e8e89, transparent: true, opacity: 0.08, depthWrite: false })
      );
      glass.position.set(0, 1.325, z - s * 0.01);
      if (s > 0) glass.rotation.y = Math.PI;
      this.carGroup.add(glass);

      // Sliding doors at x = -4.5 and +4.5
      [-4.5, 4.5].forEach((x) => {
        if (s < 0) {
          // Far side: actual animated opening leaves
          [-1, 1].forEach((side) => {
            const g = new THREE.Group();
            g.position.set(x + side * 0.335, 1.0, z + 0.045);
            this.carGroup.add(g);

            const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.66, 2.0, 0.05), mDoor);
            const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.62, 0.056), mDark);
            win.position.set(0, 0.36, 0);
            const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.0, 0.054), new THREE.MeshLambertMaterial({ color: 0x333333 }));
            rubber.position.set(-side * 0.32, 0, 0);
            g.add(leaf, win, rubber);

            this.farLeaves.push({ g, x0: x + side * 0.335, side });
          });

          // Door top header housing
          const header = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.06, 0.08), new THREE.MeshLambertMaterial({ color: 0x50544f }));
          header.position.set(x, 2.02, z + 0.03);
          this.carGroup.add(header);
        } else {
          // Near side doors
          const staticDoor = new THREE.Mesh(new THREE.BoxGeometry(1.34, 2.0, 0.05), mDoor);
          staticDoor.position.set(x, 1.0, z - 0.045);
          [-0.3, 0.3].forEach((dx) => {
            const w = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.62, 0.056), mDark);
            w.position.set(x + dx, 1.36, z - 0.052);
            this.carGroup.add(w);
          });
          this.carGroup.add(staticDoor);
        }
      });

      // Scooped molded subway benches
      [[-8.85, -5.25], [-3.75, 3.75], [5.25, 8.85]].forEach(([a, b], bIdx) => {
        const L = b - a;
        const cx = (a + b) / 2;
        const seatMat = bIdx % 2 === 0 ? mSeatOrange : mSeatYellow;

        // Seat base cushion
        const baseCushion = new THREE.Mesh(new THREE.BoxGeometry(L, 0.09, 0.46), seatMat);
        baseCushion.position.set(cx, 0.455, s * 1.25);

        // Seat backrest
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, 0.07), seatMat);
        backrest.position.set(cx, 0.76, s * 1.47);

        // Underseat heater / riser box
        const under = new THREE.Mesh(new THREE.BoxGeometry(L, 0.41, 0.36), mBase);
        under.position.set(cx, 0.205, s * 1.3);

        this.carGroup.add(baseCushion, backrest, under);
      });

      // Horizontal overhead grab bar
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 17.6, 12), mSteel);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 2.02, s * 0.98);
      this.carGroup.add(bar);

      // Vertical stanchion poles
      [-5.3, -3.7, 3.7, 5.3].forEach((x) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.42, 12), mSteel);
        pole.position.set(x, 1.21, s * 0.98);
        this.carGroup.add(pole);
      });
    });

    // End car bulkheads with open inter-car gangway doorways
    [-9, 9].forEach((x, endIdx) => {
      // Left bulkhead wall panel
      const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 1.05), mWall);
      wallLeft.position.set(x, 1.2, -0.98);

      // Right bulkhead wall panel
      const wallRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 1.05), mWall);
      wallRight.position.set(x, 1.2, 0.98);

      // Top doorway header lintel
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.96), mWall);
      lintel.position.set(x, 2.22, 0);

      this.carGroup.add(wallLeft, wallRight, lintel);

      // Gangway door frame
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3c3a, metalness: 0.6, roughness: 0.4 });
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.05, 0.94), frameMat);
      doorFrame.position.set(x, 1.025, 0);
      this.carGroup.add(doorFrame);

      // Interactive swinging gangway door
      const doorPivot = new THREE.Group();
      doorPivot.position.set(x, 0, -0.44);
      this.carGroup.add(doorPivot);

      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.0, 0.88), mDoor);
      doorMesh.position.set(0, 1.0, 0.44);

      // Wire-reinforced transit safety window
      const doorWin = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.78, 0.32),
        new THREE.MeshBasicMaterial({ color: 0x44554e, transparent: true, opacity: 0.35 })
      );
      doorWin.position.set(0, 1.28, 0.44);

      // Heavy transit pull handle
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 8), mSteel);
      handle.position.set(0.04, 1.0, 0.78);

      doorPivot.add(doorMesh, doorWin, handle);

      if (endIdx === 0) {
        // Front door (to Car A)
        this.gangwayDoors.frontGroup = doorPivot;
        this.registerTarget(doorMesh, 'gangway:front', 'the gangway door to Car A');
      } else {
        // Rear door (to Car C)
        this.gangwayDoors.rearGroup = doorPivot;
        this.registerTarget(doorMesh, 'gangway:rear', 'the gangway door to Car C');
      }
    });

    // Windows hit detection panes and decal anomalies
    const decalSticker = this.textureGen.createDecalTexture('sticker');
    const decalStain = this.textureGen.createDecalTexture('stain');

    this.panes = [-7.6, -1.9, 0, 1.9, 7.6].map((x, i) => {
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(x, 1.325, -1.47);
      this.carGroup.add(hit);

      const tid = `win:${i}`;
      this.registerTarget(hit, tid, 'a window', () => true);

      // Anomaly decal
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(0.28, 0.28),
        new THREE.MeshBasicMaterial({
          map: decalSticker,
          transparent: true,
          alphaTest: 0.04,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      decal.position.set(x + (Math.random() - 0.5) * 0.8, 1.25 + Math.random() * 0.3, -1.505);
      // Each pane's decal sits a little differently, so repeats don't look stamped.
      const vary = seededRandom(tid);
      decal.rotation.z = (vary() - 0.5) * 0.6;
      decal.scale.setScalar(0.85 + vary() * 0.3);
      decal.visible = false;
      decal.userData.tid = tid;
      this.carGroup.add(decal);

      return {
        x,
        tid,
        decal,
        decalTexSticker: decalSticker,
        decalTexStain: decalStain,
      };
    });
  }

  private buildAds() {
    // Across ads (far wall, upper panel)
    const acrossXs = [-7, -2.6, 0, 2.6, 7];
    this.acrossAds = ACROSS_ADS.map((def, i) => {
      const canvas = hiDpiCanvas(640, 200);
      this.textureGen.drawAdOnCanvas(canvas, def, def.h);
      const tex = this.textureGen.textTexture(canvas);

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.406),
        new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      );
      mesh.position.set(acrossXs[i], 2.07, -1.47);
      this.carGroup.add(mesh);

      // Ad frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.46, 0.012), new THREE.MeshLambertMaterial({ color: 0x363936 }));
      frame.position.set(acrossXs[i], 2.07, -1.488);
      this.carGroup.add(frame);

      const ad: AdObject = { def, canvas, tex, mesh, tid: 'ad:' + def.h };
      this.registerTarget(mesh, ad.tid, `the ${def.h.toLowerCase()} ad`);
      return ad;
    });

    // Near ads (wall behind player)
    const nearXs = [-7, -2.6, 2.6, 7];
    this.nearAds = NEAR_ADS.map((def, i) => {
      const canvas = hiDpiCanvas(640, 200);
      this.textureGen.drawAdOnCanvas(canvas, def, def.h);
      const tex = this.textureGen.textTexture(canvas);

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.406),
        new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      );
      mesh.position.set(nearXs[i], 2.07, 1.47);
      mesh.rotation.y = Math.PI;
      this.carGroup.add(mesh);

      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.46, 0.012), new THREE.MeshLambertMaterial({ color: 0x363936 }));
      frame.position.set(nearXs[i], 2.07, 1.488);
      this.carGroup.add(frame);

      const ad: AdObject = { def, canvas, tex, mesh, tid: 'ad:' + def.h };
      this.registerTarget(mesh, ad.tid, `the ${def.h.toLowerCase()} ad`);
      return ad;
    });
  }

  private buildRouteMaps() {
    [-4.5, 4.5].forEach((x, i) => {
      const canvas = hiDpiCanvas(640, 160);
      this.textureGen.drawRouteMap(canvas, 'normal');
      const tex = this.textureGen.textTexture(canvas);

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.22, 0.31),
        new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      );
      mesh.position.set(x, 2.12, -1.475);
      this.carGroup.add(mesh);

      const mapObj: RouteMapObject = { canvas, tex, mesh, tid: 'map:' + i };
      this.maps.push(mapObj);
      this.registerTarget(mesh, mapObj.tid, 'the route map');
    });
  }

  private buildPassengers() {
    // Mom (sitting across on left)
    const mom = this.charBuilder.createPerson({
      tid: 'mom',
      label: 'Mom',
      x: -0.95,
      z: -1.3,
      skin: 0xc68e6c,
      shirt: 0x7a4a5e,
      pants: 0x2c3140,
      hair: 0x2a1c16,
      longHair: true,
      phone: true,
    });
    mom.i = 0;
    this.parents.push(mom);
    this.carGroup.add(mom.g);
    this.registerTarget(mom.g, 'mom', 'Mom');

    // Dad (sitting next to Mom)
    const dad = this.charBuilder.createPerson({
      tid: 'dad',
      label: 'Dad',
      x: -0.3,
      z: -1.3,
      skin: 0xb98062,
      shirt: 0x3e5a6e,
      pants: 0x3a3a36,
      hair: 0x1c1a18,
      glasses: true,
      phone: true,
    });
    dad.i = 1;
    this.parents.push(dad);
    this.carGroup.add(dad.g);
    this.registerTarget(dad.g, 'dad', 'Dad');

    // Strangers
    // s1: The man across the aisle
    const s1 = this.charBuilder.createPerson({
      tid: 's1',
      label: 'the man across the aisle',
      archetype: 'mta',
      x: 2.35,
      z: -1.3,
      hp: 0.35,
      skin: 0x8a5a3c,
      shirt: 0x5b6b3a,
      pants: 0x222222,
      hair: 0x111111,
    });
    // s2: The woman on your bench
    const s2 = this.charBuilder.createPerson({
      tid: 's2',
      label: 'the woman on your bench',
      archetype: 'coat',
      x: -2.6,
      z: 1.3,
      ry: Math.PI,
      hp: 0.25,
      skin: 0xe0b89a,
      shirt: 0x9a9a90,
      pants: 0x40404a,
      hair: 0x9b968d,
      longHair: true,
    });
    // s3: The standing commuter
    const s3 = this.charBuilder.createPerson({
      tid: 's3',
      label: 'the standing passenger',
      archetype: 'puffer',
      x: 5.0,
      z: 0.55,
      ry: -Math.PI / 2,
      hy: 0.2,
      standing: true,
      skin: 0xa47050,
      shirt: 0x2d2d33,
      pants: 0x51514a,
      hair: 0x191512,
    });

    this.strangers = [s1, s2, s3];
    this.strangers.forEach((s) => {
      this.carGroup.add(s.g);
      this.registerTarget(s.g, s.tid, s.label);
    });

    // Mystery extra passenger (spawned at far seat during anomaly)
    this.extraPerson = this.charBuilder.createPerson({
      tid: 'seat6',
      label: 'the seat at the far end',
      x: 6.4,
      z: -1.3,
      hp: 0.1,
      skin: 0xd9c2a8,
      shirt: 0x1c1c1c,
      pants: 0x1c1c1c,
      hair: 0x0c0c0c,
    });
    this.extraPerson.g.visible = false;
    this.carGroup.add(this.extraPerson.g);
    this.registerTarget(this.extraPerson.g, this.extraPerson.tid, this.extraPerson.label);

    // Crowd (for crowded stops 7 and 8)
    this.crowd = [
      this.charBuilder.createPerson({ tid: 'c1', label: 'a passenger in the aisle', archetype: 'hoodie', x: 3.0, z: 0.5, ry: -Math.PI / 2, standing: true, hy: -0.3, skin: 0x9b6a4a, shirt: 0x6b2f2f, pants: 0x2a2a2a, hair: 0x111111 }),
      this.charBuilder.createPerson({ tid: 'c2', label: 'a passenger at the end', archetype: 'texter', x: -6.6, z: -1.3, hp: 0.4, skin: 0xe2c4a8, shirt: 0x3d5f8a, pants: 0x2e2e3a, hair: 0x6a4a2a }),
      this.charBuilder.createPerson({ tid: 'c3', label: 'a passenger behind you', archetype: 'overcoat', x: 6.0, z: 1.3, ry: Math.PI, hp: 0.3, skin: 0x7a4e34, shirt: 0xc7a64a, pants: 0x2a2a2a, hair: 0x0e0e0e }),
      this.charBuilder.createPerson({ tid: 'c4', label: 'a passenger by the door', archetype: 'office', x: -3.2, z: -0.25, ry: Math.PI / 2, standing: true, skin: 0xc99a7a, shirt: 0x4d4d4d, pants: 0x3c3326, hair: 0x2a1a10 }),
      this.charBuilder.createPerson({ tid: 'c5', label: 'a passenger across', x: 3.15, z: -1.3, hp: 0.5, skin: 0xb07a58, shirt: 0x7a7a3a, pants: 0x262626, hair: 0x1a1a1a }),
    ];
    this.crowd.forEach((c) => {
      c.g.visible = false;
      this.carGroup.add(c.g);
      this.registerTarget(c.g, c.tid, c.label, () => c.g.visible);
    });
  }

  private buildTunnel() {
    const mTunnelWall = new THREE.MeshLambertMaterial({ color: 0x181a18 });
    const mTunnelColumn = new THREE.MeshLambertMaterial({ color: 0x242724 });
    const mTunnelLight = new THREE.MeshBasicMaterial({ color: 0xffd896 });

    [-1, 1].forEach((s) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(400, 3.4, 0.1), mTunnelWall);
      // The far side (+z, behind your seat) is wide enough for a second track: see passingTrain.ts.
      wall.position.set(0, 1.1, s > 0 ? FAR_WALL_Z : -2.55);
      this.tunnelGroup.add(wall);
      this.tunnelWalls.push(wall);

      // Tunnel incandescent lights
      for (let i = 0; i < 12; i++) {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.06), mTunnelLight);
        fixture.position.set(0, 1.78, s * 2.36);
        this.tunnelGroup.add(fixture);
        this.tunnelItems.push({ m: fixture, base: i * 7 + (s > 0 ? 3.5 : 0), s, light: true });
      }

      // Concrete tunnel support piers
      for (let i = 0; i < 28; i++) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.3, 0.2), mTunnelColumn);
        pier.position.set(0, 1.1, s * 2.4);
        this.tunnelGroup.add(pier);
        this.tunnelItems.push({ m: pier, base: i * 3 + (s > 0 ? 1.5 : 0), s });
      }

      // Trackside signal lantern markers
      const sigColor = s > 0 ? 0xdf8c18 : 0x2e7d32;
      const sigLensMat = new THREE.MeshBasicMaterial({ color: sigColor });
      for (let i = 0; i < 6; i++) {
        const sig = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 0.12), mTunnelColumn);
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), sigLensMat);
        lens.position.set(0, 0.04, 0.06);
        sig.add(lens);
        sig.position.set(0, 1.55, s * 2.4);
        this.tunnelGroup.add(sig);
        this.tunnelItems.push({ m: sig, base: i * 14 + (s > 0 ? 5 : 2), s });
      }
    });
  }

  private buildStationPlatform(): StationObject {
    const g = new THREE.Group();
    this.worldGroup.add(g);

    // Platform tiled wall
    const tileTex = this.textureGen.createStationTileTexture(72, 5);
    const tileMat = new THREE.MeshLambertMaterial({ map: tileTex, emissive: 0x22211c });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(44, 3.2, 0.1), tileMat);
    wall.position.set(0, 1.3, -2.28);
    g.add(wall);

    // Decorative G-line green mosaic trim band
    const greenTrim = new THREE.Mesh(new THREE.BoxGeometry(44, 0.16, 0.02), new THREE.MeshLambertMaterial({ color: 0x3f7a52, emissive: 0x0c1a10 }));
    greenTrim.position.set(0, 2.3, -2.225);
    g.add(greenTrim);

    // Platform concrete floor
    const platform = new THREE.Mesh(new THREE.BoxGeometry(44, 0.14, 0.8), new THREE.MeshLambertMaterial({ color: 0x8d8a82 }));
    platform.position.set(0, -0.07, -1.95);
    g.add(platform);

    // Yellow platform safety edge line
    const yellowEdge = new THREE.Mesh(new THREE.BoxGeometry(44, 0.01, 0.12), new THREE.MeshLambertMaterial({ color: 0xe3c341, emissive: 0x332a08 }));
    yellowEdge.position.set(0, 0.005, -1.62);
    g.add(yellowEdge);

    // Structural steel I-beam columns
    const colMat = new THREE.MeshLambertMaterial({ color: 0x2d4838 });
    for (let x = -20; x <= 20; x += 5) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.0, 0.18), colMat);
      col.position.set(x, 1.5, -1.9);
      g.add(col);
    }

    // Station name tablets
    const { texture: signTex, canvas: signCanvas } = this.textureGen.createStationSignTexture(STOPS[1]);
    for (let x = -15; x <= 15; x += 10) {
      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.35), new THREE.MeshBasicMaterial({ map: signTex }));
      signMesh.position.set(x + 2.5, 1.75, -2.2);
      g.add(signMesh);
    }

    // Station ceiling lamps
    const stationLightMat = new THREE.MeshBasicMaterial({ color: 0xfff5e0 });
    for (let x = -20; x <= 20; x += 4) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), stationLightMat);
      lamp.position.set(x, 2.8, -1.95);
      g.add(lamp);
    }

    // Platform commuter shadow silhouettes (eerie PS1 ambient commuter figures standing quietly)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0c0e0c });
    const silhouetteCoords = [
      { x: -14, z: -2.12, rotY: Math.PI / 2, coat: true },
      { x: -8, z: -2.0, rotY: 0.1, coat: false },
      { x: 3, z: -2.14, rotY: -Math.PI / 4, coat: true },
      { x: 12, z: -2.02, rotY: Math.PI, coat: false },
    ];
    silhouetteCoords.forEach((sc) => {
      const fig = new THREE.Group();
      const bodyH = sc.coat ? 1.05 : 0.88;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, bodyH, 0.22), shadowMat);
      body.position.set(0, bodyH / 2 + 0.45, 0);
      fig.add(body);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), shadowMat);
      head.position.set(0, bodyH + 0.62, 0);
      fig.add(head);

      [-0.09, 0.09].forEach((dx) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.14), shadowMat);
        leg.position.set(dx, 0.25, 0);
        fig.add(leg);
      });

      fig.position.set(sc.x, 0.005, sc.z);
      fig.rotation.y = sc.rotY;
      fig.userData.platformSilhouette = true;
      g.add(fig);
    });

    const stationObj: StationObject = {
      g,
      baseX: 0,
      name: '',
      setName: (name: string) => {
        stationObj.name = name;
        this.textureGen.drawStationSign(signCanvas.getContext('2d')!, name);
        signTex.needsUpdate = true;
      },
      setOpenAir: (on: boolean) => {
        wall.visible = !on;
        greenTrim.visible = !on;
      },
    };

    return stationObj;
  }

  /**
   * Builds Car A (Lead car at x = -19.5) and Car C (Rear car at x = +19.5)
   */
  private buildAdjacentCars() {
    const mWall = new THREE.MeshLambertMaterial({ color: 0xc9ccc4 });
    const mLow = new THREE.MeshLambertMaterial({ color: 0x9fa49e });
    const mSeatOrange = new THREE.MeshLambertMaterial({ color: 0xd8782e });
    const mSeatYellow = new THREE.MeshLambertMaterial({ color: 0xdf9c32 });
    const mBase = new THREE.MeshLambertMaterial({ color: 0x4a4d4f });
    const mDark = new THREE.MeshBasicMaterial({ color: 0x060809 });
    const mSteel = new THREE.MeshStandardMaterial({ color: 0xdcdede, metalness: 0.85, roughness: 0.22 });
    const floorTex = this.textureGen.createFloorTexture();
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });

    // CAR A (Lead Consist Car, centered at x = -19.5, length 18m)
    const floorA = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 3.06), floorMat);
    floorA.position.set(-19.5, -0.03, 0);
    const ceilA = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 3.06), new THREE.MeshLambertMaterial({ color: 0xe6e4db }));
    ceilA.position.set(-19.5, 2.43, 0);
    this.carAGroup.add(floorA, ceilA);

    // Car A lights
    [-25.5, -21.5, -17.5, -13.5].forEach((x) => {
      const pl = new THREE.PointLight(0xfff0d4, 0.5, 9.0, 1.6);
      pl.position.set(x, 2.2, 0);
      this.carAGroup.add(pl);
      this.carLights.push(pl);
    });

    // Car A walls, benches, and poles
    [-1, 1].forEach((s) => {
      const z = s * 1.53;
      const lowWall = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 0.06), mLow);
      lowWall.position.set(-19.5, 0.45, z);
      const upWall = new THREE.Mesh(new THREE.BoxGeometry(18, 0.68, 0.06), mWall);
      upWall.position.set(-19.5, 2.06, z);
      this.carAGroup.add(lowWall, upWall);

      // Benches in Car A
      [[-27.5, -23.5], [-22.5, -16.5], [-15.5, -11.5]].forEach(([a, b], bIdx) => {
        const L = b - a;
        const cx = (a + b) / 2;
        const seatMat = bIdx % 2 === 0 ? mSeatOrange : mSeatYellow;
        const baseCushion = new THREE.Mesh(new THREE.BoxGeometry(L, 0.09, 0.46), seatMat);
        baseCushion.position.set(cx, 0.455, s * 1.25);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, 0.07), seatMat);
        backrest.position.set(cx, 0.76, s * 1.47);
        const under = new THREE.Mesh(new THREE.BoxGeometry(L, 0.41, 0.36), mBase);
        under.position.set(cx, 0.205, s * 1.3);
        this.carAGroup.add(baseCushion, backrest, under);
      });

      // Grab bar and poles
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 17.6, 10), mSteel);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(-19.5, 2.02, s * 0.98);
      this.carAGroup.add(bar);

      [-24.0, -15.0].forEach((x) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.42, 10), mSteel);
        pole.position.set(x, 1.21, s * 0.98);
        this.carAGroup.add(pole);
      });
    });

    // Car A Lead Cab Bulkhead (x = -28.5)
    const cabWallA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 3.06), mWall);
    cabWallA.position.set(-28.5, 1.2, 0);
    const cabDoorA = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.8, 0.8), mDark);
    cabDoorA.position.set(-28.5, 1.0, 0);
    this.carAGroup.add(cabWallA, cabDoorA);

    // Car A Rear Gangway Doorway (x = -10.5)
    const wallLeftA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 1.05), mWall);
    wallLeftA.position.set(-10.5, 1.2, -0.98);
    const wallRightA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 1.05), mWall);
    wallRightA.position.set(-10.5, 1.2, 0.98);
    const lintelA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.96), mWall);
    lintelA.position.set(-10.5, 2.22, 0);
    this.carAGroup.add(wallLeftA, wallRightA, lintelA);

    // Car A Passengers
    const pa1 = this.charBuilder.createPerson({
      tid: 'pa1',
      label: 'the commuter reading in Car A',
      archetype: 'office',
      x: -18.5,
      z: -1.3,
      hp: 0.3,
      skin: 0xd2a679,
      shirt: 0x4a5d4e,
      pants: 0x222629,
      hair: 0x1c1a17,
    });
    const pa2 = this.charBuilder.createPerson({
      tid: 'pa2',
      label: 'the commuter staring ahead in Car A',
      archetype: 'overcoat',
      x: -22.0,
      z: 1.3,
      ry: Math.PI,
      hp: 0.15,
      skin: 0xa67458,
      shirt: 0x8c5e38,
      pants: 0x333333,
      hair: 0x090909,
    });
    this.carAPassengers = [pa1, pa2];
    this.carAPassengers.forEach((p) => {
      this.carAGroup.add(p.g);
      this.registerTarget(p.g, p.tid, p.label);
    });

    // CAR C (Rear Consist Car, centered at x = +19.5, length 18m)
    const floorC = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 3.06), floorMat);
    floorC.position.set(19.5, -0.03, 0);
    const ceilC = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 3.06), new THREE.MeshLambertMaterial({ color: 0xe6e4db }));
    ceilC.position.set(19.5, 2.43, 0);
    this.carCGroup.add(floorC, ceilC);

    // Car C lights
    [13.5, 17.5, 21.5, 25.5].forEach((x) => {
      const pl = new THREE.PointLight(0xfff0d4, 0.5, 9.0, 1.6);
      pl.position.set(x, 2.2, 0);
      this.carCGroup.add(pl);
      this.carLights.push(pl);
    });

    // Car C walls, benches, and poles
    [-1, 1].forEach((s) => {
      const z = s * 1.53;
      const lowWall = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 0.06), mLow);
      lowWall.position.set(19.5, 0.45, z);
      const upWall = new THREE.Mesh(new THREE.BoxGeometry(18, 0.68, 0.06), mWall);
      upWall.position.set(19.5, 2.06, z);
      this.carCGroup.add(lowWall, upWall);

      // Benches in Car C
      [[11.5, 15.5], [16.5, 22.5], [23.5, 27.5]].forEach(([a, b], bIdx) => {
        const L = b - a;
        const cx = (a + b) / 2;
        const seatMat = bIdx % 2 === 0 ? mSeatOrange : mSeatYellow;
        const baseCushion = new THREE.Mesh(new THREE.BoxGeometry(L, 0.09, 0.46), seatMat);
        baseCushion.position.set(cx, 0.455, s * 1.25);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, 0.07), seatMat);
        backrest.position.set(cx, 0.76, s * 1.47);
        const under = new THREE.Mesh(new THREE.BoxGeometry(L, 0.41, 0.36), mBase);
        under.position.set(cx, 0.205, s * 1.3);
        this.carCGroup.add(baseCushion, backrest, under);
      });

      // Grab bar and poles
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 17.6, 10), mSteel);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(19.5, 2.02, s * 0.98);
      this.carCGroup.add(bar);

      [15.0, 24.0].forEach((x) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.42, 10), mSteel);
        pole.position.set(x, 1.21, s * 0.98);
        this.carCGroup.add(pole);
      });
    });

    // Car C Front Gangway Doorway (x = +10.5)
    const wallLeftC = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 1.05), mWall);
    wallLeftC.position.set(10.5, 1.2, -0.98);
    const wallRightC = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 1.05), mWall);
    wallRightC.position.set(10.5, 1.2, 0.98);
    const lintelC = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.96), mWall);
    lintelC.position.set(10.5, 2.22, 0);
    this.carCGroup.add(wallLeftC, wallRightC, lintelC);

    // Car C Rear Cab Bulkhead (x = +28.5)
    const cabWallC = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.46, 3.06), mWall);
    cabWallC.position.set(28.5, 1.2, 0);
    const cabDoorC = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.8, 0.8), mDark);
    cabDoorC.position.set(28.5, 1.0, 0);
    this.carCGroup.add(cabWallC, cabDoorC);

    // Car C Passengers
    const pc1 = this.charBuilder.createPerson({
      tid: 'pc1',
      label: 'the passenger holding the pole in Car C',
      archetype: 'texter',
      x: 17.0,
      z: 0.55,
      ry: -Math.PI / 2,
      standing: true,
      skin: 0xbf8050,
      shirt: 0x2e3b52,
      pants: 0x1f2022,
      hair: 0x181512,
    });
    const pc2 = this.charBuilder.createPerson({
      tid: 'pc2',
      label: 'the hooded passenger in Car C',
      archetype: 'hoodie',
      x: 23.5,
      z: -1.3,
      hp: 0.4,
      skin: 0xe6c2a5,
      shirt: 0x1f1f24,
      pants: 0x2d2d33,
      hair: 0x0a0a0c,
    });
    this.carCPassengers = [pc1, pc2];
    this.carCPassengers.forEach((p) => {
      this.carCGroup.add(p.g);
      this.registerTarget(p.g, p.tid, p.label);
    });
  }

  /**
   * Builds the inter-car gangways connecting Car A to Car B, and Car B to Car C
   */
  private buildGangways() {
    const mTreadplate = new THREE.MeshStandardMaterial({ color: 0x444648, metalness: 0.9, roughness: 0.4 });
    const mBellows = new THREE.MeshLambertMaterial({ color: 0x161819 });
    const mChain = new THREE.MeshStandardMaterial({ color: 0x999a9c, metalness: 0.85, roughness: 0.3 });

    // Gangway 1 (between Car A rear x = -10.5 and Car B front x = -9.0)
    // Floor treadplate
    const plate1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 1.02), mTreadplate);
    plate1.position.set(-9.75, -0.02, 0);
    const roof1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.08), mBellows);
    roof1.position.set(-9.75, 2.22, 0);
    this.gangwayGroup.add(plate1, roof1);

    // Accordion pleated bellows walls on left and right
    [-0.54, 0.54].forEach((z) => {
      for (let i = 0; i < 7; i++) {
        const pleat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.05), mBellows);
        pleat.position.set(-10.35 + i * 0.2, 1.1, z);
        this.gangwayGroup.add(pleat);
      }
      // Safety handrails/chains
      const chainTop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.48, 8), mChain);
      chainTop.rotation.z = Math.PI / 2;
      chainTop.position.set(-9.75, 1.0, z * 0.9);
      const chainBot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.48, 8), mChain);
      chainBot.rotation.z = Math.PI / 2;
      chainBot.position.set(-9.75, 0.55, z * 0.9);
      this.gangwayGroup.add(chainTop, chainBot);
    });

    // Gangway 2 (between Car B rear x = +9.0 and Car C front x = +10.5)
    // Floor treadplate
    const plate2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 1.02), mTreadplate);
    plate2.position.set(9.75, -0.02, 0);
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.08), mBellows);
    roof2.position.set(9.75, 2.22, 0);
    this.gangwayGroup.add(plate2, roof2);

    [-0.54, 0.54].forEach((z) => {
      for (let i = 0; i < 7; i++) {
        const pleat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.05), mBellows);
        pleat.position.set(9.15 + i * 0.2, 1.1, z);
        this.gangwayGroup.add(pleat);
      }
      const chainTop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.48, 8), mChain);
      chainTop.rotation.z = Math.PI / 2;
      chainTop.position.set(9.75, 1.0, z * 0.9);
      const chainBot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.48, 8), mChain);
      chainBot.rotation.z = Math.PI / 2;
      chainBot.position.set(9.75, 0.55, z * 0.9);
      this.gangwayGroup.add(chainTop, chainBot);
    });
  }

  public toggleFrontDoor() {
    this.gangwayDoors.frontTarget = this.gangwayDoors.frontTarget === 0 ? 1.35 : 0;
  }

  public toggleRearDoor() {
    this.gangwayDoors.rearTarget = this.gangwayDoors.rearTarget === 0 ? -1.35 : 0;
  }

  public updateDoors(dt: number) {
    const k = 1 - Math.exp(-9 * dt);
    this.gangwayDoors.frontAngle += (this.gangwayDoors.frontTarget - this.gangwayDoors.frontAngle) * k;
    this.gangwayDoors.rearAngle += (this.gangwayDoors.rearTarget - this.gangwayDoors.rearAngle) * k;

    if (this.gangwayDoors.frontGroup) {
      this.gangwayDoors.frontGroup.rotation.y = this.gangwayDoors.frontAngle;
    }
    if (this.gangwayDoors.rearGroup) {
      this.gangwayDoors.rearGroup.rotation.y = this.gangwayDoors.rearAngle;
    }
  }

  public getAllPassengers(): PersonObject[] {
    return [
      ...this.parents,
      ...this.strangers,
      this.extraPerson,
      ...this.crowd,
      ...this.carAPassengers,
      ...this.carCPassengers,
    ];
  }
}
