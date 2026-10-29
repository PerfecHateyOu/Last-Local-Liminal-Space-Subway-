/**
 * Game State & Engine Loop for LAST LOCAL
 * Implements the full v5.1 specification: 13-stop sequence, band-relative scoring,
 * parental gaze/masking, False Stop Trial, Restraint moment, and sensory sabotage.
 */
import * as THREE from 'three';
import {
  BANDS,
  BREATH_MAX_FLAGS,
  BREATH_PER_FLAG_DEG,
  BREATH_TIERS,
  CALM_CHATS,
  CFG,
  CHATS,
  DRIFT,
  GLITCH_TIERS,
  HEART_BPM,
  HEART_JITTER,
  INTERCOM_EVERY,
  INTERCOM_FIRST,
  INTERCOM_MIN_ROOM,
  INTERCOM_RETRY,
  MASK_DIALOGUES,
  type MaskDialogue,
  PARANOID_UI_WORDS,
  RESTRAINT_GRACE,
  RESTRAINT_RAISE,
  SAN,
  SEGS,
  SUS,
  TA,
  TD,
  TIER_NAMES,
  V,
  NIGHTMARE,
  tierOf,
  CHAPTERS,
  ChapterDef,
  chapterForStop,
  FORWARD_X,
} from '../constants';
import { recordRide, PsychLogResult, entryState } from './psychLog';
import { audioEngine } from '../audio/audioEngine';
import { SubwayCarBuilder } from '../graphics/subwayCarBuilder';
import { TrialBuilder } from '../graphics/trialBuilder';
import { AnomalyManager } from './anomalyManager';
import { haptics } from './haptics';
import { settings } from '../settings';
import { polaroidManager } from './polaroidManager';
import { evp, EVP_SIGNALS } from './evpManager';
import { passengerBehavior } from './passengerBehavior';
import { carLife } from './carLife';
import { shuffle } from './shuffle';
import { PassingTrain } from '../graphics/passingTrain';
import { routeManager } from './routeManager';
import { routeText, fillRoute } from './routeText';
import { resolveEnding, endingSummary, recordEndingToArchive, EndingDefinition, ExitChoice } from './endings';
import { unlockAchievement } from './achievements';
import { practice, CHAPTER_START_SEGMENT } from './practice';
import { Tutorial, markTutorialSeen } from './tutorial';

/** Foggy sodium-vapor night fog colour on the open trestle. */
const TRESTLE_FOG = new THREE.Color('#322018');
/** Chance a tape played out loud makes a parent who wasn't watching turn to look. */
const TAPE_GLANCE_CHANCE = 0.5;
/** "The next stop is…" PA: seconds into the stretch, and how long it shows. */
const NEXT_STOP_PA_AT = 7.0;
const NEXT_STOP_PA_S = 4.5;
/** The parents' chat on a stretch: when its two lines start, and how long each shows. */
const CHAT_AT = [15.0, 18.6] as const;
const CHAT_LINE_S = 3.4;
/** How long a mask check (line, answer, reaction) keeps the subtitles busy, at most. */
const MASK_CHECK_S = 10;
/** The in-transit conductor's garbled lines (audioEngine.conductorBroadcast variants 1–3), subtitled (doc 6). */
const CONDUCTOR_LINES = ['…stand clear of the closing doors…', '…next stop… transfer available…', '…held momentarily by the dispatcher…'];
/** Chance a flash makes a parent who wasn't watching turn to look. */
const FLASH_GLANCE_CHANCE = 0.5;
/** Game seconds while the print ejects before the next shot (stops a double tap or a held key from burning film). */
export const SHUTTER_COOLDOWN = 0.9;
const HAPTIC_DELAY_S = 0.9; // after arrival, between the chime starting and the doors
import {
  ActiveAnomaly,
  ChoiceItem,
  ChoiceState,
  GamePhase,
  PersonObject,
  RestraintState,
  RunHistoryRecord,
  SanLogEntry,
  SanSample,
  SegmentDef,
  StopLogRecord,
  SusLogEntry,
  TrialRecord,
  TrialState,
} from '../types';

export class GameEngine {
  public phase: GamePhase = 'menu';
  public GT: number = 0;
  public paused: boolean = false;
  public debug: boolean = false;

  // Kinematics and position
  public segIdx: number = -1;
  public seg: SegmentDef | null = null;
  public ts: number = 0;
  public odo: number = 0;
  public speed: number = 0;
  /** Seconds into this stretch when a train passes on the other track, or null for none. */
  public passAt: number | null = null;
  /**
   * Seconds into this stretch when a third-rail gap makes one ceiling tube flicker, or null.
   * One tube only, never the whole car (that's the False Stop flicker tick, doc 2.4 / 4.4).
   */
  public tubeFlickerAt: number | null = null;
  /** The tube flickering now: its index in carBuilder.lightSegs and until when (game time). */
  public tubeFlicker: { i: number; until: number } | null = null;
  /** Seconds into this stretch when an in-transit conductor announcement plays, or null. */
  public conductorAt: number | null = null;
  /** Start times (s into the stretch) where the conductor fits without talking over a scripted line. */
  public conductorFree: [number, number][] = [];
  /** Game time until which the background intercom is talking. */
  public intercomUntil: number = 0;
  /** Whether the brake wheel flange squeal already played this deceleration. */
  public squealedThisBrake: boolean = false;
  /** Passenger lean and habits (src/game/carLife.ts). */
  public readonly life = carLife;
  public bandStop: number = 1;

  // Multi-Car Consist & Player Movement
  public moveFwd: number = 0;
  public moveRight: number = 0;
  public currentCarIndex: number = 1; // 0: Car A (Lead), 1: Car B (Mid), 2: Car C (Rear)
  public isCrossingGangway: boolean = false;
  public nearGangwayDoor: 'front' | 'rear' | null = null;
  public stepTimer: number = 0;

  // Sanity & Suspicion
  public san: number = 100;
  public sus: number = 0;
  public peak: number = 0;
  public harder: number = 0;
  public interventions: number = 0;
  public intervening: boolean = false;
  public tier: number = 0;

  public susLog: SusLogEntry[] = [];
  public sanLog: SanLogEntry[] = [];
  public sanSamples: SanSample[] = [];
  public stopLog: StopLogRecord[] = [];
  public acc = { correct: 0, fp: 0, miss: 0 };

  // Anomalies & Flags
  public active: ActiveAnomaly[] = [];
  public usedTids: Set<string> = new Set();
  public segFlags: Array<{ tid: string; gt: number }> = [];
  public segSusGain: boolean = false;

  public flagHeld: boolean = false;
  public flagProg: number = 0;
  public flagTid: string | null = null;
  public flagLock: boolean = false;
  public notedT: number = -9;

  // Camera & Gaze
  public gazeTid: string | null = null;
  public dwell: number = 0;
  public dwellReacted: boolean = false;
  public angVel: number = 0;
  public snapArc: number = 0;
  public snapPeak: number = 0;
  public snapCd: number = 0;
  public prevDir: THREE.Vector3 | null = null;

  public yaw: number = 0;
  public pitch: number = -0.05;
  public ty: number = 0;
  public tp: number = -0.05;

  // World elements
  public doorOpen: number = 1;
  public doorTarget: number = 1;
  public flickerUntil: number = -1;
  public dim: number = 1;

  // Systems
  public restraint: RestraintState | null = null;
  public restraintDone: boolean = false;
  public restraintOK: boolean = false;
  public restraintWhy: string = '';

  public trial: TrialState | null = null;
  public trials: TrialRecord[] = [];
  private chatSwap: Record<number, [number, string][]> = {};
  public misleadUsed: boolean = false;
  public misleadStop: number = 9;

  public choice: ChoiceState | null = null;
  public keyHintShown: boolean = false;

  // Audio & Atmosphere Timers
  public subUntil: number = 0;
  public paUntil: number = 0;
  public hintUntil: number = 0;
  public subHtml: string = '';
  public paText: string = '';
  public hintText: string = '';
  public clackD: number = 6;
  public whisperT: number = 20;
  public intercomT: number = INTERCOM_FIRST[0]; // ride-time countdown to the next background announcement
  public intercomCount: number = 0;
  // Screen glitch currently playing (game time), and the ride-time countdown to the next decoy.
  public glitch: { start: number; duration: number; strength: number; seed: number } | null = null;
  public glitchDecoyT: number = 30;
  public glitchLog: Array<{ gt: number; reason: 'anomaly' | 'decoy'; strength: number; duration: number }> = [];
  // Trestle (Operation Skyward, Phase 1): absolute track positions where the tunnel ends and
  // starts again. +Infinity / null mean "tunnel everywhere" (every segment but the last two).
  public trestleExitAt: number = Infinity;
  public trestleEnterAt: number | null = null;
  /** Fraction of the consist in the open (0..1), and whether any open air is in view. */
  public trestleOutside: number = 0;
  public trestleShow: boolean = false;
  private fogBase: { color: THREE.Color; near: number; far: number } | null = null;
  // Breathing: phase 0..1 through the current breath, and the eased rate and depth (degrees).
  public breathPhase: number = 0;
  public breathBpm: number = 0;
  public breathDepth: number = 0;
  // Psychological Log for the finished ride (set at the end of a run).
  public psychLog: PsychLogResult | null = null;
  // Heart clock: one source for the HUD trace and the Critical-tier thump, in game time.
  public heartBpm: number = HEART_BPM[0];
  public heartNextAt: number = 0;
  public heartBeats: number[] = []; // GT of recent beats, newest last
  public isTouch: boolean = false;
  /** The practice stretch, while it runs (src/game/tutorial.ts). */
  public tutorial: Tutorial | null = null;

  // Operation Skyward Phase 3: Chapters & Multiple Escape Endings
  public currentChapter: ChapterDef = CHAPTERS[0];
  public chapterRollsign: { chapter: ChapterDef; title: string; subtitle: string; until: number } | null = null;
  public lastShownChapterIndex: number = 0;
  public finalExitChoice: ExitChoice | null = null;
  /**
   * A tape playing out loud (Evidence Log or report). During the ride it can be heard: a parent
   * watching while it plays costs Suspicion once, and it may make one look.
   */
  public tapePlaying: { signalId: string; inRide: boolean; charged: boolean; endsAt: number } | null = null;
  private tapeTimer: ReturnType<typeof setTimeout> | null = null;

  /** The trestle badge has been checked this ride. */
  private trestleBadgeChecked = false;

  /** Nightmare mode (see NIGHTMARE in constants.ts). Chosen on the start screen; kept across rides. */
  public nightmare = false;
  /**
   * The chapter the ride starts from (the start screen's "Start from"). Chapter I is a full ride;
   * II and III are practice runs that save nothing (see practice.ts). Kept across rides.
   */
  public startChapter = 1;
  /** Game time until which each ceiling tube is out (Nightmare bulb flicker). */
  private bulbOut: number[] = [];

  /** This ride is a practice run (started from Chapter II or III): nothing it does is saved. */
  public get isPractice(): boolean {
    return practice.on;
  }

  /** This ride began with "Get back on" after The Eternal Commute. */
  public looped: boolean = false;
  public resolvedEnding: EndingDefinition | null = null;

  // Subway train motion and screen shake
  public screenShake: { x: number; y: number; rot: number; intensity: number } = {
    x: 0,
    y: 0,
    rot: 0,
    intensity: 0,
  };
  private railClackT: number = 1.0;
  private railImpulse: number = 0;

  // 3D Scene Components
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public carBuilder: SubwayCarBuilder;
  public trialBuilder: TrialBuilder;
  public anomalyMgr: AnomalyManager;

  // Internal helpers
  private Q: Array<{ t: number; fn: () => void }> = [];
  private raycaster = new THREE.Raycaster();
  private centerVec = new THREE.Vector2(0, 0);
  private dirVec = new THREE.Vector3();
  private tmpVec1 = new THREE.Vector3();
  private tmpVec2 = new THREE.Vector3();
  public eyePos = new THREE.Vector3(0, 1.18, 0.4);
  private trialEyePos = new THREE.Vector3(0, 1.6, 2.2);
  private idleTime: number = 0;

