import { NethackStateManager } from '@neth4ck/api';
import type { NethackRuntimeVersion, SaveSlot } from '../types/game';

const SLOTS_KEY = 'nethack-save-slots';
const OLD_META_KEY = 'nethack-save-meta';

const VERSION_TAGS: Record<NethackRuntimeVersion, string> = {
  '3.7': '37',
  '3.6.7': '367',
};

// ── Slot ID ──

export function createSlotId(): string {
  return `s-${Date.now()}`;
}

// ── Save directory for a slot ──

export function getSlotSaveDir(slot: { slotId: string; version: NethackRuntimeVersion }): string {
  const tag = VERSION_TAGS[slot.version] ?? slot.version;
  return `/save-${tag}-${slot.slotId}`;
}

/** Legacy save dir (pre-multi-slot) for migration. */
export function getLegacySaveDir(version: NethackRuntimeVersion): string {
  return `/save-${VERSION_TAGS[version] ?? version}`;
}

// ── Slot Registry (localStorage) ──

export function loadSlotRegistry(): SaveSlot[] {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt */ }

  // Migration: convert old single-slot metadata to a slot entry
  try {
    const oldRaw = localStorage.getItem(OLD_META_KEY);
    if (oldRaw) {
      const old = JSON.parse(oldRaw);
      const migrated: SaveSlot = {
        slotId: `migrated-${VERSION_TAGS[old.version as NethackRuntimeVersion] ?? '37'}`,
        version: old.version ?? '3.7',
        name: old.name ?? 'Player',
        turn: old.turn ?? 0,
        dlvl: old.dlvl ?? 0,
        title: old.title ?? old.name ?? 'Player',
        date: old.date ?? Date.now(),
      };
      saveSlotRegistry([migrated]);
      localStorage.removeItem(OLD_META_KEY);
      return [migrated];
    }
  } catch { /* ignore */ }

  return [];
}

export function saveSlotRegistry(slots: SaveSlot[]): void {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch { /* quota exceeded */ }
}

export function updateSlotInRegistry(slot: SaveSlot): void {
  const slots = loadSlotRegistry();
  const idx = slots.findIndex(s => s.slotId === slot.slotId);
  if (idx >= 0) {
    slots[idx] = slot;
  } else {
    slots.push(slot);
  }
  saveSlotRegistry(slots);
}

export function removeSlotFromRegistry(slotId: string): void {
  const slots = loadSlotRegistry().filter(s => s.slotId !== slotId);
  saveSlotRegistry(slots);
}

// ── IndexedDB checks ──

/** Check if an IDBFS database has save files. */
export async function hasSlotSaveData(slot: { slotId: string; version: NethackRuntimeVersion }): Promise<boolean> {
  return NethackStateManager.hasSaveFiles(getSlotSaveDir(slot));
}

/** Delete a slot's IndexedDB database. */
export async function deleteSlotSaveData(slot: { slotId: string; version: NethackRuntimeVersion }): Promise<void> {
  const dbName = getSlotSaveDir(slot);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Validate slots against IndexedDB — remove entries with no actual save data. */
export async function validateSlots(slots: SaveSlot[]): Promise<SaveSlot[]> {
  const results = await Promise.all(
    slots.map(async (slot) => {
      const has = await hasSlotSaveData(slot);
      // Also check legacy path for migrated slots
      if (!has && slot.slotId.startsWith('migrated-')) {
        const hasLegacy = await NethackStateManager.hasSaveFiles(getLegacySaveDir(slot.version));
        return hasLegacy ? slot : null;
      }
      return has ? slot : null;
    })
  );
  return results.filter((s): s is SaveSlot => s !== null);
}
