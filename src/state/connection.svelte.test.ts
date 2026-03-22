import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock wasm-connection to avoid pulling in @neth4ck/api and WASM deps.
// connection.svelte.ts only imports the ConnectionStatus type from it.
vi.mock('../services/wasm-connection', () => ({}));

import { connectionState } from './connection.svelte';

beforeEach(() => {
  connectionState.status = 'disconnected';
  connectionState.error = '';
});

describe('ConnectionStore defaults', () => {
  it('starts as disconnected with no error', () => {
    expect(connectionState.status).toBe('disconnected');
    expect(connectionState.error).toBe('');
  });
});

describe('ConnectionStore.setStatus', () => {
  it('updates status', () => {
    connectionState.setStatus('connecting');
    expect(connectionState.status).toBe('connecting');
  });

  it('updates status and error together', () => {
    connectionState.setStatus('error', 'WASM failed to load');
    expect(connectionState.status).toBe('error');
    expect(connectionState.error).toBe('WASM failed to load');
  });

  it('clears error when not provided', () => {
    connectionState.setStatus('error', 'something broke');
    connectionState.setStatus('connected');
    expect(connectionState.status).toBe('connected');
    expect(connectionState.error).toBe('');
  });

  it('supports all valid status transitions', () => {
    const statuses = ['disconnected', 'connecting', 'connected', 'error'] as const;
    for (const s of statuses) {
      connectionState.setStatus(s);
      expect(connectionState.status).toBe(s);
    }
  });
});