  // Event callbacks for UI
  public onStateChange?: () => void;
  public onReportReady?: (runs: RunHistoryRecord[]) => void;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, isTouch: boolean = false) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.isTouch = isTouch;

    this.carBuilder = new SubwayCarBuilder(scene);
    this.carBuilder.buildScene();
    this.trialBuilder = new TrialBuilder(scene);
    this.anomalyMgr = new AnomalyManager(this.carBuilder);

    this.misleadStop = Math.random() < CFG.misleadChance ? 9 : 0;

    // Switching lines renames what's in view straight away, not at the next stretch.
    routeManager.onRouteChanged = () => this.renameStations();
  }

  /**
   * The two platforms in view take the current line's names: the one the train left (or is
   * standing at, before a ride) and the one it's heading to. Otherwise, after a mid-ride switch,
   * the HUD and the PA would name one station and the platform you pull into another.
   */
  private renameStations() {
    const cb = this.carBuilder;
    const seg = this.seg;
    const from = seg ? (this.segIdx > 0 ? SEGS[this.segIdx - 1].stop : 1) : 1;
    const to = seg ? seg.stop : 2;
    cb.stA.setName(routeManager.getStopName(from));
    cb.stB.setName(routeManager.getStopName(to));
    // A chapter card still showing names the stretch's stations: follow the line too.
    const card = this.chapterRollsign;
    if (card) this.chapterRollsign = { ...card, ...this.rollsignLabels(card.chapter) };
    this.notifyUI();
  }

  private rollsignLabels(chapter: ChapterDef): { title: string; subtitle: string } {
    const route = routeManager.activeRoute;
    return {
      title: route.id !== 'G' && chapter.titleOffG ? chapter.titleOffG : chapter.title,
      subtitle: `${route.stops[chapter.startStop]} to ${route.stops[chapter.endStop]}`,
    };
  }

  public sched(delay: number, fn: () => void) {
    this.Q.push({ t: this.GT + delay, fn });
  }

  public runSched() {
    const due = this.Q.filter((e) => this.GT >= e.t).sort((a, b) => a.t - b.t);
    if (!due.length) return;
    this.Q = this.Q.filter((e) => !due.includes(e));
    due.forEach((e) => e.fn());
  }

  public setSub(html: string, dur: number) {
    this.subHtml = html;
    this.subUntil = this.GT + dur;
    this.notifyUI();
  }

  public setPA(text: string, dur: number) {
    this.paText = text;
    this.paUntil = this.GT + dur;
    this.notifyUI();
  }

  public setHint(text: string, dur: number) {
    this.hintText = text;
    this.hintUntil = this.GT + dur;
    this.notifyUI();
  }

  /** Chapter card. Silent (the chime belongs to the doors), never pauses, and labels come from the route. */
  public triggerChapterRollsign(chapter: ChapterDef) {
    this.currentChapter = chapter;
    this.chapterRollsign = { chapter, ...this.rollsignLabels(chapter), until: this.GT + 4.5 };
    this.notifyUI();
  }

  public say(parentIdx: number, line: string, dur: number = 3.2) {
    const parent = this.carBuilder.parents[parentIdx];
    this.setSub(`<b>${parent.label}:</b> ${line}`, dur);
  }

  /** For the tutorial's coach card. */
  public refreshUI() {
    this.notifyUI();
  }

  /** Angle (rad) between where you're looking and an object. */
  public angleTo(obj: THREE.Object3D): number {
    obj.getWorldPosition(this.tmpVec1);
    this.tmpVec1.sub(this.camera.position).normalize();
    return this.dirVec.angleTo(this.tmpVec1);
  }

  /** The practice stretch, then the ride (the first ride, or the title screen's "Practice stretch"). */
  public startTutorial() {
    this.startChapter = 1;
    this.startIntro({ tutorial: true });
  }

  /** Done or skipped: on to the real ride, fresh. */
  public finishTutorial(_skipped: boolean) {
    this.startIntro();
  }

  private notifyUI() {
    if (this.onStateChange) this.onStateChange();
  }

  /** Head-snap tuning: on touch a snap must be faster and cover a big turn, so a quick swipe isn't a head whip. */
  public get snapThresh(): number {
    return this.isTouch ? CFG.snapThreshTouch : CFG.snapThresh;
  }
  public get snapArcMin(): number {
    return this.isTouch ? CFG.snapArcTouch : CFG.snapArc;
  }

  /**
   * Held inputs can be lost without a key/pointer-up (alt-tab, pause screen, Esc releasing the mouse).
   * Release them, and during the restraint give the player a grace period to re-hold instead of failing it.
   */
  public interruptInputs() {
    this.flagHeld = false;
    this.setMoveInput(0, 0); // stop walking: the key-ups may never arrive
    if (this.restraint) {
      this.restraint.grace = Math.max(this.restraint.grace, RESTRAINT_GRACE);
    }
  }

  public pause() {
    if (this.paused || this.phase === 'menu' || this.phase === 'end') return;
    evp.setRecording(false);
    this.stopTape();
    this.paused = true;
    this.interruptInputs();
    this.notifyUI();
  }

  public resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.restraint) {
      this.restraint.grace = Math.max(this.restraint.grace, RESTRAINT_GRACE);
      this.setHint(this.isTouch ? 'Hold the button again. Don’t react.' : 'Hold Space again. Don’t react.', 3.0);
    }
    this.notifyUI();
  }

  public getBand(stop: number): [number, number] {
    const base = BANDS[stop] || [0, 9];
    const b: [number, number] = [base[0], base[1]];
    if (stop >= 11 && this.restraintOK) {
      b[1] += RESTRAINT_RAISE;
    }
    return b;
  }

  public addSanity(d: number, reason: string) {
    const [lo, hi] = this.getBand(this.bandStop);
    const before = this.san;
    this.san = Math.max(lo, Math.min(hi, this.san + d));
    this.sanLog.push({ t: this.GT, d: this.san - before, raw: d, reason });
    this.notifyUI();
  }

  public addSus(n: number, reason: string, watcher?: PersonObject) {
    this.sus = Math.max(0, Math.min(100, this.sus + n));
    if (n > 0) {
      this.peak = Math.max(this.peak, this.sus);
      this.susLog.push({ t: this.GT, n, reason, stop: this.seg ? this.seg.stop : 1 });
      this.segSusGain = true;
    }
    if (watcher) {
      watcher.holdUntil = this.GT + 1.6;
      watcher.until = Math.max(watcher.until || 0, watcher.holdUntil);
    }
    this.notifyUI();
  }

  public sampleSanity() {
    const [lo, hi] = this.getBand(this.bandStop);
    const pos = hi > lo ? Math.max(0, Math.min(1, (this.san - lo) / (hi - lo))) : 1;
    this.sanSamples.push({ stop: this.bandStop, san: this.san, lo, hi, pos });
    const rec = this.stopLog[this.stopLog.length - 1];
    if (rec && rec.san === undefined) {
      rec.san = Math.round(this.san);
      rec.lo = lo;
      rec.hi = hi;
    }
  }

  public getSanityScore(): number {
    if (!this.sanSamples.length) return 0;
    const avg = this.sanSamples.reduce((a, x) => a + x.pos, 0) / this.sanSamples.length;
    return Math.round(100 * avg);
  }

  public newGame() {
    this.Q = [];
    this.GT = 0;
    this.phase = 'intro';
    this.segIdx = -1;
    this.seg = null;
    this.ts = 0;
    this.odo = 0;
    this.bandStop = 1;
    this.san = 100;
    this.sus = 0;
    this.peak = 0;
    this.harder = 0;
    this.interventions = 0;
    this.intervening = false;
    this.tier = 0;
    this.susLog = [];
    this.sanLog = [];
    this.sanSamples = [];
    this.stopLog = [];
    this.acc = { correct: 0, fp: 0, miss: 0 };
    this.active = [];
    this.usedTids = new Set();
    this.segFlags = [];
    this.segSusGain = false;
    this.flagHeld = false;
    this.flagProg = 0;
    this.flagTid = null;
    this.flagLock = false;
    this.notedT = -9;
    this.eyePos.set(0, 1.18, 0.4);
    this.currentCarIndex = 1;
    this.moveFwd = 0;
    this.moveRight = 0;
    this.isCrossingGangway = false;
    this.nearGangwayDoor = null;
    this.stepTimer = 0;
    this.gazeTid = null;
    this.dwell = 0;
    this.dwellReacted = false;
    this.angVel = 0;
    this.snapArc = 0;
    this.snapPeak = 0;
    this.snapCd = 0;
    this.yaw = 0;
    this.pitch = -0.05;
    this.ty = 0;
    this.tp = -0.05;
    this.doorOpen = 1;
    this.doorTarget = 1;
    this.flickerUntil = -1;
    this.dim = 1;
    this.restraint = null;
    this.restraintDone = false;
    this.restraintOK = false;
    this.restraintWhy = '';
    this.trial = null;
    this.trials = [];
    this.misleadUsed = false;
    this.nextShotAt = 0;
    // Swap some calm exchanges (chat slots 0-2) for extra small talk, each extra used at most once a ride.
    const extra = [...CALM_CHATS];
    this.chatSwap = {};
    for (const i of [0, 1, 2]) {
      if (extra.length && Math.random() < 0.5) this.chatSwap[i] = extra.splice(Math.floor(Math.random() * extra.length), 1)[0];
    }
    this.heartBpm = HEART_BPM[0];
    this.heartNextAt = 0;
    this.heartBeats = [];
    this.intercomT = INTERCOM_FIRST[0] + Math.random() * (INTERCOM_FIRST[1] - INTERCOM_FIRST[0]);
    this.intercomCount = 0;
    this.intercomUntil = 0;
    this.glitch = null;
    this.glitchDecoyT = 30;
    this.glitchLog = [];
    this.breathPhase = 0;
    this.trestleExitAt = Infinity;
    this.trestleEnterAt = null;
    this.trestleOutside = 0;
    this.trestleShow = false;
    this.tubeFlickerAt = null;
    this.tubeFlicker = null;
    this.conductorAt = null;
    this.conductorFree = [];
    this.squealedThisBrake = false;
    // Put the tunnel back: the intro doesn't run the world placement that would otherwise do it.
    this.carBuilder.trestle?.reset();
    this.carBuilder.tunnelWalls.forEach((w) => (w.position.x = 0));
    this.carBuilder.tunnelItems.forEach((it) => (it.m.visible = true));
    this.carBuilder.stA?.setOpenAir(false);
    this.carBuilder.stB?.setOpenAir(false);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && this.fogBase) {
      fog.color.copy(this.fogBase.color);
      fog.near = this.fogBase.near;
      fog.far = this.fogBase.far;
    }
    audioEngine.setOpenAir(0);
    audioEngine.stopLastLocalAnnouncement(0.1);
    this.breathBpm = 0;
    this.breathDepth = 0;
    this.psychLog = null;
    evp.newRun();
    this.misleadStop = Math.random() < CFG.misleadChance ? 9 : 0;
    // Clear on-screen text too: with its timer zeroed, expiry never clears leftover text.
    this.subHtml = '';
    this.paText = '';
    this.hintText = '';
    this.subUntil = 0;
    this.paUntil = 0;
    this.hintUntil = 0;
    this.choice = null;
    this.paused = false;
    this.currentChapter = CHAPTERS[0];
    this.chapterRollsign = null;
    this.lastShownChapterIndex = 0;
    this.finalExitChoice = null;
    this.resolvedEnding = null;
    this.trestleBadgeChecked = false;
    this.stopTape();

    // Reset world entities
    const cb = this.carBuilder;
    cb.acrossAds.forEach((a) => {
      cb.textureGen.drawAdOnCanvas(a.canvas, a.def, a.def.h);
      a.tex.needsUpdate = true;
    });
    cb.maps.forEach((m) => {
      cb.textureGen.drawRouteMap(m.canvas, 'normal');
      m.tex.needsUpdate = true;
    });
    cb.lightSegs.forEach((l) => l.mat.color.set(0xfff4de));
    cb.panes.forEach((p) => (p.decal.visible = false));

    cb.parents.forEach((p) => {
      p.mode = 'phone';
      p.until = 2 + Math.random() * 3;
      p.holdUntil = 0;
      p.force = false;
      p.frozen = false;
      p.yaw = 0;
      p.pitch = 0.5;
      p.facing = false;
      p.eyes.forEach((e) => e.scale.set(1, 1, 1));
      (p.skMat as THREE.MeshLambertMaterial).color.set(p.skin);
    });

    [...cb.strangers, cb.extraPerson, ...cb.crowd].forEach((s) => {
      s.g.position.copy(s.home);
      s.g.visible = true;
      s.stare = false;
      s.twist = false;
      s.head.rotation.set(s.pose[1], s.pose[0], 0);
      s.head.rotation.z = 0;
    });
    cb.extraPerson.g.visible = false;
    cb.crowd.forEach((c) => (c.g.visible = false));

    cb.worldGroup.visible = true;
    this.trialBuilder.group.visible = false;
    cb.stA.baseX = 0;
    cb.stA.setName(routeManager.getStopName(1));
    cb.stB.baseX = 9999;
    cb.stB.setName(routeManager.getStopName(2));

    this.notifyUI();
  }

  /**
   * A new ride. `looped` is "Get back on" after The Eternal Commute: the same ride, but you've
   * been here before (no tutorial hint, and Dad's line lands as a repeat). Nothing else carries over.
   */
  public startIntro(opts: { looped?: boolean; tutorial?: boolean } = {}) {
    // Leaving the practice stretch (finished, skipped, or Restart from the pause menu).
    if (this.tutorial) {
      this.tutorial.cleanUp();
      this.tutorial = null;
      markTutorialSeen();
    }
    this.newGame();
    this.looped = !!opts.looped;
    // Camera and route are per ride: a restart or Ride again starts with fresh film,
    // an empty album, the viewfinder down and the G route.
    polaroidManager.reset();
    routeManager.reset();
    carLife.reset(this.carBuilder.getAllPassengers(), this.GT);
    this.carBuilder.passingTrain.stop();
    this.passAt = null;
    this.phase = 'intro';
    this.doorOpen = 1;
    this.doorTarget = 1;

    // Practice run: start at the chapter's first stretch, from the station before it.
    const from = CHAPTER_START_SEGMENT[this.startChapter] ?? 0;
    practice.on = from > 0;
    practice.chapter = practice.on ? this.startChapter : 1;
    if (from > 0) {
      this.carBuilder.stA.setName(routeManager.getStopName(SEGS[from - 1].stop));
      this.carBuilder.stB.setName(routeManager.getStopName(SEGS[from].stop));
      // Sanity starts where that stretch's band allows (the first drift clamps it into the band).
      this.bandStop = SEGS[from].stop;
      this.san = this.getBand(this.bandStop)[1];
      // Dad handed you the recorder at the Stop 6 Safe Haven; by Chapter III you have it.
      if (SEGS[from].stop > 6) evp.hasRecorder = true;
    }

    // The report screen drops the master level and fades the hum out, and a Trial or the
    // Stop 6 transition thins the bed. A new run (Ride again, or Restart from the pause
    // menu) must start at full ambience.
    audioEngine.setMasterLevel(0.85, 0.3);
    audioEngine.setBedLevel(1.0, 0.3);
    audioEngine.resetRideMusic(); // a new ride starts at the top of the tune
    this.maskUsed.clear(); // mask lines can come back on a new ride
    this.maskLast = null;

    // The practice stretch: the train waits at the platform with the doors open; nothing counts.
    if (opts.tutorial) {
      practice.on = true;
      this.tutorial = new Tutorial(this);
      this.notifyUI();
      return;
    }
    audioEngine.startLastLocalAnnouncement();

    this.sched(1.2, () => this.setPA(fillRoute('This is the Last Local. {terminus}–bound {line} train.'), 4.0));
    if (!this.looped) {
      this.sched(2.5, () =>
        this.setHint(
          this.isTouch
            ? 'Drag to look around. Hold FLAG while looking at anything that changes.'
            : 'Move the mouse to look. Hold F while looking at anything that changes.',
          7.0
        )
      );
    }
    this.sched(6.0, () => this.say(1, 'Grab a seat. It\u2019s a long one.', 2.8));
    if (this.looped) this.sched(8.9, () => this.setSub('<em>He said that last time, too.</em>', 2.4));
    this.sched(9.0, () => {
      this.setPA('Stand clear of the closing doors, please.', 3.0);
      audioEngine.chime();
    });
    this.sched(10.4, () => {
      this.doorTarget = 0;
    });
    if (from > 0 && evp.hasRecorder) {
      this.sched(12.5, () =>
        this.setHint(this.isTouch ? 'You have Dad\u2019s tape recorder. Tap Recorder to raise it.' : 'You have Dad\u2019s tape recorder. Press R to raise it.', 5)
      );
    }
    this.sched(11.6, () => {
      audioEngine.stopLastLocalAnnouncement(1.2);
      this.startSegment(from);
    });
    this.notifyUI();
  }

  public startSegment(idx: number) {
    audioEngine.stopLastLocalAnnouncement(0.5);
    const prev = this.seg;
    if (prev) {
      this.sampleSanity();
      this.odo += this.segDist(prev);
    }

    this.segIdx = idx;
    this.seg = SEGS[idx];
    const seg = this.seg;
    this.phase = 'ride';
    this.ts = 0;
    this.segFlags = [];
    this.segSusGain = false;
    this.bandStop = seg.stop;

    if (this.harder > 0) this.harder--;
    const base = DRIFT[seg.stop] ?? SAN.drift;
    const dVal = this.nightmare ? Math.min(NIGHTMARE.minDrift, base * NIGHTMARE.drift) : base;
    this.addSanity(dVal, 'Per-stop drift');

    // Chapter progression and analog rollsign trigger
    const targetChapter = chapterForStop(seg.stop);
    if (targetChapter.index !== this.lastShownChapterIndex) {
      this.lastShownChapterIndex = targetChapter.index;
      this.sched(0.6, () => this.triggerChapterRollsign(targetChapter));
    }

    // Slide station platforms
    const cb = this.carBuilder;
    const tmp = cb.stA;
    cb.stA = prev ? cb.stB : cb.stA;
    cb.stB = prev ? tmp : cb.stB;
    cb.stA.baseX = this.odo;
    cb.stB.baseX = this.odo + this.segDist(seg);
    cb.stB.setName(routeManager.getStopName(seg.stop));
    if (seg.stop === 9) cb.stB.setName(routeManager.getStopName(9));

    // The trestle: on the G, the train climbs out of the Newtown Creek tunnel a quarter of the
    // way to 21 St, arrives at an open-air 21 St, and drops back underground 60% of the way to
    // Court Sq. Always at Critical (Stops 11-13 are band 0-9). Interior light never changes.
    const onG = routeManager.routeId === 'G';
    this.trestleExitAt = Infinity;
    this.trestleEnterAt = null;
    if (onG && seg.stop === 12 && !seg.b) {
      this.trestleExitAt = this.odo + 0.25 * this.segDist(seg);
    } else if (onG && seg.stop === 13) {
      this.trestleExitAt = -Infinity;
      this.trestleEnterAt = this.odo + 0.6 * this.segDist(seg);
    }
    cb.stA.setOpenAir(onG && seg.stop === 13); // leaving 21 St
    cb.stB.setOpenAir(onG && seg.stop === 12 && !seg.b); // arriving at 21 St

    cb.crowd.forEach((c) => (c.g.visible = !!seg.crowd));
    if (!evp.hasRecorder && (seg.stop > 6 || (seg.stop === 6 && seg.b))) {
      this.sched(6.0, () => this.giveRecorder('train'));
    }
    this.planAnomalies(seg);
    this.planPassingTrain(seg);

    // Mask checks are timed for the normal ride; a shorter Nightmare ride brings them forward too,
    // so none lands on the approach.
    const maskScale = this.nightmare ? NIGHTMARE.cruise : 1;
    seg._masks = (seg.mask || []).map((t) => ({ t: Math.max(6, t * maskScale), done: false }));
    // After the mask checks are placed: the conductor keeps clear of them.
    this.planAtmosphere(seg);
    seg._havenSaid = false;
    seg._screech = false;
    seg._mislead = false;

    audioEngine.setBedLevel(seg.thin ? 0.18 : 1.0, 1.5);
    const L = this.segLen(seg);

    if (!seg.silent) {
      this.sched(NEXT_STOP_PA_AT, () => this.setPA(`The next stop is ${routeManager.getStopName(seg.stop)}.`, NEXT_STOP_PA_S));
    }

    if (seg.chat !== undefined) {
      const c = this.tier >= 2 && seg.chat < 3 ? CHATS[3] : this.chatSwap[seg.chat] ?? CHATS[seg.chat];
      this.sched(CHAT_AT[0], () => this.chatDialogue(c[0]));
      this.sched(CHAT_AT[1], () => this.chatDialogue(c[1]));
    }

    if (seg.final) {
      this.sched(L - 9.0, () => this.setPA(fillRoute('{terminus}. This is the last stop on this train.'), 5.0));
    }

    this.notifyUI();
  }

  private chatDialogue([who, line]: [number, string]) {
    if (this.choice || this.restraint || this.intervening || this.phase !== 'ride') return;
    this.carBuilder.parents.forEach((p) => {
      if (!p.force && !p.frozen) {
        p.mode = 'other';
        p.until = this.GT + 3.2;
      }
    });
    const speaker = this.carBuilder.parents[who].label;
    const listener = this.carBuilder.parents[1 - who].label;
    this.setSub(`<b>${speaker}:</b> ${line} <em>(to ${listener})</em>`, CHAT_LINE_S);
  }

  /**
   * Now and then a train passes the other way, mid-cruise: ambience, nothing to flag. Its odds
   * don't depend on the next stop (no second door tell), it's done at least 10 s before braking
   * (never near the arrival flicker), and it skips the trestle, the restraint stretch, the
   * unscheduled 6b, the last stretch, and Screen effects Reduced.
   */
  private planPassingTrain(seg: SegmentDef) {
    this.carBuilder.passingTrain.stop();
    this.passAt = null;
    const trestle = Number.isFinite(this.trestleExitAt) || this.trestleEnterAt !== null;
    if (seg.b || seg.restraint || seg.stop === 13 || trestle || settings.effectsReduced()) return;
    const latest = TA + this.cruiseOf(seg) - 10 - PassingTrain.duration(this.topSpeed);
    if (latest > 8 && Math.random() < GameEngine.PASS_CHANCE) this.passAt = 8 + Math.random() * (latest - 8);
  }

  /**
   * Plans the third-rail gap tube flicker and occasional in-transit conductor broadcasts.
   *
   * The flicker follows the Nightmare bulb rules (doc 4.4): one tube, never the whole car, so the
   * arrival flicker tick stays unique. It is done at least TUBE_FLICKER_CLEAR s before braking
   * (like the passing train, doc 4.5), and never planned with Screen effects: Reduced.
   */
  private planAtmosphere(seg: SegmentDef) {
    this.tubeFlickerAt = null;
    this.tubeFlicker = null;
    this.conductorAt = null;
    this.conductorFree = [];
    this.squealedThisBrake = false;

    const trestle = Number.isFinite(this.trestleExitAt) || this.trestleEnterAt !== null;
    if (seg.b || seg.restraint || seg.stop === 13 || trestle) return;

    const cruise = this.cruiseOf(seg);
    // Braking starts at TA + cruise.
    const earliest = TA + 3;
    const latest = TA + cruise - GameEngine.TUBE_FLICKER_CLEAR - GameEngine.TUBE_FLICKER_S;
    if (!settings.effectsReduced() && latest > earliest && Math.random() < GameEngine.TUBE_FLICKER_CHANCE) {
      this.tubeFlickerAt = earliest + Math.random() * (latest - earliest);
    }
    // Whether the conductor speaks doesn't depend on the stretch (no chat/no-chat tell for Stops
    // 4, 6 and 9); only when does, so it never talks over a scripted line.
    if (cruise > 18 && Math.random() < GameEngine.CONDUCTOR_CHANCE) {
      this.conductorFree = this.conductorSlots(seg);
      this.conductorAt = this.pickIn(this.conductorFree);
    }
  }

  /** In-transit conductor PA: chance per stretch, how long its subtitle shows (s), and the gap kept around other lines (s). */
  public static CONDUCTOR_CHANCE = 0.45;
  public static CONDUCTOR_S = 2.6;
  public static CONDUCTOR_GAP = 0.5;

  /**
   * Where the conductor may start on a stretch: after the departure "Stand clear" PA and at least
   * INTERCOM_MIN_ROOM s before braking, but never over the "The next stop is…" PA (every
   * stretch, so it doesn't depend on seg.silent), the parents' chat or a mask check. The slot
   * between departure and the next-stop PA is always free, so every eligible stretch has room.
   */
  public conductorSlots(seg: SegmentDef): [number, number][] {
    const D = GameEngine.CONDUCTOR_S;
    const M = GameEngine.CONDUCTOR_GAP;
    const blocks: [number, number][] = [[NEXT_STOP_PA_AT, NEXT_STOP_PA_AT + NEXT_STOP_PA_S]];
    if (seg.chat !== undefined) blocks.push([CHAT_AT[0], CHAT_AT[1] + CHAT_LINE_S]);
    (seg._masks || []).forEach((m) => blocks.push([m.t, m.t + MASK_CHECK_S]));
    const latest = TA + this.cruiseOf(seg) - INTERCOM_MIN_ROOM - D;
    let free: [number, number][] = [[1.0, latest]];
    for (const [a, b] of blocks) {
      free = free.flatMap(([s, e]): [number, number][] => [
        [s, Math.min(e, a - M - D)],
        [Math.max(s, b + M), e],
      ]).filter(([s, e]) => e > s);
    }
    return free;
  }

  /** A uniformly random point in a set of ranges, or null if they're empty. */
  private pickIn(ranges: [number, number][]): number | null {
    const total = ranges.reduce((n, [s, e]) => n + (e - s), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const [s, e] of ranges) {
      if (r <= e - s) return s + r;
      r -= e - s;
    }
    return ranges[ranges.length - 1][1];
  }

  /** Something is already talking or on screen: a PA, a subtitle, a prompt, the intercom. */
  private conductorBusy(): boolean {
    return !!this.paText || !!this.subHtml || !!this.choice || !!this.restraint || this.intervening || this.GT < this.intercomUntil;
  }

  /** Play one garbled conductor line, through setPA so it's subtitled and the music ducks. */
  private playConductor() {
    const v = Math.floor(Math.random() * CONDUCTOR_LINES.length) + 1; // 1, 2, or 3
    audioEngine.conductorBroadcast(v);
    this.setPA(CONDUCTOR_LINES[v - 1], GameEngine.CONDUCTOR_S);
  }

  private lifeRolesCache: { noHabits: Set<PersonObject>; still: Set<PersonObject> } | null = null;
  /** Parents' heads are the game; the woman on your bench owns the face-turn anomaly; the silent extra stays still. */
  private lifeRoles() {
    return (this.lifeRolesCache ??= {
      noHabits: new Set([...this.carBuilder.parents, this.carBuilder.strangers[1]]),
      still: new Set([this.carBuilder.extraPerson]),
    });
  }

  /** Share of stretches with a passing train. */
  public static PASS_CHANCE = 0.35;
  /** Chance of a single-tube flicker on a stretch, its length (s), and its minimum gap before braking (s). */
  public static TUBE_FLICKER_CHANCE = 0.5;
  public static TUBE_FLICKER_S = 0.16;
  public static TUBE_FLICKER_CLEAR = 10;

  /**
   * Flicker one ceiling tube for TUBE_FLICKER_S of game time, with the third-rail spark. Skips a
   * tube showing the cold-light anomaly and tubes already out. Returns the tube's index, or -1.
   */
  public flickerOneTube(): number {
    const segs = this.carBuilder.lightSegs;
    const COLD = 0x8cc2ff;
    const ok = segs.map((l, i) => i).filter((i) => segs[i].m.visible && segs[i].mat.color.getHex() !== COLD);
    if (!ok.length) return -1;
    const i = ok[Math.floor(Math.random() * ok.length)];
    this.tubeFlicker = { i, until: this.GT + GameEngine.TUBE_FLICKER_S };
    audioEngine.thirdRailSpark();
    return i;
  }

  private planAnomalies(seg: SegmentDef) {
    this.active = [];
    this.usedTids = new Set();
    const times: number[] = [];
    const n = seg.anoms + (seg.forced ? seg.forced.length : 0);
    // Every slot is early enough to appear with time to spare before the cutoff (it waits until
    // you look away, so leave it a few seconds), instead of being dropped unseen.
    const latest = Math.max(6, this.lastChanceOf(seg) - 4);
    for (let i = 0; i < n; i++) {
      times.push(6 + Math.random() * (latest - 6));
    }
    times.sort((a, b) => a - b);

    let ti = 0;
    (seg.forced || []).forEach((f) => {
      const id =
        f === 'parent'
          ? Math.random() < 0.5 ? 'momface' : 'dadanswer'
          : f === 'crit'
          ? ['momface', 'dadanswer', 'empty'][Math.floor(Math.random() * 3)]
          : f;
      const anom = this.anomalyMgr.createAnomaly(id, times[ti++]);
      if (anom) {
        anom.tids.forEach((t) => this.usedTids.add(t));
        this.active.push(anom);
      }
    });

    const tier = tierOf(this.san);
    for (let i = 0; i < seg.anoms; i++) {
      // Never repeat an anomaly already planned for this stretch (e.g. Stop 10's forced parent
      // anomaly picked again from the three-anomaly Critical pool): one flag would count twice.
      // Re-rolling until it differed gave up after 7 tries, about 1 ride in 13,000.
      const id = this.anomalyMgr.pickPoolTier(tier, seg.stop, new Set(this.active.map((a) => a.id)));
      if (!id) continue;
      const anom = this.anomalyMgr.createAnomaly(id, times[ti++]);
      if (anom) {
        anom.tids.forEach((t) => this.usedTids.add(t));
        this.active.push(anom);
      }
    }
  }

  private scoreSegment(): StopLogRecord {
    const seg = this.seg!;
    const rec: StopLogRecord = {
      stop: seg.stop,
      b: !!seg.b,
      name: routeManager.getStopName(seg.stop),
      anoms: [],
      fps: [],
      doors: null,
    };

    let dS = 0;
    let catches = 0;
    this.active.forEach((a) => {
      if (a.at === null) {
        a.revert();
        return;
      }
      // A photo that framed it after it appeared counts the same as a held flag.
      const byFlag = this.segFlags.some((f) => a.tids.includes(f.tid) && f.gt >= a.at!);
      const byPhoto = polaroidManager.photosCatching(this.segIdx, a.id, a.desc, a.at!).length > 0;
      const hit = byFlag || byPhoto;
      if (hit) {
        catches++;
        this.acc.correct++;
        dS += SAN.clock;
      } else {
        this.acc.miss++;
        dS += SAN.miss;
      }
      rec.anoms.push({ id: a.id, desc: a.desc, hit, via: hit ? (byFlag && byPhoto ? 'both' : byFlag ? 'flag' : 'photo') : undefined });
      a.revert();
    });

    const fps = this.segFlags.filter((f) => !this.active.some((a) => a.at !== null && a.tids.includes(f.tid) && f.gt >= a.at));
    this.acc.fp += fps.length;
    rec.fps = fps.map((f) => this.carBuilder.targetLabels[f.tid] || f.tid);
    dS += SAN.falsePos * Math.min(fps.length, 2);

    if (dS) this.addSanity(dS, `Stop ${seg.stop} anomalies`);
    if (!this.segSusGain && this.sus > 0) this.addSus(SUS.clean, 'Clean stop');

    // Haptic reward: one pulse per catch on this ride, at the same moment of every arrival,
    // so it reflects only how many you caught (never which flag, never the stop type).
    if (catches > 0) this.sched(HAPTIC_DELAY_S, () => haptics.catches(catches));

    this.active = [];
    this.usedTids = new Set();
    if (!this.restraint && !this.intervening) {
      this.carBuilder.strangers.forEach((s) => (s.g.visible = true));
    }

    this.stopLog.push(rec);
    return rec;
  }

  public arrive() {
    const seg = this.seg!;
    this.phase = 'stop';
    const rec = this.scoreSegment();

    if (seg.final) {
      this.sched(0.4, () => audioEngine.chime());
      this.sched(2.3, () => {
        this.doorTarget = 1;
      });
      this.sched(3.4, () => this.say(0, fillRoute('Here we are. {terminus}.'), 3.0));
      this.sched(4.8, () => this.presentFinalExitChoice());
      return;
    }

    const tick = seg.type === 'false' ? seg.tick : null;
    rec.type = seg.type || 'real';
    rec.tick = tick;
    rec.mislead = !!seg._mislead;
    rec.bait = !!seg.bait;
    rec.paLie = !!seg.paLie;

    if (tick === 'flicker') this.flickerUntil = this.GT + 0.16;

    if (seg.paLie) {
      this.sched(0.2, () => this.setPA(seg.paLie!, 5.0));
    } else if (!seg.silent && seg.type !== 'false') {
      this.sched(0.9, () => this.setPA(`This is ${routeManager.getStopName(seg.stop)}.`, 3.0));
    }

    this.sched(0.35, () => audioEngine.chime());
    const openAt = 0.35 + (tick === 'doors' ? 1.15 : 1.95);

    if (seg.bait) {
      this.sched(openAt - 0.05, () => this.say(0, 'This is us. Come on, get up.', 3.0));
    }

    this.sched(openAt, () => {
      this.doorTarget = 1;
    });
    this.sched(openAt + 0.9, () => this.presentDoorChoice(rec));
    this.notifyUI();
  }

  private presentDoorChoice(rec: StopLogRecord) {
    const t = tierOf(this.san);
    const win = (t >= 2 ? 4.0 : 5.0) + (this.isTouch ? 0.5 : 0);

    this.presentChoice({
      items: [
        { txt: 'Stay on', val: 'stay' },
        { txt: 'Step off', val: 'off' },
      ],
      window: win,
      glitch: [0, 0.05, 0.2, 0.35][t],
      onPick: (val) => this.resolveDoors(rec, val || 'stay'),
    });
  }

  /**
   * The last choice at Court Sq: which way out. The labels never change and nothing says what's
   * open. The exit only decides which earned ending you walk into (see game/endings.ts).
   */
  private presentFinalExitChoice() {
    this.presentChoice({
      items: [
        { txt: 'Follow Mom and Dad to the escalators', val: 'escalators' },
        { txt: 'Follow the static down the side stairs', val: 'lower_level' },
        { txt: 'Push through the emergency door', val: 'surface_hatch' },
      ],
      window: 8.0,
      glitch: 0.1,
      onPick: (val) => this.resolveFinalExitChoice((val as ExitChoice) || 'escalators'),
    });
  }

  private resolveFinalExitChoice(choice: ExitChoice) {
    this.finalExitChoice = choice;
    const line: Record<ExitChoice, string> = {
      escalators: '<em>You follow your parents toward the escalators.</em>',
      lower_level: '<em>You drift toward the side stairs. The hiss in your pocket gets louder.</em>',
      surface_hatch: '<em>You lean on the emergency bar. Somewhere above, the air is moving.</em>',
    };
    this.setSub(line[choice], 3.0);
    this.sched(3.6, () => this.endGame());
  }

  private resolveDoors(rec: StopLogRecord, choice: 'stay' | 'off') {
    const seg = this.seg!;
    rec.doors = choice;

    if (rec.type === 'real') {
      rec.correct = choice === 'stay';
      if (choice === 'off') {
        this.addSus(SUS.falsePos, `Stepped off at ${routeManager.getStopName(seg.stop)}, a real stop`, this.carBuilder.parents[0]);
        this.addSanity(SAN.falsePos, 'Stepped off at a real stop');
        this.say(0, 'Hey! Where are you going? Get back in here.', 3.0);
        this.sched(3.2, () => this.departNext());
      } else {
        this.departNext();
      }
    } else if (rec.type === 'haven') {
      rec.correct = choice === 'off';
      if (choice === 'off') {
        this.executeSafeHaven();
      } else {
        this.addSus(SUS.refuseHaven, 'Refused to step off when your parents asked', this.carBuilder.parents[0]);
        this.say(0, 'You don\u2019t want to stretch your legs? \u2026Okay.', 3.0);
        this.sched(3.2, () => this.departNext());
      }
    } else {
      // False Stop
      rec.correct = choice === 'stay';
      if (choice === 'stay') {
        this.departNext();
      } else if (seg.forgiving) {
        this.addSus(SUS.maskFail, 'Stepped off at a False Stop', this.carBuilder.parents[0]);
        this.setSub('<em>Mom grabs your sleeve.</em> <b>Mom:</b> Not this one, hon. The doors opened funny.', 3.8);
        this.sched(3.8, () => this.departNext());
      } else {
        this.startTrial();
      }
    }
  }

  private departNext() {
    if (this.phase === 'end') return;
    this.setPA('Stand clear of the closing doors, please.', 3.0);
    audioEngine.chime();
    this.sched(1.4, () => {
      this.doorTarget = 0;
    });
    this.sched(2.6, () => this.startSegment(this.segIdx + 1));
  }

  private executeSafeHaven() {
    this.phase = 'haven';
    audioEngine.setBedLevel(2.2, 0.4);
    this.sched(2.0, () => audioEngine.setBedLevel(0.18, 2.4));
    this.sched(0.8, () => this.say(0, 'Feels good to stand up, right?', 2.6));
    this.sched(3.5, () => this.say(1, fillRoute('Couple more stops after this. Then {terminus}.'), 2.8));
    // Dad hands over his old recorder (the EVP recorder, Operation Skyward Phase 2).
    this.sched(6.4, () => this.giveRecorder('haven'));
    this.sched(10.4, () => {
      this.addSanity(SAN.haven, 'Safe Haven');
      this.setSub('<em>You get back on with them.</em>', 2.0);
    });
    this.sched(11.4, () => {
      this.phase = 'stop';
      this.departNext();
    });
  }

  /** Dad gives you his old microcassette recorder. */
  private giveRecorder(where: 'haven' | 'train') {
    if (evp.hasRecorder || this.phase === 'end') return;
    evp.hasRecorder = true;
    this.say(
      1,
      where === 'haven'
        ? 'Here. Your grandfather\u2019s. He used it on the night shift. Never could get it to stop picking up the radio.'
        : 'Here, hold onto this. Your grandfather\u2019s old recorder. Never could get it to stop picking up the radio.',
      4.2
    );
    this.setHint(this.isTouch ? 'Dad gave you a tape recorder. Tap Recorder to raise it.' : 'Dad gave you a tape recorder. Press R to raise it.', 5);
    this.notifyUI();
  }

  /** Play a saved tape out loud. Playing another one, or the same one again, restarts. */
  public playTape(signalId: string) {
    const sig = EVP_SIGNALS.find((x) => x.id === signalId);
    if (!sig || this.paused || this.phase === 'menu') return;
    this.stopTape();
    const dur = audioEngine.playTape(sig.voice) || 4; // keep the UI honest even with audio off
    const inRide = this.phase === 'ride' || this.phase === 'stop';
    this.tapePlaying = { signalId, inRide, charged: false, endsAt: Date.now() + dur * 1000 };
    this.tapeTimer = setTimeout(() => {
      this.tapePlaying = null;
      this.tapeTimer = null;
      this.notifyUI();
    }, dur * 1000);
    // Heard but not seen: a parent who isn't watching may turn toward the sound.
    if (inRide && !this.carBuilder.parents.some((p) => p.facing) && Math.random() < TAPE_GLANCE_CHANCE) {
      this.sched(0.8, () => {
        if (!this.tapePlaying) return;
        const free = this.carBuilder.parents.filter((p) => !p.frozen && !p.force);
        const p = free[Math.floor(Math.random() * free.length)];
        if (p) {
          p.mode = 'player';
          p.holdUntil = this.GT + 2.0;
          p.until = this.GT + 2.0;
        }
      });
    }
    this.notifyUI();
  }

  public stopTape() {
    if (this.tapeTimer) clearTimeout(this.tapeTimer);
    this.tapeTimer = null;
    if (this.tapePlaying) {
      audioEngine.stopTape();
      this.tapePlaying = null;
      this.notifyUI();
    }
  }

  /** Raise or lower the recorder. Raising lowers the camera; it can't come up during prompts. */
  public toggleRecorder(): boolean {
    if (evp.raised) {
      evp.lower();
    } else if (
      evp.hasRecorder &&
      !this.choice &&
      !this.restraint &&
      (this.phase === 'ride' || this.phase === 'stop' || this.phase === 'haven' || this.phase === 'intro')
    ) {
      polaroidManager.setViewfinder(false);
      this.flagHeld = false;
      evp.raise();
    } else if (this.phase === 'ride' || this.phase === 'stop' || this.phase === 'haven' || this.phase === 'intro') {
      // Say why nothing happened.
      if (!evp.hasRecorder) this.setHint('You don\u2019t have anything to record with.', 2.5);
      else if (this.handsBusy) this.setHint(this.handsBusy, 2);
    }
    this.notifyUI();
    return evp.raised;
  }

  /** Mask lines already asked this ride (by text) and the last one asked; reset per ride. */
  public maskUsed = new Set<string>();
  public maskLast: string | null = null;

  /**
   * No-repeat pick (doc §7.4): a line isn't asked twice in a ride until every line in the
   * pool has been used; then that pool starts over, but never with the line just asked.
   */
  public pickMaskLine(pool: MaskDialogue[]): MaskDialogue {
    let fresh = pool.filter((l) => !this.maskUsed.has(l.line));
    if (fresh.length === 0) {
      pool.forEach((l) => this.maskUsed.delete(l.line));
      fresh = pool.slice();
    }
    const notLast = fresh.filter((l) => l.line !== this.maskLast);
    const L = shuffle(notLast.length ? notLast : fresh)[0];
    this.maskUsed.add(L.line);
    this.maskLast = L.line;
    return L;
  }

  public startMaskCheck() {
    const t = tierOf(this.san);
    const set = t <= 1 ? MASK_DIALOGUES[t === 0 ? 0 : Math.random() < 0.5 ? 0 : 1] : t === 2 ? MASK_DIALOGUES[1] : MASK_DIALOGUES[2];
    const pool = set.filter((l) => !l.needsSus || this.sus >= 10);
    const L = this.pickMaskLine(pool);
    const p = this.carBuilder.parents[L.who];

    p.force = true;
    audioEngine.blip();
    this.setSub(`<b>${p.label}:</b> ${L.line}`, 6.0);

    const win = (this.harder > 0 ? 3.0 : 4.0) + (this.isTouch ? 0.5 : 0);
    const items: ChoiceItem[] = shuffle([
      { txt: L.calm, val: 'calm' },
      { txt: L.off[0], val: 'off' },
      { txt: L.off[1], val: 'off' },
    ]);

    this.presentChoice({
      items,
      window: win,
      glitch: [0, 0.1, 0.35, 0.6][t] + (this.harder > 0 ? 0.15 : 0),
      reshuffle: t >= 2,
      onPick: (val, rt) => {
        if (val === null) {
          this.addSus(SUS.timeout, `Hesitated when ${p.label} asked a question`, p);
          this.addSanity(SAN.timeout, 'Mask timeout');
          this.setSub(`<em>You don\u2019t answer fast enough.</em> <b>${p.label}:</b> Hon?`, 2.6);
          this.sched(2.6, () => this.releaseParent(p));
        } else if (val === 'calm') {
          this.setSub(`<b>You:</b> ${L.calm} <em>(${p.label} nods.)</em>`, 2.4);
          this.sched(1.2, () => this.releaseParent(p));
        } else {
          this.addSus(SUS.maskFail, `Gave an odd answer to ${p.label}`, p);
          this.addSanity(SAN.maskFail, 'Mask fail');
          this.setSub(`<em>${p.label} keeps looking at you.</em>`, 2.8);
          this.sched(3.2, () => this.releaseParent(p));
        }
      },
    });
  }

  private releaseParent(p: PersonObject) {
    p.force = false;
    p.holdUntil = this.GT + 0.5;
    p.until = this.GT + 0.5;
  }

  private triggerConcernedIntervention() {
    this.intervening = true;
    this.interventions++;
    this.carBuilder.parents.forEach((p) => {
      if (!p.frozen) p.force = true;
    });
    this.flagHeld = false;

    this.say(1, 'Hey. Look at me. Both of us, right now.', 2.6);
    this.sched(2.7, () => this.say(0, 'Talk to us. What is going on with you?', 3.0));
    this.sched(5.9, () => this.setSub('<b>You:</b> Nothing. I\u2019m okay. I promise.', 2.4));
    this.sched(8.4, () => {
      this.carBuilder.parents.forEach((p) => this.releaseParent(p));
      this.intervening = false;
      this.addSanity(SAN.intervention, 'Concerned Intervention');
      this.sus = 40;
      this.susLog.push({ t: this.GT, n: 0, reason: 'Concerned Intervention (suspicion reset to 40)', stop: this.seg!.stop });
    });
  }

  public startRestraintMoment() {
    evp.lower();
    polaroidManager.setViewfinder(false);
    this.restraint = {
      t: 0,
      started: false,
      wait: 0,
      dur: 15,
      failed: false,
      beats: 0,
      grace: 0,
    };
    this.setHint(
      this.isTouch ? 'Hold the button. Don\u2019t let go. Don\u2019t react.' : 'Hold Space. Don\u2019t let go. Don\u2019t react.',
      6.0
    );
    this.notifyUI();
  }

  private updateRestraint(dt: number) {
    const R = this.restraint;
    if (!R) return;

    if (R.grace > 0) {
      R.grace -= dt;
      if (!this.flagHeld) return;
    }

    if (!R.started) {
      R.wait += dt;
      if (this.flagHeld) {
        R.started = true;
      } else if (R.wait > 5.0) {
        this.endRestraint(false, 'You couldn\u2019t keep it together');
      }
      return;
    }

    if (!this.flagHeld && R.t < R.dur) {
      this.endRestraint(false, 'You let go');
      return;
    }

    R.t += dt;
    this.dim = Math.max(0.4, Math.min(1, 1 - R.t / 6));

    const beat = (at: number, fn: () => void) => {
      if (R.t >= at && R.beats < at) {
        R.beats = at;
        fn();
      }
    };

    beat(1.5, () => {
      const mom = this.carBuilder.parents[0];
      mom.frozen = true;
      mom.eyes.forEach((e) => e.scale.set(2.2, 2.2, 1.8));
      (mom.skMat as THREE.MeshLambertMaterial).color.set(0xdfd9ce);
      if (mom.phone) mom.phone.visible = false;
    });
    beat(4.0, () => this.setSub('<b>Dad:</b> No. We\u2019re not getting off. You know that.', 3.2));
    beat(7.0, () => {
      this.carBuilder.strangers.forEach((s) => (s.g.visible = false));
      this.carBuilder.crowd.forEach((c) => (c.g.visible = false));
      audioEngine.whisper(3.0);
    });
    beat(10.5, () => this.setSub('<b>Mom</b> <em>(her mouth doesn\u2019t move)</em>: You can stop pretending.', 3.4));

    if (R.t >= R.dur) {
      this.endRestraint(true, 'Held');
    }
  }

  /**
   * The ride's music (audio/rideMusic.ts): tell it where the ride is. It goes wrong by stop, steps
   * back for the doors, announcements and the recorder, and has two planned silences: Greenpoint
   * Av from the chapter card until the restraint is over (then the tune comes back minor), and
   * the last stretch, which goes quiet well before Court Sq.
   */
  private updateMusic(dt: number) {
    const seg = this.seg;
    const L = seg ? this.segLen(seg) : 0;
    audioEngine.updateRideMusic(dt, {
      stop: seg ? seg.stop : 1,
      phase: this.phase,
      approach: this.phase === 'ride' && !!seg && this.ts > L - 7,
      announcing: !!this.paText && this.GT < this.paUntil,
      listening: evp.raised || !!this.tapePlaying,
      hush: !!seg && ((seg.restraint && !this.restraintDone) || (!!seg.final && this.ts > 0.35 * L)),
      minor: this.restraintDone && !!seg && seg.stop >= 11,
    });
  }

  private endRestraint(ok: boolean, why: string) {
    this.restraint = null;
    // The restraint says "don't let go", so the hold is usually still down when it ends. Let it go
    // here, or it carries on as a flag on whatever you're looking at (a false flag you never made).
    // A key still held only sends repeats, which don't flag; a fresh press of F does.
    this.flagHeld = false;
    this.flagProg = 0;
    this.restraintDone = true;
    this.restraintOK = ok;
    this.restraintWhy = ok ? 'Held' : why;
    this.dim = 1;

    const liveId = (id: string) => this.active.some((a) => a.id === id && a.at !== null);
    if (!liveId('momface')) {
      const mom = this.carBuilder.parents[0];
      mom.frozen = false;
      mom.eyes.forEach((e) => e.scale.set(1, 1, 1));
      (mom.skMat as THREE.MeshLambertMaterial).color.set(mom.skin);
    }
    if (!liveId('empty')) {
      this.carBuilder.strangers.forEach((s) => (s.g.visible = true));
    }

    if (ok) {
      this.addSanity(SAN.restraintOK, 'Restraint held');
      this.setSub('<em>The lights come back. Everyone is where they were.</em>', 3.0);
    } else {
      this.addSus(15, 'Lost your composure during the restraint moment', this.carBuilder.parents[1]);
      this.addSanity(SAN.restraintFail, 'Restraint failed');
      this.setSub('<em>You flinch. Dad sees it.</em>', 3.0);
    }
    this.notifyUI();
  }

  // False Stop Trial
  public startTrial() {
    evp.lower();
    this.phase = 'trial';
    this.trial = {
      depth: 0,
      need: 2,
      mode: 'paths',
      cyc: 0,
      correct: 0,
      events: [],
      picks: [],
      stopName: routeManager.getStopName(this.seg!.stop),
      stepT: 2,
    };

    this.carBuilder.worldGroup.visible = false;
    this.trialBuilder.group.visible = true;
    this.ty = 0;
    this.tp = 0;
    this.yaw = 0;
    this.pitch = 0;

    audioEngine.setBedLevel(0.05, 0.5);
    this.newTrialRound();
    this.setHint('Find the way back. The signs lie. Watch the lights when the chime plays.', 6.0);
    this.notifyUI();
  }

  private newTrialRound() {
    const tr = this.trial!;
    const d = tr.depth;
    tr.correct = tr.mode === 'paths' ? Math.floor(Math.random() * 3) : Math.random() < 0.5 ? 0 : 2;

    const rt = routeText();
    const toward = fillRoute('To {terminusSign} trains', rt);
    const signsPool = [
      [toward, 'Exit', fillRoute('To {opposite} trains', rt)],
      [toward, toward, toward],
      // The signs start to fail: the first word's letters swap, and one points at you.
      [toward.replace(/^To (\S)(\S)/, 'To $2$1').replace(/trains$/, 'trians'), 'Ext', 'To You'],
      [rt.origin, rt.origin, rt.origin],
    ];
    const signs = shuffle(signsPool[Math.min(d, 3)]);

    this.trialBuilder.open.forEach((o, i) => {
      const isDoor = tr.mode === 'board' && i !== 1;
      this.trialBuilder.setSignText(o, tr.mode === 'board' ? (i === 1 ? '—' : fillRoute('{terminusSign}-bound {line}', rt)) : signs[i]);
      o.interior.visible = isDoor;
      o.leaves.forEach((l) => {
        l.lg.visible = isDoor;
        l.lg.position.x = l.x0;
      });
      o.openAmt = 0;
      o.target = 0;
      o.flickUntil = -1;
    });

    this.trialBuilder.tileMat.color.setHSL(0.12 - d * 0.03, 0.25 + d * 0.12, 0.9 - d * 0.12);
    tr.cyc = 3.2;

    const pathLabels = [
      ['Left stairs', 'Turnstiles', 'Right stairs'],
      ['Left stairs', 'Middle stairs', 'Right stairs'],
      ['Down', 'Down', 'Down'],
    ];
    const labels = tr.mode === 'paths' ? pathLabels[Math.min(d, 2)] : ['Board the left train', 'Board the right train'];
    const items: ChoiceItem[] =
      tr.mode === 'paths'
        ? labels.map((t, i) => ({ txt: t, val: i }))
        : [{ txt: labels[0], val: 0 }, { txt: labels[1], val: 2 }];

    const win = d === 0 ? Infinity : Math.max(7, 14 - d * 2);
    this.presentChoice({
      items,
      window: win,
      glitch: d * 0.18,
      onPick: (val) => this.onTrialPick(val),
    });
  }

  private trialCycle() {
    const tr = this.trial!;
    audioEngine.chime();
    tr.events = [];
    if (tr.mode === 'paths') {
      tr.events.push({ at: 0, i: tr.correct, kind: 'flick' });
      [0, 1, 2]
        .filter((i) => i !== tr.correct)
        .forEach((i) => tr.events.push({ at: 0.8 + Math.random() * 2.2, i, kind: 'flick' }));
      if (tr.depth >= 1) {
        const decoy = [0, 1, 2].filter((i) => i !== tr.correct)[Math.floor(Math.random() * 2)];
        tr.events.push({ at: 0.22 + Math.random() * 0.13, i: decoy, kind: 'flick' });
      }
    } else {
      const fake = tr.correct === 0 ? 2 : 0;
      tr.events.push(
        { at: 1.95, i: tr.correct, kind: 'open' },
        { at: 1.15, i: fake, kind: 'open' },
        { at: 3.2, i: 0, kind: 'close' },
        { at: 3.2, i: 2, kind: 'close' }
      );
    }
  }

  private updateTrial(dt: number) {
    const tr = this.trial;
    if (!tr || !this.trialBuilder.group.visible) return;

    tr.cyc += dt;
    if (tr.cyc >= 3.6) {
      tr.cyc -= 3.6;
      this.trialCycle();
    }

    tr.events.forEach((e) => {
      if (!e.done && tr.cyc >= e.at) {
        e.done = true;
        const o = this.trialBuilder.open[e.i];
        if (e.kind === 'flick') o.flickUntil = this.GT + 0.14;
        else if (e.kind === 'open') o.target = 1;
        else o.target = 0;
      }
    });

    this.trialBuilder.open.forEach((o) => {
      const off = this.GT < o.flickUntil;
      o.lmat.color.set(off ? 0x111111 : 0xfff2d6);
      o.pl.intensity = off ? 0 : 0.9;
      o.openAmt += (o.target - o.openAmt) * (1 - Math.exp(-9 * dt));
      o.leaves.forEach((l) => (l.lg.position.x = l.x0 + l.s * 0.75 * o.openAmt));
    });

    tr.stepT -= dt;
    if (tr.depth >= 1 && tr.stepT <= 0) {
      tr.stepT = (1.2 + Math.random() * 2.3) / tr.depth;
      audioEngine.step();
    }

    this.camera.position.copy(this.trialEyePos);
    if (this.camera.aspect < 1) this.camera.position.z = 3.3;
    this.camera.rotation.z = Math.sin(this.GT * 0.7) * 0.012 * tr.depth;
  }

  private onTrialPick(val: any) {
    const tr = this.trial!;
    const ok = val === tr.correct;
    tr.picks.push({ mode: tr.mode, ok });

    this.sched(0.7, () => {
      if (tr.mode === 'paths') {
        if (ok) {
          tr.need--;
          this.setSub(
            tr.need > 0 ? '<em>The stairs go down to another platform.</em>' : '<em>You come out at the platform edge. Two trains are coming.</em>',
            3.0
          );
          if (tr.need <= 0) tr.mode = 'board';
        } else {
          tr.depth++;
          tr.need = Math.min(tr.need + 1, 3);
          this.setSub('<em>The stairs bring you back up onto the same platform. It\u2019s quieter now.</em>', 3.2);
        }
      } else {
        if (ok) {
          this.exitTrial(true);
          return;
        }
        tr.depth++;
        tr.mode = 'paths';
        tr.need = 1;
        this.setSub('<em>The doors close on nothing. You\u2019re back on the stairs.</em>', 3.2);
      }

      if (tr.depth >= 4) {
        this.exitTrial(false);
        return;
      }
      this.newTrialRound();
    });
  }

  private exitTrial(clean: boolean) {
    const tr = this.trial!;
    this.trials.push({ stop: this.seg!.stop, depth: tr.depth, clean });

    this.sched(0.2, () => {
      this.trialBuilder.group.visible = false;
      this.carBuilder.worldGroup.visible = true;
      this.ty = 0;
      this.tp = -0.05;
      this.yaw = 0;
      this.pitch = -0.05;
      this.prevDir = null;
      this.angVel = 0;
      this.snapArc = 0;
      this.snapPeak = 0;
      this.snapCd = 1.5;

      this.addSus(SUS.falsePos, `Walked off the train at ${routeManager.getStopName(this.seg!.stop)}`, this.carBuilder.parents[0]);
      this.phase = 'stop';
      this.trial = null;
      this.addSanity(SAN.trial, 'Returned from a False Stop Trial');
      this.harder = 3;

      audioEngine.setBedLevel(1.0, 1.0);
      this.setSub(
        clean
          ? '<b>Mom:</b> Where did you go?! You can\u2019t just walk off like that!'
          : '<em>You don\u2019t remember getting back on.</em> <b>Mom:</b> Oh my god. Where were you?',
        3.4
      );
      this.sched(3.6, () => this.say(1, 'Sit. Stay where we can see you.', 2.6));
      this.sched(6.4, () => this.departNext());
    });
  }

  public presentChoice(options: {
    items: ChoiceItem[];
    window: number;
    glitch?: number;
    reshuffle?: boolean;
    onPick: (val: any, rt: number) => void;
  }) {
    evp.lower(); // you lower the recorder (or the camera) to answer
    polaroidManager.setViewfinder(false);
    this.choice = {
      items: options.items,
      window: options.window,
      left: options.window,
      glitch: options.glitch || 0,
      reshuffle: options.reshuffle || false,
      reshuffled: false,
      gT: 0,
      keyMap: options.items.map((_, i) => i),
      onPick: options.onPick,
    };
    this.notifyUI();
  }

  public pickChoiceIndex(i: number) {
    const C = this.choice;
    if (!C) return;
    this.choice = null;
    const rt = C.window - C.left;
    C.onPick(i < 0 ? null : C.items[i].val, rt);
    this.notifyUI();
  }

  public endGame() {
    this.phase = 'end';
    this.carBuilder.passingTrain.stop();
    this.passAt = null;
    this.tubeFlickerAt = null;
    this.tubeFlicker = null;
    this.conductorAt = null;
    this.conductorFree = [];
    this.squealedThisBrake = false;
    evp.lower();
    // The report replaces the ride: put the camera down and close the evidence log, so neither
    // is left over (or covering) the report. Its prints and tapes are on the report itself.
    polaroidManager.setViewfinder(false);
    polaroidManager.setAlbum(false);
    this.stopTape();
    this.flagHeld = false;
    audioEngine.setMasterLevel(0.2, 0.8);
    audioEngine.setBedLevel(0.0001, 0.7);

    this.sampleSanity();
    this.resolvedEnding = resolveEnding(endingSummary(this));
    recordEndingToArchive(this.resolvedEnding.id);

    // A practice run isn't added to the ride history (or anything else; see practice.ts).
    const runs = this.loadRuns();
    if (!practice.on) runs.push({
      date: Date.now(),
      san: this.san,
      sanPct: this.getSanityScore(),
      peak: this.peak,
      acc: this.acc,
      trials: this.trials.length,
      endingId: this.resolvedEnding.id,
      nightmare: this.nightmare,
    });
    if (!practice.on) this.saveRuns(runs);
    this.psychLog = recordRide(this.stopLog);
    polaroidManager.develop(); // prints develop now, after scoring

    // Career achievements evaluation
    if (this.peak === 0) {
      unlockAchievement('iron_composure');
    }
    if (this.resolvedEnding.id !== 'civilian_extraction') {
      unlockAchievement('loop_breaker');
    }
    if (this.acc.correct > 0) {
      unlockAchievement('first_anomaly');
    }
    // "Documented" as the Case Files count it (caught at least once), not merely seen.
    const archive = this.psychLog?.archive ?? {};
    const documentedCount = Object.values(archive).filter((rec) => entryState(rec) === 'documented').length;
    if (documentedCount >= 6) {
      unlockAchievement('master_archivist');
    }

    if (this.onReportReady) {
      this.onReportReady(runs);
    }
    this.notifyUI();
  }

  private loadRuns(): RunHistoryRecord[] {
    try {
      return JSON.parse(localStorage.getItem('gtrain-runs') || '[]');
    } catch (e) {
      return [];
    }
  }

  private saveRuns(runs: RunHistoryRecord[]) {
    try {
      localStorage.setItem('gtrain-runs', JSON.stringify(runs.slice(-50)));
    } catch (e) {}
  }

  public update(dt: number) {
    this.GT += dt;
    this.runSched();
    this.updateMusic(dt);

    // Sanity tier drives visuals, audio, parent behaviour and the haven cue. Recompute it
    // every frame, and tell the UI when it changes so the tier color grading follows.
    if (this.phase !== 'menu' && this.phase !== 'end') {
      const tier = tierOf(this.san);
      if (tier !== this.tier) {
        const oldTier = this.tier;
        this.tier = tier;
        if (tier > oldTier) {
          audioEngine.tierTransitionWhisper(tier);
        }
        this.notifyUI();
      }
      this.updateHeart(dt);
      this.updateBreath(dt);
    }

    if (this.phase === 'trial') {
      const k = 1 - Math.exp(-22 * dt);
      this.yaw += (this.ty - this.yaw) * k;
      this.pitch += (this.tp - this.pitch) * k;
      this.camera.rotation.set(this.pitch, this.yaw, this.camera.rotation.z);
      this.updateTrial(dt);
      this.applyLighting();
    } else if (this.phase !== 'haven' && this.phase !== 'menu') {
      this.updateCar(dt);
    } else if (this.phase === 'menu') {
      this.updateMenuIdle(dt);
    }

    this.updateChoiceTimer(dt);
    if (this.tutorial && this.phase === 'intro') {
      this.updateFlag(dt);
      this.tutorial.update(dt);
    }

    // Subtitle expiry
    if (this.subUntil && this.GT > this.subUntil) {
      this.subHtml = '';
      this.subUntil = 0;
    }
    if (this.paUntil && this.GT > this.paUntil) {
      this.paText = '';
      this.paUntil = 0;
    }
    if (this.chapterRollsign && this.GT > this.chapterRollsign.until) {
      this.chapterRollsign = null;
      this.notifyUI();
    }
  }

  /**
   * Heart rate follows the sanity tier, easing over a few seconds rather than jumping, and turns
   * irregular at low sanity. At Critical each beat is also heard (the thump stays in sync with
   * the HUD trace because both come from this clock).
   */
  private updateHeart(dt: number) {
    const target = HEART_BPM[this.tier];
    this.heartBpm += (target - this.heartBpm) * (1 - Math.exp(-dt / 2.5));
    if (this.GT < this.heartNextAt) return;

    // Anchor each beat to its planned time, not the frame it lands on, so the rate doesn't
    // drift slow at low frame rates. After a long gap (new run), restart the clock.
    const beatAt = this.GT - this.heartNextAt > 1 ? this.GT : this.heartNextAt;
    this.heartBeats.push(beatAt);
    if (this.heartBeats.length > 12) this.heartBeats.shift();
    const period = (60 / this.heartBpm) * (1 + HEART_JITTER[this.tier] * (Math.random() * 2 - 1));
    this.heartNextAt = beatAt + period;
    if (this.tier >= 3) audioEngine.thump(period);
  }

  /**
   * Anxious breathing: during rides at Medium sanity and below, the view narrows slightly on each
   * inhale. Rate and depth follow the tier, and each flag you've placed this ride deepens it.
   * Everything eases, so it fades in over a few seconds and settles back out at each station.
   */
  private updateBreath(dt: number) {
    const p = this.phase === 'ride' ? BREATH_TIERS[this.tier] : null;
    const flags = Math.min(this.segFlags.length, BREATH_MAX_FLAGS);
    const depth = p ? p.depthDeg + BREATH_PER_FLAG_DEG * flags : 0;
    const bpm = p ? p.bpm : this.breathBpm;
    const tau = depth > this.breathDepth ? 3 : 1.5;
    this.breathDepth += (depth - this.breathDepth) * (1 - Math.exp(-dt / tau));
    if (!this.breathBpm) this.breathBpm = bpm || BREATH_TIERS[1]!.bpm;
    this.breathBpm += (bpm - this.breathBpm) * (1 - Math.exp(-dt / 2.5));
    // A little slow wander in the rate, so it reads as breathing rather than a metronome.
    const wander = 1 + 0.12 * Math.sin(this.GT * 0.41) + 0.06 * Math.sin(this.GT * 1.13 + 1.7);
    this.breathPhase = (this.breathPhase + (dt * this.breathBpm * wander) / 60) % 1;
  }

  /** FOV change in degrees (at the 68° base) for this frame: 0 at rest, negative on the inhale. */
  public breathFovOffset(): number {
    if (this.breathDepth < 0.005) return 0;
    // Short, quick inhale (35% of the cycle) and a longer exhale.
    const ph = this.breathPhase;
    const sm = (x: number) => x * x * (3 - 2 * x);
    const shape = ph < 0.35 ? sm(ph / 0.35) : 1 - sm((ph - 0.35) / 0.65);
    return -this.breathDepth * shape;
  }

  /**
   * Background intercom: a garbled announcement every 28–55 s of riding, pitched and paced by
   * the sanity tier. It waits for a quiet moment (no real PA, dialogue, prompt, restraint or
   * intervention) and never starts near braking, so it can't mask the arrival chime or doors.
   */
  private updateIntercom(dt: number, seg: SegmentDef) {
    this.intercomT -= dt;
    if (this.intercomT > 0) return;
    const roomBeforeBraking = this.segLen(seg) - TD - this.ts;
    const busy = !!this.paText || !!this.subHtml || !!this.choice || !!this.restraint || this.intervening;
    if (busy || roomBeforeBraking < INTERCOM_MIN_ROOM) {
      this.intercomT = INTERCOM_RETRY;
      return;
    }
    const duration = audioEngine.intercom(this.tier);
    this.intercomUntil = this.GT + duration;
    this.intercomCount++;
    this.intercomT = duration + INTERCOM_EVERY[0] + Math.random() * (INTERCOM_EVERY[1] - INTERCOM_EVERY[0]);
  }

  /**
   * Start a screen glitch. Real (anomaly) and decoy glitches draw from the same per-tier ranges,
   * so strength and length never reveal which one it was. No glitches at High or Medium; a
   * Critical anomaly appearing above Low still uses the Low ranges.
   */
  public triggerGlitch(reason: 'anomaly' | 'decoy') {
    const p = GLITCH_TIERS[this.tier] ?? (reason === 'anomaly' ? GLITCH_TIERS[2] : null);
    if (!p) return;
    // One at a time: never restart a glitch that's still playing (e.g. two anomalies in one frame).
    if (this.glitch && this.GT - this.glitch.start < this.glitch.duration) return;
    const r = (range: [number, number]) => range[0] + Math.random() * (range[1] - range[0]);
    const strength = r(p.strength);
    const duration = r(p.duration);
    this.glitch = { start: this.GT, duration, strength, seed: Math.random() * 1000 };
    this.glitchLog.push({ gt: this.GT, reason, strength, duration });
    if (this.glitchLog.length > 50) this.glitchLog.shift();
  }

  /** Current glitch strength 0..1: fast attack, eased decay. 0 when idle or paused. */
  public glitchAmount(): number {
    const g = this.glitch;
    if (!g || this.paused) return 0;
    const p = (this.GT - g.start) / g.duration;
    if (p < 0 || p >= 1) return 0;
    const env = p < 0.08 ? p / 0.08 : Math.pow(1 - (p - 0.08) / 0.92, 1.5);
    return g.strength * env;
  }

  /**
   * Screen-shake triggered by the subway train's physical motion, with intensity
   * linked to the ride phase (acceleration jolt, cruising rail clatter, braking shudder)
   * and scaled by the current sanity tier.
   */
  public getScreenShake(): { x: number; y: number; rot: number; intensity: number } {
    return this.screenShake;
  }

  /** Decoy glitches at Low and Critical, at random during rides. */
  private updateGlitchDecoys(dt: number) {
    if (this.glitch && this.GT - this.glitch.start >= this.glitch.duration) this.glitch = null;
    const p = GLITCH_TIERS[this.tier];
    if (!p) return;
    this.glitchDecoyT -= dt;
    if (this.glitchDecoyT > 0) return;
    if (!this.glitch) this.triggerGlitch('decoy');
    this.glitchDecoyT = p.decoyEvery[0] + Math.random() * (p.decoyEvery[1] - p.decoyEvery[0]);
  }

  private updateChoiceTimer(dt: number) {
    const C = this.choice;
    if (!C) return;
    C.left -= dt;
    if (isFinite(C.window) && C.left <= 0) {
      this.pickChoiceIndex(-1);
      return;
    }

    if (C.glitch > 0) {
      C.gT -= dt;
      if (C.gT <= 0) {
        C.gT = 0.18;
        if (Math.random() < C.glitch * 0.4) {
          // Trigger dynamic glitch re-render in UI
          this.notifyUI();
        }
      }
    }
  }

  private updateMenuIdle(dt: number) {
    this.idleTime += dt;
    this.camera.position.copy(this.eyePos);
    this.camera.rotation.set(-0.05 + Math.sin(this.idleTime * 0.13) * 0.03, Math.sin(this.idleTime * 0.09) * 0.35, 0);
    this.updateParents(dt, false);
    this.applyLighting();
    this.placeWorld(0, 0);
  }

  private updateCar(dt: number) {
    const seg = this.seg;
    let speed = 0;
    let pos = this.odo;

    if (this.phase === 'ride' && seg) {
      this.ts += dt;
      speed = this.segVel(seg, this.ts);
      pos = this.odo + this.segPos(seg, this.ts);
    } else if (seg && this.phase !== 'intro') {
      pos = this.odo + this.segDist(seg);
    }

    this.speed = speed;
    const sf = speed / this.topSpeed;

    const train = this.carBuilder.passingTrain;
    if (this.phase === 'ride' && this.passAt !== null && this.ts >= this.passAt) {
      this.passAt = null;
      if (!settings.effectsReduced()) {
        train.start();
        audioEngine.passingTrain(PassingTrain.duration(speed));
      }
    }
    train.update(dt, speed, !this.trestleShow);

    // Third-rail gap: one tube flickers (planAtmosphere). Reduced can be switched on mid-ride.
    if (this.phase === 'ride' && this.tubeFlickerAt !== null && this.ts >= this.tubeFlickerAt) {
      this.tubeFlickerAt = null;
      if (!settings.effectsReduced()) this.flickerOneTube();
    }
    if (this.tubeFlicker && this.GT >= this.tubeFlicker.until) this.tubeFlicker = null;

    // In-transit garbled conductor PA (planAtmosphere). If something is talking, wait for a
    // quiet moment that's still in a free slot; give up if none is left.
    if (this.phase === 'ride' && this.conductorAt !== null && this.ts >= this.conductorAt) {
      if (!this.conductorBusy()) {
        this.conductorAt = null;
        this.playConductor();
      } else {
        const next = this.ts + 0.5;
        const slot = this.conductorFree.find(([, e]) => e >= next);
        this.conductorAt = slot ? Math.max(next, slot[0]) : null;
      }
    }

    // Train motion & screen shake calculation linked to ride phase and sanity tier
    const isRide = this.phase === 'ride' && !!seg;
    const L = seg ? this.segLen(seg) : 37;

    let phaseShakeMult = 0;
    let accelJolt = 0;
    let brakeJolt = 0;

    if (isRide && sf > 0.001) {
      if (this.ts < TA) {
        // 1. Acceleration phase: high torque inertial pull back and motor hum build-up
        const u = Math.min(1, Math.max(0, this.ts / TA));
        accelJolt = Math.sin(u * Math.PI);
        phaseShakeMult = 0.85 + 0.35 * accelJolt;
      } else if (this.ts < L - TD) {
        // 2. Cruising phase: sustained 45 mph through liminal tunnels, rail rumble
        phaseShakeMult = 1.0;
      } else {
        // 3. Deceleration / braking phase: wheel friction chatter, pitch dip, grinding steel
        const u = Math.min(1, Math.max(0, (this.ts - (L - TD)) / TD));
        brakeJolt = Math.sin(u * Math.PI);
        phaseShakeMult = 1.15 + 0.85 * brakeJolt;

        if (!this.squealedThisBrake && this.ts >= L - TD + 0.5 && speed > 2.5) {
          this.squealedThisBrake = true;
          audioEngine.wheelFlangeSqueal(2.2, 0.08);
        }
      }

      // Track joint clatter ("clack-clack" over rail seams every ~1.2s at speed)
      this.railClackT -= dt * (speed / 13);
      if (this.railClackT <= 0) {
        this.railImpulse = 1.0;
        this.railClackT = 1.0 + Math.random() * 0.6;
      }
    } else {
      phaseShakeMult = 0;
      this.railImpulse = 0;
    }

    this.railImpulse *= Math.exp(-9 * dt);

    // Sanity tier scaling:
    // Tier 0 (High): Grounded, realistic MTA subway ride
    // Tier 1 (Medium): Sharper track vibration and tension
    // Tier 2 (Low): Unsettling rail twitches, erratic chassis jitter
    // Tier 3 (Critical): Violent liminal shuddering, nightmare rail resonance
    let tierMult = 1.0;
    if (this.tier === 1) tierMult = 1.45;
    else if (this.tier === 2) tierMult = 2.15;
    else if (this.tier === 3) tierMult = 3.25;

    // Reduced screen effects: no shake at all, only the gentle bob the ride always had.
    const reduced = settings.effectsReduced();
    const motionScale = reduced ? 0 : 1.0;
    const gentleBobY = reduced ? (Math.sin(this.GT * 9.3) * 0.0035 + Math.sin(this.GT * 1.7) * 0.004) * sf : 0;
    const gentleRoll = reduced ? Math.sin(this.GT * 0.9) * 0.006 * sf : 0;

    // Vibration component synthesis
    const railBounce = Math.sin(this.GT * 14.5) * 0.0032 * sf;
    const trackClatter = Math.sin(this.GT * 27.8) * 0.002 * sf;
    const brakeChatter = Math.sin(this.GT * 34.0) * 0.0035 * brakeJolt * sf;
    const jointBump = this.railImpulse * 0.006 * sf;
    const bogieSway = Math.sin(this.GT * 1.7) * 0.006 * sf;
    const lateralBuzz = Math.sin(this.GT * 21.3) * 0.0022 * sf;

    // High tier liminal distortions
    const sanityTremorX = this.tier >= 2 ? Math.sin(this.GT * 39.5) * 0.0028 * (this.tier - 1) * sf : 0;
    const sanityTremorY = this.tier >= 2 ? Math.sin(this.GT * 47.1) * 0.0032 * (this.tier - 1) * sf : 0;
    const sanityTremorRot = this.tier >= 2 ? Math.sin(this.GT * 18.4) * 0.004 * (this.tier - 1) * sf : 0;

    const totalShakeY = (railBounce + trackClatter + brakeChatter + jointBump + sanityTremorY) * phaseShakeMult * tierMult * motionScale;
    const totalShakeX = (bogieSway + lateralBuzz + sanityTremorX) * phaseShakeMult * tierMult * motionScale;
    const totalShakeZ = (accelJolt * -0.003 + brakeJolt * 0.005) * sf * motionScale;

    const pitchJerk = (accelJolt * 0.004 - brakeJolt * 0.008 + jointBump * 0.5) * sf * motionScale;
    const rollSway = (Math.sin(this.GT * 0.9) * 0.007 * sf + sanityTremorRot) * phaseShakeMult * tierMult * motionScale;
    const yawTwitch = (this.tier === 3 ? Math.sin(this.GT * 31.0) * 0.003 * sf : 0) * motionScale;

    // Update 2D screen shake (in pixels and degrees for viewport transform)
    if (isRide && sf > 0.01) {
      const pxX = (totalShakeX * 420 + Math.sin(this.GT * 23.4) * 1.5 * sf * tierMult) * motionScale;
      const pxY = (totalShakeY * 540 + Math.sin(this.GT * 18.2) * 2.0 * sf * tierMult) * motionScale;
      const degRot = (rollSway * 18 + (this.tier >= 2 ? Math.sin(this.GT * 12.0) * 0.4 * sf : 0)) * motionScale;
      const rawIntensity = Math.min(1, Math.max(0, sf * (0.35 + 0.18 * this.tier + 0.25 * brakeJolt))) * motionScale;

      const sk = 1 - Math.exp(-24 * dt);
      this.screenShake.x += (pxX - this.screenShake.x) * sk;
      this.screenShake.y += (pxY - this.screenShake.y) * sk;
      this.screenShake.rot += (degRot - this.screenShake.rot) * sk;
      this.screenShake.intensity += (rawIntensity - this.screenShake.intensity) * sk;
    } else {
      const sk = 1 - Math.exp(-12 * dt);
      this.screenShake.x += (0 - this.screenShake.x) * sk;
      this.screenShake.y += (0 - this.screenShake.y) * sk;
      this.screenShake.rot += (0 - this.screenShake.rot) * sk;
      this.screenShake.intensity += (0 - this.screenShake.intensity) * sk;
    }

    // Camera look interpolation
    const k = 1 - Math.exp(-22 * dt);
    this.yaw += (this.ty - this.yaw) * k;
    this.pitch += (this.tp - this.pitch) * k;

    // Player movement kinematics (WASD / Arrows) across connected cars & gangways
    if (this.phase === 'ride' || this.phase === 'stop' || this.phase === 'haven' || this.phase === 'intro') {
      if (this.moveFwd !== 0 || this.moveRight !== 0) {
        const cosY = Math.cos(this.yaw);
        const sinY = Math.sin(this.yaw);
        const fwdX = -sinY;
        const fwdZ = -cosY;
        const rgtX = cosY;
        const rgtZ = -sinY;

        const moveSpeed = 2.4;
        let dx = (fwdX * this.moveFwd + rgtX * this.moveRight) * moveSpeed * dt;
        let dz = (fwdZ * this.moveFwd + rgtZ * this.moveRight) * moveSpeed * dt;

        let nextX = this.eyePos.x + dx;
        let nextZ = this.eyePos.z + dz;

        // Front gangway door collision (x = -9.0)
        const frontDoorClosed = this.carBuilder.gangwayDoors.frontAngle < 0.45;
        if (frontDoorClosed) {
          if (this.eyePos.x >= -8.9 && nextX < -8.9) nextX = -8.9;
          if (this.eyePos.x <= -9.1 && nextX > -9.1) nextX = -9.1;
        }

        // Rear gangway door collision (x = +9.0)
        const rearDoorClosed = Math.abs(this.carBuilder.gangwayDoors.rearAngle) < 0.45;
        if (rearDoorClosed) {
          if (this.eyePos.x <= 8.9 && nextX > 8.9) nextX = 8.9;
          if (this.eyePos.x >= 9.1 && nextX < 9.1) nextX = 9.1;
        }

        // Aisle width bounds
        const inGangway1 = nextX <= -8.9 && nextX >= -10.6;
        const inGangway2 = nextX >= 8.9 && nextX <= 10.6;
        const maxZ = (inGangway1 || inGangway2) ? 0.38 : 0.72;
        nextZ = Math.max(-maxZ, Math.min(maxZ, nextZ));

        // Train consist length limits
        nextX = Math.max(-27.0, Math.min(27.0, nextX));

        this.eyePos.x = nextX;
        this.eyePos.z = nextZ;

        // Footsteps
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          audioEngine.step();
          this.stepTimer = 0.44;
        }
      }

      // Check gangway door proximity
      if (this.eyePos.x < -7.6 && this.eyePos.x > -10.4) {
        this.nearGangwayDoor = 'front';
      } else if (this.eyePos.x > 7.6 && this.eyePos.x < 10.4) {
        this.nearGangwayDoor = 'rear';
      } else {
        this.nearGangwayDoor = null;
      }

      // Current car index
      if (this.eyePos.x < -10.2) {
        this.currentCarIndex = 0; // Car A
      } else if (this.eyePos.x > 10.2) {
        this.currentCarIndex = 2; // Car C
      } else {
        this.currentCarIndex = 1; // Car B (Mid)
      }

      this.isCrossingGangway = (this.eyePos.x >= -10.6 && this.eyePos.x <= -8.8) || (this.eyePos.x >= 8.8 && this.eyePos.x <= 10.6);
      audioEngine.gangwayWind(this.isCrossingGangway ? 1.0 : (this.nearGangwayDoor ? 0.4 : 0.0));
    }

    // Train physical bounce, motion shake, and breathing
    const breathe = this.tier >= 2 ? Math.sin(this.GT * 0.5) * 0.01 * (this.tier - 1) : 0;
    const windSway =
      this.trestleOutside > 0 && !settings.effectsReduced()
        ? Math.sin(this.GT * 1.8) * 0.016 * this.trestleOutside + Math.cos(this.GT * 2.7) * 0.012 * this.trestleOutside
        : 0;
    this.camera.position.set(
      this.eyePos.x + totalShakeX + windSway * 0.15,
      this.eyePos.y + totalShakeY + gentleBobY,
      this.eyePos.z + totalShakeZ
    );
    this.camera.rotation.set(
      this.pitch + pitchJerk,
      this.yaw + yawTwitch,
      rollSway + gentleRoll + breathe + windSway
    );
    this.camera.updateMatrixWorld();

    this.camera.getWorldDirection(this.dirVec);

    // Head-snap detection
    if (this.prevDir && dt > 0) {
      const da = this.dirVec.angleTo(this.prevDir);
      const a = da / dt;
      this.angVel = this.angVel * 0.55 + a * 0.45;
      if (this.angVel > this.snapThresh * 0.4) {
        this.snapArc += da;
        this.snapPeak = Math.max(this.snapPeak, this.angVel);
      } else {
        this.snapArc = 0;
        this.snapPeak = 0;
      }
    }
    this.prevDir = (this.prevDir || new THREE.Vector3()).copy(this.dirVec);

    // Center gaze raycasting
    this.raycaster.setFromCamera(this.centerVec, this.camera);
    const activeTargets = this.carBuilder.getActiveTargets();
    const hits = this.raycaster.intersectObjects(activeTargets, false);
    const hit = hits[0];
    const tid = hit && hit.distance < 14 ? (hit.object.userData.tid as string) : null;

    if (tid === this.gazeTid) {
      this.dwell += dt;
    } else {
      this.gazeTid = tid;
      this.dwell = 0;
      this.dwellReacted = false;
    }

    // Car life's head habits come off before the gaze code sets the heads, and go back on after.
    const everyone = this.carBuilder.getAllPassengers();
    carLife.stripHeads(everyone);
    this.updateParents(dt, this.phase === 'ride' || this.phase === 'stop');
    this.updateStrangers();

    this.carBuilder.updateDoors(dt);
    passengerBehavior.updatePassengers(
      this.carBuilder.getAllPassengers(),
      this.camera.position,
      this.dirVec,
      this.tier,
      this.active.some((a) => a.at !== null),
      this.GT,
      dt,
      // The parents' heads and yaw/pitch belong to updateParents and the watching check.
      this.carBuilder.parents
    );
    carLife.update(everyone, {
      dt,
      gt: this.GT,
      speed: this.speed,
      topSpeed: this.topSpeed,
      reduced: settings.effectsReduced(),
      ...this.lifeRoles(),
    });

    const watcher = this.carBuilder.parents.find((p) => p.facing);

    // Visible reactions check
    this.snapCd -= dt;
    if (this.phase === 'ride' || this.phase === 'stop') {
      if (this.snapPeak > this.snapThresh && this.snapArc >= this.snapArcMin && watcher && this.snapCd <= 0) {
        this.addSus(SUS.visible, `Snapped your head around while ${watcher.label} was watching`, watcher);
        this.snapCd = 2.5;
      }
      const real = this.active.find((a) => a.at !== null && a.tids.includes(this.gazeTid || ''));
      if (real && this.dwell > CFG.dwellReact && watcher && !this.dwellReacted) {
        this.addSus(SUS.visible, `Stared at something wrong while ${watcher.label} was watching`, watcher);
        this.dwellReacted = true;
      }
    }

    // EVP recorder: broadcasts only come through while riding. Holding it up where a parent can
    // see is a visible reaction (charged once per raise).
    if (evp.raised && watcher && !evp.watchedCharged && (this.phase === 'ride' || this.phase === 'stop')) {
      this.addSus(SUS.visible, `Held up a tape recorder while ${watcher.label} was watching`, watcher);
      evp.watchedCharged = true;
    }
    // A tape playing out loud during the ride is a visible reaction if a parent is watching.
    if (this.tapePlaying?.inRide && !this.tapePlaying.charged && watcher && (this.phase === 'ride' || this.phase === 'stop')) {
      this.addSus(SUS.visible, `Played a tape out loud while ${watcher.label} was watching`, watcher);
      this.tapePlaying.charged = true;
    }
    const tape = evp.update(dt, this.phase === 'ride' && seg ? seg.stop : null, this.GT, seg ? `${seg.stop}${seg.b ? 'b' : ''}` : '');
    if (tape) {
      audioEngine.blip();
      this.notifyUI();
    }
    audioEngine.evpUpdate({
      raised: evp.raised,
      recording: evp.recording,
      meter: evp.meter,
      lock: evp.locked ? evp.locked.kind : null,
      voice: evp.locked?.signal?.voice ?? 1,
    });

    // Sliding doors interpolation
    this.doorOpen += (this.doorTarget - this.doorOpen) * (1 - Math.exp(-7 * dt));
    this.carBuilder.farLeaves.forEach((l) => {
      l.g.position.x = l.x0 + l.side * 0.62 * this.doorOpen;
    });

    if (this.phase === 'ride' && seg) {
      const L = this.segLen(seg);
      const ts = this.ts;
      const lastChance = this.lastChanceOf(seg);

      // Unobserved anomaly manifestation
      this.active.forEach((a) => {
        if (a.at !== null || ts < a.trigger || ts > lastChance) return;
        if (a.ready && !a.ready()) return;

        let okToSpawn = true;
        if (a.obj) {
          a.obj.getWorldPosition(this.tmpVec1);
          this.tmpVec1.sub(this.camera.position).normalize();
          const ang = this.dirVec.angleTo(this.tmpVec1);
          okToSpawn = ang > (ts > lastChance - 3 ? 0.2 : ts > a.trigger + 8 ? 0.35 : 0.7);
        }

        if (okToSpawn) {
          a.apply();
          a.at = this.GT;
          // Critical, parent-implicated anomalies tear the screen the moment they happen.
          if (a.tier >= 3) this.triggerGlitch('anomaly');
          // A spoken anomaly: the subtitle is the same line the report quotes.
          if (a.id === 'dadanswer' && a.line) {
            this.setSub(`<b>Dad:</b> ${a.line}`, 3.4);
          }
        }
      });

      // Flags
      if (!this.restraint) this.updateFlag(dt);

      // Mask check dispatch
      (seg._masks || []).forEach((m) => {
        if (!m.done && ts >= m.t) {
          if (this.choice || this.intervening || this.restraint) {
            m.t += 2.0;
            return;
          }
          m.done = true;
          this.startMaskCheck();
        }
      });

      // Safe Haven parent line
      if (seg.type === 'false' && seg.stop === this.misleadStop && !this.misleadUsed && this.tier < 3 && !seg._havenSaid) {
        this.misleadUsed = true;
        seg._mislead = true;
      }
      if ((seg.type === 'haven' || seg._mislead) && !seg._havenSaid) {
        const lead = [6.5, 4.0, 1.6, 0.4][this.tier];
        if (ts >= L - lead) {
          seg._havenSaid = true;
          this.say(
            0,
            this.tier >= 2 ? 'I think this is our\u2026 let\u2019s\u2026 stretch our legs.' : 'I think this is our transfer. Let\u2019s stretch our legs.',
            3.2
          );
        }
      }

      // Wheel curve screech into whisper at Stop 5
      if (!seg._screech && ts >= L - TD + 0.5) {
        seg._screech = true;
        audioEngine.screech(4.4, seg.whisper ? 0.14 : 0.07);
        if (seg.whisper) {
          this.sched(3.6, () => audioEngine.whisper(2.8));
        }
      }

      // Restraint scripted beat at Stop 11 into Greenpoint Av
      if (seg.restraint && !this.restraintDone && !this.restraint && ts > 8.0 && !this.choice && !this.intervening) {
        this.startRestraintMoment();
      }

      // Concerned intervention
      if (this.sus >= SUS.intervene && !this.intervening && !this.choice && !this.restraint) {
        this.triggerConcernedIntervention();
      }

      // Arrival trigger
      if (ts >= L && !this.choice && !this.intervening && !this.restraint && !(seg.restraint && !this.restraintDone)) {
        this.arrive();
      }
    } else if (!this.tutorial) {
      // Off the ride, flags reset (the practice stretch flags while parked: see update()).
      this.flagProg = 0;
    }

    if (this.restraint) this.updateRestraint(dt);

    // Audio tracking
    audioEngine.updateTrainSpeed(sf);
    this.clackD -= speed * dt;
    if (this.clackD <= 0) {
      this.clackD += 13.0;
      if (speed > 2.0) audioEngine.clack();
    }
    if (this.tier >= 2) {
      this.whisperT -= dt;
      if (this.whisperT <= 0) {
        this.whisperT = 14 + Math.random() * 12;
        audioEngine.whisper(2.4, { tier: this.tier, distant: true });
      }
    }
    if (this.phase === 'ride' && this.seg) this.updateIntercom(dt, this.seg);
    if (this.phase === 'ride') this.updateGlitchDecoys(dt);
    this.updateBulbs(dt);
    this.applyLighting();
    this.placeWorld(pos, speed, dt);
  }

  private updateFlag(dt: number) {
    // Hands busy: no flagging while the recorder is up.
    if (evp.raised) {
      this.flagProg = 0;
      this.flagTid = null;
      return;
    }
    if (this.flagHeld && !this.flagLock && this.gazeTid) {
      if (this.flagTid !== this.gazeTid) {
        this.flagTid = this.gazeTid;
        this.flagProg = 0;
      }
      this.flagProg += dt;
      if (this.flagProg >= CFG.flagHold) {
        const live = this.active.find((a) => a.at !== null && a.tids.includes(this.flagTid!));
        const alreadyFlagged = this.segFlags.some((f) => f.tid === this.flagTid && (!live || f.gt >= live.at!));
        if (!alreadyFlagged) {
          this.segFlags.push({ tid: this.flagTid, gt: this.GT });
          // Same sound for every flag, so it never tells the player whether they were right.
          audioEngine.flagRegistered();
        }
        this.flagLock = true;
        this.notedT = this.GT;
        this.notifyUI();
      }
    } else if (!this.flagHeld) {
      this.flagProg = 0;
      this.flagLock = false;
      this.flagTid = null;
    } else if (!this.gazeTid) {
      this.flagProg = 0;
    }
  }

  private updateParents(dt: number, active: boolean) {
    this.carBuilder.parents.forEach((p) => {
      if (p.frozen) {
        p.facing = false;
        return;
      }
      const other = this.carBuilder.parents[1 - (p.i || 0)];
      if (p.force) {
        p.mode = 'player';
      } else if (this.GT >= (p.until || 0)) {
        if (p.mode === 'player') {
          if (this.GT >= (p.holdUntil || 0)) {
            p.mode = Math.random() < 0.6 ? 'phone' : 'other';
            p.until = this.GT + (4 + Math.random() * 5);
          }
        } else if (active && other.mode !== 'player' && Math.random() < 0.6 + 0.1 * this.tier + (this.nightmare ? NIGHTMARE.glance : 0)) {
          p.mode = 'player';
          p.until = this.GT + (1.6 + Math.random() * 1.6) * (this.nightmare ? NIGHTMARE.watchHold : 1);
        } else {
          const modes = ['phone', 'phone', 'other', 'down'] as const;
          p.mode = modes[Math.floor(Math.random() * modes.length)];
          p.until = this.GT + (3 + Math.random() * 4) - this.tier * 0.6;
          if (p.mode === 'down') p.downSide = Math.random() < 0.5 ? -1 : 1;
        }
      }

      let ty = 0;
      let tp = 0.55;
      if (p.mode === 'player') {
        [ty, tp] = this.aimLocal(p, this.camera.position);
      } else if (p.mode === 'other') {
        other.head.getWorldPosition(this.tmpVec2);
        [ty, tp] = this.aimLocal(p, this.tmpVec2);
      } else if (p.mode === 'down') {
        this.tmpVec2.set((p.downSide || 1) * 9, 1.3, -0.4);
        [ty, tp] = this.aimLocal(p, this.tmpVec2);
      } else {
        ty = p.i ? -0.12 : 0.12;
        tp = 0.6;
      }

      ty = Math.max(-1.35, Math.min(1.35, ty));
      const k = 1 - Math.exp(-5 * dt);
      p.yaw = (p.yaw || 0) + (ty - (p.yaw || 0)) * k;
      p.pitch = (p.pitch || 0.5) + (tp - (p.pitch || 0.5)) * k;
      p.head.rotation.set(p.pitch, p.yaw, 0);

      if (p.phone) p.phone.visible = p.mode === 'phone';
      const [py, pp] = this.aimLocal(p, this.camera.position);
      const [fy, fp] = this.nightmare ? [NIGHTMARE.facingYaw, NIGHTMARE.facingPitch] : [0.22, 0.25];
      p.facing = p.mode === 'player' && Math.abs((p.yaw || 0) - py) < fy && Math.abs((p.pitch || 0) - pp) < fp;
    });
  }

  private updateStrangers() {
    const s1 = this.carBuilder.strangers[0];
    if (s1.stare) {
      const [y, p] = this.aimLocal(s1, this.camera.position);
      s1.head.rotation.set(p, Math.max(-1.3, Math.min(1.3, y)), 0);
    }
    const s2 = this.carBuilder.strangers[1];
    if (s2.twist) {
      const [y, p] = this.aimLocal(s2, this.camera.position);
      s2.head.rotation.set(p, y * 1.25, 0.55);
    }
  }

  private aimLocal(person: PersonObject, targetPt: THREE.Vector3): [number, number] {
    person.head.getWorldPosition(this.tmpVec1);
    const dx = targetPt.x - this.tmpVec1.x;
    const dy = targetPt.y - this.tmpVec1.y;
    const dz = targetPt.z - this.tmpVec1.z;
    let yaw = Math.atan2(dx, dz) - person.g.rotation.y;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const pitch = Math.atan2(-dy, Math.hypot(dx, dz));
    return [yaw, pitch];
  }

  /**
   * Is a point `d` metres ahead of the train's middle (negative: behind) inside the tunnel, given
   * the trestle positions? Ahead is toward Car A (world x = FORWARD_X * d).
   */
  private inTunnelAt(d: number, pos: number): boolean {
    return d <= this.trestleExitAt - pos || (this.trestleEnterAt !== null && d >= this.trestleEnterAt - pos);
  }

  private placeWorld(pos: number, speed: number, dt: number = 0) {
    const cb = this.carBuilder;
    const L = cb.tunnelLength;
    const best = [1e9, 1e9];

    // The world streams past toward Car C: a point d metres ahead sits at world x = FORWARD_X * d.
    // Tunnel walls end at the mouth: slide them so the open stretch has none.
    const wallX = Number.isFinite(this.trestleExitAt)
      ? FORWARD_X * (this.trestleExitAt - pos - 200)
      : this.trestleEnterAt !== null
      ? FORWARD_X * (this.trestleEnterAt - pos + 200)
      : 0;
    cb.tunnelWalls.forEach((w) => (w.position.x = wallX));

    // How much of the 57 m consist is outside, and whether open air is in view at all.
    let out = 0;
    for (let i = 0; i <= 12; i++) if (!this.inTunnelAt(FORWARD_X * (-28.5 + i * 4.75), pos)) out++;
    this.trestleOutside = out / 13;
    this.trestleShow = !(this.inTunnelAt(-110, pos) && this.inTunnelAt(110, pos));

    cb.tunnelItems.forEach((it) => {
      const d = (((it.base - pos) % L) + L) % L - L / 2;
      const x = FORWARD_X * d;
      it.m.position.x = x;
      it.m.visible = this.inTunnelAt(d, pos);
      if (it.light && it.m.visible) {
        const si = it.s < 0 ? 0 : 1;
        if (Math.abs(x) < Math.abs(best[si])) best[si] = x;
      }
    });

    let near = false;
    [cb.stA, cb.stB].forEach((s) => {
      if (!s) return;
      const x = FORWARD_X * (s.baseX - pos);
      s.g.position.x = x;
      s.g.visible = Math.abs(x) < 60;
      if (Math.abs(x) < 30) near = true;
    });

    cb.trestle.update(this.GT, dt, pos, speed, this.trestleShow, (x) => !this.inTunnelAt(FORWARD_X * x, pos), settings.effectsReduced(), this.trestleOutside);
    if (this.trestleOutside > 0.4 && !this.trestleBadgeChecked) {
      this.trestleBadgeChecked = true; // once per ride, not every frame (it reads saved data)
      unlockAchievement('trestle_cross');
    }
    // Fog: black tunnel murk inside, dusk haze in the open (interior distances stay unfogged).
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      if (!this.fogBase) this.fogBase = { color: fog.color.clone(), near: fog.near, far: fog.far };
      const k = this.trestleOutside;
      fog.color.lerpColors(this.fogBase.color, TRESTLE_FOG, k);
      fog.near = this.fogBase.near + 5 * k;
      fog.far = this.fogBase.far + 55 * k;
    }
    audioEngine.setOpenAir(this.phase === 'trial' ? 0 : this.trestleOutside);

    cb.outLights.forEach((l, i) => {
      l.position.x = best[i];
      const f = Math.max(0, Math.min(1, 1 - Math.abs(best[i]) / 3.5));
      l.intensity = cb.worldGroup.visible && !(i === 0 && near) ? 0.9 * f * Math.max(0, Math.min(1, speed / 4.0)) : 0;
    });
  }

  private applyLighting() {
    const cb = this.carBuilder;
    const off = this.GT < this.flickerUntil;
    const k = off ? 0 : this.dim;

    cb.carLights.forEach((l) => (l.intensity = 0.55 * k * (1 - this.tier * 0.08)));
    cb.hemiLight.intensity = off ? 0.05 : 0.65 * (0.55 + 0.45 * k) * (1 - this.tier * 0.07);
    const tube = this.tubeFlicker && this.GT < this.tubeFlicker.until ? this.tubeFlicker.i : -1;
    cb.lightSegs.forEach((l, i) => (l.m.visible = !off && i !== tube && !(this.GT < (this.bulbOut[i] ?? -1))));
  }

  /**
   * Nightmare: single ceiling tubes drop out for a moment, mid-ride only. Never the whole car
   * (that's the False Stop tick), never near departure or on the approach, and not with
   * Screen effects: Reduced.
   */
  private updateBulbs(dt: number) {
    const seg = this.seg;
    const n = this.carBuilder.lightSegs.length;
    const allowed =
      this.nightmare &&
      !settings.effectsReduced() &&
      this.phase === 'ride' &&
      !!seg &&
      this.ts > NIGHTMARE.bulbQuietStart &&
      this.ts < this.segLen(seg) - TD - NIGHTMARE.bulbQuietEnd;
    if (!allowed) {
      if (this.bulbOut.length) this.bulbOut = [];
      return;
    }
    if (n && Math.random() < NIGHTMARE.bulbRate * dt) {
      const [a, b] = NIGHTMARE.bulbOut;
      this.bulbOut[Math.floor(Math.random() * n)] = this.GT + a + Math.random() * (b - a);
    }
  }

  // Kinematic helpers
  /** Top speed (m/s): faster in Nightmare. */
  public get topSpeed(): number {
    return V * (this.nightmare ? NIGHTMARE.speed : 1);
  }

  /** Seconds at top speed between stations: shorter in Nightmare. */
  public cruiseOf(s: SegmentDef): number {
    return (s.cruise || 26) * (this.nightmare ? NIGHTMARE.cruise : 1);
  }

  /**
   * The latest an anomaly may appear in a stretch: it leaves at least MIN_NOTICE seconds to
   * notice it before the train arrives (and it reverts). Short stretches (6b) get what they can
   * spare, never less than the old 10 s.
   */
  public lastChanceOf(s: SegmentDef): number {
    const L = this.segLen(s);
    return L - Math.max(TD + 4, Math.min(GameEngine.MIN_NOTICE, L - 12));
  }

  /** Seconds an anomaly is guaranteed to stay before the doors, on a stretch long enough for it. */
  public static MIN_NOTICE = 15;

  public segLen(s: SegmentDef): number {
    return TA + this.cruiseOf(s) + TD;
  }

  public segDist(s: SegmentDef): number {
    const V = this.topSpeed;
    return V * (TA / 2 + this.cruiseOf(s) + TD / 2);
  }

  private segVel(s: SegmentDef, t: number): number {
    const V = this.topSpeed;
    const C = this.cruiseOf(s);
    if (t < TA) return V * this.smooth(t / TA);
    if (t < TA + C) return V;
    if (t < TA + C + TD) return V * (1 - this.smooth((t - TA - C) / TD));
    return 0;
  }

  private segPos(s: SegmentDef, t: number): number {
    const V = this.topSpeed;
    const C = this.cruiseOf(s);
    if (t <= TA) {
      const u = t / TA;
      return V * TA * (u * u * u - (u * u * u * u) / 2);
    }
    let p = (V * TA) / 2;
    if (t <= TA + C) return p + V * (t - TA);
    p += V * C;
    const u = Math.min(1, (t - TA - C) / TD);
    return p + V * TD * (u - (u * u * u - (u * u * u * u) / 2));
  }

  private smooth(x: number): number {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  }

  public setMoveInput(fwd: number, right: number) {
    this.moveFwd = fwd;
    this.moveRight = right;
  }

  public interactGangwayDoor(): boolean {
    if (this.nearGangwayDoor === 'front' || this.gazeTid === 'gangway:front') {
      this.carBuilder.toggleFrontDoor();
      audioEngine.doorGangway();
      this.notifyUI();
      return true;
    }
    if (this.nearGangwayDoor === 'rear' || this.gazeTid === 'gangway:rear') {
      this.carBuilder.toggleRearDoor();
      audioEngine.doorGangway();
      this.notifyUI();
      return true;
    }
    return false;
  }

  /**
   * Take a Polaroid. The shot is scored with the flags at the next stop and the print develops
   * after the ride, so nothing here says whether it caught anything (no hint, no sanity change).
   * The flash is a visible reaction: if a parent is watching it raises Suspicion, and if not,
   * it can still make one of them look over.
   */
  /** Game time from which the camera can shoot again (the last print is still ejecting). */
  public nextShotAt = 0;
  public get shutterReady(): boolean {
    return this.GT >= this.nextShotAt;
  }

  /**
   * Why the camera or the recorder can't come up right now, for a hint and the buttons' labels:
   * an answer prompt or the restraint needs your attention first. Null when they can.
   */
  public get handsBusy(): string | null {
    if (this.choice) return 'Answer first.';
    if (this.restraint) return 'Not now. Keep holding.';
    return null;
  }

  /** Raise or lower the camera (C, or the HUD button). Not while an answer or the restraint needs you. */
  public toggleCamera(): boolean {
    if (!polaroidManager.isViewfinderOpen && this.handsBusy) {
      this.setHint(this.handsBusy, 2);
      return false;
    }
    evp.lower(); // hands busy: raising the camera lowers the recorder
    return polaroidManager.toggleViewfinder();
  }

  public takePolaroidPhoto() {
    if (!this.shutterReady) return null;
    if (polaroidManager.remainingFilm <= 0) {
      this.setHint('Out of film.', 2.5);
    }
    const seg = this.seg;
    const photo = polaroidManager.snapPhoto(
      this.scene,
      this.camera,
      this.renderer,
      this.active,
      this.currentCarIndex,
      routeManager.routeId,
      this.GT,
      seg && this.phase === 'ride' ? this.segIdx : -1,
      seg ? `${seg.stop}${seg.b ? 'b' : ''}` : ''
    );
    if (!photo) return null;
    this.nextShotAt = this.GT + SHUTTER_COOLDOWN;

    passengerBehavior.handleCameraFlash(this.carBuilder.getAllPassengers(), this.camera.position, this.GT);

    if (this.phase === 'ride' || this.phase === 'stop') {
      const watcher = this.carBuilder.parents.find((p) => p.facing);
      if (watcher) {
        this.addSus(SUS.visible, `Took a flash photo while ${watcher.label} was watching`, watcher);
      } else if (Math.random() < FLASH_GLANCE_CHANCE) {
        // The flash catches a parent's eye: they turn to look (no Suspicion by itself).
        const free = this.carBuilder.parents.filter((p) => !p.frozen && !p.force);
        const p = free[Math.floor(Math.random() * free.length)];
        if (p) {
          p.mode = 'player';
          p.holdUntil = this.GT + 1.8;
          p.until = this.GT + 1.8;
        }
      }
    }
    this.notifyUI();
    return photo;
  }
}
