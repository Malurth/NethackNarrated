// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import StatusFooter from './StatusFooter.svelte';
import { gameState } from '../state/game.svelte';

describe('StatusFooter conditions', () => {
  it('displays friendly condition names', () => {
    gameState.conditions = ['fly', 'lev', 'conf'];
    render(StatusFooter);
    expect(screen.getByText('flying')).toBeInTheDocument();
    expect(screen.getByText('levitating')).toBeInTheDocument();
    expect(screen.getByText('confused')).toBeInTheDocument();
  });

  it('applies danger class to dangerous conditions', () => {
    gameState.conditions = ['stone', 'foodpois'];
    render(StatusFooter);
    expect(screen.getByText('turning to stone')).toHaveClass('danger');
    expect(screen.getByText('food poisoned')).toHaveClass('danger');
  });

  it('applies warning class to warning conditions', () => {
    gameState.conditions = ['stun', 'blind'];
    render(StatusFooter);
    expect(screen.getByText('stunned')).toHaveClass('warning');
    expect(screen.getByText('blind')).toHaveClass('warning');
  });

  it('applies info class to non-critical conditions', () => {
    gameState.conditions = ['fly', 'ride'];
    render(StatusFooter);
    expect(screen.getByText('flying')).toHaveClass('info');
    expect(screen.getByText('riding a steed')).toHaveClass('info');
  });
});
