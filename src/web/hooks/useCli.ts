import { useCallback, useState } from 'react';
import { apiClient } from '@web/lib/api-client';
import type { CliResponse } from '@shared/types';

/**
 * Hook to execute CLI commands.
 * Wraps POST /api/cli. Provides loading/error state.
 */
export function useCli() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeCli = useCallback(
    async <T = unknown>(cmd: string[]): Promise<CliResponse<T>> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.cli<T>(cmd);
        if (!res.ok) {
          setError(res.error ?? 'Unknown error');
        }
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error';
        setError(msg);
        return { ok: false, data: null as T, actions: [], error: msg };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { executeCli, loading, error };
}
