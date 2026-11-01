/**
 * Sanity, suspicion and the body's reactions to them: heart, breathing, the background intercom
 * and screen glitches. Split out of gameState.ts; GameEngine keeps thin wrappers with the same
 * names, so window.__G and the e2e tests see no change.
 */
import {
  BANDS,
  BREATH_MAX_FLAGS,
  BREATH_PER_FLAG_DEG,
  BREATH_TIERS,
  GLITCH_TIERS,
  HEART_BPM,
  HEART_JITTER,
  INTERCOM_EVERY,
  INTERCOM_MIN_ROOM,
  INTERCOM_RETRY,
  RESTRAINT_RAISE,
  TD,
} from "../constants";
import { audioEngine } from "../audio/audioEngine";
import type { PersonObject, SegmentDef } from "../types";
import type { GameEngine } from "./gameState";

export function getBand(G: GameEngine, stop: number): [number, number] {
  const base = BANDS[stop] || [0, 9];
  const b: [number, number] = [base[0], base[1]];
  if (stop >= 11 && G.restraintOK) {
    b[1] += RESTRAINT_RAISE;
  }
  return b;
}

export function addSanity(G: GameEngine, d: number, reason: string) {
  const [lo, hi] = G.getBand(G.bandStop);
  const before = G.san;
  G.san = Math.max(lo, Math.min(hi, G.san + d));
  G.sanLog.push({ t: G.GT, d: G.san - before, raw: d, reason });
  G.notifyUI();
}

export function addSus(
  G: GameEngine,
  n: number,
  reason: string,
  watcher?: PersonObject,
) {
  G.sus = Math.max(0, Math.min(100, G.sus + n));
  if (n > 0) {
    G.peak = Math.max(G.peak, G.sus);
    G.susLog.push({ t: G.GT, n, reason, stop: G.seg ? G.seg.stop : 1 });
    G.segSusGain = true;
  }
  if (watcher) {
    watcher.holdUntil = G.GT + 1.6;
    watcher.until = Math.max(watcher.until || 0, watcher.holdUntil);
  }
  G.notifyUI();
}

export function sampleSanity(G: GameEngine) {
  const [lo, hi] = G.getBand(G.bandStop);
  const pos = hi > lo ? Math.max(0, Math.min(1, (G.san - lo) / (hi - lo))) : 1;
  G.sanSamples.push({ stop: G.bandStop, san: G.san, lo, hi, pos });
  const rec = G.stopLog[G.stopLog.length - 1];
  if (rec && rec.san === undefined) {
    rec.san = Math.round(G.san);
    rec.lo = lo;
    rec.hi = hi;
  }
}

export function getSanityScore(G: GameEngine): number {
  if (!G.sanSamples.length) return 0;
  const avg = G.sanSamples.reduce((a, x) => a + x.pos, 0) / G.sanSamples.length;
  return Math.round(100 * avg);
}

/**
 * Heart rate follows the sanity tier, easing over a few seconds rather than jumping, and turns
 * irregular at low sanity. At Critical each beat is also heard (the thump stays in sync with
 * the HUD trace because both come from this clock).
 */
export function updateHeart(G: GameEngine, dt: number) {
  const target = HEART_BPM[G.tier];
  G.heartBpm += (target - G.heartBpm) * (1 - Math.exp(-dt / 2.5));
  if (G.GT < G.heartNextAt) return;

  // Anchor each beat to its planned time, not the frame it lands on, so the rate doesn't
  // drift slow at low frame rates. After a long gap (new run), restart the clock.
  const beatAt = G.GT - G.heartNextAt > 1 ? G.GT : G.heartNextAt;
  G.heartBeats.push(beatAt);
  if (G.heartBeats.length > 12) G.heartBeats.shift();
  const period =
    (60 / G.heartBpm) * (1 + HEART_JITTER[G.tier] * (Math.random() * 2 - 1));
  G.heartNextAt = beatAt + period;
  if (G.tier >= 3) audioEngine.thump(period);
}

/**
 * Anxious breathing: during rides at Medium sanity and below, the view narrows slightly on each
 * inhale. Rate and depth follow the tier, and each flag you've placed this ride deepens it.
 * Everything eases, so it fades in over a few seconds and settles back out at each station.
 */
