import type { CliResponse } from '@shared/types';

const API_BASE = '/api';

/**
 * HTTP API client.
 * All CLI commands are sent via POST /api/cli.
 */
export const apiClient = {
  /** Execute a CLI command. data is used to pass additional payload (e.g., layout save). */
  async cli<T = unknown>(cmd: string[], data?: unknown): Promise<CliResponse<T>> {
    const payload: { cmd: string[]; data?: unknown } = { cmd };
    if (data !== undefined) payload.data = data;

    const res = await fetch(`${API_BASE}/cli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return {
        ok: false,
        data: null as T,
        actions: [],
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    return res.json() as Promise<CliResponse<T>>;
  },
};
