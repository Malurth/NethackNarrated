// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import PromptBar from './PromptBar.svelte';
import { gameState } from '../state/game.svelte';

const rawKeySpy = vi.fn();
const sendLineSpy = vi.fn();

vi.mock('../services/wasm-connection', () => ({
  connection: {
    rawKey: (key: string) => rawKeySpy(key),
    sendLine: (text: string) => sendLineSpy(text),
  },
}));

describe('PromptBar', () => {
  beforeEach(() => {
    rawKeySpy.mockClear();
    sendLineSpy.mockClear();

    gameState.awaitingInput = false;
    gameState.inputType = null;
    gameState.prompt = '';
    gameState.promptChoices = '';
    gameState.menuItems = [];
    gameState.menuSelectionMode = null;
    gameState.textWindowLines = [];
  });

  it('ignores stale menu items when the active prompt is not a menu', () => {
    gameState.awaitingInput = true;
    gameState.inputType = 'yn';
    gameState.prompt = 'Do what with your large box?';
    gameState.promptChoices = ':r';
    gameState.menuItems = [
      { menuChar: ':', text: 'Look inside', isSelectable: true },
      { menuChar: 'r', text: 'Remove item', isSelectable: true },
    ];
    gameState.menuSelectionMode = 1;

    render(PromptBar);

    expect(screen.queryByRole('button', { name: /Look inside/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^: \(:\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^R \(r\)$/ })).toBeInTheDocument();
  });

  it('shows text window lines with a Continue button when blocking on key input', () => {
    gameState.awaitingInput = true;
    gameState.inputType = 'key';
    gameState.textWindowLines = [
      'Contents of the large box:',
      '',
      '  a rusty dagger',
      '  an uncursed food ration',
    ];

    render(PromptBar);

    expect(screen.getByText('Contents of the large box:')).toBeInTheDocument();
    expect(screen.getByText('a rusty dagger')).toBeInTheDocument();
    expect(screen.getByText('an uncursed food ration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('sends a space key when Continue is clicked on a text window', async () => {
    rawKeySpy.mockResolvedValue({});
    gameState.awaitingInput = true;
    gameState.inputType = 'key';
    gameState.textWindowLines = ['Contents of the chest:'];

    render(PromptBar);

    const btn = screen.getByRole('button', { name: 'Continue' });
    btn.click();

    expect(rawKeySpy).toHaveBeenCalledWith(' ');
  });

  it('is hidden when awaiting key input but no text window lines and no prompt', () => {
    gameState.awaitingInput = true;
    gameState.inputType = 'key';
    gameState.prompt = '';
    gameState.textWindowLines = [];

    render(PromptBar);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
