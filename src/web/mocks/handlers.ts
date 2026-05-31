import type { CliResponse, Session, PaneRef } from '@shared/types';
import { mockSessions } from './data/sessions';
import { mockPanes } from './data/panes';

/** Mutable mock state */
const state = {
  sessions: [...mockSessions],
  panes: [...mockPanes],
  nextId: 100,
};

/** Generate unique ID */
function genId(prefix: string): string {
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

/** Mock response mapping per CLI command */
export function handleCliCommand(cmd: string[]): CliResponse {
  const [domain, verb, ...args] = cmd;

  // ─── session (s) ────────────────────────────────
  if (domain === 's' || domain === 'session') {
    if (verb === 'list') {
      return {
        ok: true,
        data: { sessions: state.sessions },
        actions: [
          { cmd: ['s', 'create', '--name', '<name>'], desc: 'Create session' },
        ],
      };
    }

    if (verb === 'inspect') {
      const id = args[0];
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return { ok: false, data: null, actions: [], error: 'Session not found' };
      const panes = state.panes.filter((p) => p.sessionId === id);
      const children = state.sessions
        .filter((s) => s.parentSessionId === id)
        .map((s) => ({
          session: s,
          panes: state.panes.filter((p) => p.sessionId === s.id),
        }));
      return {
        ok: true,
        data: { session, panes, children },
        actions: [
          { cmd: ['p', 'spawn', '--session', id], desc: 'Spawn agent' },
          { cmd: ['s', 'complete', id], desc: 'Complete session' },
        ],
      };
    }

    if (verb === 'create') {
      const nameIdx = args.indexOf('--name');
      const repoIdx = args.indexOf('--repo');
      const parentIdx = args.indexOf('--parent');
      const name = nameIdx >= 0 ? args[nameIdx + 1] : `session-${state.nextId}`;
      const repo = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
      const parentId = parentIdx >= 0 ? args[parentIdx + 1] : undefined;

      const newSession: Session = {
        id: genId('sess'),
        name,
        status: 'active',
        repo,
        cwd: `/home/alice/${name}`,
        parentSessionId: parentId,
        children: [],
        panes: [],
      };
      state.sessions.push(newSession);
      return {
        ok: true,
        data: { session: newSession },
        actions: [
          { cmd: ['p', 'spawn', '--session', newSession.id], desc: 'Spawn agent' },
        ],
      };
    }

    if (verb === 'switch') {
      // Session switching is handled directly on the client (store.setActiveSession)
      return { ok: true, data: { switched: args[0] }, actions: [] };
    }

    if (verb === 'delete') {
      const id = args[0];
      state.sessions = state.sessions.filter((s) => s.id !== id);
      state.panes = state.panes.filter((p) => p.sessionId !== id);
      return { ok: true, data: { deleted: id }, actions: [] };
    }
  }

  // ─── pane (p) ────────────────────────────────
  if (domain === 'p' || domain === 'pane') {
    if (verb === 'spawn') {
      const sessionIdx = args.indexOf('--session');
      const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : 'sess-myapp';
      const newPane: PaneRef = {
        id: genId('pane'),
        type: 'agent',
        cmd: 'claude --permission-mode auto',
        status: 'idle',
        sessionId,
      };
      state.panes.push(newPane);
      return {
        ok: true,
        data: { pane: newPane },
        actions: [
          { cmd: ['p', 'kill', newPane.id], desc: 'Kill pane' },
        ],
      };
    }

    if (verb === 'attach') {
      const sessionIdx = args.indexOf('--session');
      const cmdIdx = args.indexOf('--cmd');
      const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : 'sess-myapp';
      const paneCmd = cmdIdx >= 0 ? args[cmdIdx + 1] : 'zsh';
      const newPane: PaneRef = {
        id: genId('pane'),
        type: 'terminal',
        cmd: paneCmd,
        status: 'running',
        sessionId,
      };
      state.panes.push(newPane);
      return {
        ok: true,
        data: { pane: newPane },
        actions: [],
      };
    }

    if (verb === 'kill') {
      const id = args[0];
      state.panes = state.panes.filter((p) => p.id !== id);
      return { ok: true, data: { killed: id }, actions: [] };
    }

  }

  return {
    ok: false,
    data: null,
    actions: [],
    error: `Unknown command: ${cmd.join(' ')}`,
  };
}

/** Retrieve current mock state (for WebSocket initial state delivery) */
export function getMockState() {
  return {
    sessions: state.sessions,
    panes: state.panes,
  };
}
