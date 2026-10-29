/**
 * Investigation Achievements & Career Milestones (Operation Skyward Phase 4)
 * Persisted in localStorage and displayed in the Case Files dossier.
 */

import { practice } from './practice';

export type AchievementId =
  | 'first_anomaly'
  | 'photo_evidence'
  | 'tuning_pro'
  | 'broadcaster_lore'
  | 'iron_composure'
  | 'trestle_cross'
  | 'loop_breaker'
  | 'master_archivist';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  category: 'observation' | 'signals' | 'composure' | 'survival';
  description: string;
  badge: string;
  /** Named after something the game keeps hidden (the secret ending): no name until earned. */
  secret?: boolean;
}

export const ACHIEVEMENTS: Record<AchievementId, AchievementDef> = {
  first_anomaly: {
    id: 'first_anomaly',
    title: 'First Contact',
    category: 'observation',
    description: 'Catch your first anomaly with a flag or Polaroid photo.',
    badge: 'FLAG',
  },
  photo_evidence: {
    id: 'photo_evidence',
    title: 'Silver Halide Evidence',
    category: 'observation',
    description: 'Successfully photograph an active car anomaly with the Polaroid 600.',
    badge: 'PHOTO',
  },
  tuning_pro: {
    id: 'tuning_pro',
    title: 'Signal Hunter',
    category: 'signals',
    description: 'Record at least 3 distinct radio signals on the microcassette recorder.',
    badge: 'EVP',
  },
  broadcaster_lore: {
    id: 'broadcaster_lore',
    title: 'Phantom Broadcaster',
    category: 'signals',
    description: 'Discover and record a secret station broadcaster frequency.',
    badge: 'RADIO',
  },
  iron_composure: {
    id: 'iron_composure',
    title: 'The Unbroken Mask',
    category: 'composure',
    description: 'Complete a full ride with 0 peak suspicion from your parents.',
    badge: 'MASK',
    secret: true,
  },
  trestle_cross: {
    id: 'trestle_cross',
    title: 'Night Watch',
    category: 'survival',
    description: 'Witness the Newtown Creek trestle crossing into the night sky.',
    badge: 'VISTA',
  },
  loop_breaker: {
    id: 'loop_breaker',
    title: 'Loop Breaker',
    category: 'survival',
    description: 'Unlock any alternative escape ending beyond standard Civilian Extraction.',
    badge: 'ESCAPE',
  },
  master_archivist: {
    id: 'master_archivist',
    title: 'Chief Archivist',
    category: 'observation',
    description: 'Catalog and document at least 6 distinct anomaly types in your case files.',
    badge: 'DOSSIER',
  },
};

export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS) as AchievementId[];

const ACHIEVEMENTS_STORAGE_KEY = 'gtrain-achievements';

export interface UnlockedAchievements {
  [id: string]: {
    unlockedAt: number;
  };
}

export function loadAchievements(): UnlockedAchievements {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function unlockAchievement(id: AchievementId): boolean {
  if (practice.on) return false; // practice runs don't earn badges
  try {
    const current = loadAchievements();
    if (current[id]) return false; // already unlocked
    current[id] = { unlockedAt: Date.now() };
    localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function hasAchievement(id: AchievementId): boolean {
  const current = loadAchievements();
  return !!current[id];
}