export function updateBreath(G: GameEngine, dt: number) {
  const p = G.phase === "ride" ? BREATH_TIERS[G.tier] : null;
  const flags = Math.min(G.segFlags.length, BREATH_MAX_FLAGS);
  const depth = p ? p.depthDeg + BREATH_PER_FLAG_DEG * flags : 0;
  const bpm = p ? p.bpm : G.breathBpm;
  const tau = depth > G.breathDepth ? 3 : 1.5;
  G.breathDepth += (depth - G.breathDepth) * (1 - Math.exp(-dt / tau));
  if (!G.breathBpm) G.breathBpm = bpm || BREATH_TIERS[1]!.bpm;
  G.breathBpm += (bpm - G.breathBpm) * (1 - Math.exp(-dt / 2.5));
  // A little slow wander in the rate, so it reads as breathing rather than a metronome.
  const wander =
    1 + 0.12 * Math.sin(G.GT * 0.41) + 0.06 * Math.sin(G.GT * 1.13 + 1.7);
  G.breathPhase = (G.breathPhase + (dt * G.breathBpm * wander) / 60) % 1;
}

/** FOV change in degrees (at the 68° base) for this frame: 0 at rest, negative on the inhale. */
export function breathFovOffset(G: GameEngine): number {
  if (G.breathDepth < 0.005) return 0;
  // Short, quick inhale (35% of the cycle) and a longer exhale.
  const ph = G.breathPhase;
  const sm = (x: number) => x * x * (3 - 2 * x);
  const shape = ph < 0.35 ? sm(ph / 0.35) : 1 - sm((ph - 0.35) / 0.65);
  return -G.breathDepth * shape;
}

/**
 * Background intercom: a garbled announcement every 28–55 s of riding, pitched and paced by
 * the sanity tier. It waits for a quiet moment (no real PA, dialogue, prompt, restraint or
 * intervention) and never starts near braking, so it can't mask the arrival chime or doors.
 */
export function updateIntercom(G: GameEngine, dt: number, seg: SegmentDef) {
  G.intercomT -= dt;
  if (G.intercomT > 0) return;
  const roomBeforeBraking = G.segLen(seg) - TD - G.ts;
  const busy =
    !!G.paText || !!G.subHtml || !!G.choice || !!G.restraint || G.intervening;
  if (busy || roomBeforeBraking < INTERCOM_MIN_ROOM) {
    G.intercomT = INTERCOM_RETRY;
    return;
  }
  const duration = audioEngine.intercom(G.tier);
  G.intercomUntil = G.GT + duration;
  G.intercomCount++;
  G.intercomT =
    duration +
    INTERCOM_EVERY[0] +
    Math.random() * (INTERCOM_EVERY[1] - INTERCOM_EVERY[0]);
}

/**
 * Start a screen glitch. Real (anomaly) and decoy glitches draw from the same per-tier ranges,
 * so strength and length never reveal which one it was. No glitches at High or Medium; a
 * Critical anomaly appearing above Low still uses the Low ranges.
 */
export function triggerGlitch(G: GameEngine, reason: "anomaly" | "decoy") {
  const p =
    GLITCH_TIERS[G.tier] ?? (reason === "anomaly" ? GLITCH_TIERS[2] : null);
  if (!p) return;
  // One at a time: never restart a glitch that's still playing (e.g. two anomalies in one frame).
  if (G.glitch && G.GT - G.glitch.start < G.glitch.duration) return;
  const r = (range: [number, number]) =>
    range[0] + Math.random() * (range[1] - range[0]);
  const strength = r(p.strength);
  const duration = r(p.duration);
  G.glitch = { start: G.GT, duration, strength, seed: Math.random() * 1000 };
  G.glitchLog.push({ gt: G.GT, reason, strength, duration });
  if (G.glitchLog.length > 50) G.glitchLog.shift();
}

/** Current glitch strength 0..1: fast attack, eased decay. 0 when idle or paused. */
export function glitchAmount(G: GameEngine): number {
  const g = G.glitch;
  if (!g || G.paused) return 0;
  const p = (G.GT - g.start) / g.duration;
  if (p < 0 || p >= 1) return 0;
  const env = p < 0.08 ? p / 0.08 : Math.pow(1 - (p - 0.08) / 0.92, 1.5);
  return g.strength * env;
}

/** Decoy glitches at Low and Critical, at random during rides. */
export function updateGlitchDecoys(G: GameEngine, dt: number) {
  if (G.glitch && G.GT - G.glitch.start >= G.glitch.duration) G.glitch = null;
  const p = GLITCH_TIERS[G.tier];
  if (!p) return;
  G.glitchDecoyT -= dt;
  if (G.glitchDecoyT > 0) return;
  if (!G.glitch) G.triggerGlitch("decoy");
  G.glitchDecoyT =
    p.decoyEvery[0] + Math.random() * (p.decoyEvery[1] - p.decoyEvery[0]);
}
