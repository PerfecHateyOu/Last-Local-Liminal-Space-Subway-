#!/usr/bin/env bun
/**
 * Generates initial valid Blender-compatible .glb character models into public/models/characters/
 * Demonstrates node naming conventions: Head, Eye_L, Eye_R, Phone, and retro Lambert materials.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Polyfill FileReader for GLTFExporter in Bun/Node
class PolyFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.({ target: this });
    });
  }
}
globalThis.FileReader = PolyFileReader;

const outDir = path.resolve(import.meta.dirname, '../public/models/characters');
mkdirSync(outDir, { recursive: true });

async function exportGlb(root, filename) {
  root.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (glb) => {
        const dest = path.join(outDir, filename);
        writeFileSync(dest, Buffer.from(glb));
        console.log(`Exported ${filename} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
        resolve();
      },
      (err) => reject(err),
      { binary: true }
    );
  });
}

// 1. Mom Model
function buildMom() {
  const root = new THREE.Group();
  root.name = 'Character_Mom';

  const mSkin = new THREE.MeshLambertMaterial({ color: 0xc68e6c });
  mSkin.name = 'Skin_Mom';
  const mShirt = new THREE.MeshLambertMaterial({ color: 0x7a4a5e });
  mShirt.name = 'Fabric_Blouse';
  const mPants = new THREE.MeshLambertMaterial({ color: 0x2c3140 });
  mPants.name = 'Fabric_Slacks';
  const mHair = new THREE.MeshLambertMaterial({ color: 0x2a1c16 });
  mHair.name = 'Hair_Brunette';
  const mEyePupil = new THREE.MeshBasicMaterial({ color: 0x111113 });

  // Body / Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.22), mShirt);
  torso.name = 'Torso';
  torso.position.set(0, 0.76, 0);
  root.add(torso);

  // Seated Lap / Legs
  const lap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.42), mPants);
  lap.name = 'Lap';
  lap.position.set(0, 0.54, 0.19);
  root.add(lap);

  [-0.09, 0.09].forEach((dx, i) => {
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.12), mPants);
    shin.name = `Shin_${i}`;
    shin.position.set(dx, 0.24, 0.36);
    root.add(shin);
  });

  // Articulated Head
  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 1.25, 0.02);
  root.add(head);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), mSkin);
  skull.name = 'Skull';
  head.add(skull);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), mHair);
  hair.name = 'Hair';
  hair.position.set(0, 0.06, -0.01);
  head.add(hair);

  // Eyes (linked for dilation anomaly)
  [-0.045, 0.045].forEach((ex, i) => {
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.01), mEyePupil);
    pupil.name = `Eye_${i === 0 ? 'L' : 'R'}`;
    pupil.position.set(ex, 0.016, 0.102);
    head.add(pupil);
  });

  // Phone prop
  const phone = new THREE.Group();
  phone.name = 'Phone';
  phone.position.set(0, 0.72, 0.28);
  phone.rotation.x = -0.92;
  const phoneMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.01, 0.13), new THREE.MeshLambertMaterial({ color: 0x1b1d20 }));
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.11), new THREE.MeshBasicMaterial({ color: 0xdde8ef }));
  screenMesh.rotation.x = -Math.PI / 2;
  screenMesh.position.y = 0.006;
  phone.add(phoneMesh, screenMesh);
  root.add(phone);

  return root;
}

// 2. Dad Model
function buildDad() {
  const root = new THREE.Group();
  root.name = 'Character_Dad';

  const mSkin = new THREE.MeshLambertMaterial({ color: 0xb98062 });
  mSkin.name = 'Skin_Dad';
  const mShirt = new THREE.MeshLambertMaterial({ color: 0x3e5a6e });
  mShirt.name = 'Fabric_Shirt';
  const mPants = new THREE.MeshLambertMaterial({ color: 0x3a3a36 });
  mPants.name = 'Fabric_Pants';
  const mHair = new THREE.MeshLambertMaterial({ color: 0x1c1a18 });
  const mEyePupil = new THREE.MeshBasicMaterial({ color: 0x111113 });
  const mGlasses = new THREE.MeshBasicMaterial({ color: 0x222225 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.54, 0.24), mShirt);
  torso.name = 'Torso';
  torso.position.set(0, 0.78, 0);
  root.add(torso);

  const lap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.15, 0.44), mPants);
  lap.name = 'Lap';
  lap.position.set(0, 0.54, 0.2);
  root.add(lap);

  [-0.1, 0.1].forEach((dx, i) => {
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.46, 0.13), mPants);
    shin.name = `Shin_${i}`;
    shin.position.set(dx, 0.24, 0.38);
    root.add(shin);
  });

  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 1.28, 0.02);
  root.add(head);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.25, 0.21), mSkin);
  skull.name = 'Skull';
  head.add(skull);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), mHair);
  hair.name = 'Hair';
  hair.position.set(0, 0.08, -0.01);
  head.add(hair);

  [-0.045, 0.045].forEach((ex, i) => {
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.01), mEyePupil);
    pupil.name = `Eye_${i === 0 ? 'L' : 'R'}`;
    pupil.position.set(ex, 0.016, 0.106);
    head.add(pupil);

    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.008), mGlasses);
    rim.name = `GlassesRim_${i}`;
    rim.position.set(ex, 0.016, 0.11);
    head.add(rim);
  });

  return root;
}

// 3. MTA Worker Model (Archetype MTA)
function buildMTA() {
  const root = new THREE.Group();
  root.name = 'Character_MTA';

  const mSkin = new THREE.MeshLambertMaterial({ color: 0x8a5a3c });
  mSkin.name = 'Skin_MTA';
  const mUniform = new THREE.MeshLambertMaterial({ color: 0x1f2b38 });
  const mVest = new THREE.MeshLambertMaterial({ color: 0xdf9a18 });
  const mHelmet = new THREE.MeshLambertMaterial({ color: 0xf5f033 });
  const mEyePupil = new THREE.MeshBasicMaterial({ color: 0x111113 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.52, 0.24), mUniform);
  torso.name = 'Torso';
  torso.position.set(0, 0.78, 0);
  root.add(torso);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.44, 0.25), mVest);
  vest.name = 'HiVisVest';
  vest.position.set(0, 0.76, 0);
  root.add(vest);

  const lap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.44), mUniform);
  lap.position.set(0, 0.55, 0.2);
  root.add(lap);

  [-0.1, 0.1].forEach((dx, i) => {
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.48, 0.13), mUniform);
    shin.position.set(dx, 0.25, 0.38);
    root.add(shin);
  });

  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 1.26, 0.02);
  root.add(head);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), mSkin);
  head.add(skull);

  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.12, 0.24), mHelmet);
  helmet.name = 'HardHat';
  helmet.position.set(0, 0.12, 0);
  head.add(helmet);

  [-0.045, 0.045].forEach((ex, i) => {
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.01), mEyePupil);
    pupil.name = `Eye_${i === 0 ? 'L' : 'R'}`;
    pupil.position.set(ex, 0.016, 0.102);
    head.add(pupil);
  });

  return root;
}

// 4. Coat Commuter Model (Archetype Coat)
function buildCoat() {
  const root = new THREE.Group();
  root.name = 'Character_Coat';

  const mSkin = new THREE.MeshLambertMaterial({ color: 0xe0b89a });
  const mCoat = new THREE.MeshLambertMaterial({ color: 0x5a2d3a }); // Burgundy coat
  const mPants = new THREE.MeshLambertMaterial({ color: 0x40404a });
  const mHair = new THREE.MeshLambertMaterial({ color: 0x9b968d });
  const mEyePupil = new THREE.MeshBasicMaterial({ color: 0x111113 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.56, 0.24), mCoat);
  torso.name = 'Torso';
  torso.position.set(0, 0.78, 0);
  root.add(torso);

  const lap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.44), mCoat);
  lap.position.set(0, 0.54, 0.2);
  root.add(lap);

  [-0.1, 0.1].forEach((dx) => {
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.12), mPants);
    shin.position.set(dx, 0.24, 0.38);
    root.add(shin);
  });

  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 1.25, 0.02);
  root.add(head);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), mSkin);
  head.add(skull);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.22), mHair);
  hair.position.set(0, -0.04, -0.02);
  head.add(hair);

  [-0.045, 0.045].forEach((ex, i) => {
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.01), mEyePupil);
    pupil.name = `Eye_${i === 0 ? 'L' : 'R'}`;
    pupil.position.set(ex, 0.016, 0.102);
    head.add(pupil);
  });

  return root;
}

// 5. Uncanny Faceless Anomaly Figure
function buildAnomalyFaceless() {
  const root = new THREE.Group();
  root.name = 'Anomaly_Faceless';

  const mPale = new THREE.MeshLambertMaterial({ color: 0xdedcd7 });
  const mDark = new THREE.MeshLambertMaterial({ color: 0x141416 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.54, 0.22), mDark);
  torso.name = 'Torso';
  torso.position.set(0, 0.78, 0);
  root.add(torso);

  const lap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.42), mDark);
  lap.position.set(0, 0.54, 0.19);
  root.add(lap);

  [-0.09, 0.09].forEach((dx) => {
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.12), mDark);
    shin.position.set(dx, 0.24, 0.36);
    root.add(shin);
  });

  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 1.26, 0.02);
  root.add(head);

  // Smooth blank egg-like head with no features
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.25, 0.19), mPale);
  skull.name = 'BlankFace';
  head.add(skull);

  return root;
}

console.log('Generating initial Blender-compatible .glb character models into public/models/characters/ ...');
await exportGlb(buildMom(), 'character_mom.glb');
await exportGlb(buildDad(), 'character_dad.glb');
await exportGlb(buildMTA(), 'character_mta.glb');
await exportGlb(buildCoat(), 'character_coat.glb');
await exportGlb(buildAnomalyFaceless(), 'anomaly_faceless.glb');
console.log('All starter GLB character models successfully generated!');
