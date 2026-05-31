/**
 * WebSocket Gateway
 *
 * Handles PTY I/O streaming + state event broadcasts with the frontend.
 * Based on @nestjs/platform-ws (raw WebSocket).
 *
 * Client messages: JSON { type, ... } format
 * - pty-input: write data to PTY
 * - pty-resize: resize PTY terminal
 * - subscribe: subscribe to a session PTY stream
 * - unsubscribe: unsubscribe from a session PTY stream
 */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import type { WebSocket } from 'ws';
import type {
  Session,
  PaneRef,
  PaneStatus,
  ViewSlot,
  WsClientMessage,
} from '../../shared/types';
import { PtyManagerService } from '../pane/pty-manager.service';
import { PaneService } from '../pane/pane.service';
import { SessionService } from '../session/session.service';
import { ConfigService } from '../config/config.service';

@WebSocketGateway({ path: '/ws' })
export class PtyGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PtyGateway.name);

  @WebSocketServer()
  server: unknown;

  /** Track subscribed sessions per client */
  private subscriptions = new Map<WebSocket, Set<string>>();

  constructor(
    private readonly ptyManager: PtyManagerService,
    private readonly paneService: PaneService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  /** Gateway initialization: bind PtyManager events */
  afterInit(): void {
    this.ptyManager.on('pty-data', ((...args: unknown[]) => {
      const event = args[0] as { paneId: string; sessionId: string; data: string };
      this.broadcastToSession(event.sessionId, {
        type: 'pty-output',
        paneId: event.paneId,
        data: event.data,
      });
    }) as (...args: unknown[]) => void);

    this.ptyManager.on('pty-exit', ((...args: unknown[]) => {
      const event = args[0] as { paneId: string; sessionId: string; exitCode: number };
      // PTY exited → update pane to exited state (DB record kept; restart is possible)
      this.paneService.updateStatus(event.paneId, 'exited');
    }) as (...args: unknown[]) => void);

    this.logger.log('PtyGateway initialized');
  }

  /** Client connected: send initial state + bind message handler */
  handleConnection(client: WebSocket): void {
    this.subscriptions.set(client, new Set());

    // Send initial state (includes workspace + xterm config)
    // sessions: send sessions from all workspaces → client filters by activeWorkspaceId
    const workspaces = this.sessionService.listWorkspaces();
    const activeWorkspaceId = this.sessionService.getActiveWorkspaceId();
    const sessions = this.sessionService.listAll();
    const activeSessionId = this.sessionService.getActiveSessionId();
    const xtermConfig = this.configService.get<Record<string, unknown>>('web.xterm') || {};
    this.sendToClient(client, {
      type: 'state',
      data: { workspaces, activeWorkspaceId, sessions, activeSessionId, xtermConfig },
    });

    // @SubscribeMessage does not work with raw WS, so bind directly
    client.on('message', (raw: Buffer | string) => {
      try {
        const msg: WsClientMessage = JSON.parse(raw.toString());
        this.handleClientMessage(client, msg);
      } catch {
        // Ignore parse failures
      }
    });

    this.logger.log('Client connected');
  }

  /** Client disconnected */
  handleDisconnect(client: WebSocket): void {
    this.subscriptions.delete(client);
    this.logger.log('Client disconnected');
  }

  // ─────────────────────────────────────────────
  // Client message handling
  // ─────────────────────────────────────────────

  /** Route messages by type */
  private handleClientMessage(client: WebSocket, msg: WsClientMessage): void {
    switch (msg.type) {
      case 'pty-input':
        this.ptyManager.write(msg.paneId, msg.data);
        break;
      case 'pty-resize':
        this.ptyManager.resize(msg.paneId, msg.cols, msg.rows);
        break;
      case 'subscribe':
        this.handleSubscribe(client, msg.sessionId);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(client, msg.sessionId);
        break;
      case 'pty-replay':
        this.handlePaneReplay(client, msg.paneId);
        break;
    }
  }

  /** Subscribe to a session (starts real-time streaming; replay is triggered via pty-replay on Terminal mount) */
  private handleSubscribe(client: WebSocket, sessionId: string): void {
    const subs = this.subscriptions.get(client);
    if (subs) subs.add(sessionId);
    this.logger.debug(`Session subscribed: ${sessionId}`);
  }

  /** Replay individual pane ring buffer (called on Terminal mount) */
  private handlePaneReplay(client: WebSocket, paneId: string): void {
    const buffer = this.ptyManager.getRingBuffer(paneId);
    for (const data of buffer) {
      this.sendToClient(client, { type: 'pty-output', paneId, data });
    }
    this.logger.debug(`Pane replay: ${paneId}, chunks=${buffer.length}`);
  }

  /** Unsubscribe from a session */
  private handleUnsubscribe(client: WebSocket, sessionId: string): void {
    const subs = this.subscriptions.get(client);
    if (subs) subs.delete(sessionId);
    this.logger.debug(`Session unsubscribed: ${sessionId}`);
  }

  // ─────────────────────────────────────────────
  // EventEmitter2 events → WS broadcast
  // ─────────────────────────────────────────────

  @OnEvent('session.created')
  handleSessionCreated(session: Session): void {
    this.broadcastAll({
      type: 'session-update',
      action: 'created',
      session,
    });
  }

  @OnEvent('session.updated')
  handleSessionUpdated(session: Session): void {
    this.broadcastAll({
      type: 'session-update',
      action: 'updated',
      session,
    });
  }

  @OnEvent('session.switched')
  handleSessionSwitched(_payload: { sessionId: string }): void {
    const workspaces = this.sessionService.listWorkspaces();
    // Exclude activeWorkspaceId/activeSessionId; send sessions from all workspaces:
    // each tab manages its own active workspace/session independently
    const sessions = this.sessionService.listAll();
    this.broadcastAll({
      type: 'state',
      data: { workspaces, sessions },
    });
  }

  @OnEvent('workspace.created')
  handleWorkspaceCreated(): void {
    this.broadcastFullState();
  }

  @OnEvent('workspace.switched')
  handleWorkspaceSwitched(): void {
    this.broadcastFullState();
  }

  @OnEvent('workspace.updated')
  handleWorkspaceUpdated(): void {
    this.broadcastFullState();
  }

  @OnEvent('workspace.deleted')
  handleWorkspaceDeleted(): void {
    this.broadcastFullState();
  }

  @OnEvent('session.deleted')
  handleSessionDeleted(): void {
    // Broadcast full state → sidebar updates immediately (includes activeSessionId)
    this.broadcastFullState();
  }

  @OnEvent('pane.created')
  handlePaneCreated(pane: PaneRef): void {
    // broadcastAll: panes spawned just before a session switch are not yet subscribed,
    // so broadcastToSession cannot reach the frontend
    this.broadcastAll({
      type: 'pane-update',
      action: 'created',
      pane,
    });
  }

  @OnEvent('pane.exited')
  handlePaneExited(payload: { paneId: string; sessionId: string }): void {
    // broadcastAll: pane deletion must be reflected even if viewing a different session
    this.broadcastAll({
      type: 'pane-update',
      action: 'exited',
      paneId: payload.paneId,
    });
  }

  @OnEvent('pane.removed')
  handlePaneRemoved(payload: { paneId: string }): void {
    this.broadcastAll({
      type: 'pane-update',
      action: 'removed',
      paneId: payload.paneId,
    });
  }

  @OnEvent('pane.statusChanged')
  handlePaneStatusChanged(payload: { paneId: string; status: PaneStatus; pane?: PaneRef }): void {
    if (payload.pane) {
      this.broadcastAll({
        type: 'pane-update',
        action: 'status-changed',
        pane: payload.pane,
      });
    } else {
      // Fallback: if no pane object, send paneId + status
      this.broadcastAll({
        type: 'pane-update',
        action: 'status-changed',
        paneId: payload.paneId,
        status: payload.status,
      });
    }
  }

  @OnEvent('view.pushed')
  handleViewPushed(payload: { guiPaneId: string; slot: ViewSlot }): void {
    this.logger.log(`view.pushed: guiPaneId=${payload.guiPaneId}, slotId=${payload.slot?.id}, type=${payload.slot?.type}`);
    this.broadcastAll({
      type: 'view-update',
      action: 'pushed',
      guiPaneId: payload.guiPaneId,
      slot: payload.slot,
    });
  }

  @OnEvent('view.updated')
  handleViewUpdated(payload: { guiPaneId: string; slot: ViewSlot }): void {
    this.logger.log(`view.updated: guiPaneId=${payload.guiPaneId}, slotId=${payload.slot?.id}, type=${payload.slot?.type}`);
    this.broadcastAll({
      type: 'view-update',
      action: 'updated',
      guiPaneId: payload.guiPaneId,
      slot: payload.slot,
    });
  }

  @OnEvent('view.removed')
  handleViewRemoved(payload: { guiPaneId: string; slotId: string }): void {
    this.broadcastAll({
      type: 'view-update',
      action: 'removed',
      guiPaneId: payload.guiPaneId,
      slotId: payload.slotId,
    });
  }

  // ─────────────────────────────────────────────
  // Send helpers
  // ─────────────────────────────────────────────

  /** Broadcast full state (on workspace/session changes) */
  private broadcastFullState(): void {
    const workspaces = this.sessionService.listWorkspaces();
    // Send sessions from all workspaces — exclude activeWorkspaceId/activeSessionId:
    // each tab manages its own active workspace/session independently
    const sessions = this.sessionService.listAll();
    this.broadcastAll({
      type: 'state',
      data: { workspaces, sessions },
    });
  }

  /** Broadcast a message to subscribers of a specific session */
  broadcastToSession(sessionId: string, msg: object): void {
    const data = JSON.stringify(msg);
    for (const [client, subs] of this.subscriptions) {
      if (subs.has(sessionId) && client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(data);
      }
    }
  }

  /** Broadcast to all connected clients */
  broadcastAll(msg: object): void {
    const data = JSON.stringify(msg);
    for (const [client] of this.subscriptions) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(data);
      }
    }
  }

  /** Send a message to a single client */
  private sendToClient(client: WebSocket, msg: object): void {
    if (client.readyState === 1 /* WebSocket.OPEN */) {
      client.send(JSON.stringify(msg));
    }
  }
}
