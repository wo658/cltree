import { handleCliCommand, getMockState } from './handlers';
import { useAppStore } from '@web/stores';
import type { WsServerMessage } from '@shared/types';

/**
 * Mock server initialization.
 * - Intercepts fetch to handle CLI commands
 * - Simulates PTY output via a fake WebSocket
 * - Used only in dev mode
 */
export function initMockServer() {
  setupFetchMock();
  setupWsMock();
  loadInitialState();

  console.log('[mock] Mock server initialized');
}

// ─── Intercept fetch ─────────────────────────────────

const originalFetch = window.fetch.bind(window);

function setupFetchMock() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Intercept POST /api/cli
    if (url.endsWith('/api/cli') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      const result = handleCliCommand(body.cmd);

      // Reflect state changes in the store (simulates server WS push)
      syncStoreFromMock();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fall through to the original fetch for everything else
    return originalFetch(input, init);
  };
}

// ─── Fake WebSocket ─────────────────────────────────

/** Fake PTY output timer */
let ptyOutputTimer: ReturnType<typeof setInterval> | null = null;

function setupWsMock() {
  // Effectively neutralize wsClient.connect() and
  // instead push data directly into the store.
  // Override the WebSocket class to mock the connection itself
  const OriginalWebSocket = window.WebSocket;

  class MockWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState = MockWebSocket.OPEN;
    url: string;
    protocol = '';
    extensions = '';
    bufferedAmount = 0;
    binaryType: BinaryType = 'blob';

    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;

    constructor(url: string | URL, _protocols?: string | string[]) {
      super();
      this.url = url.toString();

      // Call onopen on the next tick
      setTimeout(() => {
        const event = new Event('open');
        this.onopen?.(event);
        this.dispatchEvent(event);

        // Send initial state
        this.fakeSend({
          type: 'state',
          data: {
            sessions: getMockState().sessions,
            activeSessionId: 'sess-myapp',
          },
        });
      }, 50);

      // Fake PTY output (every 2 seconds)
      ptyOutputTimer = setInterval(() => {
        const store = useAppStore.getState();
        const activePanes = store.panes.filter(
          (p) => p.sessionId === store.activeSessionId,
        );
        activePanes.forEach((pane) => {
          const fakeOutput =
            pane.type === 'agent'
              ? `\r\n\x1B[36m[agent]\x1B[0m thinking...\r\n`
              : `\r\n\x1B[32m$\x1B[0m \r\n`;
          this.fakeSend({
            type: 'pty-output',
            paneId: pane.id,
            data: fakeOutput,
          });
        });
      }, 3000);
    }

    send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      // Receive client message (ignore or log)
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      if (ptyOutputTimer) {
        clearInterval(ptyOutputTimer);
        ptyOutputTimer = null;
      }
      const event = new CloseEvent('close');
      this.onclose?.(event);
      this.dispatchEvent(event);
    }

    /** Simulate server → client message */
    private fakeSend(msg: WsServerMessage) {
      const event = new MessageEvent('message', {
        data: JSON.stringify(msg),
      });
      this.onmessage?.(event);
      this.dispatchEvent(event);
    }
  }

  // Replace the WebSocket class with the mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).WebSocket = MockWebSocket;

  // Preserve original (for restoration if needed)
  (window as unknown as { _OriginalWebSocket: typeof WebSocket })._OriginalWebSocket =
    OriginalWebSocket;
}

// ─── Load initial state ─────────────────────────────

function loadInitialState() {
  const { sessions, panes } = getMockState();
  const store = useAppStore.getState();
  store.setSessions(sessions);
  store.setActiveSession('sess-myapp');
  store.setPanes(panes);
}

// ─── Sync mock state → store ─────────────────────────

function syncStoreFromMock() {
  const { sessions, panes } = getMockState();
  const store = useAppStore.getState();
  store.setSessions(sessions);
  store.setPanes(panes);
}
