import { describe, expect, test, afterEach } from 'bun:test';
import {
  ENDINGS, ENDING_IDS, COMPOSED_PEAK, resolveEnding, loadEndingsArchive, recordEndingToArchive,
  ENDINGS_ARCHIVE_KEY, LEGACY_ENDINGS_ARCHIVE_KEY, type EndingSummary,
} from '../../src/game/endings';
import { practice } from '../../src/game/practice';

const base: EndingSummary = { peak: 5, interventions: 0, trialStops: [], sanPct: 80, accPct: 100, restraintOK: true, tapes: [], exit: 'escalators' };
const end = (p: Partial<EndingSummary>) => resolveEnding({ ...base, ...p }).id;

afterEach(() => { practice.on = false; practice.debugRun = false; });

describe('resolveEnding (8 endings, priority order)', () => {
  test('there are exactly 8 endings', () => expect(ENDING_IDS.length).toBe(8));
  test('secret mask: zero peak beats everything', () => expect(end({ peak: 0, sanPct: 10, trialStops: [12] })).toBe('secret_mask'));
  test('eternal commute: the 21 St bait trial or sanity under 30', () => {
    expect(end({ trialStops: [12] })).toBe('eternal_commute');
    expect(end({ sanPct: 29 })).toBe('eternal_commute');
    expect(end({ sanPct: 30 })).not.toBe('eternal_commute');
  });
  test('signal archivist: lower level, 2+ tapes, 75%+ accuracy, composed', () => {
    const ok = { exit: 'lower_level' as const, tapes: ['a', 'b'], accPct: 75, peak: COMPOSED_PEAK };
    expect(end(ok)).toBe('signal_archivist');
    expect(end({ ...ok, tapes: ['a'] })).not.toBe('signal_archivist');
    expect(end({ ...ok, accPct: 74 })).not.toBe('signal_archivist');
    expect(end({ ...ok, peak: COMPOSED_PEAK + 1 })).not.toBe('signal_archivist');
  });
  test('skyward void: surface hatch, restraint held, no trials, no interventions', () => {
    expect(end({ exit: 'surface_hatch' })).toBe('skyward_void');
    expect(end({ exit: 'surface_hatch', restraintOK: false })).toBe('civilian_extraction');
  });
  test('dawn horizon: escalators, restraint, no trials, conductor tape, sanity 60+', () => {
    expect(end({ tapes: ['conductor'] })).toBe('dawn_horizon');
    expect(end({ tapes: ['conductor'], sanPct: 59 })).toBe('civilian_extraction');
  });
  test('exposed, then collapse, then civilian extraction', () => {
    expect(end({ interventions: 1 })).toBe('exposed');
    expect(end({ trialStops: [4] })).toBe('collapse');
    expect(end({})).toBe('civilian_extraction');
  });
  test('every ending is reachable', () => {
    const hit = new Set([
      end({ peak: 0 }), end({ sanPct: 0 }), end({ exit: 'lower_level', tapes: ['a', 'b'] }), end({ exit: 'surface_hatch' }),
      end({ tapes: ['conductor'] }), end({ interventions: 2 }), end({ trialStops: [3] }), end({}),
    ]);
    expect([...hit].sort()).toEqual([...ENDING_IDS].sort());
    for (const id of ENDING_IDS) expect(ENDINGS[id]).toBeDefined();
  });
});

describe('endings archive', () => {
  test('records and counts endings', () => {
    recordEndingToArchive('exposed');
    const a = recordEndingToArchive('exposed');
    expect(a.exposed?.count).toBe(2);
    expect(JSON.parse(localStorage.getItem(ENDINGS_ARCHIVE_KEY)!).exposed.count).toBe(2);
  });
  test('migrates the legacy courtSq_endingsArchive key once', () => {
    localStorage.setItem(LEGACY_ENDINGS_ARCHIVE_KEY, JSON.stringify({ secret_mask: { id: 'secret_mask', discoveredAt: 1, count: 1 }, gone_ending: { count: 1 } }));
    expect(Object.keys(loadEndingsArchive())).toEqual(['secret_mask']);
    recordEndingToArchive('collapse');
    expect(localStorage.getItem(LEGACY_ENDINGS_ARCHIVE_KEY)).toBeNull();
    expect(Object.keys(loadEndingsArchive()).sort()).toEqual(['collapse', 'secret_mask']);
  });
  test('practice and DEBUG RUN rides save nothing', () => {
    practice.on = true; recordEndingToArchive('exposed');
    practice.on = false; practice.debugRun = true; recordEndingToArchive('exposed');
    expect(localStorage.getItem(ENDINGS_ARCHIVE_KEY)).toBeNull();
  });
  test('corrupt storage reads as empty', () => {
    localStorage.setItem(ENDINGS_ARCHIVE_KEY, '{not json');
    expect(loadEndingsArchive()).toEqual({});
  });
});
