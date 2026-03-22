// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

/** Flush one rAF frame + Svelte microtasks */
async function flushFrame() {
  await tick();
  await new Promise((r) => requestAnimationFrame(r));
  await tick();
}
import NarrationTriggerPopover from './NarrationTriggerPopover.svelte';
import { llmState } from '../state/llm.svelte';
import { defaultTriggerConfig, ALL_TRIGGERS, TRIGGER_LABELS, PRESET_LABELS, ALL_PRESETS } from '../types/narration-triggers';

beforeEach(() => {
  llmState.triggerConfig = defaultTriggerConfig();
});

describe('NarrationTriggerPopover', () => {
  it('renders the toggle button with preset label', () => {
    render(NarrationTriggerPopover);
    expect(screen.getByTitle('Configure narration triggers')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
  });

  it('opens popover on click showing presets and triggers', async () => {
    render(NarrationTriggerPopover);
    await fireEvent.click(screen.getByTitle('Configure narration triggers'));

    // All preset buttons visible (use getAllByText since label also appears on toggle button)
    for (const preset of ALL_PRESETS) {
      const matches = screen.getAllByText(PRESET_LABELS[preset]);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }

    // All trigger checkboxes visible
    for (const trigger of ALL_TRIGGERS) {
      expect(screen.getByText(TRIGGER_LABELS[trigger])).toBeInTheDocument();
    }
  });

  it('shows ignored messages section when popover is open', async () => {
    render(NarrationTriggerPopover);
    await fireEvent.click(screen.getByTitle('Configure narration triggers'));

    expect(screen.getByText('Ignored Messages')).toBeInTheDocument();
    // Default pattern should be visible
    expect(screen.getByText('You swap places with *')).toBeInTheDocument();
    // Add input should be visible
    expect(screen.getByPlaceholderText('e.g. You see here *')).toBeInTheDocument();
  });

  it('can add and remove ignored patterns', async () => {
    render(NarrationTriggerPopover);
    await fireEvent.click(screen.getByTitle('Configure narration triggers'));

    // Type a new pattern and add it
    const input = screen.getByPlaceholderText('e.g. You see here *');
    await fireEvent.input(input, { target: { value: 'You see here *' } });
    await fireEvent.click(screen.getByText('Add'));

    expect(screen.getByText('You see here *')).toBeInTheDocument();

    // Remove the default pattern
    const removeButtons = screen.getAllByTitle('Remove');
    await fireEvent.click(removeButtons[0]);

    expect(screen.queryByText('You swap places with *')).not.toBeInTheDocument();
  });

  it('can edit an existing pattern inline', async () => {
    render(NarrationTriggerPopover);
    await fireEvent.click(screen.getByTitle('Configure narration triggers'));

    // Click the edit button on the default pattern
    await fireEvent.click(screen.getByTitle('Edit'));

    // An input should appear with the current pattern value
    const editInput = screen.getByDisplayValue('You swap places with *');
    expect(editInput).toBeInTheDocument();

    // Change it and submit
    await fireEvent.input(editInput, { target: { value: 'You see here *' } });
    await fireEvent.submit(editInput.closest('form')!);

    // Old pattern gone, new one present
    expect(screen.queryByText('You swap places with *')).not.toBeInTheDocument();
    expect(screen.getByText('You see here *')).toBeInTheDocument();
  });

  it('uses fixed positioning anchored to the toggle button and constrains height', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);

    render(NarrationTriggerPopover);
    const toggleBtn = screen.getByTitle('Configure narration triggers');

    // Button at y=40..60, right edge at x=780
    vi.spyOn(toggleBtn, 'getBoundingClientRect').mockReturnValue({
      top: 40, bottom: 60, left: 660, right: 780,
      width: 120, height: 20, x: 660, y: 40, toJSON() {},
    });

    await fireEvent.click(toggleBtn);
    await flushFrame();

    const popover = document.querySelector('.popover') as HTMLElement;
    expect(popover).toBeTruthy();

    // top = btnRect.bottom + 6 = 66
    expect(popover.style.top).toBe('66px');
    // right = innerWidth - btnRect.right = 800 - 780 = 20
    expect(popover.style.right).toBe('20px');
    // maxHeight = innerHeight - top - 12 = 300 - 66 - 12 = 222
    expect(popover.style.maxHeight).toBe('222px');
  });

  it('enforces a minimum max-height of 80px even in tiny viewports', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(100);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);

    render(NarrationTriggerPopover);
    const toggleBtn = screen.getByTitle('Configure narration triggers');

    // Button near the bottom of a tiny viewport
    vi.spyOn(toggleBtn, 'getBoundingClientRect').mockReturnValue({
      top: 70, bottom: 90, left: 660, right: 780,
      width: 120, height: 20, x: 660, y: 70, toJSON() {},
    });

    await fireEvent.click(toggleBtn);
    await flushFrame();

    const popover = document.querySelector('.popover') as HTMLElement;
    expect(popover).toBeTruthy();

    // top = 96, available = 100 - 96 - 12 = -8, clamped to 80
    expect(popover.style.maxHeight).toBe('80px');
  });

  it('continuously repositions via rAF to track layout changes like panel resizing', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);

    render(NarrationTriggerPopover);
    const toggleBtn = screen.getByTitle('Configure narration triggers');

    const btnRectMock = vi.spyOn(toggleBtn, 'getBoundingClientRect').mockReturnValue({
      top: 40, bottom: 60, left: 660, right: 780,
      width: 120, height: 20, x: 660, y: 40, toJSON() {},
    });

    await fireEvent.click(toggleBtn);
    await flushFrame();

    const popover = document.querySelector('.popover') as HTMLElement;
    expect(popover).toBeTruthy();

    // top=66, maxHeight = 500 - 66 - 12 = 422
    expect(popover.style.top).toBe('66px');
    expect(popover.style.maxHeight).toBe('422px');

    // Simulate the button moving down (panel header pushed down by drag resize)
    // — no resize event needed, rAF loop picks it up automatically
    btnRectMock.mockReturnValue({
      top: 340, bottom: 360, left: 660, right: 780,
      width: 120, height: 20, x: 660, y: 340, toJSON() {},
    });

    await flushFrame();

    // top = 366, maxHeight = 500 - 366 - 12 = 122
    expect(popover.style.top).toBe('366px');
    expect(popover.style.maxHeight).toBe('122px');
  });
});
