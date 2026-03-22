// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import CharacterCreation from './CharacterCreation.svelte';
import { saveSlotRegistry, getSlotSaveDir } from '../utils/save-detection';
import type { SaveSlot } from '../types/game';

/** Create a fake IDBFS database so validateSlots doesn't filter the slot out. */
async function createFakeIDB(slot: SaveSlot) {
  const dbName = getSlotSaveDir(slot);
  await new Promise<void>((resolve) => {
    const req = indexedDB.open(dbName, 21);
    req.onupgradeneeded = () => { req.result.createObjectStore('FILE_DATA'); };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('FILE_DATA', 'readwrite');
      tx.objectStore('FILE_DATA').put({ contents: new Uint8Array(10) }, '/save/test');
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
}

// Clear slot registry before each test
beforeEach(() => {
  saveSlotRegistry([]);
});

describe('CharacterCreation component', () => {
  it('renders the New Game form when no saves exist', async () => {
    render(CharacterCreation, { props: { onstart: () => {} } });

    // Should show "New Game" title (goes straight to create when no slots)
    expect(await screen.findByText('New Game')).toBeInTheDocument();
    expect(screen.getByLabelText('Player Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Pet Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByText('Begin Adventure')).toBeInTheDocument();
  });

  it('renders the slot list when saves exist', async () => {
    const slot: SaveSlot = {
      slotId: 'test-slot',
      version: '3.7',
      name: 'TestHero',
      role: 'Valkyrie', race: 'Human', gender: 'Female', alignment: 'Neutral',
      turn: 42,
      dlvl: 5,
      title: 'TestHero the Valiant',
      date: Date.now(),
    };
    saveSlotRegistry([slot]);
    await createFakeIDB(slot);

    render(CharacterCreation, { props: { onstart: () => {} } });

    // Should show the slot list with "Your Adventures"
    expect(await screen.findByText('Your Adventures')).toBeInTheDocument();
    expect(screen.getByText('TestHero the Valiant')).toBeInTheDocument();
    expect(screen.getByText('+ New Adventure')).toBeInTheDocument();
  });

  it('shows Settings button on the slot list view', async () => {
    const slot: SaveSlot = {
      slotId: 'settings-test',
      version: '3.7',
      name: 'Hero',
      role: 'Barbarian', race: 'Human', gender: 'Male', alignment: 'Neutral',
      turn: 1,
      dlvl: 1,
      title: 'Hero the Brave',
      date: Date.now(),
    };
    saveSlotRegistry([slot]);
    await createFakeIDB(slot);

    render(CharacterCreation, { props: { onstart: () => {} } });

    await screen.findByText('Your Adventures');
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows Settings button on the new game form', async () => {
    render(CharacterCreation, { props: { onstart: () => {} } });

    // No slots → goes straight to create view
    await screen.findByText('New Game');
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows delete confirmation when Delete is clicked', async () => {
    const slot: SaveSlot = {
      slotId: 'del-slot',
      version: '3.7',
      name: 'Doomed',
      role: 'Wizard', race: 'Elf', gender: 'Female', alignment: 'Chaotic',
      turn: 1,
      dlvl: 1,
      title: 'Doomed the Unlucky',
      date: Date.now(),
    };
    saveSlotRegistry([slot]);
    await createFakeIDB(slot);

    const { getByText, findByText } = render(CharacterCreation, {
      props: { onstart: () => {} },
    });

    // Wait for slots to load
    await findByText('Doomed the Unlucky');

    // Click the delete (trashcan) button
    screen.getByTitle('Delete save').click();

    // Confirmation dialog should appear
    expect(await screen.findByText('Delete Save?')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
