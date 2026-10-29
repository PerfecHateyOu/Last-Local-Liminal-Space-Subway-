import { describe, expect, test, afterEach } from 'bun:test';
import { EVP_SIGNALS, EVP_MIN_KHZ, EVP_MAX_KHZ, titleOf, transcriptOf } from '../../src/game/evpManager';
import { routeManager } from '../../src/game/routeManager';
import { settings, DEFAULT_SETTINGS, PROGRESS_KEYS } from '../../src/settings';

afterEach(() => routeManager.setRoute('G'));

describe('EVP signals', () => {
  test('ids are unique and every signal has stops and a valid voice tier', () => {
    const ids = EVP_SIGNALS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of EVP_SIGNALS) {
      expect(s.stops.length).toBeGreaterThan(0);
      expect(s.voice).toBeGreaterThanOrEqual(0);
      expect(s.voice).toBeLessThanOrEqual(3);
    }
    expect(EVP_MIN_KHZ).toBeLessThan(EVP_MAX_KHZ);
  });
  test('titles and transcripts fill route placeholders on every line', () => {
    for (const id of ['G', 'L', '7'] as const) {
      routeManager.setRoute(id);
      for (const s of EVP_SIGNALS) {
        expect(titleOf(s)).not.toMatch(/\{\w+\}/);
        expect(transcriptOf(s)).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe('settings defaults', () => {
  test('safe defaults: debug overlay off, raw mouse on, smooth walking off, not muted', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ debugOverlay: false, rawMouse: true, smoothWalking: false, startMuted: false, invertY: false });
  });
  test('erase progress clears progress keys but keeps settings', () => {
    for (const k of PROGRESS_KEYS) localStorage.setItem(k, '1');
    localStorage.setItem('gtrain-settings', '{"invertY":true}');
    settings.eraseProgress();
    for (const k of PROGRESS_KEYS) expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem('gtrain-settings')).not.toBeNull();
  });
});
