/**
 * cltree CLI HTTP client used by the demo scripts.
 *
 * Calls are made directly from Node.js via fetch — not from inside the
 * Puppeteer page via `page.evaluate(() => fetch(...))`.
 * (The cltree server runs as a separate process; the demo script calls it.)
 */

export interface CliResponse<T = unknown> {
  ok: boolean;
  data: T;
  actions: { cmd: string[]; desc: string }[];
  error?: string;
}

export class CltreeClient {
  constructor(private baseUrl: string) {}

  async cli<T = unknown>(cmd: string[], data?: unknown): Promise<CliResponse<T>> {
    const payload: { cmd: string[]; data?: unknown } = { cmd };
    if (data !== undefined) payload.data = data;
    const res = await fetch(`${this.baseUrl}/api/cli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, data: null as T, actions: [], error: `HTTP ${res.status}` };
    }
    return res.json() as Promise<CliResponse<T>>;
  }

  /** Wait until the server becomes ready (up to 60 seconds). */
  async waitForReady(maxMs = 60_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxMs) {
      try {
        const res = await fetch(`${this.baseUrl}/api/cli`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: ['w', 'list'] }),
        });
        if (res.ok) return;
      } catch {
        // not yet ready
      }
      await sleep(500);
    }
    throw new Error(`cltree server not ready after ${maxMs}ms at ${this.baseUrl}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
