/**
 * LAST LOCAL
 * Main Application Component tying Three.js render loop with React HUD,
 * sanity tier filters, and full game flow.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GameEngine } from './game/gameState';
import { audioEngine } from './audio/audioEngine';
import { settings } from './settings';
import { practice } from './game/practice';
import { pointerLock } from './input/pointerLock';
import { KeyLook, limitYaw } from './input/keyLook';
import { evp } from './game/evpManager';
import { passengerBehavior } from './game/passengerBehavior';
import { enterFullscreen, isFullscreen, leftFullscreenOnRequest, onFullscreenChange } from './ui/fullscreen';
import { resolveEnding, ENDINGS } from './game/endings';
import { shakeCoverScale, SHAKE_BLEED_PX } from './graphics/shakeCover';
import { haptics } from './game/haptics';
import { GlitchPass } from './graphics/glitchPass';
import { HUD } from './components/HUD';
import { StartScreen } from './components/StartScreen';
import { TutorialCoach } from './components/TutorialCoach';
import { tutorialSeen } from './game/tutorial';
import { ReportScreen } from './components/ReportScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { PauseScreen } from './components/PauseScreen';
import { PolaroidViewfinder } from './components/PolaroidViewfinder';
import { PolaroidAlbum } from './components/PolaroidAlbum';
import { RouteSelector } from './components/RouteSelector';
import { polaroidManager } from './game/polaroidManager';
import { routeManager } from './game/routeManager';
import { RunHistoryRecord } from './types';

// Touch = the primary pointer is coarse. Touchscreen laptops report touch points too,
// but they have a mouse or trackpad and should get pointer lock and desktop tuning.
// Screen tearing is skipped entirely for players who ask the OS for reduced motion.

const IS_TOUCH =
  typeof window !== 'undefined' &&
  (matchMedia('(pointer: coarse)').matches ||
    ('ontouchstart' in window && !matchMedia('(pointer: fine)').matches));

// With the viewfinder up on touch: a touch shorter and stiller than this is a tap (snap a
// photo); anything longer or further is a drag (aim the camera).
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_MS = 350;

// The engine notifies React on discrete events only. These HUD values change every frame,
// so refresh at ~30 Hz while any of them is on screen.
const HUD_REFRESH_MS = 33;
/** Seconds without input before the HUD's non-essential parts dim (see hudIdle). */
const HUD_IDLE_S = 6;

/**
 * The HUD can rest: nothing is asking for the player (no prompt, restraint, live hint, held flag
 * or raised camera or recorder, the same signals that keep the HUD refreshing live) and they
 * haven't touched anything for a while. Its station card, tools and key hints then dim to 40%
 * (index.css, .hud-dim), which suits the empty car.
 */
function hudIdle(G: GameEngine, quietFor: number): boolean {
  if (G.paused || G.phase === 'menu' || G.phase === 'end') return false;
  if (quietFor < HUD_IDLE_S || hudNeedsLiveRefresh(G)) return false;
  return !G.subHtml && !G.paText && !G.tutorial && !polaroidManager.isViewfinderOpen && !polaroidManager.isAlbumOpen;
}

