/**
 * Database service
 *
 * Manages ~/.cltree/cltree.db via better-sqlite3.
 * All SQL access must go through this service.
 */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────
// snake_case ↔ camelCase mapping helpers
// ─────────────────────────────────────────────

/** camelCase → snake_case */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/** snake_case → camelCase */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Convert TS object → DB row (snake_case) */
export function toDbRow(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[toSnakeCase(key)] = obj[key];
  }
  return result;
}

/** Convert DB row → TS object (camelCase) */
export function fromDbRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    result[toCamelCase(key)] = row[key];
  }
  return result;
}

// ─────────────────────────────────────────────
// Table creation SQL
// ─────────────────────────────────────────────

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  gh_profile TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  repo TEXT,
  issue_repo TEXT,
  cwd TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE,
  parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  issue_number INTEGER,
  worktree_path TEXT,
  branch TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS panes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  cmd TEXT NOT NULL DEFAULT '',
  cwd TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS view_panes (
  id TEXT PRIMARY KEY,
  view_type TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  meta TEXT DEFAULT '{}',
  active_slot_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gui_slots (
  id TEXT PRIMARY KEY,
  gui_pane_id TEXT NOT NULL REFERENCES view_panes(id) ON DELETE CASCADE,
  view_type TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

// ─────────────────────────────────────────────
// Interfaces (DB row types)
// ─────────────────────────────────────────────

export interface WorkspaceRow {
  id: string;
  name: string;
  description: string;
  gh_profile: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  name: string;
  status: string;
  repo: string | null;
  issue_repo: string | null;
  cwd: string;
  workspace_id: string | null;
  parent_session_id: string | null;
  issue_number: number | null;
  worktree_path: string | null;
  branch: string | null;
  created_at: string;
}

export interface PaneRow {
  id: string;
  type: string;
  cmd: string;
  cwd: string | null;
  status: string;
  session_id: string;
  conversation_id: string | null;
  created_at: string;
}

export interface ViewPaneRow {
  id: string;
  view_type: string;
  session_id: string;
  meta: string;
  active_slot_id: string | null;
  created_at: string;
}

export interface SlotRow {
  id: string;
  gui_pane_id: string;
  view_type: string;
  data: string;
  label: string | null;
  created_at: string;
}

export interface ContextMessageRow {
  id: number;
  from_session_id: string;
  to_session_id: string;
  type: string;
  content: string;
  created_at: string;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;

  /** Prepared statement cache */
  private stmts = new Map<string, Database.Statement>();

  onModuleInit(): void {
    const dbDir = path.join(os.homedir(), '.cltree');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, 'cltree.db');
    this.initDb(dbPath);
  }

  /** Initialize DB (pass ':memory:' in tests) */
  initDb(dbPath: string): void {
    this.stmts.clear();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(CREATE_TABLES);
    this.migrateIfNeeded();
  }

  /** Migrate existing DB schema if needed */
  private migrateIfNeeded(): void {
    // Check if workspace_id column exists in sessions table
    const cols = this.db.pragma('table_info(sessions)') as { name: string }[];
    const hasWorkspaceId = cols.some((c) => c.name === 'workspace_id');
    if (!hasWorkspaceId) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE');
    }

    // Check if gh_profile column exists in workspace table
    const wsCols = this.db.pragma('table_info(workspace)') as { name: string }[];
    const hasGhProfile = wsCols.some((c) => c.name === 'gh_profile');
    if (!hasGhProfile) {
      this.db.exec('ALTER TABLE workspace ADD COLUMN gh_profile TEXT');
    }

    // Check if cwd column exists in panes table
    const paneCols = this.db.pragma('table_info(panes)') as { name: string }[];
    const hasPaneCwd = paneCols.some((c) => c.name === 'cwd');
    if (!hasPaneCwd) {
      this.db.exec('ALTER TABLE panes ADD COLUMN cwd TEXT');
    }
    const hasPaneConversationId = paneCols.some((c) => c.name === 'conversation_id');
    if (!hasPaneConversationId) {
      this.db.exec('ALTER TABLE panes ADD COLUMN conversation_id TEXT');
    }

    // Add active_slot_id column to view_panes table
    const vpCols = this.db.pragma('table_info(view_panes)') as { name: string }[];
    const hasActiveSlotId = vpCols.some((c) => c.name === 'active_slot_id');
    if (!hasActiveSlotId) {
      this.db.exec('ALTER TABLE view_panes ADD COLUMN active_slot_id TEXT');
    }

    // Create gui_slots table if it does not exist in an older DB
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gui_slots (
        id TEXT PRIMARY KEY,
        gui_pane_id TEXT NOT NULL REFERENCES view_panes(id) ON DELETE CASCADE,
        view_type TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        label TEXT,
        created_at TEXT NOT NULL
      )
    `);
  }

  onModuleDestroy(): void {
    this.db.close();
  }

  /** Retrieve a prepared statement (cached) */
  private stmt(sql: string): Database.Statement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  // ─────────────────────────────────────────────
  // App State (key-value)
  // ─────────────────────────────────────────────

  getAppState(key: string): string | undefined {
    const row = this.stmt('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? undefined;
  }

  setAppState(key: string, value: string | null): void {
    this.stmt('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(key, value);
  }

  // ─────────────────────────────────────────────
  // Workspace
  // ─────────────────────────────────────────────

  insertWorkspace(ws: { id: string; name: string; description?: string }): void {
    this.stmt(
      'INSERT INTO workspace (id, name, description, created_at) VALUES (?, ?, ?, ?)',
    ).run(ws.id, ws.name, ws.description || '', new Date().toISOString());
  }

  getWorkspace(id: string): WorkspaceRow | undefined {
    return this.stmt('SELECT * FROM workspace WHERE id = ?').get(id) as WorkspaceRow | undefined;
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.stmt('SELECT * FROM workspace ORDER BY created_at ASC').all() as WorkspaceRow[];
  }

  updateWorkspace(id: string, fields: Record<string, unknown>): void {
    const row = toDbRow(fields);
    const setClauses = Object.keys(row).map((k) => `${k} = @${k}`);
    if (setClauses.length === 0) return;
    const sql = `UPDATE workspace SET ${setClauses.join(', ')} WHERE id = @id`;
    this.stmt(sql).run({ ...row, id });
  }

  deleteWorkspace(id: string): void {
    this.stmt('DELETE FROM workspace WHERE id = ?').run(id);
  }

  // ─────────────────────────────────────────────
  // Sessions
  // ─────────────────────────────────────────────

  insertSession(session: Record<string, unknown>): void {
    const row = toDbRow(session);
    this.stmt(`
      INSERT INTO sessions (id, name, status, repo, issue_repo, cwd, workspace_id, parent_session_id, issue_number, worktree_path, branch, created_at)
      VALUES (@id, @name, @status, @repo, @issue_repo, @cwd, @workspace_id, @parent_session_id, @issue_number, @worktree_path, @branch, @created_at)
    `).run(row);
  }

  getSession(id: string): SessionRow | undefined {
    return this.stmt('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  listSessions(): SessionRow[] {
    return this.stmt('SELECT * FROM sessions ORDER BY created_at ASC').all() as SessionRow[];
  }

  listSessionsByWorkspace(workspaceId: string): SessionRow[] {
    return this.stmt('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId) as SessionRow[];
  }

  updateSession(id: string, fields: Record<string, unknown>): void {
    const row = toDbRow(fields);
    const setClauses = Object.keys(row).map((k) => `${k} = @${k}`);
    if (setClauses.length === 0) return;
    const sql = `UPDATE sessions SET ${setClauses.join(', ')} WHERE id = @id`;
    this.stmt(sql).run({ ...row, id });
  }

  /** Look up a session by short ID (prefix) or full ID */
  findSessionByIdPrefix(idPrefix: string): SessionRow | undefined {
    // Full UUID first
    const exact = this.getSession(idPrefix);
    if (exact) return exact;
    // Prefix matching
    const rows = this.stmt('SELECT * FROM sessions WHERE id LIKE ?').all(`${idPrefix}%`) as SessionRow[];
    return rows.length === 1 ? rows[0] : undefined;
  }

  /** Look up a session by issue_number + workspace */
  findSessionByIssue(workspaceId: string, issueNumber: number): SessionRow | undefined {
    return this.stmt(
      `SELECT * FROM sessions WHERE workspace_id = ? AND issue_number = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    ).get(workspaceId, issueNumber) as SessionRow | undefined;
  }

  deleteSession(id: string): void {
    this.stmt('DELETE FROM sessions WHERE id = ?').run(id);
  }

  // ─────────────────────────────────────────────
  // Panes
  // ─────────────────────────────────────────────

  insertPane(pane: Record<string, unknown>): void {
    const row = toDbRow(pane);
    // Normalize missing conversation_id to null (backward compat with pre-migration callers).
    // better-sqlite3 throws RangeError when a named parameter is missing, so an explicit
    // default is required.
    if (row.conversation_id === undefined) {
      (row as Record<string, unknown>).conversation_id = null;
    }
    this.stmt(`
      INSERT INTO panes (id, type, cmd, cwd, status, session_id, conversation_id, created_at)
      VALUES (@id, @type, @cmd, @cwd, @status, @session_id, @conversation_id, @created_at)
    `).run(row);
  }

  getPane(id: string): PaneRow | undefined {
    return this.stmt('SELECT * FROM panes WHERE id = ?').get(id) as PaneRow | undefined;
  }

  listPanesBySession(sessionId: string): PaneRow[] {
    return this.stmt('SELECT * FROM panes WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as PaneRow[];
  }

  updatePane(id: string, fields: Record<string, unknown>): void {
    const row = toDbRow(fields);
    const setClauses = Object.keys(row).map((k) => `${k} = @${k}`);
    if (setClauses.length === 0) return;
    const sql = `UPDATE panes SET ${setClauses.join(', ')} WHERE id = @id`;
    this.stmt(sql).run({ ...row, id });
  }

  deletePane(id: string): void {
    this.stmt('DELETE FROM panes WHERE id = ?').run(id);
  }

  // ─────────────────────────────────────────────
  // View Panes
  // ─────────────────────────────────────────────

  insertViewPane(vp: { id: string; view_type: string; session_id: string; meta: string; active_slot_id: string | null; created_at: string }): void {
    this.stmt(`
      INSERT OR REPLACE INTO view_panes (id, view_type, session_id, meta, active_slot_id, created_at)
      VALUES (@id, @view_type, @session_id, @meta, @active_slot_id, @created_at)
    `).run(vp);
  }

  getViewPane(id: string): ViewPaneRow | undefined {
    return this.stmt('SELECT * FROM view_panes WHERE id = ?').get(id) as ViewPaneRow | undefined;
  }

  listViewPanesBySession(sessionId: string): ViewPaneRow[] {
    return this.stmt('SELECT * FROM view_panes WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ViewPaneRow[];
  }

  updateViewPane(id: string, fields: Record<string, unknown>): void {
    const row = toDbRow(fields);
    const setClauses = Object.keys(row).map((k) => `${k} = @${k}`);
    if (setClauses.length === 0) return;
    this.stmt(`UPDATE view_panes SET ${setClauses.join(', ')} WHERE id = @id`).run({ ...row, id });
  }

  deleteViewPane(id: string): void {
    this.stmt('DELETE FROM view_panes WHERE id = ?').run(id);
  }

  // ─────────────────────────────────────────────
  // GUI Slots
  // ─────────────────────────────────────────────

  insertSlot(slot: SlotRow): void {
    this.stmt(`
      INSERT INTO gui_slots (id, gui_pane_id, view_type, data, label, created_at)
      VALUES (@id, @gui_pane_id, @view_type, @data, @label, @created_at)
    `).run(slot);
  }

  getSlot(id: string): SlotRow | undefined {
    return this.stmt('SELECT * FROM gui_slots WHERE id = ?').get(id) as SlotRow | undefined;
  }

  /** Look up a slot by short ID (prefix) or full ID */
  findSlotByIdPrefix(idPrefix: string): SlotRow | undefined {
    const exact = this.getSlot(idPrefix);
    if (exact) return exact;
    const rows = this.stmt('SELECT * FROM gui_slots WHERE id LIKE ?').all(`${idPrefix}%`) as SlotRow[];
    return rows.length === 1 ? rows[0] : undefined;
  }

  listSlotsByGuiPane(guiPaneId: string): SlotRow[] {
    return this.stmt('SELECT * FROM gui_slots WHERE gui_pane_id = ? ORDER BY created_at ASC').all(guiPaneId) as SlotRow[];
  }

  listSlotsBySession(sessionId: string): SlotRow[] {
    return this.stmt(`
      SELECT gs.* FROM gui_slots gs
      JOIN view_panes vp ON gs.gui_pane_id = vp.id
      WHERE vp.session_id = ?
      ORDER BY gs.created_at ASC
    `).all(sessionId) as SlotRow[];
  }

  updateSlot(id: string, fields: Record<string, unknown>): void {
    const row = toDbRow(fields);
    const setClauses = Object.keys(row).map((k) => `${k} = @${k}`);
    if (setClauses.length === 0) return;
    const sql = `UPDATE gui_slots SET ${setClauses.join(', ')} WHERE id = @id`;
    this.stmt(sql).run({ ...row, id });
  }

  deleteSlot(id: string): void {
    this.stmt('DELETE FROM gui_slots WHERE id = ?').run(id);
  }

  // ─────────────────────────────────────────────
  // Context Messages
  // ─────────────────────────────────────────────

  insertMessage(msg: Record<string, unknown>): void {
    const row = toDbRow(msg);
    this.stmt(`
      INSERT INTO context_messages (from_session_id, to_session_id, type, content, created_at)
      VALUES (@from_session_id, @to_session_id, @type, @content, @created_at)
    `).run(row);
  }

  getHistory(sessionId: string, limit = 50): ContextMessageRow[] {
    return this.stmt(`
      SELECT * FROM context_messages
      WHERE from_session_id = ? OR to_session_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(sessionId, sessionId, limit) as ContextMessageRow[];
  }
}
