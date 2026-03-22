import type { ConnectionStatus } from '../services/wasm-connection';

class ConnectionStore {
  status = $state<ConnectionStatus>('disconnected');
  error = $state('');

  setStatus(status: ConnectionStatus, error?: string) {
    this.status = status;
    this.error = error ?? '';
  }
}

export const connectionState = new ConnectionStore();
