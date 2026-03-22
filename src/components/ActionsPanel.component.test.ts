// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ActionsPanel from './ActionsPanel.svelte';

// Mock the connection so button clicks are observable without booting WASM.
const actionSpy = vi.fn();
vi.mock('../services/wasm-connection', () => ({
  connection: {
    action: (name: string) => actionSpy(name),
  },
}));

describe('ActionsPanel', () => {
  beforeEach(() => {
    actionSpy.mockClear();
  });

  it('renders a Quaff button that dispatches the drink action', async () => {
    // Regression: Quaff was previously only accessible via the inventory
    // panel's per-potion verb, leaving players unable to discover the
    // 'q' command for drinking from fountains when they had no potions.
    render(ActionsPanel);
    const quaff = screen.getByRole('button', { name: /Quaff/ });
    expect(quaff).toBeInTheDocument();
    await fireEvent.click(quaff);
    expect(actionSpy).toHaveBeenCalledWith('drink');
  });

  it('renders an Eat button that dispatches the eat action', async () => {
    // Eat is the direct parallel to Quaff: 'e' works on corpses lying on
    // the floor, not just on food items in your inventory.
    render(ActionsPanel);
    const eat = screen.getByRole('button', { name: /Eat/ });
    expect(eat).toBeInTheDocument();
    await fireEvent.click(eat);
    expect(actionSpy).toHaveBeenCalledWith('eat');
  });

  it('renders the rest of the environment-interacting verbs', () => {
    // Sanity check: make sure we didn't accidentally break the other
    // verbs in the INTERACT row while adding Quaff and Eat.
    render(ActionsPanel);
    for (const label of ['Open', 'Close', 'Kick', 'Apply', 'Cast', 'Fire', 'Loot', 'Engrave', 'Pray']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });
});
