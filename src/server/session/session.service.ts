import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { DbService, SessionRow, PaneRow } from '../db/db.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RepoService } from '../repo/repo.service';
import type {
  Session,
  SessionStatus,
  Workspace,
  PaneRef,
  SessionInspectData,
} from '../../shared/types';

/** Helper to convert a DB row to the Session interface */
function toSession(row: SessionRow, children: Session[] = [], panes: PaneRef[] = []): Session {
  return {
    id: row.id,
    name: row.name,
    status: row.status as SessionStatus,
    repo: row.repo || undefined,
    issueRepo: row.issue_repo || undefined,
    cwd: row.cwd,
    workspaceId: row.workspace_id || undefined,
    parentSessionId: row.parent_session_id || undefined,
    issueNumber: row.issue_number || undefined,
    worktreePath: row.worktree_path || undefined,
    branch: row.branch || undefined,
    children,
    panes,
    createdAt: row.created_at,
  };
}

/** Helper to convert a DB row to a PaneRef */
function toPaneRef(row: PaneRow): PaneRef {
  return {
    id: row.id,
    type: row.type as PaneRef['type'],
    cmd: row.cmd,
    cwd: row.cwd || undefined,
    status: row.status as PaneRef['status'],
    sessionId: row.session_id,
  };
}

