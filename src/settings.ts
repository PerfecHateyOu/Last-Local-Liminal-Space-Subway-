/**
 * Player settings, saved on this device.
 *
 * One small store that the audio engine, the render loop, the look controls and the HUD read
 * from. Changes apply immediately (including mid-ride, from the pause menu).
 */
import { useSyncExternalStore } from 'react';

export type ScreenEffects = 'system' | 'full' | 'reduced';

export interface Settings {
  /** Multiplier on mouse and touch look speed. */
  lookSensitivity: number;
  invertY: boolean;
  /** Game sounds, ambience and the intercom (0–1). */
  gameVolume: number;
  /** The tune: the ride's music and the pause menu's (0–1). */
  musicVolume: number;
  /**
   * Screen tearing, breathing and the animated heartbeat trace. "system" follows the
   * device's reduced-motion setting.
   */
  screenEffects: ScreenEffects;
  /** Go full screen when boarding the train (where the browser allows it). */
  fullscreenOnBoard: boolean;
  /** Rides (and the practice stretch) start with sound off; M or the Sound button turns it on. */
  startMuted: boolean;
  /** The HUD's key-hint strip, for the first minute of the first ride. */
  showHints: boolean;
  /**
   * Opt-in spoiler overlay: when on, the backquote key shows the debug overlay in any build.
   * A ride where it was shown is a debug run and saves nothing.
   */
  debugOverlay: boolean;
}

export const SENSITIVITY_RANGE = [0.4, 2.0] as const;

export const DEFAULT_SETTINGS: Settings = {
  lookSensitivity: 1,
  invertY: false,
  gameVolume: 1,
  musicVolume: 1,
  screenEffects: 'system',
  fullscreenOnBoard: true,
  startMuted: false,
  showHints: true,
  debugOverlay: false,
};

const KEY = 'gtrain-settings';
/** Saved progress the "Erase saved progress" button clears. */
export const PROGRESS_KEYS = [
  'gtrain-psychlog',
  'gtrain-runs',
  'gtrain-tapes',
  'gtrain-endings',
  'courtSq_endingsArchive',
  'gtrain-polaroids',
  'gtrain-achievements',
];

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

function sanitize(raw: any): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    lookSensitivity: clamp(raw.lookSensitivity, SENSITIVITY_RANGE[0], SENSITIVITY_RANGE[1], d.lookSensitivity),
    invertY: typeof raw.invertY === 'boolean' ? raw.invertY : d.invertY,
    gameVolume: clamp(raw.gameVolume, 0, 1, d.gameVolume),
    musicVolume: clamp(raw.musicVolume, 0, 1, d.musicVolume),
    screenEffects: ['system', 'full', 'reduced'].includes(raw.screenEffects) ? raw.screenEffects : d.screenEffects,
    fullscreenOnBoard: typeof raw.fullscreenOnBoard === 'boolean' ? raw.fullscreenOnBoard : d.fullscreenOnBoard,
    startMuted: typeof raw.startMuted === 'boolean' ? raw.startMuted : d.startMuted,
    showHints: typeof raw.showHints === 'boolean' ? raw.showHints : d.showHints,
    debugOverlay: typeof raw.debugOverlay === 'boolean' ? raw.debugOverlay : d.debugOverlay,
  };
}

class SettingsStore {
  private value: Settings;
  private listeners = new Set<() => void>();
  private systemReduced = false;
  /** Bumped when saved progress is erased, so screens showing it can re-read. */
  private progressEpoch = 0;

  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      /* storage blocked or corrupt: use defaults */
    }
    this.value = sanitize(raw);

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.systemReduced = mq.matches;
      mq.addEventListener?.('change', (e) => {
        this.systemReduced = e.matches;
        this.emit();
      });
    }
  }

  public get = (): Settings => this.value;

  public set(patch: Partial<Settings>) {
    this.value = sanitize({ ...this.value, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* not saved, but still applies this session */
    }
    this.emit();
  }

  public subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** True when screen tearing, breathing and the heartbeat animation should be off. */
  public effectsReduced(): boolean {
    const m = this.value.screenEffects;
    return m === 'reduced' || (m === 'system' && this.systemReduced);
  }

  public systemPrefersReduced(): boolean {
    return this.systemReduced;
  }

  /** Clears everything in PROGRESS_KEYS (see savedProgress). Settings are kept. */
  public eraseProgress() {
    for (const k of PROGRESS_KEYS) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
    this.progressEpoch++;
    this.emit();
  }

  public getProgressEpoch = (): number => this.progressEpoch;

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export const settings = new SettingsStore();

// The page's CSS animations (sign flicker, pulsing lights) follow the in-game Screen effects
// setting, not only the device's reduced-motion setting (see index.css).
if (typeof document !== 'undefined') {
  const mark = () => document.documentElement.setAttribute('data-effects', settings.effectsReduced() ? 'reduced' : 'full');
  mark();
  settings.subscribe(mark);
}

/** React hook: current settings, re-rendering when they change. */
export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get, settings.get);
}

/** React hook: changes whenever saved progress is erased. */
export function useProgressEpoch(): number {
  return useSyncExternalStore(settings.subscribe, settings.getProgressEpoch, settings.getProgressEpoch);
}

/**
 * What "Erase saved progress" would remove, counted, so the confirmation can say exactly that.
 * Empty when there's nothing saved.
 */
export function savedProgress(): string[] {
  const read = (k: string): unknown => {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  };
  const count = (v: unknown, keep: (x: any) => boolean = () => true) =>
    Array.isArray(v) ? v.filter(keep).length : v && typeof v === 'object' ? Object.values(v).filter(keep).length : 0;
  const n = (k: number, one: string, many: string) => (k > 0 ? [`${k} ${k === 1 ? one : many}`] : []);
  const endings = new Set([
    ...Object.keys((read('gtrain-endings') as object) || {}),
    ...Object.keys((read('courtSq_endingsArchive') as object) || {}),
  ]).size;
  return [
    ...n(count(read('gtrain-runs')), 'finished ride', 'finished rides'),
    ...n(count(read('gtrain-psychlog'), (r) => r && r.seen > 0), 'Case Files entry', 'Case Files entries'),
    ...n(endings, 'ending', 'endings'),
    ...n(count(read('gtrain-tapes')), 'tape', 'tapes'),
    ...n(count(read('gtrain-polaroids')), 'print', 'prints'),
    ...n(count(read('gtrain-achievements')), 'badge', 'badges'),
  ];
}
