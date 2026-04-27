import { describe, it, expect } from 'vitest';
import { formatInlineMarkdown } from './format-markdown';

describe('formatInlineMarkdown', () => {
  it('renders **bold** as <strong>', () => {
    expect(formatInlineMarkdown('a **bold** word')).toBe('a <strong>bold</strong> word');
  });

  it('renders *italic* as <em>', () => {
    expect(formatInlineMarkdown('an *italic* word')).toBe('an <em>italic</em> word');
  });

  it('handles both bold and italic together', () => {
    expect(formatInlineMarkdown('**bold** and *italic*')).toBe('<strong>bold</strong> and <em>italic</em>');
  });

  it('does not treat bold markers as italic', () => {
    expect(formatInlineMarkdown('**bold**')).toBe('<strong>bold</strong>');
  });

  it('escapes HTML entities before formatting', () => {
    expect(formatInlineMarkdown('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('escapes HTML but still formats markdown', () => {
    expect(formatInlineMarkdown('**<b>tricky</b>**')).toBe('<strong>&lt;b&gt;tricky&lt;/b&gt;</strong>');
  });

  it('returns plain text unchanged', () => {
    expect(formatInlineMarkdown('just plain text')).toBe('just plain text');
  });
});
