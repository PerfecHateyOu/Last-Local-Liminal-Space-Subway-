/**
 * Core type definitions for LAST LOCAL
 * Based on Master Project Document v5.1
 */
import * as THREE from 'three';

export type GamePhase = 'menu' | 'intro' | 'ride' | 'stop' | 'haven' | 'trial' | 'end';

export interface SegmentDef {
  stop: number;
  b?: boolean;
  anoms: number;
  forced?: string[];
  type?: 'real' | 'false' | 'haven';
  tick?: 'doors' | 'flicker';
  forgiving?: boolean;
  mask?: number[];
  crowd?: boolean;
  chat?: number;
  whisper?: boolean;
  thin?: boolean;
  silent?: boolean;
  restraint?: boolean;
  bait?: boolean;
  paLie?: string;
  final?: boolean;
  cruise?: number;
  _masks?: Array<{ t: number; done: boolean }>;
  _havenSaid?: boolean;
  _screech?: boolean;
  _mislead?: boolean;
}

export interface ChoiceItem {
  txt: string;
  val: any;
}

export interface ChoiceState {
  items: ChoiceItem[];
  window: number;
  left: number;
  glitch: number;
  reshuffle?: boolean;
  reshuffled?: boolean;
  gT: number;
  keyMap: number[];
  onPick: (val: any, rt: number) => void;
}

export interface AnomalyDef {
  tier: number;
  make: () => {
    tids: string[];
    obj: THREE.Object3D | null;
    desc: string;
    /** Words a parent says aloud when it happens (shown as a subtitle; the report quotes the same line). */
    line?: string;
    apply: () => void;
    revert: () => void;
    ready?: () => boolean;
  } | null;
}

export interface ActiveAnomaly {
  id: string;
  tier: number;
  tids: string[];
  obj: THREE.Object3D | null;
  desc: string;
  /** See AnomalyDef: spoken when it happens. */
  line?: string;
  trigger: number;
  at: number | null;
  apply: () => void;
  revert: () => void;
  ready?: () => boolean;
}

export interface StopAnomalyRecord {
  id: string;
  desc: string;
  hit: boolean;
  /** How it was caught: a held flag, a photo, or both. */
  via?: 'flag' | 'photo' | 'both';
}

export interface StopLogRecord {
  stop: number;
  b: boolean;
  name: string;
  type?: 'real' | 'haven' | 'false' | string;
  tick?: 'doors' | 'flicker' | null;
  mislead?: boolean;
  bait?: boolean;
  paLie?: boolean;
  doors?: 'stay' | 'off' | null;
  correct?: boolean;
  anoms: StopAnomalyRecord[];
  fps: string[];
  san?: number;
  lo?: number;
  hi?: number;
}

export interface SusLogEntry {
  t: number;
  n: number;
  reason: string;
  stop: number;
}

export interface SanLogEntry {
  t: number;
  d: number;
  raw: number;
  reason: string;
}

export interface SanSample {
  stop: number;
  san: number;
  lo: number;
  hi: number;
  pos: number;
}

export interface RestraintState {
  t: number;
  started: boolean;
  wait: number;
  dur: number;
  failed: boolean;
  beats: number;
  grace: number;
}

export interface TrialEvent {
  at: number;
  i: number;
  kind: 'flick' | 'open' | 'close';
  done?: boolean;
}

export interface TrialState {
  depth: number;
  need: number;
  mode: 'paths' | 'board';
  cyc: number;
  correct: number;
  events: TrialEvent[];
  picks: Array<{ mode: string; ok: boolean }>;
  stopName: string;
  stepT: number;
}

export interface TrialRecord {
  stop: number;
  depth: number;
  clean: boolean;
}

export interface RunHistoryRecord {
  date: number;
  san: number;
  sanPct: number;
  peak: number;
  acc: { correct: number; miss: number; fp: number };
  trials: number;
  endingId?: string;
  /** Ridden in Nightmare mode. */
  nightmare?: boolean;
}

