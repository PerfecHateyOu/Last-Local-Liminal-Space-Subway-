import { describe, expect, test } from 'bun:test';
import { pushOutOfCircles, PERSON_KEEP_OUT } from '../../src/game/personKeepOut';

describe('pushOutOfCircles', () => {
  const c = [{ x: 5, z: 0.55, r: PERSON_KEEP_OUT }];
  test('outside the circle: unchanged', () => {
    expect(pushOutOfCircles(3, 0, c)).toEqual({ x: 3, z: 0 });
  });
  test('inside: pushed to the edge, away from the centre', () => {
    const p = pushOutOfCircles(4.8, 0.4, c);
    expect(Math.hypot(p.x - 5, p.z - 0.55)).toBeCloseTo(PERSON_KEEP_OUT, 6);
    expect(p.x).toBeLessThan(5);
  });
  test('exactly on the centre: pushed back the way the eye came', () => {
    const p = pushOutOfCircles(5, 0.55, c, 4.5, 0.55);
    expect(p.x).toBeCloseTo(5 - PERSON_KEEP_OUT, 6);
  });
});
