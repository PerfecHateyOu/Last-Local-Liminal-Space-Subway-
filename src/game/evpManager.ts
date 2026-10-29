/**
 * EVP recorder (Operation Skyward, Phase 2): Dad's old microcassette recorder.
 *
 * It carries story and dread. It is never a detector:
 *  - Broadcasts are authored and tied to stretches of the ride, never to the 13 car anomalies.
 *  - Each segment also has decoy carriers. The meter and the lock react to decoys exactly as to
 *    broadcasts, so a lock says nothing about the car.
 *  - Frequencies are shuffled every run, so tuning is a skill, not memorisation.
 *
 * Audio lives in audio/evpAudio.ts; the engine wires suspicion, hands-busy and the handoff.
 */

import { practice } from './practice';
import { routeManager } from './routeManager';
import { fillRoute } from './routeText';
import { unlockAchievement } from './achievements';

export const EVP_MIN_KHZ = 70;
export const EVP_MAX_KHZ = 180;
/** Within this many kHz of a carrier, the recorder locks on. */
export const EVP_LOCK_KHZ = 1.0;
/** The meter starts to rise this far out (Gaussian width). */
const METER_WIDTH_KHZ = 4;
/** Hold a lock while recording this long (game seconds) to save a tape. */
export const EVP_RECORD_HOLD = 1.5;
/** Seconds of listening to reveal a whole transcript. */
const REVEAL_SECONDS = 3;
const DECOYS_PER_SEGMENT = 2;
/** Minimum spacing (kHz) between broadcasts heard in the same stretch, and around decoys. */
export const SIGNAL_GAP = 8;
export const DECOY_GAP = 5;

export type EvpCategory = 'dispatch' | 'passenger' | 'conductor' | 'warning';

export interface EvpSignalDef {
  id: string;
  /** Shown on the tape label and in the log. */
  title: string;
  /** Segments (by destination stop) during which it can be picked up. */
  stops: number[];
  category: EvpCategory;
  transcript: string;
  /** Intercom voice tier (0 clear … 3 broken) used for the garbled speech. */
  voice: number;
  /** Transcript on routes where the default doesn't fit (the L and 7 never surface). */
  transcriptOffG?: string;
  /** Title on routes where the default doesn't fit. */
  titleOffG?: string;
}

/** About one broadcast per stretch from the Safe Haven on. Chapter 3's sit on the trestle. */
export const EVP_SIGNALS: EvpSignalDef[] = [
  {
    id: 'dispatch-hold',
    title: 'Dispatch, track 2',
    stops: [6, 7],
    category: 'dispatch',
    transcript: '…{line} four-forty, hold at {s10}. Hold. Do not open the doors at {s10}…',
    voice: 1,
  },
  {
    id: 'passenger-hoyt',
    title: 'A passenger',
    stops: [7, 8, 9],
    category: 'passenger',
    transcript: '…I got on at {originShort} too. I always get on at {originShort}. I always get on at {originShort}…',
    voice: 1,
  },
  {
    id: 'dispatch-empty',
    title: 'Dispatch, no train number',
    stops: [9, 10],
    category: 'dispatch',
    transcript: '…there is no train scheduled on this track. Repeat: nothing is scheduled on this track…',
    voice: 2,
  },
  {
    id: 'passenger-greenpoint',
    title: 'Someone at the far end',
    stops: [10, 11],
    category: 'passenger',
    transcript: '…first time? It gets easier after {s11}. Don’t let them see you looking…',
    voice: 2,
  },
  {
    id: 'warning-time',
    title: 'Static, then a time',
    stops: [11, 12],
    category: 'warning',
    transcript: '…6:52… 6:52 a.m.… it was 6:52 the last time, too…',
    voice: 3,
  },
  {
    id: 'conductor',
    title: 'The conductor',
    stops: [12, 13],
    category: 'conductor',
    transcript: '…this is your conductor. We are above ground. This train does not go above ground…',
    transcriptOffG: '…this is your conductor. We are under the river. This train does not go under the river…',
    voice: 2,
  },
  {
    id: 'mom-voice',
    title: 'A voice like Mom’s',
    stops: [12, 13],
    category: 'passenger',
    transcript: '…honey, don’t look at the window. Look at me. Look at me…',
    voice: 0,
  },
  {
    id: 'station-bedford',
    title: '{s5} dispatch static',
    stops: [6, 7],
    category: 'dispatch',
    transcript: '…Dispatch 44 to all units on {line}… relay failure at {s5}. Unauthorized personnel on track bed… repeat: do not look at track bed…',
    voice: 1,
  },
  {
    id: 'station-classon',
    title: '{s4} phantom PA echo',
    stops: [6, 7, 8],
    category: 'warning',
    transcript: '…Please stand clear of the closing doors… the train following this one does not exist… return to your seat immediately…',
    voice: 2,
  },
  {
    id: 'station-flushing',
    title: '{s7} night wiretap',
    stops: [7, 8, 9],
    category: 'passenger',
    transcript: '…Station log 02:14. Platform empty, but footsteps continue down the south stairs. Someone is whistling the wrong chime…',
    voice: 1,
  },
  {
    id: 'station-newtown',
    title: 'Newtown Creek emergency channel',
    titleOffG: 'Track emergency channel',
    stops: [10, 11, 12],
    category: 'dispatch',
    transcript: '…Maritime security channel 16. Bridge clearance confirmed. Unscheduled train visible on upper trestle. Who authorized that train…',
    transcriptOffG: '…Track security channel 16. Signals confirmed. Unscheduled train visible on a closed track. Who authorized that train…',
    voice: 2,
  },
];