/**
 * Session CRUD service.
 * Manages session/pane data via DbService.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly db: DbService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repoService: RepoService,
  ) {}

  /** Create a new session. Default cwd = server startup directory. repo is auto-detected from the git remote of cwd. */
  create(opts: {
    name: string;
    cwd?: string;
    parentSessionId?: string;
    workspaceId?: string;
  }): Session {
    const id = uuidv4();
    const now = new Date().toISOString();
    const cwd = opts.cwd || process.env.CLTREE_CWD || process.cwd();
    const repo = this.detectRepo(cwd);
    // issueRepo: upstream if it exists, otherwise origin (supports fork → upstream)
    const issueRepo = this.detectIssueRepo(cwd) || repo;

    const workspaceId = opts.workspaceId || this.getActiveWorkspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace. Please create a workspace first.');
    }

    this.db.insertSession({
      id,
      name: opts.name,
      status: 'active',
      repo,
      issue_repo: issueRepo,
      cwd,
      workspace_id: workspaceId,
      parent_session_id: opts.parentSessionId ?? null,
      issue_number: null,
      worktree_path: null,
      branch: null,
      created_at: now,
    });

    this.logger.log(`Session created: id=${id}, name=${opts.name}, cwd=${cwd}, repo=${repo}, issueRepo=${issueRepo}, workspace=${workspaceId}`);

    const session = toSession({
      id,
      name: opts.name,
      status: 'active',
      repo,
      issue_repo: issueRepo,
      cwd,
      workspace_id: workspaceId,
      parent_session_id: opts.parentSessionId ?? null,
      issue_number: null,
      worktree_path: null,
      branch: null,
      created_at: now,
    });

    // For a top-level session with a repo, auto-create the issue GuiPane + slot (once)
    if (!opts.parentSessionId && (issueRepo || repo)) {
      this.createDefaultGuiPane(id, issueRepo || repo!);
    }

    this.eventEmitter.emit('session.created', session);
    return session;
  }

  /** Create a worktree sub-session (issue-based) */
  createWorktreeSubSession(opts: {
    name: string;
    cwd: string;
    parentSessionId: string;
    workspaceId?: string;
    issueNumber: number;
    worktreePath: string;
    branch: string;
    repo: string;
    issueRepo: string;
  }): Session {
    const id = uuidv4();
    const now = new Date().toISOString();
    const workspaceId = opts.workspaceId || this.getActiveWorkspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace');
    }

    this.db.insertSession({
      id,
      name: opts.name,
      status: 'active',
      repo: opts.repo,
      issue_repo: opts.issueRepo,
      cwd: opts.cwd,
      workspace_id: workspaceId,
      parent_session_id: opts.parentSessionId,
      issue_number: opts.issueNumber,
      worktree_path: opts.worktreePath,
      branch: opts.branch,
      created_at: now,
    });

    this.logger.log(`Worktree sub-session created: id=${id}, issue=#${opts.issueNumber}, branch=${opts.branch}, cwd=${opts.cwd}`);

    const session = toSession({
      id,
      name: opts.name,
      status: 'active',
      repo: opts.repo,
      issue_repo: opts.issueRepo,
      cwd: opts.cwd,
      workspace_id: workspaceId,
      parent_session_id: opts.parentSessionId,
      issue_number: opts.issueNumber,
      worktree_path: opts.worktreePath,
      branch: opts.branch,
      created_at: now,
    });

    this.eventEmitter.emit('session.created', session);
    return session;
  }

  /** Retrieve sessions in the active workspace as a tree structure */
  list(): Session[] {
    const workspaceId = this.getActiveWorkspaceId();
    if (!workspaceId) return [];
    const rows = this.db.listSessionsByWorkspace(workspaceId);
    return this.buildTree(rows);
  }

  /** Retrieve all sessions as a tree structure (workspace-agnostic) */
  listAll(): Session[] {
    const rows = this.db.listSessions();
    return this.buildTree(rows);
  }

  /** Internal helper to assemble a session row array into a tree */
  private buildTree(rows: SessionRow[]): Session[] {
    const sessionsMap = new Map<string, Session>();

    // Step 1: create all sessions (with panes)
    for (const row of rows) {
      const paneRows = this.db.listPanesBySession(row.id as string);
      const panes = paneRows.map(toPaneRef);
      sessionsMap.set(row.id as string, toSession(row, [], panes));
    }

    // Step 2: assemble the tree structure
    const roots: Session[] = [];
    for (const session of sessionsMap.values()) {
      if (session.parentSessionId) {
        const parent = sessionsMap.get(session.parentSessionId);
        if (parent) {
          parent.children.push(session);
        } else {
          roots.push(session);
        }
      } else {
        roots.push(session);
      }
    }

    return roots;
  }

  /** Fetch detailed session information */
  inspect(id: string): SessionInspectData {
    const row = this.db.getSession(id);
    if (!row) {
      throw new NotFoundException(`Session not found: ${id}`);
    }

    const paneRows = this.db.listPanesBySession(id);
    const panes = paneRows.map(toPaneRef);

    const session = toSession(row, [], panes);

    // Fetch child sessions
    const allRows = this.db.listSessions();
    const children = allRows
      .filter((r) => r.parent_session_id === id)
      .map((r) => {
        const childPaneRows = this.db.listPanesBySession(r.id as string);
        const childPanes = childPaneRows.map(toPaneRef);
        return {
          session: toSession(r, [], childPanes),
          panes: childPanes,
        };
      });

    return { session, panes, children };
  }

  /** Switch to a session (update app_state.activeSessionId) */
  switchTo(id: string): void {
    const row = this.db.getSession(id);
    if (!row) {
      throw new NotFoundException(`Session not found: ${id}`);
    }
    this.db.setAppState('activeSessionId', id);
    this.logger.log(`Session switched: ${id}`);
    this.eventEmitter.emit('session.switched', { sessionId: id });
  }

  /** Delete a session (recursively deletes sub-sessions) */
  delete(id: string): void {
    const row = this.db.getSession(id);
    if (!row) {
      throw new NotFoundException(`Session not found: ${id}`);
    }

    // Recursively delete child sessions
    const allRows = this.db.listSessions();
    const childRows = allRows.filter((r) => r.parent_session_id === id);
    for (const child of childRows) {
      this.delete(child.id as string);
    }

    // Delete pane DB records for this session (PTY termination is handled by PaneService)
    const paneRows = this.db.listPanesBySession(id);
    for (const pane of paneRows) {
      this.db.deletePane(pane.id as string);
    }

    // If a worktree exists, clean up the local worktree directory too
    if (row.worktree_path) {
      try {
        this.repoService.removeWorktree(row.worktree_path);
      } catch (err) {
        this.logger.warn(`Worktree cleanup failed (${row.worktree_path}): ${err}`);
      }
    }

    // Clear active session if the deleted session was active
    const activeId = this.db.getAppState('activeSessionId');
    if (activeId === id) {
      this.db.setAppState('activeSessionId', '');
    }

    this.db.deleteSession(id);
    this.logger.log(`Session deleted: ${id}`);
    this.eventEmitter.emit('session.deleted', { sessionId: id });
  }

  /** Rename a session */
  rename(id: string, name: string): Session {
    const row = this.db.getSession(id);
    if (!row) {
      throw new NotFoundException(`Session not found: ${id}`);
    }
    this.db.updateSession(id, { name });
    const updated = this.db.getSession(id)!;
    const session = toSession(updated);
    this.eventEmitter.emit('session.updated', session);
    return session;
  }

  /** Mark a session as completed */
  complete(id: string): Session {
    return this.updateStatus(id, 'completed');
  }

  /** Archive a session */
  archive(id: string): Session {
    return this.updateStatus(id, 'archived');
  }

  /** Get the current active session ID */
  getActiveSessionId(): string | null {
    return this.db.getAppState('activeSessionId') ?? null;
  }

  /** Resolve a short ID (prefix) to a full ID. Returns the original if not found. */
  resolveId(idOrPrefix: string): string {
    const row = this.db.findSessionByIdPrefix(idOrPrefix);
    return row ? row.id : idOrPrefix;
  }

  /** Fetch a single session (supports short IDs) */
  findById(id: string): Session | undefined {
    const row = this.db.findSessionByIdPrefix(id);
    if (!row) return undefined;
    const paneRows = this.db.listPanesBySession(id);
    return toSession(row, [], paneRows.map(toPaneRef));
  }

  /** List direct child sessions of a given session */
  getChildren(sessionId: string): Session[] {
    const allRows = this.db.listSessions();
    return allRows
      .filter((r) => r.parent_session_id === sessionId)
      .map((r) => toSession(r));
  }

  /** Detect git remote origin from cwd. Returns null if not found. */
  private detectRepo(cwd: string): string | null {
    try {
      const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
      // https://github.com/owner/repo.git → owner/repo
      const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      return match ? match[1] : remote;
    } catch {
      return null;
    }
  }

  /**
   * Auto-detect the issue repo.
   * 1. If an upstream remote exists, use upstream
   * 2. Detect fork parent via gh repo view
   * 3. Otherwise null (origin from detectRepo is used as fallback)
   */
  private detectIssueRepo(cwd: string): string | null {
    try {
      const remote = execSync('git remote get-url upstream', { cwd, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (match) return match[1];
    } catch {
      // No upstream — this is normal
    }

    try {
      const json = execSync('gh repo view --json parent --jq ".parent | .owner.login + \\"/\\" + .name"', { cwd, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      // Validate "owner/repo" format (reject null/null, /, empty strings)
      if (json && json.match(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)) {
        return json;
      }
    } catch {
      // Ignore gh failure
    }

    return null;
  }

  /** Manually set the issue repo for a session */
  setIssueRepo(id: string, issueRepo: string): Session {
    const row = this.db.getSession(id);
    if (!row) {
      throw new NotFoundException(`Session not found: ${id}`);
    }
    this.db.updateSession(id, { issue_repo: issueRepo });
    const updated = this.db.getSession(id)!;
    const session = toSession(updated);
    this.eventEmitter.emit('session.updated', session);
    this.logger.log(`Issue repo set: session=${id}, issueRepo=${issueRepo}`);
    return session;
  }

  /** Get the effective issue repo for a session (issueRepo → repo → null) */
  getEffectiveIssueRepo(id: string): string | null {
    const row = this.db.getSession(id);
    if (!row) return null;
    return (row.issue_repo || row.repo) as string | null;
  }

  // ─────────────────────────────────────────────
  // Workspace
  // ─────────────────────────────────────────────

  /** Create a workspace */
  createWorkspace(opts: { name: string; description?: string }): Workspace {
    const id = uuidv4();
    this.db.insertWorkspace({ id, name: opts.name, description: opts.description });
    this.logger.log(`Workspace created: id=${id}, name=${opts.name}`);
    const sessions = this.db.listSessionsByWorkspace(id).map((r) => toSession(r));
    const ws: Workspace = {
      id,
      name: opts.name,
      description: opts.description,
      ghProfile: undefined,
      sessions,
      createdAt: new Date().toISOString(),
    };
    this.eventEmitter.emit('workspace.created', ws);
    return ws;
  }

  /** List all workspaces */
  listWorkspaces(): Workspace[] {
    const rows = this.db.listWorkspaces();
    return rows.map((row) => {
      const sessions = this.db.listSessionsByWorkspace(row.id).map((r) => toSession(r));
      return {
        id: row.id,
        name: row.name,
        description: row.description || undefined,
        ghProfile: row.gh_profile || undefined,
        sessions,
        createdAt: row.created_at,
      };
    });
  }

  /** Delete a workspace (CASCADE deletes its sessions too) */
  deleteWorkspace(id: string): void {
    const ws = this.db.getWorkspace(id);
    if (!ws) {
      throw new NotFoundException(`Workspace not found: ${id}`);
    }
    this.db.deleteWorkspace(id);
    this.logger.log(`Workspace deleted: ${id}`);

    // Clear active workspace if it was the deleted one
    const activeWsId = this.getActiveWorkspaceId();
    if (activeWsId === id) {
      const remaining = this.db.listWorkspaces();
      this.db.setAppState('activeWorkspaceId', remaining.length > 0 ? remaining[0].id : null);
    }

    this.eventEmitter.emit('workspace.deleted', { workspaceId: id });
  }

  /** Switch the active workspace */
  switchWorkspace(id: string): void {
    const ws = this.db.getWorkspace(id);
    if (!ws) {
      throw new NotFoundException(`Workspace not found: ${id}`);
    }
    this.db.setAppState('activeWorkspaceId', id);

    // Set the first active session in the target workspace as the active session
    const sessions = this.db.listSessionsByWorkspace(id);
    const first = sessions.find((s) => s.status === 'active') ?? sessions[0] ?? null;
    this.db.setAppState('activeSessionId', first ? first.id : null);

    this.logger.log(`Workspace switched: ${id} (activeSession=${first?.id ?? 'null'})`);
    this.eventEmitter.emit('workspace.switched', { workspaceId: id });
  }

  /** Rename a workspace */
  renameWorkspace(id: string, name: string): Workspace {
    const ws = this.db.getWorkspace(id);
    if (!ws) {
      throw new NotFoundException(`Workspace not found: ${id}`);
    }
    this.db.updateWorkspace(id, { name });
    const updated = this.db.getWorkspace(id)!;
    const sessions = this.db.listSessionsByWorkspace(id).map((r) => toSession(r));
    const result: Workspace = {
      id: updated.id,
      name: updated.name,
      description: updated.description || undefined,
      ghProfile: updated.gh_profile || undefined,
      sessions,
      createdAt: updated.created_at,
    };
    this.eventEmitter.emit('workspace.updated', result);
    return result;
  }

  /** Set the gh profile for a workspace */
  setGhProfile(workspaceId: string, ghProfile: string | null): Workspace {
    const ws = this.db.getWorkspace(workspaceId);
    if (!ws) {
      throw new NotFoundException(`Workspace not found: ${workspaceId}`);
    }
    this.db.updateWorkspace(workspaceId, { gh_profile: ghProfile });
    const updated = this.db.getWorkspace(workspaceId)!;
    const sessions = this.db.listSessionsByWorkspace(workspaceId).map((r) => toSession(r));
    const result: Workspace = {
      id: updated.id,
      name: updated.name,
      description: updated.description || undefined,
      ghProfile: updated.gh_profile || undefined,
      sessions,
      createdAt: updated.created_at,
    };
    this.eventEmitter.emit('workspace.updated', result);
    this.logger.log(`gh profile set: workspace=${workspaceId}, ghProfile=${ghProfile}`);
    return result;
  }

  /** Get the gh profile for the workspace that owns a session */
  getGhProfileForSession(sessionId: string): string | null {
    const row = this.db.getSession(sessionId);
    if (!row?.workspace_id) return null;
    const ws = this.db.getWorkspace(row.workspace_id);
    return ws?.gh_profile || null;
  }

  /** Get the current active workspace ID */
  getActiveWorkspaceId(): string | null {
    return this.db.getAppState('activeWorkspaceId') ?? null;
  }

  /** Auto-create the default GuiPane (issue slot) when a session is created */
  private createDefaultGuiPane(sessionId: string, issueRepo: string): void {
    const guiPaneId = `gui-${sessionId}`;
    const slotId = uuidv4();
    const now = new Date().toISOString();

    this.db.insertViewPane({
      id: guiPaneId,
      view_type: 'issue',
      session_id: sessionId,
      meta: JSON.stringify({ repo: issueRepo, mode: 'list' }),
      active_slot_id: slotId,
      created_at: now,
    });

    this.db.insertSlot({
      id: slotId,
      gui_pane_id: guiPaneId,
      view_type: 'issue',
      data: JSON.stringify({ repo: issueRepo, mode: 'list' }),
      label: null,
      created_at: now,
    });

    this.logger.log(`Default GuiPane created: session=${sessionId}, guiPane=${guiPaneId}, slot=${slotId}`);
  }

  /** Internal helper to update session status */
  private updateStatus(id: string, status: SessionStatus): Session {
    const row = this.db.getSession(id);
    if (!row) {
      throw new NotFoundException(`Session not found: ${id}`);
    }
    this.db.updateSession(id, { status });
    const updated = this.db.getSession(id)!;
    const session = toSession(updated);
    this.eventEmitter.emit('session.updated', session);
    return session;
  }
}