export interface PolaroidPhoto {
  id: string;
  timestamp: number;
  dataUrl: string;
  carIndex: number;
  routeId: 'G' | 'L' | '7';
  /** Ride segment the shot was taken in (-1 outside a ride), and its stop label ("7", "6b"). */
  segIdx: number;
  stop: string;
  /**
   * Prints develop after the ride, like a real Polaroid 600. Until then nothing about what the
   * shot caught is shown anywhere: a photo must never work as a real-time anomaly detector.
   */
  developed: boolean;
  /** Private until developed: manifested anomalies in frame at the moment of the shot. */
  framed: Array<{ id: string; desc: string }>;
  /** Filled in when the stop is scored: anomalies this photo caught (private until developed). */
  caught: string[];
  /** Set when developed. */
  hasAnomalyInFrustum: boolean;
  anomalyName?: string;
  exposureQuality: number;
  description?: string;
}

export interface TransitLineRoute {
  id: 'G' | 'L' | '7';
  name: string;
  bulletColor: string;
  bulletTextColor: string;
  accentHex: number;
  anomalyFrequency: number;
  soundtrackProfile: string;
  description: string;
  stops: string[];
}

export interface ConsistState {
  currentCarIndex: number; // 0: Car A (Lead), 1: Car B (Center), 2: Car C (Rear)
  isCrossingGangway: boolean;
  gangwayProgress: number; // 0..1
  doorAOpen: boolean;
  doorBOpen: boolean;
}

/**
 * Outfit archetypes for passengers built from boxes (see CharacterBuilder):
 *  coat     - burgundy knee-length coat, small dark hat, canvas tote in one hand
 *  mta      - MTA maintenance worker: navy uniform, hi-vis vest, hard hat
 *  puffer   - bulky puffer jacket, over-ear headphones
 *  office   - grey dress shirt and tie, messenger bag, folded newspaper
 *  hoodie   - navy hoodie, white headphones over a beanie, baggy jeans, backpack
 *  texter   - navy puffer, phone held up at the chest, backpack, hair in a bun
 *  overcoat - long dark overcoat over a black turtleneck, slicked hair; very still
 */
export type PersonArchetype = 'coat' | 'mta' | 'puffer' | 'office' | 'hoodie' | 'texter' | 'overcoat';

export interface PersonObject {
  g: THREE.Group;
  head: THREE.Group;
  phone: THREE.Object3D | null;
  eyes: THREE.Mesh[];
  skMat: THREE.Material;
  skin: number;
  tid: string;
  label: string;
  home: THREE.Vector3;
  pose: [number, number];
  carIndex?: number;
  mode?: 'phone' | 'other' | 'player' | 'down';
  until?: number;
  holdUntil?: number;
  /** Seconds the player has been staring at this passenger (decays when they look away). */
  stareT?: number;
  force?: boolean;
  frozen?: boolean;
  yaw?: number;
  pitch?: number;
  facing?: boolean;
  i?: number;
  downSide?: number;
  stare?: boolean;
  twist?: boolean;
  twitchTimer?: number;
  flashReactionUntil?: number;
  syncChorus?: boolean;
  uncannyAvert?: boolean;
  /** Outfit from PersonConfig (the #74 lineup); carLife picks small habits from it. */
  archetype?: string;
  standing?: boolean;
  /** passengerBehavior: the head is held by a stare, chorus or flash; carLife adds no habits. */
  gazeLocked?: boolean;
  /** carLife state: body lean (spring) and the head/prop offsets it added this frame. */
  life?: {
    lean: number;
    leanVel: number;
    phase: number;
    headX: number;
    headY: number;
    nextAt: number;
    startT: number;
    untilT: number;
    act: '' | 'nod' | 'page' | 'scroll' | 'radio';
    prop: THREE.Object3D | null;
    propBase: number;
  };
  modelSource?: string;
  isImportedModel?: boolean;
}