/** A broadcast's title on the current route. */
export function titleOf(s: EvpSignalDef): string {
  return fillRoute(routeManager.routeId !== 'G' && s.titleOffG ? s.titleOffG : s.title);
}

/** The words of a broadcast on the current route. */
export function transcriptOf(s: EvpSignalDef): string {
  return fillRoute(routeManager.routeId !== 'G' && s.transcriptOffG ? s.transcriptOffG : s.transcript);
}

export interface EvpTape {
  signalId: string;
  title: string;
  stop: string;
  freq: string;
  transcript: string;
  gt: number;
}

export interface EvpCarrier {
  kind: 'signal' | 'decoy';
  khz: number;
  signal?: EvpSignalDef;
}

const ARCHIVE_KEY = 'gtrain-tapes';
export type EvpArchive = Record<string, { first: number; count: number }>;

export function loadEvpArchive(): EvpArchive {
  try {
    const a = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '{}');
    return a && typeof a === 'object' ? a : {};
  } catch {
    return {};
  }
}

function saveEvpArchive(a: EvpArchive) {
  if (practice.on) return; // practice tapes play on this report only
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a));
  } catch {
    /* storage blocked: the tape still shows this ride */
  }
}

export class EvpManager {
  public hasRecorder = false;
  public raised = false;
  public recording = false;
  public khz = 120;

  /** 0..1, same shape for broadcasts and decoys. */
  public meter = 0;
  public locked: EvpCarrier | null = null;
  /** Fraction of the locked broadcast's transcript heard so far (0..1). */
  public reveal = 0;
  /** Seconds of the current recording hold. */
  public recordT = 0;
  public tapes: EvpTape[] = [];
  /** The last tape saved and when (wall-clock ms), for the panel's brief "Saved to tape" note. */
  public lastSaved: { title: string; at: number } | null = null;
  /** Suspicion is charged at most once per raise. */
  public watchedCharged = false;

  private signalKhz: Record<string, number> = {};
  private decoyKhz: Record<number, number[]> = {};
  private heard: Record<string, number> = {};

  public onChange?: () => void;

  /** A new ride: no recorder yet, fresh frequencies, empty tapes. */
  public newRun(rand: () => number = Math.random) {
    this.hasRecorder = false;
    this.raised = false;
    this.recording = false;
    this.khz = 120;
    this.meter = 0;
    this.locked = null;
    this.reveal = 0;
    this.recordT = 0;
    this.tapes = [];
    this.lastSaved = null;
    this.heard = {};
    this.watchedCharged = false;

    // Broadcasts that can be heard in the same stretch sit at least SIGNAL_GAP kHz apart;
    // decoys at least DECOY_GAP from everything else in their stretch. Only stretches matter
    // (two broadcasts that never overlap may share a frequency), which is what lets 11 fit.
    // Lay out a whole ride, check it, and try again if anything is too close.
    const share = (a: EvpSignalDef, b: EvpSignalDef) => a.stops.some((x) => b.stops.includes(x));
    const rnd = () => Math.round((EVP_MIN_KHZ + 4 + rand() * (EVP_MAX_KHZ - EVP_MIN_KHZ - 8)) * 10) / 10;
    const pick = (minGap: number, against: number[]) => {
      for (let tries = 0; tries < 300; tries++) {
        const f = rnd();
        if (against.every((o) => Math.abs(o - f) >= minGap)) return f;
      }
      return null;
    };
    const layout = (): boolean => {
      this.signalKhz = {};
      // Most-overlapped broadcasts first: they have the least room.
      const order = [...EVP_SIGNALS].sort(
        (a, b) => EVP_SIGNALS.filter((x) => share(x, b)).length - EVP_SIGNALS.filter((x) => share(x, a)).length
      );
      for (const sig of order) {
        const against = order.filter((o) => o !== sig && this.signalKhz[o.id] !== undefined && share(o, sig)).map((o) => this.signalKhz[o.id]);
        const f = pick(SIGNAL_GAP, against);
        if (f === null) return false;
        this.signalKhz[sig.id] = f;
      }
      this.decoyKhz = {};
      for (let stop = 6; stop <= 13; stop++) {
        const near = EVP_SIGNALS.filter((x) => x.stops.includes(stop)).map((x) => this.signalKhz[x.id]);
        const ds: number[] = [];
        for (let i = 0; i < DECOYS_PER_SEGMENT; i++) {
          const f = pick(DECOY_GAP, [...near, ...ds]);
          if (f === null) return false;
          ds.push(f);
        }
        this.decoyKhz[stop] = ds;
      }
      return true;
    };
    for (let attempt = 0; attempt < 50 && !layout(); attempt++) {
      /* retry */
    }
    this.changed();
  }

