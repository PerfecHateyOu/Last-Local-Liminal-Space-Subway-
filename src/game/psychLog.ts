/**
 * Psychological Log: a case file of the anomaly types you've witnessed, kept across rides on
 * this device.
 *
 * Each of the 13 anomaly types has one entry. An entry moves through three states:
 *   - redacted:    never witnessed (only its class shows)
 *   - unconfirmed: it happened in front of you, but you've never caught it
 *   - documented:  caught at least once (the full note shows)
 *
 * The log is only shown on the end-of-ride report, after scoring, so it never acts as an
 * oracle during play.
 */
import { offRecord } from './practice';
import type { StopLogRecord } from '../types';

export interface PsychEntryDef {
  title: string;
  /** Sanity tier whose pool the anomaly comes from (0 High … 3 Critical); shown as a class. */
  tier: number;
  note: string;
}

/** One entry per anomaly id in the catalog (anomalyManager.ts), in catalog order. */
export const PSYCH_ENTRIES: Record<string, PsychEntryDef> = {
  adswap: {
    title: 'The Misprint',
    tier: 0,
    note: 'One letter in an overhead ad changed while you weren’t looking. Small enough to doubt.',
  },
  sticker: {
    title: 'Window Residue',
    tier: 0,
    note: 'Something appeared on the glass between stops. Nobody saw it get there.',
  },
  lighttemp: {
    title: 'The Cold Panel',
    tier: 0,
    note: 'One ceiling tube turned a hospital blue. It lit the same car. It didn’t feel like the same car.',
  },
  stare: {
    title: 'The Man Across the Aisle',
    tier: 0,
    note: 'He stopped blinking. He didn’t look away when you did.',
  },
  mapstop: {
    title: 'Route Map Error',
    tier: 1,
    note: 'The strip map disagreed with itself. Sometimes it lists Hollow St. There is no Hollow St.',
  },
  adcolor: {
    title: 'Color Drift',
    tier: 1,
    note: 'An ad’s background changed between glances. The words stayed exactly where they were.',
  },
  moved: {
    title: 'The Relocated Passenger',
    tier: 1,
    note: 'A standing passenger was at the far doors without crossing the car. No one saw them walk.',
  },
  extra: {
    title: 'The Additional Passenger',
    tier: 1,
    note: 'A silent rider sat at the far end. They didn’t board at any stop you remember.',
  },
  nearword: {
    title: 'Warped Copy',
    tier: 2,
    note: 'An ad rearranged itself into words that were meant for you.',
  },
  faceturn: {
    title: 'The Woman on Your Bench',
    tier: 2,
    note: 'Her head turned further than a neck allows. She wanted to see your reaction.',
  },
  momface: {
    title: 'Mom, Fixed',
    tier: 3,
    note: 'Her face set into an expression that wasn’t hers, pupils wide. She kept talking as if nothing had changed.',
  },
  dadanswer: {
    title: 'Dad, Answering',
    tier: 3,
    note: 'He replied to something you only thought.',
  },
  empty: {
    title: 'The Empty Car',
    tier: 3,
    note: 'Every stranger was gone at once. Your parents didn’t mention it.',
  },
};

export const PSYCH_IDS = Object.keys(PSYCH_ENTRIES);
export const PSYCH_CLASS = ['I', 'II', 'III', 'IV'];

export interface PsychRecord {
  seen: number;
  caught: number;
  /** Date first witnessed (ms). */
  first: number;
}
export type PsychArchive = Record<string, PsychRecord>;

export interface PsychRideEntry {
  id: string;
  stop: string;
  desc: string;
  hit: boolean;
  /** First time this type was ever witnessed on this device. */
  isNew: boolean;
  /** First time this type was ever caught (it was witnessed before but never caught). */
  confirmed: boolean;
}

export interface PsychLogResult {
  ride: PsychRideEntry[];
  archive: PsychArchive;
}

export type PsychState = 'redacted' | 'unconfirmed' | 'documented';

export function entryState(rec: PsychRecord | undefined): PsychState {
  if (!rec || rec.seen === 0) return 'redacted';
  return rec.caught > 0 ? 'documented' : 'unconfirmed';
}

const KEY = 'gtrain-psychlog';

export function loadArchive(): PsychArchive {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveArchive(a: PsychArchive) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* storage blocked: the log still shows this ride */
  }
}

/** Fold this ride's anomalies into the archive and return what to show on the report. */
export function recordRide(stopLog: StopLogRecord[], now = Date.now()): PsychLogResult {
  const archive = loadArchive();
  const ride: PsychRideEntry[] = [];

  for (const r of stopLog) {
    for (const a of r.anoms) {
      if (!a.id || !PSYCH_ENTRIES[a.id]) continue;
      const prev = archive[a.id];
      if (offRecord()) {
        // Practice runs list what happened but leave the Case Files as they were.
        ride.push({ id: a.id, stop: `${r.stop}${r.b ? 'b' : ''}`, desc: a.desc, hit: a.hit, isNew: false, confirmed: false });
        continue;
      }
      const isNew = !prev;
      const rec: PsychRecord = prev ?? { seen: 0, caught: 0, first: now };
      const confirmed = !isNew && a.hit && rec.caught === 0;
      rec.seen++;
      if (a.hit) rec.caught++;
      archive[a.id] = rec;
      ride.push({ id: a.id, stop: `${r.stop}${r.b ? 'b' : ''}`, desc: a.desc, hit: a.hit, isNew, confirmed });
    }
  }

  if (!offRecord()) saveArchive(archive);
  return { ride, archive };
}
