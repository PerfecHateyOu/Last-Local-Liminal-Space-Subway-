/**
 * Polaroid 600 Camera & Evidence Photo Management System
 * Handles viewfinder overlay, mechanical shutter discharge, high-voltage flash,
 * WebGL canvas capture, and the evidence photo album.
 *
 * Rules (master doc: flags are private, nothing confirms correctness in real time):
 *  - A shot privately records which manifested anomalies were in frame. It is scored with the
 *    flags when the train reaches the next stop, and counts as a catch the same way a flag does.
 *  - Prints develop after the ride. During the ride the album and the ejected print show an
 *    undeveloped frame with no caption, badge, hint or sanity change.
 */
import { practice } from './practice';
import * as THREE from 'three';
import { PolaroidPhoto } from '../types';
import { audioEngine } from '../audio/audioEngine';
import { unlockAchievement } from './achievements';

export const POLAROID_STORAGE_KEY = 'gtrain-polaroids';

export function loadPersistentPolaroids(): PolaroidPhoto[] {
  try {
    const raw = localStorage.getItem(POLAROID_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prints kept on the device for the Case Files, newest first. */
export const KEPT_PHOTOS = 12;
const THUMB_PX = 240;

/** Shrink a print to a small JPEG (about 10–20 KB) so the archive stays far under the storage quota. */
function thumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve('');
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = THUMB_PX;
        c.getContext('2d')!.drawImage(img, 0, 0, THUMB_PX, THUMB_PX);
        resolve(c.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/** Save developed prints as thumbnails, newest first, capped at KEPT_PHOTOS. Private framing data isn't kept. */
export async function persistThumbnails(photos: PolaroidPhoto[]): Promise<void> {
  if (!photos.length || practice.on) return; // practice prints stay on this ride's report
  try {
    const fresh = await Promise.all(
      photos.map(async (p) => ({ ...p, framed: [], dataUrl: await thumbnail(p.dataUrl) }))
    );
    // Prints saved full-size by an earlier build are shrunk too.
    const older = await Promise.all(
      loadPersistentPolaroids().map(async (p) =>
        p.dataUrl && p.dataUrl.length > 60_000 ? { ...p, framed: [], dataUrl: await thumbnail(p.dataUrl) } : p
      )
    );
    const combined = [...fresh, ...older];
    const kept = combined.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i).slice(0, KEPT_PHOTOS);
    localStorage.setItem(POLAROID_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    /* storage blocked or full: the prints still show on this ride's report */
  }
}

/** Film loaded at the start of every ride. */
export const STARTING_FILM = 8;

export class PolaroidManager {
  public isViewfinderOpen: boolean = false;
  public remainingFilm: number = STARTING_FILM;
  public maxFilm: number = 10;
  public photos: PolaroidPhoto[] = [];
  public lastCapturedPhoto: PolaroidPhoto | null = null;
  public isDeveloping: boolean = false;
  public flashActive: boolean = false;
  public flashUntil: number = 0;
  public isAlbumOpen: boolean = false;

  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private tempVec = new THREE.Vector3();

  private developTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  public onStateChanged?: () => void;
  public onPhotoSnapped?: (photo: PolaroidPhoto) => void;

  /** A new ride: fresh film, empty album, camera lowered. */
  public reset() {
    if (this.developTimer) clearTimeout(this.developTimer);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.developTimer = null;
    this.flashTimer = null;
    this.isViewfinderOpen = false;
    this.isAlbumOpen = false;
    this.remainingFilm = STARTING_FILM;
    this.photos = [];
    this.lastCapturedPhoto = null;
    this.isDeveloping = false;
    this.flashActive = false;
    this.flashUntil = 0;
    this.notify();
  }

  public toggleViewfinder(): boolean {
    this.isViewfinderOpen = !this.isViewfinderOpen;
    if (this.isViewfinderOpen) {
      this.isAlbumOpen = false;
    }
    this.notify();
    return this.isViewfinderOpen;
  }

  public setViewfinder(open: boolean) {
    if (this.isViewfinderOpen !== open) {
      this.isViewfinderOpen = open;
      if (open) this.isAlbumOpen = false;
      this.notify();
    }
  }

  public toggleAlbum(): boolean {
    this.isAlbumOpen = !this.isAlbumOpen;
    if (this.isAlbumOpen) {
      this.isViewfinderOpen = false;
    }
    this.notify();
    return this.isAlbumOpen;
  }

  public setAlbum(open: boolean) {
    if (this.isAlbumOpen !== open) {
      this.isAlbumOpen = open;
      if (open) this.isViewfinderOpen = false;
      this.notify();
    }
  }

  public replenishFilm(amount: number = 4) {
    this.remainingFilm = Math.min(this.maxFilm, this.remainingFilm + amount);
    this.notify();
  }

  /**
   * Snaps a Polaroid photo:
   * 1. Captures WebGL canvas snapshot
   * 2. Evaluates active anomalies in camera frustum
   * 3. Plays authentic shutter and film ejection audio
   * 4. Triggers flash burst and chemical development
   */
  public snapPhoto(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    activeAnomalies: Array<{ id: string; desc: string; obj: THREE.Object3D | null; at: number | null }>,
    carIndex: number,
    routeId: 'G' | 'L' | '7',
    gameTime: number,
    segIdx: number = -1,
    stop: string = ''
  ): PolaroidPhoto | null {
    if (this.remainingFilm <= 0) {
      audioEngine.blip();
      return null;
    }

    this.remainingFilm--;
    this.flashActive = true;
    this.flashUntil = performance.now() + 220;

    // Trigger audio
    audioEngine.polaroidShutter();

    // 1. Evaluate camera frustum for anomalies
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const framed: Array<{ id: string; desc: string }> = [];
    const camPos = camera.position;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    for (const anom of activeAnomalies) {
      if (anom.at === null) continue; // Not triggered yet

      if (anom.obj) {
        anom.obj.getWorldPosition(this.tempVec);
        const dist = camPos.distanceTo(this.tempVec);

        if (dist < 18) {
          const toTarget = this.tempVec.clone().sub(camPos).normalize();
          const angle = camDir.angleTo(toTarget);

          // Within ~38 degree cone of center viewfinder or within frustum
          if (angle < 0.65 && this.frustum.containsPoint(this.tempVec)) {
            framed.push({ id: anom.id, desc: anom.desc });
          }
        }
      } else {
        // Full-screen / lighting / ambient anomaly: any shot inside the car frames it
        framed.push({ id: anom.id, desc: anom.desc });
      }
    }

    // 2. Snapshot WebGL canvas
    let dataUrl = '';
    try {
      // Create cropped 480x480 square thumbnail representing the Polaroid 1:1 image area
      const canvas = renderer.domElement;
      const offscreen = document.createElement('canvas');
      const size = 480;
      offscreen.width = size;
      offscreen.height = size;
      const ctx = offscreen.getContext('2d');

      if (ctx) {
        // The renderer doesn't preserve its drawing buffer, so between frames the canvas
        // reads back blank. Render now and copy in the same tick, before it's cleared.
        renderer.render(scene, camera);
        const minDim = Math.min(canvas.width, canvas.height);
        const sx = (canvas.width - minDim) / 2;
        const sy = (canvas.height - minDim) / 2;

        // Draw center square crop
        ctx.drawImage(canvas, sx, sy, minDim, minDim, 0, 0, size, size);

        // Apply vintage Polaroid film tint and slight vignetting
        ctx.fillStyle = 'rgba(240, 220, 190, 0.08)';
        ctx.fillRect(0, 0, size, size);

        dataUrl = offscreen.toDataURL('image/jpeg', 0.82);
      } else {
        renderer.render(scene, camera);
        dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      }
    } catch (e) {
      console.warn('Polaroid snapshot canvas capture failed:', e);
      dataUrl = '';
    }

    const photo: PolaroidPhoto = {
      id: `polaroid_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: gameTime,
      dataUrl,
      carIndex,
      routeId,
      segIdx,
      stop,
      developed: false,
      framed,
      caught: [],
      hasAnomalyInFrustum: false, // revealed by develop() after the ride
      exposureQuality: Math.round(80 + Math.random() * 20),
    };

    this.photos.unshift(photo);
    if (this.photos.length > 16) {
      this.photos.pop(); // Retain most recent 16 prints
    }

    this.lastCapturedPhoto = photo;
    this.isDeveloping = true;

    // Reset developing state after chemical development completes (4.0s)
    if (this.developTimer) clearTimeout(this.developTimer);
    this.developTimer = setTimeout(() => {
      this.developTimer = null;
      this.isDeveloping = false;
      this.notify();
    }, 4200);

    // End flash
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.flashActive = false;
      this.notify();
    }, 220);

    if (this.onPhotoSnapped) {
      this.onPhotoSnapped(photo);
    }

    this.notify();
    return photo;
  }

  /**
   * Photos from a ride segment that framed this anomaly after it appeared. Called when the stop
   * is scored; marks them (privately) as having caught it.
   */
  public photosCatching(segIdx: number, anomalyId: string, desc: string, appearedAt: number): PolaroidPhoto[] {
    const hits = this.photos.filter(
      (p) => p.segIdx === segIdx && p.timestamp >= appearedAt && p.framed.some((f) => f.id === anomalyId)
    );
    hits.forEach((p) => {
      if (!p.caught.includes(desc)) p.caught.push(desc);
    });
    return hits;
  }

  /** The ride is over: every print develops and shows what it caught. */
  public develop() {
    this.photos.forEach((p) => {
      p.developed = true;
      p.hasAnomalyInFrustum = p.caught.length > 0;
      p.anomalyName = p.caught[0];
      p.description = p.caught.length ? `Caught: ${p.caught.join('; ')}` : 'Nothing out of place.';
    });
    this.isDeveloping = false;

    // Check for photo achievement
    if (this.photos.some((p) => p.hasAnomalyInFrustum)) {
      unlockAchievement('photo_evidence');
    }

    // Keep this ride's prints for the Case Files, as small thumbnails (see persistThumbnails).
    void persistThumbnails(this.photos);

    this.notify();
  }

  private notify() {
    if (this.onStateChanged) {
      this.onStateChanged();
    }
  }
}

export const polaroidManager = new PolaroidManager();
