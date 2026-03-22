import type { GameState, MonsterEntity } from '../types/game';
import type { NarrationTriggerConfig } from '../types/narration-triggers';
import { matchesIgnoredPattern } from '../types/narration-triggers';
import { gameState } from '../state/game.svelte';

/**
 * Snapshot shape used for state-diff triggers. Matches the NarrationSnapshot
 * interface in llm-service.ts — we only declare the fields we need here to
 * avoid a circular import.
 */
export interface TriggerSnapshot {
  monsters: { name: string; x: number; y: number }[];
  inventory: { letter: string; text: string }[];
  visibleFloorTiles: number;
}

// ── Individual trigger checks ──────────────────────────────────────

/**
 * Game produced at least one real message this turn that isn't ignored.
 * `filteredMessages` are the messages that already passed hasNarratableContent
 * filtering (UI instructions removed). We further remove any that match
 * the user's ignored patterns.
 */
export function checkGameMessages(
  filteredMessages: string[],
  ignoredPatterns: string[],
): boolean {
  if (filteredMessages.length === 0) return false;
  if (ignoredPatterns.length === 0) return true;
  return filteredMessages.some(m => !matchesIgnoredPattern(m, ignoredPatterns));
}

/** Dungeon level changed since previous turn. */
export function checkLevelChange(state: GameState): boolean {
  return state.dlvl !== gameState.previousDlvl && gameState.previousDlvl !== 0;
}

/** HP dropped below 50% or lost 3+ HP in one turn. */
export function checkHpLoss(state: GameState): boolean {
  if (!state.player) return false;
  if (state.player.hp < state.player.max_hp * 0.5) return true;
  if (gameState.previousHp > 0) {
    const drop = gameState.previousHp - state.player.hp;
    if (drop >= 3) return true;
  }
  return false;
}

/** A new status condition appeared this turn. */
export function checkStatusCondition(state: GameState): boolean {
  if (state.conditions.length > gameState.previousConditions.length) return true;
  // Check for a condition that wasn't there before (even if total count is same)
  for (const c of state.conditions) {
    if (!gameState.previousConditions.includes(c)) return true;
  }
  return false;
}

/** One or more new monster names appeared in view compared to previous snapshot. */
export function checkMonsterAppeared(
  state: GameState,
  prevSnapshot: TriggerSnapshot | null,
): boolean {
  if (!prevSnapshot) return false;
  // Must match the same filtering as visibleMonsters() in llm-service.ts:
  // exclude pets and the player's own tile.
  const currentMonsters = state.entities.filter(
    (e): e is MonsterEntity =>
      e.type === 'monster' && !e.pet
      && !(e.x === state.player.x && e.y === state.player.y),
  );
  // Build a count-aware bag from the previous snapshot so that
  // e.g. 1 goblin → 2 goblins is detected as a new appearance.
  const prevCounts = new Map<string, number>();
  for (const m of prevSnapshot.monsters) {
    prevCounts.set(m.name, (prevCounts.get(m.name) ?? 0) + 1);
  }
  const currCounts = new Map<string, number>();
  for (const m of currentMonsters) {
    currCounts.set(m.name, (currCounts.get(m.name) ?? 0) + 1);
  }
  for (const [name, count] of currCounts) {
    if (count > (prevCounts.get(name) ?? 0)) return true;
  }
  return false;
}

const VISION_EXPANSION_THRESHOLD = 10;

/** Significant increase in visible floor tiles (e.g. entering a large room). */
export function checkVisionExpansion(
  state: GameState,
  prevSnapshot: TriggerSnapshot | null,
): boolean {
  if (!prevSnapshot) return false;
  const currentTiles = state.terrain?.visibleFloorTiles ?? 0;
  const prevTiles = prevSnapshot.visibleFloorTiles;
  return currentTiles - prevTiles >= VISION_EXPANSION_THRESHOLD;
}

/** An inventory item was added, removed, or changed. */
export function checkInventoryChange(
  state: GameState,
  prevSnapshot: TriggerSnapshot | null,
): boolean {
  if (!prevSnapshot) return false;
  const prev = prevSnapshot.inventory;
  const curr = state.inventory.map(i => ({ letter: i.letter, text: i.text }));
  if (prev.length !== curr.length) return true;
  for (let i = 0; i < curr.length; i++) {
    if (curr[i].letter !== prev[i].letter || curr[i].text !== prev[i].text) return true;
  }
  return false;
}

// ── Orchestrator ───────────────────────────────────────────────────

/**
 * Check all enabled triggers and return true if any fires.
 * `filteredMessages` are the turn's messages after hasNarratableContent filtering.
 */
export function shouldTriggerNarration(
  state: GameState,
  config: NarrationTriggerConfig,
  prevSnapshot: TriggerSnapshot | null,
  filteredMessages: string[],
): boolean {
  const t = config.triggers;
  const reasons: string[] = [];
  if (t.gameMessages && checkGameMessages(filteredMessages, config.ignoredMessagePatterns)) reasons.push('gameMessages');
  if (t.levelChange && checkLevelChange(state)) reasons.push('levelChange');
  if (t.hpLoss && checkHpLoss(state)) reasons.push('hpLoss');
  if (t.statusCondition && checkStatusCondition(state)) reasons.push('statusCondition');
  if (t.monsterAppeared && checkMonsterAppeared(state, prevSnapshot)) reasons.push('monsterAppeared');
  if (t.visionExpansion && checkVisionExpansion(state, prevSnapshot)) reasons.push('visionExpansion');
  if (t.inventoryChange && checkInventoryChange(state, prevSnapshot)) reasons.push('inventoryChange');
  if (reasons.length > 0) {
    console.log('[NARRATION TRIGGER]', { turn: state.turn, reasons });
    return true;
  }
  return false;
}
