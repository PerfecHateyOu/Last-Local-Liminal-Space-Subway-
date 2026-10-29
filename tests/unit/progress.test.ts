import { describe, expect, test, afterEach } from 'bun:test';
import { ACHIEVEMENT_IDS, unlockAchievement, hasAchievement, loadAchievements } from '../../src/game/achievements';
import { practice, offRecord } from '../../src/game/practice';
import { shuffle } from '../../src/game/shuffle';
import { routeManager } from '../../src/game/routeManager';
import { fillRoute, routeText } from '../../src/game/routeText';

afterEach(() => { practice.on = false; practice.debugRun = false; routeManager.setRoute('G'); });

describe('achievements', () => {
  test('unlock once, persisted', () => {
    const id = ACHIEVEMENT_IDS[0];
    expect(unlockAchievement(id)).toBe(true);
    expect(unlockAchievement(id)).toBe(false);
    expect(hasAchievement(id)).toBe(true);
    expect(Object.keys(loadAchievements())).toEqual([id]);
  });
  test('off-record rides (practice or DEBUG RUN) earn nothing', () => {
    practice.debugRun = true;
    expect(offRecord()).toBe(true);
    expect(unlockAchievement(ACHIEVEMENT_IDS[0])).toBe(false);
    expect(hasAchievement(ACHIEVEMENT_IDS[0])).toBe(false);
  });
});

describe('shuffle', () => {
  test('is a permutation and does not mutate input', () => {
    const src = [1, 2, 3, 4, 5, 6];
    let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = shuffle(src, rnd);
    expect([...out].sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('route text', () => {
  test('each route fills {line} and leaves no placeholders', () => {
    for (const id of ['G', 'L', '7'] as const) {
      routeManager.setRoute(id);
      expect(routeText().line).toBe(id);
      const s = fillRoute('{line} to {terminus} from {origin}');
      expect(s.startsWith(id)).toBe(true);
      expect(s).not.toMatch(/\{\w+\}/);
    }
  });
});
