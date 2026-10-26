/**
 * Endings (Operation Skyward, Phase 3).
 *
 * Endings are earned by how you rode: composure (peak Suspicion), sanity, accuracy, the
 * restraint, the False Stop Trials and the tapes you recorded. The exit you take at Court Sq
 * only decides which earned ending you walk into; the menu never says what's open.
 *
 * Checked in priority order; the first match wins. `resolveEnding` is a pure function of an
 * `EndingSummary`, so the rules are testable without the 3D scene.
 */
import { offRecord } from './practice';
import type { GameEngine } from './gameState';
import { evp } from './evpManager';
import { SUS } from '../constants';

export type EndingId =
  | 'secret_mask'
  | 'eternal_commute'
  | 'signal_archivist'
  | 'skyward_void'
  | 'dawn_horizon'
  | 'exposed'
  | 'collapse'
  | 'civilian_extraction';

export type ExitChoice = 'escalators' | 'lower_level' | 'surface_hatch';

import { fillRoute } from './routeText';

export interface EndingDefinition {
  id: EndingId;
  priority: number;
  title: string;
  badge: string;
  narrative: string;
  /** Shown in the archive only once this ending has been reached. */
  summary: string;
}

/** An ending's narrative and summary with the current route's place names (see routeText.ts). */
export function endingText(def: EndingDefinition): { narrative: string; summary: string } {
  return { narrative: fillRoute(def.narrative), summary: fillRoute(def.summary) };
}

/** Everything an ending depends on, taken from the engine when the ride ends. */
export interface EndingSummary {
  peak: number;
  interventions: number;
  /** Stops where a False Stop Trial happened. */
  trialStops: number[];
  /** Sanity Retained, 0–100. */
  sanPct: number;
  /** Anomaly accuracy, 0–100 (100 when the ride had no anomalies). */
  accPct: number;
  restraintOK: boolean;
  tapes: string[];
  exit: ExitChoice;
}

/** Composure threshold for the quieter endings: half the intervention threshold. */
export const COMPOSED_PEAK = SUS.intervene / 2;

export const ENDINGS: Record<EndingId, EndingDefinition> = {
  secret_mask: {
    id: 'secret_mask',
    priority: 1,
    title: 'The Unbroken Mask',
    badge: '[SECRET: THE UNBROKEN MASK]',
    narrative:
      'At {terminus}, Mom takes your hand on the escalator. “You can stop pretending now,” she says, not looking at you. “We saw it too.”',
    summary: 'The whole ride without a single visible reaction (peak Suspicion 0).',
  },
  eternal_commute: {
    id: 'eternal_commute',
    priority: 2,
    title: 'The Eternal Commute',
    badge: '[LOOP: THE ETERNAL COMMUTE]',
    narrative:
      'The doors open. The sign says {origin}. Mom stands up and smooths her coat. “This is us,” she says.',
    summary: 'Stepped off at {bait}, or let too much of yourself slip away (Sanity Retained under 30%).',
  },
  signal_archivist: {
    id: 'signal_archivist',
    priority: 3,
    title: 'Midnight Terminal',
    badge: '[BRANCH: SIGNAL ARCHIVIST]',
    narrative:
      'You descend past the rusted chain-link gate into {terminus}’s abandoned lower level. The microcassette recorder crackles to life on its own in the damp darkness. A calm dispatcher voice speaks through the hiss: “Track 4 clear. All units hold position.” The loop is broken.',
    summary: 'Followed the static down the side stairs, with tapes in hand, most anomalies caught, and your composure intact.',
  },
  skyward_void: {
    id: 'skyward_void',
    priority: 4,
    title: 'Skyward Catwalk',
    badge: '[BRANCH: SKYWARD VOID]',
    narrative:
      'You break away through the emergency door and climb until there is open air. Below you, the sodium lights of the city glow in eerie silence, completely empty. Behind you, the train rumbles into the dark tunnel—its cars completely hollow.',
    summary: 'Pushed through the emergency door after holding firm through the restraint, without a single False Stop or intervention.',
  },
  dawn_horizon: {
    id: 'dawn_horizon',
    priority: 5,
    title: 'Dawn Horizon',
    badge: '[BRANCH: DAWN HORIZON]',
    narrative:
      'The doors open at {terminus} onto daylight that shouldn’t reach this platform. Dad squints and says nothing. For once, neither do you.',
    summary: 'Stayed with your parents after holding firm through the restraint, with the conductor on tape and most of yourself intact.',
  },
  exposed: {
    id: 'exposed',
    priority: 6,
    title: 'Exposed',
    badge: '[TERMINAL: EXPOSED]',
    narrative:
      'You made it to {terminus}. Dad keeps a firm, unyielding grip on your shoulder all the way up the stairs into the street. Nobody says a single word.',
    summary: 'Your parents stepped in.',
  },
  collapse: {
    id: 'collapse',
    priority: 7,
    title: 'Disoriented Collapse',
    badge: '[COLLAPSE: DISORIENTED]',
    narrative:
      'You made it to {terminus}. Mom doesn’t let go of your sleeve until you’re outside on {street}. You have no memory of the last three stops.',
    summary: 'Stepped off at a False Stop.',
  },
  civilian_extraction: {
    id: 'civilian_extraction',
    priority: 8,
    title: 'Civilian Extraction',
    badge: '[STANDARD: EXTRACTION]',
    narrative:
      'You made it to {terminus}. Your parents push through the turnstiles, already arguing about where to eat in {area}.',
    summary: 'An ordinary arrival.',
  },
};

