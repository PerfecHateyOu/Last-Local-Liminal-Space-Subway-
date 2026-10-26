import { SEGS } from '../constants';
import { ROUTES } from './routeManager';

/**
 * Practice runs: a ride started from Chapter II or III (the start screen's "Start from").
 * It plays exactly like a normal ride, but nothing it does is saved: no endings, badges,
 * Case Files entries, tapes, prints or ride history. Those come only from full rides.
 *
 * gameState sets `practice.on` when a ride starts; each save point checks it.
 */
export const practice = {
  on: false,
  /** The chapter the practice run started from (2 or 3). */
  chapter: 1,
  /** The spoiler overlay was shown at some point this ride: treated like practice for saving. */
  debugRun: false,
};

/** Nothing this ride does is saved: a practice run, or a debug run (the spoiler overlay was shown). */
export function offRecord(): boolean {
  return practice.on || practice.debugRun;
}

/** Where each chapter's ride starts: the segment index into SEGS (see constants.ts). */
export const CHAPTER_START_SEGMENT: Record<number, number> = {
  1: 0, // Hoyt–Schermerhorn, the whole ride
  2: 4, // from Stop 5, into the Stop 6 Safe Haven
  3: 10, // from Stop 10, Greenpoint: the restraint, then the trestle
};

/** Where each chapter's ride leaves from (the station before its first stretch). Rides start on the G. */
export function chapterOrigin(chapter: number): string {
  const seg = CHAPTER_START_SEGMENT[chapter] ?? 0;
  return ROUTES.G.stops[seg > 0 ? SEGS[seg - 1].stop : 1];
}
