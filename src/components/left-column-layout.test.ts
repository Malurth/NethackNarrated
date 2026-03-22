/**
 * Tests that the left-column layout shrinks the Actions panel first (with a
 * scrollbar) before compressing the Messages panel.
 *
 * jsdom doesn't compute CSS layout, so we verify the structural CSS contracts
 * by parsing the component source files for the critical style rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function readComponent(name: string): string {
  return readFileSync(resolve(__dirname, `${name}.svelte`), 'utf-8');
}

/** Extract the value of a CSS property from a given rule block in source */
function cssValue(source: string, selector: string, property: string): string | null {
  // Match the selector block (non-greedy to get the first closing brace)
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g');
  let match;
  while ((match = blockRe.exec(source)) !== null) {
    const block = match[1];
    const propRe = new RegExp(`${property}\\s*:\\s*([^;]+);`);
    const propMatch = block.match(propRe);
    if (propMatch) return propMatch[1].trim();
  }
  return null;
}

describe('Left column shrink priority', () => {
  const actionsSource = readComponent('ActionsPanel');
  const messageSource = readComponent('MessagePanel');

  it('ActionsPanel has a high flex-shrink so it compresses first', () => {
    const shrink = cssValue(actionsSource, '.actions-panel', 'flex-shrink');
    expect(shrink).not.toBeNull();
    expect(Number(shrink)).toBeGreaterThanOrEqual(10);
  });

  it('ActionsPanel has a min-height floor to avoid total collapse', () => {
    const minHeight = cssValue(actionsSource, '.actions-panel', 'min-height');
    expect(minHeight).not.toBeNull();
    expect(parseInt(minHeight!, 10)).toBeGreaterThan(0);
  });

  it('ActionsPanel .panel-body is scrollable when compressed', () => {
    const overflow = cssValue(actionsSource, '.panel-body', 'overflow-y');
    expect(overflow).toBe('auto');

    const minH = cssValue(actionsSource, '.panel-body', 'min-height');
    expect(minH).toBe('0');
  });

  it('MessagePanel does not shrink (flex-shrink: 0)', () => {
    const shrink = cssValue(messageSource, '.message-panel', 'flex-shrink');
    expect(shrink).toBe('0');
  });
});
