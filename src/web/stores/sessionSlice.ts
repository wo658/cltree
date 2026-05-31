import { StateCreator } from 'zustand';
import type { Session, Workspace } from '@shared/types';

/** xterm.js configuration (delivered from the server) */
export interface XtermConfig {
  fontFamily?: string;
  fontSize?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
}

/** Session slice state + actions */
export interface SessionSlice {
  sessions: Session[];
  activeSessionId: string | null;
  xtermConfig: XtermConfig;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  setSessions: (sessions: Session[]) => void;
  setActiveSession: (id: string | null) => void;
  setXtermConfig: (config: XtermConfig) => void;
  addSession: (session: Session) => void;
  updateSession: (session: Session) => void;
  removeSession: (id: string) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspace: (id: string | null) => void;
  addWorkspace: (workspace: Workspace) => void;
  updateWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
}

/** Session slice creator */
export const createSessionSlice: StateCreator<
  SessionSlice,
  [],
  [],
  SessionSlice
> = (set) => ({
  sessions: [],
  activeSessionId: null,
  xtermConfig: {},
  workspaces: [],
  activeWorkspaceId: null,

  setSessions: (sessions) => set({ sessions }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  setXtermConfig: (config) => set({ xtermConfig: config }),

  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),

  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === session.id ? session : s,
      ),
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      // If the deleted session is active, deactivate it
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),

  setWorkspaces: (workspaces) => set({ workspaces }),

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  addWorkspace: (workspace) =>
    set((state) => ({ workspaces: [...state.workspaces, workspace] })),

  updateWorkspace: (workspace) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspace.id ? workspace : w,
      ),
    })),

  removeWorkspace: (id) =>
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id),
      activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
    })),
});