  /** Carriers receivable during the ride to `stop` (null = not riding: nothing). */
  public carriers(stop: number | null): EvpCarrier[] {
    if (stop === null) return [];
    const out: EvpCarrier[] = EVP_SIGNALS.filter((s) => s.stops.includes(stop)).map((s) => ({
      kind: 'signal' as const,
      khz: this.signalKhz[s.id],
      signal: s,
    }));
    for (const f of this.decoyKhz[stop] || []) out.push({ kind: 'decoy', khz: f });
    return out;
  }

  public setKhz(khz: number) {
    this.khz = Math.max(EVP_MIN_KHZ, Math.min(EVP_MAX_KHZ, Math.round(khz * 10) / 10));
  }

  public tune(deltaKhz: number) {
    this.setKhz(this.khz + deltaKhz);
  }

  public raise() {
    if (!this.hasRecorder || this.raised) return;
    this.raised = true;
    this.watchedCharged = false;
    this.changed();
  }

  public lower() {
    if (!this.raised && !this.recording) return;
    this.raised = false;
    this.recording = false;
    this.recordT = 0;
    this.locked = null;
    this.meter = 0;
    this.changed();
  }

  public setRecording(on: boolean) {
    const next = on && this.raised;
    if (next === this.recording) return;
    this.recording = next;
    if (!next) this.recordT = 0;
    this.changed();
  }

  /**
   * Per frame. `stop` is the destination of the segment being ridden (null when not riding).
   * Returns a tape when one is saved this frame.
   */
  public update(dt: number, stop: number | null, gt: number, stopLabel: string): EvpTape | null {
    if (!this.raised) {
      this.meter = 0;
      this.locked = null;
      return null;
    }
    const cs = this.carriers(stop);
    let best: EvpCarrier | null = null;
    let bestD = Infinity;
    for (const c of cs) {
      const d = Math.abs(c.khz - this.khz);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.meter = best ? Math.exp(-((bestD / METER_WIDTH_KHZ) ** 2)) : 0;
    const prevLocked = this.locked;
    this.locked = best && bestD <= EVP_LOCK_KHZ ? best : null;
    if (this.locked !== prevLocked) this.changed();

    const sig = this.locked?.kind === 'signal' ? this.locked.signal! : null;
    if (sig) {
      this.heard[sig.id] = Math.min(1, (this.heard[sig.id] || 0) + dt / REVEAL_SECONDS);
      this.reveal = this.heard[sig.id];
    } else {
      this.reveal = 0;
    }

    if (this.recording && sig && !this.tapes.some((t) => t.signalId === sig.id)) {
      this.recordT += dt;
      if (this.recordT >= EVP_RECORD_HOLD) {
        this.recordT = 0;
        const tape: EvpTape = {
          signalId: sig.id,
          title: titleOf(sig),
          stop: stopLabel,
          freq: `${this.khz.toFixed(1)} kHz`,
          transcript: transcriptOf(sig),
          gt,
        };
        this.tapes.push(tape);
        this.lastSaved = { title: tape.title, at: Date.now() };
        const a = loadEvpArchive();
        a[sig.id] = { first: a[sig.id]?.first ?? Date.now(), count: (a[sig.id]?.count ?? 0) + 1 };
        saveEvpArchive(a);
        if (Object.keys(a).length >= 3) {
          unlockAchievement('tuning_pro');
        }
        if (sig.id.startsWith('station-')) {
          unlockAchievement('broadcaster_lore');
        }
        this.changed();
        return tape;
      }
    } else {
      this.recordT = 0;
    }
    return null;
  }

  /** Test/debug helper: the frequency a broadcast sits on this run. */
  public khzOf(signalId: string): number | undefined {
    return this.signalKhz[signalId];
  }

  public decoysFor(stop: number): number[] {
    return [...(this.decoyKhz[stop] || [])];
  }

  private changed() {
    this.onChange?.();
  }
}

export const evp = new EvpManager();