export const ENDING_IDS = (Object.keys(ENDINGS) as EndingId[]).sort((a, b) => ENDINGS[a].priority - ENDINGS[b].priority);

/** The bait False Stop at 21 St. */
const BAIT_STOP = 12;

export function resolveEnding(s: EndingSummary): EndingDefinition {
  const noTrials = s.trialStops.length === 0;
  if (s.peak === 0) return ENDINGS.secret_mask;
  if (s.trialStops.includes(BAIT_STOP) || s.sanPct < 30) return ENDINGS.eternal_commute;
  if (s.exit === 'lower_level' && s.tapes.length >= 2 && s.accPct >= 75 && s.peak <= COMPOSED_PEAK) {
    return ENDINGS.signal_archivist;
  }
  if (s.exit === 'surface_hatch' && s.restraintOK && noTrials && s.interventions === 0) {
    return ENDINGS.skyward_void;
  }
  if (s.exit === 'escalators' && s.restraintOK && noTrials && s.tapes.includes('conductor') && s.sanPct >= 60) {
    return ENDINGS.dawn_horizon;
  }
  if (s.interventions > 0) return ENDINGS.exposed;
  if (!noTrials) return ENDINGS.collapse;
  return ENDINGS.civilian_extraction;
}

export function endingSummary(G: GameEngine): EndingSummary {
  const total = G.acc.correct + G.acc.miss;
  return {
    peak: G.peak,
    interventions: G.interventions,
    trialStops: G.trials.map((t) => t.stop),
    sanPct: G.getSanityScore(),
    accPct: total > 0 ? Math.round((100 * G.acc.correct) / total) : 100,
    restraintOK: G.restraintOK,
    tapes: evp.tapes.map((t) => t.signalId),
    exit: G.finalExitChoice ?? 'escalators',
  };
}

// --- Archive (kept on the device; cleared by Erase saved progress) ---

export const ENDINGS_ARCHIVE_KEY = 'gtrain-endings';
/** Key used by the first Phase 3 build; read once and migrated. */
export const LEGACY_ENDINGS_ARCHIVE_KEY = 'courtSq_endingsArchive';

export interface EndingArchiveEntry {
  id: EndingId;
  discoveredAt: number;
  count: number;
}

export type EndingsArchive = Partial<Record<EndingId, EndingArchiveEntry>>;

export function loadEndingsArchive(): EndingsArchive {
  try {
    const raw = localStorage.getItem(ENDINGS_ARCHIVE_KEY) ?? localStorage.getItem(LEGACY_ENDINGS_ARCHIVE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Keep only endings that still exist.
    const out: EndingsArchive = {};
    for (const id of ENDING_IDS) if (parsed[id]) out[id] = parsed[id];
    return out;
  } catch {
    return {};
  }
}

export function recordEndingToArchive(id: EndingId): EndingsArchive {
  const archive = loadEndingsArchive();
  if (offRecord()) return archive; // practice runs don't discover endings
  const existing = archive[id];
  archive[id] = { id, discoveredAt: existing?.discoveredAt ?? Date.now(), count: (existing?.count ?? 0) + 1 };
  try {
    localStorage.setItem(ENDINGS_ARCHIVE_KEY, JSON.stringify(archive));
    localStorage.removeItem(LEGACY_ENDINGS_ARCHIVE_KEY);
  } catch {
    /* storage blocked: the ending still shows on this report */
  }
  return archive;
}