function hudNeedsLiveRefresh(G: GameEngine): boolean {
  if (G.paused || G.phase === 'menu' || G.phase === 'end') return false;
  return (
    G.flagHeld ||
    G.flagProg > 0 ||
    evp.raised ||
    !!G.choice ||
    !!G.restraint ||
    G.debug ||
    G.GT < G.hintUntil ||
    G.GT - G.notedT < 0.7 ||
    !G.shutterReady // the shutter button shows EJECTING until the print is out
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<'menu' | 'intro' | 'ride' | 'stop' | 'haven' | 'trial' | 'end'>('menu');
  const [paused, setPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [runsHistory, setRunsHistory] = useState<RunHistoryRecord[]>([]);
  // Settings panel (over the start screen or the pause menu). The ref lets the key handler see it.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;
  const [routeSelectorOpen, setRouteSelectorOpen] = useState(false);
  const routeSelectorOpenRef = useRef(false);
  routeSelectorOpenRef.current = routeSelectorOpen;

  // Held arrow keys; the render loop turns the view while they're down.
  const keyLookRef = useRef(new KeyLook());
  const keysDownRef = useRef<{ w: boolean; a: boolean; s: boolean; d: boolean }>({
    w: false,
    a: false,
    s: false,
    d: false,
  });
  // Forget held look and movement keys (pause, lost focus): their key-ups may never arrive.
  const releaseHeldKeys = useCallback(() => {
    keyLookRef.current.clear();
    keysDownRef.current = { w: false, a: false, s: false, d: false };
    engineRef.current?.setMoveInput(0, 0);
    evp.setRecording(false);
  }, []);


  // Turning "Debug overlay (spoilers)" on mid-ride (pause > Settings) shows it at once and makes
  // the ride a debug run; turning it off hides it, but the ride stays a debug run.
  useEffect(() => {
    let was = settings.get().debugOverlay;
    return settings.subscribe(() => {
      const on = settings.get().debugOverlay;
      if (on === was) return;
      was = on;
      const G = engineRef.current;
      if (!G) return;
      G.debug = on;
      if (on && G.phase !== 'menu') practice.debugRun = true;
      triggerUpdate();
    });
  }, []);

  useEffect(() => {
    if (phase !== 'menu' && !paused) setSettingsOpen(false);
    // The route selector opens mid-ride (L or the HUD), so it stays up while the train runs and
    // closes when the train stops or the ride ends: the doors, the Haven, a Trial and the report need you.
    if (phase !== 'intro' && phase !== 'ride') setRouteSelectorOpen(false);
  }, [phase, paused]);

  useEffect(() => {
    evp.onChange = () => setTick((t) => t + 1);
    return () => {
      evp.onChange = undefined;
    };
  }, []);

  useEffect(() => {
    polaroidManager.onStateChanged = () => {
      setTick((t) => t + 1);
    };
    return () => {
      polaroidManager.onStateChanged = undefined;
    };
  }, []);

  // Tier visual filter values
  const [tierStyle, setTierStyle] = useState({
    filter: 'none',
    vignetteOpacity: 0.55,
  });

  const isTouch = IS_TOUCH;

  // Re-render helper
  const triggerUpdate = useCallback(() => {
    setTick((t) => t + 1);
    if (engineRef.current) {
      setPhase(engineRef.current.phase);
      setPaused(engineRef.current.paused);
      setIsMuted(audioEngine.getMuted());

      // Update tier post-processing CSS filters
      const t = engineRef.current.tier;
      if (t === 0) {
        setTierStyle({ filter: 'none', vignetteOpacity: 0.55 });
      } else if (t === 1) {
        setTierStyle({ filter: 'saturate(0.8) contrast(1.04)', vignetteOpacity: 0.62 });
      } else if (t === 2) {
        setTierStyle({ filter: 'saturate(0.55) contrast(1.1) hue-rotate(-8deg)', vignetteOpacity: 0.72 });
      } else {
        setTierStyle({ filter: 'saturate(0.3) contrast(1.18) sepia(0.18)', vignetteOpacity: 0.85 });
      }
    }
  }, []);

  const requestLock = useCallback(() => {
    if (isTouch) return;
    const canvas = containerRef.current?.querySelector('canvas');
    // Raw mouse input when it's on and supported; failures show "Click to look around".
    pointerLock.lock(canvas);
  }, [isTouch]);

  // Every pause path (Esc, P, tab switch, pause button) goes through here so held inputs
  // are released and the restraint gets its grace period on resume.
  const pauseGame = useCallback(() => {
    const G = engineRef.current;
    if (!G || G.paused) return;
    G.pause();
    if (!G.paused) return; // menu or report: nothing to pause
    haptics.stop();
    releaseHeldKeys();
    if (document.hidden) {
      // Tab switched away: silence everything; music starts when the player comes back.
      audioEngine.suspend();
    } else {
      // Game audio and the ride's music fade out; the clean pause tune fades in.
      audioEngine.enterPause();
    }
    // Free the cursor so the Resume button can be clicked.
    pointerLock.unlock();
    pointerLock.clearHint();
    if (containerRef.current) containerRef.current.style.transform = '';
    triggerUpdate();
  }, [triggerUpdate, releaseHeldKeys]);

  const resumeGame = useCallback(() => {
    const G = engineRef.current;
    if (!G || !G.paused) return;
    G.resume();
    audioEngine.wake();
    audioEngine.exitPause();
    requestLock();
    triggerUpdate();
  }, [requestLock, triggerUpdate]);

  // Initialize Three.js scene & Game Engine
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    let pixelRatio = Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    containerRef.current.appendChild(renderer.domElement);
    const canvas = renderer.domElement;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030403);
    scene.fog = new THREE.Fog(0x040504, 9, 30);

    const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 90);
    camera.rotation.order = 'YXZ';

    // Base field of view; breathing narrows it slightly from here each frame.
    let baseFov = 68;
    const fit = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (!w || !h) return;
      const aspect = w / h;
      camera.aspect = aspect;
      baseFov = aspect < 1 ? 88 : 68;
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => {
      setTimeout(fit, 120);
      setTimeout(fit, 450);
    });

    // Create Engine instance
    const engine = new GameEngine(scene, camera, renderer, isTouch);
    const glitchPass = new GlitchPass(renderer);
    // Registered after fit, so the renderer has its new size when the glitch target follows it.
    const fitGlitch = () => glitchPass.syncSize();
    window.addEventListener('resize', fitGlitch);
    engineRef.current = engine;

    // Test builds only (vite build --mode test): expose internals to the Playwright suite.
    // MODE is replaced at build time, so production bundles don't contain this.
    if (import.meta.env.MODE === 'test') {
      Object.assign(window, { __G: engine, __A: audioEngine, __S: settings, __R: { renderer, scene, camera, glitchPass }, __shakeCoverScale: shakeCoverScale, __P: polaroidManager, __RT: routeManager, __EVP: evp, __END: { resolveEnding, ENDINGS }, __PB: passengerBehavior, __PL: pointerLock });
    }

    engine.onStateChange = () => triggerUpdate();
    engine.onReportReady = (runs) => {
      setRunsHistory(runs);
      triggerUpdate();
    };

    // Frame-time resolution governor
    let lastTime = performance.now();
    let perfAcc = 0;
    let perfN = 0;
    let hudAcc = 0;
    let hudWasLive = false;

    let shakeZoom = 1; // current screen-shake cover zoom (see shakeCoverScale)
    let animId: number;
    const animate = (currentTime: number) => {
      animId = requestAnimationFrame(animate);
      const deltaMs = currentTime - lastTime;
      const dt = Math.min(0.05, deltaMs / 1000);
      lastTime = currentTime;

      // Performance governor
      if (!document.hidden && deltaMs <= 250 && engine.phase !== 'menu' && !engine.paused) {
        perfAcc += deltaMs;
        perfN++;
        if (perfN >= 90) {
          const avgMs = perfAcc / perfN;
          perfAcc = 0;
          perfN = 0;
          if (avgMs > 25 && pixelRatio > 1) {
            pixelRatio = Math.max(1, pixelRatio - 0.25);
            renderer.setPixelRatio(pixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            glitchPass.syncSize();
          }
        }
      }

      if (!engine.paused) {
        if (engine.phase !== 'menu' && engine.phase !== 'end') {
          keyLookRef.current.apply(engine, dt, settings.get().lookSensitivity);
        }
        engine.update(dt);
      }

      // Live HUD: flag ring fill, answer countdown bars, hint expiry, debug overlay.
      // One extra refresh after the last live frame lets them settle (e.g. a hint disappearing).
      hudAcc += deltaMs;
      const hudLive = hudNeedsLiveRefresh(engine);
      if ((hudLive || hudWasLive) && hudAcc >= HUD_REFRESH_MS) {
        hudAcc = 0;
        hudWasLive = hudLive;
        setTick((t) => t + 1);
      }

      // Anxious breathing: a slight FOV pulse during low-sanity rides (off when screen effects are reduced).
      // The offset is in degrees at the 68° landscape FOV, so scale it for the wider portrait view.
      const reduced = settings.effectsReduced();
      const fov = baseFov * (1 + (reduced ? 0 : engine.breathFovOffset()) / 68);
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      // A few real lights follow the camera through the cars (see SubwayCarBuilder.updateLightPool).
      engine.carBuilder.updateLightPool(camera.position, deltaMs / 1000);

      // Screen glitch: only route through the shader pass while one is playing.
      const glitchAmt = reduced ? 0 : engine.glitchAmount();
      if (glitchAmt > 0.001 && engine.glitch) {
        glitchPass.render(scene, camera, glitchAmt, engine.GT - engine.glitch.start, engine.glitch.seed);
      } else {
        renderer.render(scene, camera);
      }

      // Subway train motion screen-shake (linked to ride phase and sanity tier)
      if (engine.phase !== 'menu' && !engine.paused) {
        const shake = engine.getScreenShake();
        if (containerRef.current) {
          if (shake.intensity > 0.001) {
            // Zoom in just enough that the shifted, rotated view still covers every screen
            // corner (the container only bleeds 8 px past the edges). Zoom in at once when more
            // is needed, ease back out slowly, so it reads as a steady zoom, not a pulse.
            const need = shakeCoverScale(window.innerWidth, window.innerHeight, SHAKE_BLEED_PX, shake);
            shakeZoom = need > shakeZoom ? need : shakeZoom + (need - shakeZoom) * (1 - Math.exp(-dt / 0.6));
            containerRef.current.style.transform = `translate3d(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px, 0px) rotate(${shake.rot.toFixed(3)}deg) scale(${shakeZoom.toFixed(4)})`;
          } else if (containerRef.current.style.transform) {
            containerRef.current.style.transform = '';
            shakeZoom = 1;
          }
        }
      } else if (containerRef.current?.style.transform) {
        containerRef.current.style.transform = '';
      }
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', fit);
      window.removeEventListener('resize', fitGlitch);
      glitchPass.dispose();
      renderer.dispose();
      if (containerRef.current) containerRef.current.style.transform = '';
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [isTouch, triggerUpdate]);

  // Pointer & Touch Look Controls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragId: number | null = null;
    let lx = 0;
    let ly = 0;
    // With the viewfinder up on touch, a quick tap snaps a photo and a drag aims.
    let tapStart: { id: number; x: number; y: number; t: number } | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      const G = engineRef.current;
      if (!G || G.paused || G.phase === 'menu' || G.phase === 'end') return;

      audioEngine.wake();
      if (e.pointerType === 'mouse') requestLock();

      // Camera snapshot if viewfinder is raised. A mouse click snaps at once; a touch
      // waits for pointerup so a drag can aim first (see handlePointerEnd).
      if (polaroidManager.isViewfinderOpen && e.button === 0) {
        if (e.pointerType === 'mouse') {
          G.takePolaroidPhoto();
          triggerUpdate();
          return;
        }
        if (dragId === null) {
          tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
          dragId = e.pointerId;
          lx = e.clientX;
          ly = e.clientY;
        }
        return;
      }

      // Gangway door click interaction
      if (G.nearGangwayDoor || G.gazeTid?.startsWith('gangway:')) {
        if (G.interactGangwayDoor()) {
          triggerUpdate();
          return;
        }
      }

      if (dragId === null) {
        dragId = e.pointerId;
        lx = e.clientX;
        ly = e.clientY;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const G = engineRef.current;
      if (!G || G.paused || G.phase === 'menu' || G.phase === 'end') return;

      // Look speed and vertical direction come from the player's settings.
      const { lookSensitivity: sens, invertY } = settings.get();
      const ySign = invertY ? -1 : 1;
      if (e.pointerType === 'mouse' && pointerLock.isLocked) {
        G.ty = limitYaw(G.phase, G.ty - e.movementX * 0.0022 * sens);
        G.tp = Math.max(-0.6, Math.min(0.72, G.tp - ySign * e.movementY * 0.0022 * sens));
        return;
      }

      if (e.pointerId !== dragId) return;
      const k = (e.pointerType === 'mouse' ? 0.004 : 0.0055) * sens;
      G.ty = limitYaw(G.phase, G.ty - (e.clientX - lx) * k);
      G.tp = Math.max(-0.6, Math.min(0.72, G.tp - ySign * (e.clientY - ly) * k));
      lx = e.clientX;
      ly = e.clientY;
    };

    const handlePointerEnd = (e: PointerEvent) => {
      if (e.pointerId === dragId) dragId = null;
      if (tapStart && e.pointerId === tapStart.id) {
        const tap = tapStart;
        tapStart = null;
        const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
        const G = engineRef.current;
        if (
          e.type === 'pointerup' &&
          moved <= TAP_MAX_MOVE_PX &&
          performance.now() - tap.t <= TAP_MAX_MS &&
          G &&
          !G.paused &&
          polaroidManager.isViewfinderOpen
        ) {
          G.takePolaroidPhoto();
          triggerUpdate();
        }
      }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);
    container.addEventListener('pointerleave', handlePointerEnd);

    // Auto-pause when pointerlock is exited mid-game (Esc), but not when the route selector
    // freed the mouse itself (see openRouteSelector).
    const offLock = pointerLock.subscribe(({ locked, quiet }) => {
      if (locked || quiet) return;
      pauseGame();
    });
    // Leaving full screen mid-ride (Esc, a swipe, the browser's button) pauses, like losing the mouse.
    // The game's own Exit full screen button doesn't: the player chose it and is still playing.
    const offFullscreen = onFullscreenChange(() => {
      if (!isFullscreen() && !leftFullscreenOnRequest()) pauseGame();
    });

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerEnd);
      container.removeEventListener('pointercancel', handlePointerEnd);
      container.removeEventListener('pointerleave', handlePointerEnd);
      offLock();
      offFullscreen();
    };
  }, [isTouch, requestLock, pauseGame]);

  // The route selector (L, or the HUD's route buttons). The ride keeps going behind it, so the
  // mouse is freed to click a line without pausing, and held keys are let go.
  const openRouteSelector = useCallback(() => {
    releaseHeldKeys();
    pointerLock.unlock({ quiet: true });
    setRouteSelectorOpen(true);
  }, [releaseHeldKeys]);

  // Idle HUD: any input wakes it; a slow timer checks whether it can rest (hudIdle). A data
  // attribute on <html> does the dimming in CSS, so the HUD doesn't re-render for it.
  useEffect(() => {
    let last = performance.now();
    const poke = () => {
      last = performance.now();
      if (document.documentElement.hasAttribute('data-hud-idle')) document.documentElement.removeAttribute('data-hud-idle');
    };
    const opts = { passive: true, capture: true } as const;
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, poke, opts));
    const timer = window.setInterval(() => {
      const G = engineRef.current;
      const idle = !!G && hudIdle(G, (performance.now() - last) / 1000);
      document.documentElement.toggleAttribute('data-hud-idle', idle);
    }, 500);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, poke, opts));
      window.clearInterval(timer);
      document.documentElement.removeAttribute('data-hud-idle');
    };
  }, []);

  // The evidence log can open mid-ride (Tab, the HUD, the viewfinder). The ride keeps going behind
  // it, so, like the route selector, it frees a captured mouse (without pausing) so its tabs,
  // filters and close button can be clicked.
  // Closing it (Tab again, Esc, its close button) captures the mouse again, so you're straight back
  // to looking around.
  const albumOpen = polaroidManager.isAlbumOpen;
  const albumFreedLockRef = useRef(false);
  useEffect(() => {
    if (albumOpen && pointerLock.isLocked) {
      albumFreedLockRef.current = true;
      pointerLock.unlock({ quiet: true });
    } else if (!albumOpen && albumFreedLockRef.current) {
      albumFreedLockRef.current = false;
      const G = engineRef.current;
      if (G && !G.paused && G.phase !== 'menu' && G.phase !== 'end') requestLock();
    }
  }, [albumOpen, requestLock]);

  // Keyboard Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const G = engineRef.current;
      if (!G) return;

      // With Settings open, P closes it (and leaves the game paused). Esc is handled by the
      // panel itself (see ui/escape.ts), so a confirmation inside it closes first.
      if (settingsOpenRef.current) {
        if (e.code === 'KeyP') {
          e.preventDefault();
          setSettingsOpen(false);
        }
        if (e.code !== 'KeyM') return;
      }
      // The route selector can open mid-ride; while it's up, keys belong to it (Tab moves
      // focus, Enter/Space pick a line, Esc closes it via ui/escape.ts). L closes it again,
      // and M still mutes.
      if (routeSelectorOpenRef.current) {
        if (e.code === 'KeyL' && !e.repeat) {
          e.preventDefault();
          setRouteSelectorOpen(false);
        }
        if (e.code !== 'KeyM') return;
      }

      // The evidence log can be open mid-ride too; while it is, ride shortcuts (camera, recorder,
      // route lines, answers, walking) don't fire behind it. Tab closes it, Esc is its own (via
      // ui/escape.ts), and M still mutes.
      if (polaroidManager.isAlbumOpen && G.phase !== 'menu' && G.phase !== 'end') {
        if (e.code === 'Tab') {
          e.preventDefault();
          polaroidManager.toggleAlbum();
          triggerUpdate();
          return;
        }
        if (e.code !== 'KeyM' && e.code !== 'KeyP') return;
      }

      if ((e.code === 'KeyP' || e.code === 'Escape') && G.phase !== 'menu' && G.phase !== 'end') {
        if (G.paused) resumeGame();
        else pauseGame();
        return;
      }

      if (e.code === 'KeyM' && !e.repeat) {
        const muted = audioEngine.toggleMute();
        setIsMuted(muted);
        triggerUpdate();
        return;
      }

      // The spoiler overlay: backquote toggles it in `vite dev`, or in any build once the player
      // turns on Settings > Data > "Debug overlay (spoilers)". Showing it makes this a debug run.
      if ((import.meta.env.DEV || settings.get().debugOverlay) && e.code === 'Backquote') {
        G.debug = !G.debug;
        if (G.debug && G.phase !== 'menu') practice.debugRun = true;
        triggerUpdate();
        return;
      }

      if (G.paused || G.phase === 'menu' || G.phase === 'end') return;

      // EVP recorder: R raises/lowers; while up, [ ] tune and Space records.
      if (e.code === 'KeyR' && !e.repeat) {
        e.preventDefault();
        G.toggleRecorder();
        triggerUpdate();
        return;
      }
      if (evp.raised) {
        if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
          e.preventDefault();
          evp.tune((e.code === 'BracketLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.5));
          triggerUpdate();
          return;
        }
        if (e.code === 'Space') {
          e.preventDefault();
          if (!e.repeat) evp.setRecording(true);
          return;
        }
      }

      // Route lines [L]
      if (e.code === 'KeyL' && !e.repeat) {
        e.preventDefault();
        openRouteSelector();
        return;
      }

      // Polaroid Album [TAB] toggle
      if (e.code === 'Tab') {
        e.preventDefault();
        polaroidManager.toggleAlbum();
        triggerUpdate();
        return;
      }

      // Polaroid Viewfinder [C] toggle (hands busy: raising the camera lowers the recorder)
      if (e.code === 'KeyC') {
        e.preventDefault();
        if (!e.repeat) G.toggleCamera();
        triggerUpdate();
        return;
      }

      // Inter-Car Gangway Door [E] interaction
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (G.interactGangwayDoor()) {
          triggerUpdate();
        } else if (!e.repeat && (G.phase === 'ride' || G.phase === 'stop' || G.phase === 'intro')) {
          // Nothing to open here: say where the doors are.
          G.setHint('Walk to the end of the car to open a gangway door.', 2.5);
        }
        return;
      }

      // Practice stretch: Enter moves on once a lesson is done (the mouse is captured while looking).
      if (e.code === 'Enter' && G.tutorial && !G.choice && !polaroidManager.isViewfinderOpen) {
        e.preventDefault();
        if (!e.repeat) G.tutorial.next();
        triggerUpdate();
        return;
      }

      // Snap photo if viewfinder is active
      if (polaroidManager.isViewfinderOpen && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        // One shot per press: holding the key doesn't fire the shutter again.
        if (!e.repeat) G.takePolaroidPhoto();
        triggerUpdate();
        return;
      }

      // Player Movement (WASD) across connected subway cars
      if (!G.choice && !G.restraint) {
        if (e.code === 'KeyW') keysDownRef.current.w = true;
        if (e.code === 'KeyS') keysDownRef.current.s = true;
        if (e.code === 'KeyA') keysDownRef.current.a = true;
        if (e.code === 'KeyD') keysDownRef.current.d = true;

        if (['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
          const fwd = (keysDownRef.current.w ? 1 : 0) - (keysDownRef.current.s ? 1 : 0);
          const right = (keysDownRef.current.d ? 1 : 0) - (keysDownRef.current.a ? 1 : 0);
          G.setMoveInput(fwd, right);
        }
      }

      // Keyboard look (arrow keys): held keys turn the view smoothly in the render loop.
      if (KeyLook.isLookKey(e.code)) {
        e.preventDefault();
        keyLookRef.current.press(e.code);
        return;
      }

      // Flagging / Restraint holding
      if ((e.code === 'KeyF' || e.code === 'Space') && !e.repeat) {
        if (e.code === 'Space' && !G.restraint) return;
        e.preventDefault();
        G.flagHeld = true;
        triggerUpdate();
      }

      // Choice hotkeys (1, 2, 3)
      const numMatch = e.code.match(/^(Digit|Numpad)([1-3])$/);
      if (numMatch && G.choice) {
        const choiceIdx = parseInt(numMatch[2], 10) - 1;
        if (choiceIdx < G.choice.items.length) {
          G.pickChoiceIndex(G.choice.keyMap[choiceIdx]);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const G = engineRef.current;
      if (!G) return;
      keyLookRef.current.release(e.code);

      // WASD key release
      if (e.code === 'KeyW') keysDownRef.current.w = false;
      if (e.code === 'KeyS') keysDownRef.current.s = false;
      if (e.code === 'KeyA') keysDownRef.current.a = false;
      if (e.code === 'KeyD') keysDownRef.current.d = false;

      if (['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        const fwd = (keysDownRef.current.w ? 1 : 0) - (keysDownRef.current.s ? 1 : 0);
        const right = (keysDownRef.current.d ? 1 : 0) - (keysDownRef.current.a ? 1 : 0);
        G.setMoveInput(fwd, right);
      }

      if (e.code === 'Space' && evp.recording) evp.setRecording(false);
      if (e.code === 'KeyF' || e.code === 'Space') {
        G.flagHeld = false;
        triggerUpdate();
      }
    };

    // Mouse wheel tunes the recorder while it's up.
    const handleWheel = (e: WheelEvent) => {
      const G = engineRef.current;
      if (!G || G.paused || !evp.raised || !e.deltaY) return;
      evp.tune(e.deltaY < 0 ? 0.5 : -0.5);
      triggerUpdate();
    };

    const handleVisibility = () => {
      const G = engineRef.current;
      const outsideRide = !G || G.phase === 'menu' || G.phase === 'end';
      if (document.hidden) {
        if (outsideRide) {
          // Start screen or report: nothing to pause, but a tape playing on the report stops
          // and the audio goes quiet while the tab is away.
          G?.stopTape();
          audioEngine.suspend();
        } else if (G.paused) audioEngine.suspend(); // already paused: stop the pause music too
        else pauseGame();
      } else if (outsideRide) {
        audioEngine.wake();
      } else if (G.paused) {
        // Back on the tab while paused: bring the pause music back.
        audioEngine.wake();
        audioEngine.enterPause();
      }
    };

    // Alt-tab or clicking another window: the key-up never arrives, so release held
    // inputs here. During the restraint this starts the grace period instead of failing it.
    const handleBlur = () => {
      releaseHeldKeys();
      const G = engineRef.current;
      if (!G) return;
      G.interruptInputs();
      triggerUpdate();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [triggerUpdate, pauseGame, resumeGame, releaseHeldKeys, openRouteSelector]);

  const handleStartGame = (nightmare = false, startChapter = 1) => {
    const { startMuted } = settings.get();
    // Inside the click, as browsers require: go full screen for the ride.
    if (settings.get().fullscreenOnBoard) enterFullscreen();
    audioEngine.init(startMuted);
    audioEngine.wake();
    setIsMuted(startMuted);

    const G = engineRef.current;
    if (G) {
      // With Settings > "Debug overlay (spoilers)" on, the overlay shows from the start (phones have no
      // backquote key) and the whole ride is a debug run. Backquote still hides/shows it on keyboards.
      G.debug = settings.get().debugOverlay;
      if (G.debug) practice.debugRun = true;
      G.nightmare = nightmare; // kept for Ride Again / Restart until the next start screen
      G.startChapter = startChapter; // likewise; Chapter II and III are practice runs
      // The first ride starts with the practice stretch (skippable); after that, straight in.
      if (!tutorialSeen() && startChapter === 1 && !nightmare) G.startTutorial();
      else G.startIntro();
      triggerUpdate();
    }
  };

  /** The title screen's "Practice stretch": the lesson again, then a normal ride. */
  const handleStartTutorial = () => {
    const { startMuted } = settings.get();
    if (settings.get().fullscreenOnBoard) enterFullscreen();
    audioEngine.init(startMuted);
    audioEngine.wake();
    setIsMuted(startMuted);
    const G = engineRef.current;
    if (G) {
      G.nightmare = false;
      G.startTutorial();
      triggerUpdate();
    }
  };

  const handleFlagDown = () => {
    const G = engineRef.current;
    if (G && !G.paused) {
      G.flagHeld = true;
      triggerUpdate();
    }
  };

  const handleFlagUp = () => {
    const G = engineRef.current;
    if (G) {
      G.flagHeld = false;
      triggerUpdate();
    }
  };

  const handleToggleMute = () => {
    const muted = audioEngine.toggleMute();
    setIsMuted(muted);
    triggerUpdate();
  };

  const handlePause = pauseGame;
  const handleResume = resumeGame;

  // Restart from the pause menu: a fresh run from the same starting chapter. The abandoned
  // ride is not saved to run history (only endGame() saves).
  const handleRestart = () => {
    const G = engineRef.current;
    if (!G) return;
    audioEngine.exitPause();
    G.startIntro(); // resets all run state and unpauses
    audioEngine.wake();
    requestLock();
    triggerUpdate();
  };

  // Ride Again (or "Get back on" after The Eternal Commute) goes straight into the intro.
  const handlePlayAgain = (looped = false) => {
    const G = engineRef.current;
    if (G) {
      G.startIntro({ looped });
      triggerUpdate();
    }
  };

  return (
    <div className="relative w-screen h-dvh overflow-hidden bg-ink text-cream font-sans">
      {/* 3D Canvas Stage */}
      <div
        ref={containerRef}
        className="absolute -inset-2 z-0 touch-none will-change-transform"
        style={{ filter: tierStyle.filter, transition: 'filter 2s ease' }}
      />

      {/* Atmospheric Vignette Filter */}
      <div
        className="fixed inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, #000000 100%)',
          opacity: tierStyle.vignetteOpacity,
          transition: 'opacity 2s ease',
        }}
      />

      {/* Interactive HUD Overlay */}
      {engineRef.current && (
        <HUD
          engine={engineRef.current}
          onPause={handlePause}
          onToggleMute={handleToggleMute}
          isMuted={isMuted}
          onFlagDown={handleFlagDown}
          onFlagUp={handleFlagUp}
          onToggleCamera={() => {
            engineRef.current?.toggleCamera();
            triggerUpdate();
          }}
          onToggleAlbum={() => {
            polaroidManager.toggleAlbum();
            triggerUpdate();
          }}
          onOpenRouteSelector={openRouteSelector}
        />
      )}

      {/* Vintage Polaroid 600 Viewfinder & Flash */}
      {engineRef.current && (
        <PolaroidViewfinder
          engine={engineRef.current}
          onClose={() => {
            polaroidManager.setViewfinder(false);
            triggerUpdate();
          }}
          onOpenAlbum={() => {
            polaroidManager.setAlbum(true);
            triggerUpdate();
          }}
        />
      )}

      {/* Polaroid Evidence Photo Album Drawer */}
      {polaroidManager.isAlbumOpen && (
        <PolaroidAlbum
          engine={engineRef.current ?? undefined}
          onClose={() => {
            polaroidManager.setAlbum(false);
            triggerUpdate();
          }}
          onOpenCamera={
            engineRef.current && engineRef.current.phase !== 'menu' && engineRef.current.phase !== 'end'
              ? () => {
                  // Same path as the Camera button (respects busy hands, lowers the recorder).
                  polaroidManager.setAlbum(false);
                  if (!polaroidManager.isViewfinderOpen) engineRef.current?.toggleCamera();
                  triggerUpdate();
                }
              : undefined
          }
        />
      )}

      {/* Branching Transit Route Line Selector */}
      {routeSelectorOpen && (
        <RouteSelector
          onClose={() => setRouteSelectorOpen(false)}
          onSelectRoute={(route) => {
            if (engineRef.current) {
              engineRef.current.setHint(`Now on the ${route.id}: ${route.stops[1]} to ${route.stops[route.stops.length - 1]}.`, 4.5);
              triggerUpdate();
            }
          }}
        />
      )}

      {/* Practice stretch coach card */}
      {engineRef.current?.tutorial && phase !== 'menu' && !paused && (
        <TutorialCoach
          view={engineRef.current.tutorial.view}
          isTouch={isTouch}
          onNext={() => {
            engineRef.current?.tutorial?.next();
            triggerUpdate();
          }}
          onSkip={() => {
            engineRef.current?.finishTutorial(true);
            triggerUpdate();
          }}
        />
      )}

      {/* Start / Briefing Screen */}
      {phase === 'menu' && (
        <StartScreen
          onStart={handleStartGame}
          onPractice={handleStartTutorial}
          onOpenSettings={() => setSettingsOpen(true)}
          isTouch={isTouch}
          engine={engineRef.current ?? undefined}
        />
      )}

      {/* Pause Screen Overlay */}
      {paused && engineRef.current && (
        <PauseScreen
          engine={engineRef.current}
          onResume={handleResume}
          onRestart={handleRestart}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* Settings, only from the start screen or the pause menu */}
      {settingsOpen && (phase === 'menu' || paused) && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} isTouch={isTouch} />
      )}

      {/* End of Ride Psychological Travel Report */}
      {phase === 'end' && engineRef.current && (
        <ReportScreen
          engine={engineRef.current}
          runs={runsHistory}
          onPlayAgain={handlePlayAgain}
          // The ride is already saved; a fresh page is the cleanest way back to the title.
          onTitle={() => window.location.reload()}
        />
      )}
    </div>
  );
}
