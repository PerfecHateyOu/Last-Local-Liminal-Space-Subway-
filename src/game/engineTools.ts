/**
 * The things you hold: the Polaroid camera, Dad's tape recorder and its tapes, and the gangway
 * door. Split out of gameState.ts; GameEngine keeps thin wrappers with the same names, so
 * window.__G and the e2e tests see no change.
 */
import { SUS } from "../constants";
import { audioEngine } from "../audio/audioEngine";
import { polaroidManager } from "./polaroidManager";
import { evp, EVP_SIGNALS } from "./evpManager";
import { passengerBehavior } from "./passengerBehavior";
import { routeManager } from "./routeManager";
import type { GameEngine } from "./gameState";

/** Chance a tape played out loud makes a parent who wasn't watching turn to look. */
const TAPE_GLANCE_CHANCE = 0.5;
/** Chance a flash makes a parent who wasn't watching turn to look. */
const FLASH_GLANCE_CHANCE = 0.5;
/** Game seconds while the print ejects before the next shot (stops a double tap or a held key from burning film). */
export const SHUTTER_COOLDOWN = 0.9;

/** Dad gives you his old microcassette recorder. */
export function giveRecorder(G: GameEngine, where: "haven" | "train") {
  if (evp.hasRecorder || G.phase === "end") return;
  evp.hasRecorder = true;
  G.say(
    1,
    where === "haven"
      ? "Here. Your grandfather\u2019s. He used it on the night shift. Never could get it to stop picking up the radio."
      : "Here, hold onto G. Your grandfather\u2019s old recorder. Never could get it to stop picking up the radio.",
    4.2,
  );
  G.setHint(
    G.isTouch
      ? "Dad gave you a tape recorder. Tap Recorder to raise it."
      : "Dad gave you a tape recorder. Press R to raise it.",
    5,
  );
  G.notifyUI();
}

/** Play a saved tape out loud. Playing another one, or the same one again, restarts. */
export function playTape(G: GameEngine, signalId: string) {
  const sig = EVP_SIGNALS.find((x) => x.id === signalId);
  if (!sig || G.paused || G.phase === "menu") return;
  G.stopTape();
  const dur = audioEngine.playTape(sig.voice) || 4; // keep the UI honest even with audio off
  const inRide = G.phase === "ride" || G.phase === "stop";
  G.tapePlaying = {
    signalId,
    inRide,
    charged: false,
    endsAt: Date.now() + dur * 1000,
  };
  G.tapeTimer = setTimeout(() => {
    G.tapePlaying = null;
    G.tapeTimer = null;
    G.notifyUI();
  }, dur * 1000);
  // Heard but not seen: a parent who isn't watching may turn toward the sound.
  if (
    inRide &&
    !G.carBuilder.parents.some((p) => p.facing) &&
    Math.random() < TAPE_GLANCE_CHANCE
  ) {
    G.sched(0.8, () => {
      if (!G.tapePlaying) return;
      const free = G.carBuilder.parents.filter((p) => !p.frozen && !p.force);
      const p = free[Math.floor(Math.random() * free.length)];
      if (p) {
        p.mode = "player";
        p.holdUntil = G.GT + 2.0;
        p.until = G.GT + 2.0;
      }
    });
  }
  G.notifyUI();
}

export function stopTape(G: GameEngine) {
  if (G.tapeTimer) clearTimeout(G.tapeTimer);
  G.tapeTimer = null;
  if (G.tapePlaying) {
    audioEngine.stopTape();
    G.tapePlaying = null;
    G.notifyUI();
  }
}

/** Raise or lower the recorder. Raising lowers the camera; it can't come up during prompts. */
export function toggleRecorder(G: GameEngine): boolean {
  if (evp.raised) {
    evp.lower();
  } else if (
    evp.hasRecorder &&
    !G.choice &&
    !G.restraint &&
    (G.phase === "ride" ||
      G.phase === "stop" ||
      G.phase === "haven" ||
      G.phase === "intro")
  ) {
    polaroidManager.setViewfinder(false);
    G.flagHeld = false;
    evp.raise();
  } else if (
    G.phase === "ride" ||
    G.phase === "stop" ||
    G.phase === "haven" ||
    G.phase === "intro"
  ) {
    // Say why nothing happened.
    if (!evp.hasRecorder)
      G.setHint("You don\u2019t have anything to record with.", 2.5);
    else if (G.handsBusy) G.setHint(G.handsBusy, 2);
  }
  G.notifyUI();
  return evp.raised;
}

export function interactGangwayDoor(G: GameEngine): boolean {
  if (G.nearGangwayDoor === "front" || G.gazeTid === "gangway:front") {
    G.carBuilder.toggleFrontDoor();
    audioEngine.doorGangway();
    G.notifyUI();
    return true;
  }
  if (G.nearGangwayDoor === "rear" || G.gazeTid === "gangway:rear") {
    G.carBuilder.toggleRearDoor();
    audioEngine.doorGangway();
    G.notifyUI();
    return true;
  }
  return false;
}

/** Raise or lower the camera (C, or the HUD button). Not while an answer or the restraint needs you. */
export function toggleCamera(G: GameEngine): boolean {
  if (!polaroidManager.isViewfinderOpen && G.handsBusy) {
    G.setHint(G.handsBusy, 2);
    return false;
  }
  evp.lower(); // hands busy: raising the camera lowers the recorder
  return polaroidManager.toggleViewfinder();
}

export function takePolaroidPhoto(G: GameEngine) {
  if (!G.shutterReady) return null;
  if (polaroidManager.remainingFilm <= 0) {
    G.setHint("Out of film.", 2.5);
  }
  const seg = G.seg;
  const photo = polaroidManager.snapPhoto(
    G.scene,
    G.camera,
    G.renderer,
    G.active,
    G.currentCarIndex,
    routeManager.routeId,
    G.GT,
    seg && G.phase === "ride" ? G.segIdx : -1,
    seg ? `${seg.stop}${seg.b ? "b" : ""}` : "",
  );
  if (!photo) return null;
  G.nextShotAt = G.GT + SHUTTER_COOLDOWN;

  passengerBehavior.handleCameraFlash(
    G.carBuilder.getAllPassengers(),
    G.camera.position,
    G.GT,
  );

  if (G.phase === "ride" || G.phase === "stop") {
    const watcher = G.carBuilder.parents.find((p) => p.facing);
    if (watcher) {
      G.addSus(
        SUS.visible,
        `Took a flash photo while ${watcher.label} was watching`,
        watcher,
      );
    } else if (Math.random() < FLASH_GLANCE_CHANCE) {
      // The flash catches a parent's eye: they turn to look (no Suspicion by itself).
      const free = G.carBuilder.parents.filter((p) => !p.frozen && !p.force);
      const p = free[Math.floor(Math.random() * free.length)];
      if (p) {
        p.mode = "player";
        p.holdUntil = G.GT + 1.8;
        p.until = G.GT + 1.8;
      }
    }
  }
  G.notifyUI();
  return photo;
}
