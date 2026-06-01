import type { WsClientMessage, WsServerMessage } from '@shared/types';

type MessageHandler = (msg: WsServerMessage) => void;

/**
 * WebSocket singleton client.
 * Handles automatic reconnection and message routing.
 */
class WsClient {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private url = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 16000;
  /** Messages sent before the socket is OPEN — flushed on connect. */
  private pendingQueue: WsClientMessage[] = [];

  /** Start connection */
  connect(url?: string) {
    this.url = url ?? `ws://${location.host}/ws`;
    this.doConnect();
  }

  /** Close connection */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send a message to the server (queued until the socket is OPEN). */
  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Not connected yet (e.g. right after a page reload). Queue and flush on open
      // so control messages like `subscribe` / `pty-replay` are not silently lost —
      // otherwise terminals stay blank because the ring-buffer replay never fires.
      this.pendingQueue.push(msg);
    }
  }

  /** Register a message handler */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private doConnect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Flush any messages queued while the socket was connecting.
      const pending = this.pendingQueue;
      this.pendingQueue = [];
      for (const msg of pending) {
        this.ws?.send(JSON.stringify(msg));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsServerMessage;
        this.handlers.forEach((h) => h(msg));
      } catch {
        // Ignore parse failures
      }
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      this.doConnect();
    }, this.reconnectDelay);
  }
}

/** Global WebSocket client instance */
export const wsClient = new WsClient();
