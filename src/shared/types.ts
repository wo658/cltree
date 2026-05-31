/**
 * Shared type definitions for the cltree frontend and backend.
 *
 * Covers CLI responses, WebSocket messages, and domain models.
 * All HTTP/WebSocket communication is serialized/deserialized against these types.
 */

// ─────────────────────────────────────────────
// Domain models
// ─────────────────────────────────────────────

/** Session status */
export type SessionStatus = 'active' | 'completed' | 'archived';

/** Pane type */
export type PaneType = 'agent' | 'terminal';

/** Pane execution status */
export type PaneStatus = 'running' | 'idle' | 'busy' | 'done' | 'error' | 'exited';

/** Context message type */
export type ContextMessageType = 'message' | 'data' | 'event';

/** View slot type */
export type ViewSlotType =
  | 'issue'
  | 'config'
  | 'explain'
  | 'preview'
  | 'diff'
  | 'filesearch';

/** Workspace = session group (multi-directory work unit) */
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  /** gh CLI profile (gh auth login account name). Injected as GH_TOKEN when spawning PTYs. */
  ghProfile?: string;
  sessions: Session[];
  createdAt?: string;
}

/** Session */
export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  repo?: string;
  /** Issue tracking repo (may differ from repo, e.g. fork → upstream). Falls back to repo if not set. */
  issueRepo?: string;
  cwd: string;
  workspaceId?: string;
  parentSessionId?: string;
  issueNumber?: number;
  worktreePath?: string;
  branch?: string;
  children: Session[];
  panes: PaneRef[];
  createdAt?: string;
}

/** Pane reference (Agent or Terminal) */
export interface PaneRef {
  id: string;
  type: PaneType;
  cmd: string;
  /** Pane-specific working directory. Falls back to the session cwd if not set. */
  cwd?: string;
  status: PaneStatus;
  sessionId: string;
}

// ─────────────────────────────────────────────
// Per-view data types
// ─────────────────────────────────────────────

/** Issue View data */
export interface IssueViewData {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: { name: string; color: string }[];
  assignees: string[];
  body: string;
  comments: { author: string; body: string; createdAt: string }[];
}

/** Session Detail View data */
export interface SessionDetailData {
  session: Session;
  panes: PaneRef[];
  children: { session: Session; panes: PaneRef[] }[];
}

/** Diagram View data */
export interface DiagramViewData {
  source: string;
}

/** Preview View data */
export interface PreviewViewData {
  url: string;
  title?: string;
  status?: 'loading' | 'ready' | 'error';
  errorMessage?: string;
}

/** Individual file entry in a Diff View */
export interface DiffFileEntry {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U';
  /** Original path if renamed */
  oldPath?: string;
  language: string;
  /** File content at HEAD (committed version) */
  originalContent: string;
  /** Current working tree content */
  modifiedContent: string;
}

/** Diff View data */
export interface DiffViewData {
  sessionId: string;
  cwd: string;
  files: DiffFileEntry[];
  /** Currently selected file index */
  currentFileIndex: number;
  /** Diff scope: all changes relative to HEAD (staged + unstaged + untracked) */
  diffMode: 'all';
  /** Timestamp of the last refresh */
  refreshedAt: string;
}

/** File Change Tracker View data */
export interface FilesViewData {
  sessionId: string;
  files: {
    path: string;
    status: 'M' | 'A' | 'D' | 'R';
    additions: number;
    deletions: number;
  }[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
}

/** Markdown View data */
export interface MarkdownViewData {
  content: string;
}

/** Code annotation (inline explanation for a specific line) */
export interface CodeAnnotation {
  /** Line number (1-based within the snippet) */
  line: number;
  /** End line when specifying a range (omit for single line) */
  endLine?: number;
  /** Explanation text for the line */
  text: string;
}

/** Explain step */
export interface ExplainStep {
  index: number;
  /** Markdown explanation text */
  markdown: string;
  /** File reference (e.g. "src/auth.ts:10-25") */
  codeRef?: string;
  /** Code content resolved by the server */
  codeSnippet?: string;
  /** Syntax highlighting language hint */
  language?: string;
  /** Line numbers to highlight (1-based, relative to snippet) */
  highlightLines?: number[];
  /** Inline annotations for specific lines */
  annotations?: CodeAnnotation[];
  /** Mermaid diagram source (renders a diagram instead of a code viewer when present) */
  mermaid?: string;
}

/** Explain View data */
export interface ExplainViewData {
  title: string;
  currentStep: number;
  steps: ExplainStep[];
  /** Whether the agent has finished adding steps */
  completed: boolean;
}

/** Single file search result */
export interface FileSearchResult {
  /** Path relative to the session cwd */
  path: string;
  /** Matched line number in content mode (1-based) */
  lineNumber?: number;
  /** Matched line content in content mode */
  lineContent?: string;
}

/** FileSearch View data */
export interface FileSearchViewData {
  query?: string;
  mode?: 'filename' | 'content';
  results?: FileSearchResult[];
  /** Search root directory (session cwd) */
  cwd?: string;
}

/** View type → data type mapping */
export interface ViewDataMap {
  issue: IssueViewData;
  'session-detail': SessionDetailData;
  diagram: DiagramViewData;
  preview: PreviewViewData;
  files: FilesViewData;
  markdown: MarkdownViewData;
  explain: ExplainViewData;
  diff: DiffViewData;
  filesearch: FileSearchViewData;
}

// ─────────────────────────────────────────────
// Worktree
// ─────────────────────────────────────────────

/** Worktree information */
export interface WorktreeInfo {
  path: string;
  branch: string;
  sessionId: string;
  issueNumber?: number;
}

// ─────────────────────────────────────────────
// Context messages
// ─────────────────────────────────────────────

/** Cross-session context message */
export interface ContextMessage {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  type: ContextMessageType;
  content: string;
  timestamp: string;
}

// ─────────────────────────────────────────────
// Agent history
// ─────────────────────────────────────────────

/** Agent conversation entry */
export interface AgentHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ─────────────────────────────────────────────
// PR
// ─────────────────────────────────────────────

/** Pull request information */
export interface PrInfo {
  number: number;
  url: string;
  title: string;
  branch: string;
}

/** Merge conflict information */
export interface MergeConflictInfo {
  branch: string;
  mainBranch: string;
  files: string[];
  diff: string;
}

// ─────────────────────────────────────────────
// CLI request / response
// ─────────────────────────────────────────────

/** CLI request (HTTP POST /api/cli) */
export interface CliRequest {
  cmd: string[];
}

/** CLI action (next available action) */
export interface CliAction {
  cmd: string[];
  desc: string;
}

/** CLI response */
export interface CliResponse<T = unknown> {
  ok: boolean;
  data: T;
  actions: CliAction[];
  error?: string;
}

// ─────────────────────────────────────────────
// CLI domain response data types
// ─────────────────────────────────────────────

/** w list response data */
export interface WorkspaceListData {
  workspaces: Workspace[];
}

/** w create response data */
export interface WorkspaceCreateData {
  workspace: Workspace;
}

/** w delete response data */
export interface WorkspaceDeleteData {
  deleted: string;
}

/** s list response data */
export interface SessionListData {
  sessions: Session[];
}

/** s inspect response data */
export interface SessionInspectData {
  session: Session;
  panes: PaneRef[];
  children: { session: Session; panes: PaneRef[] }[];
}

/** s create response data */
export interface SessionCreateData {
  session: Session;
  spawnedPane?: PaneRef;
}

/** s rename response data */
export interface SessionRenameData {
  session: Pick<Session, 'id' | 'name'>;
}

/** s complete response data */
export interface SessionCompleteData {
  session: Pick<Session, 'id' | 'name' | 'status'>;
  pr: PrInfo | null;
}

/** s archive response data */
export interface SessionArchiveData {
  session: Pick<Session, 'id' | 'name' | 'status'>;
}

/** s delete response data */
export interface SessionDeleteData {
  deleted: string;
}

/** p inspect response data */
export interface PaneInspectData {
  pane: PaneRef | { id: string; type: 'gui'; viewType: ViewSlotType; sessionId: string };
  sessionName: string;
  sessionId: string;
  ptyAlive: boolean;
  ringBufferSize: number;
  /** Included when the pane is a ViewPane */
  viewType?: ViewSlotType;
  viewMeta?: Record<string, unknown>;
}

/** p read response data */
export interface PaneReadData {
  paneId: string;
  type: PaneType | 'gui';
  lines: string[];
  totalChunks: number;
}

/** p write response data */
export interface PaneWriteData {
  paneId: string;
  written: boolean;
}

/** p spawn / p attach response data */
export interface PaneCreateData {
  pane: PaneRef;
}

/** p ls response data */
export interface PaneListData {
  panes: PaneRef[];
}

/** p kill response data */
export interface PaneKillData {
  killed: string;
}

/** p focus response data */
export interface PaneFocusData {
  focused: string;
}

/** p resize response data */
export interface PaneResizeData {
  resized: string;
  width: number;
  height: number;
}

/** p layout response data */
export interface PaneLayoutData {
  layout: string;
}

/** p zoom response data */
export interface PaneZoomData {
  zoomed: string;
  isZoomed: boolean;
}

/** p swap response data */
export interface PaneSwapData {
  swapped: [string, string];
}

/** p history response data */
export interface PaneHistoryData {
  paneId: string;
  entries: AgentHistoryEntry[];
}

/** r attach response data */
export interface RepoAttachData {
  repo: string;
  path: string;
  branch: string;
}

/** r detach response data */
export interface RepoDetachData {
  detached: string;
}

/** r info response data */
export interface RepoInfoData {
  repo: string;
  path: string;
  branch: string;
  status: string;
  remoteUrl: string;
  worktreeCount: number;
}

/** r worktrees response data */
export interface RepoWorktreesData {
  worktrees: WorktreeInfo[];
}

/** r cleanup response data */
export interface RepoCleanupData {
  cleaned: { path: string; reason: string }[];
}

/** ctx send response data */
export interface CtxSendData {
  message: ContextMessage;
}

/** ctx history response data */
export interface CtxHistoryData {
  sessionId: string;
  messages: ContextMessage[];
}

/** cfg get response data (all keys) */
export interface ConfigGetAllData {
  config: Record<string, unknown>;
}

/** cfg get response data (specific key) */
export interface ConfigGetKeyData {
  key: string;
  value: unknown;
}

/** cfg set response data */
export interface ConfigSetData {
  key: string;
  value: unknown;
}

/** cfg init response data */
export interface ConfigInitData {
  configPath: string;
  dbPath: string;
  created: boolean;
}

/** cfg cleanup response data */
export interface ConfigCleanupData {
  cleaned: {
    orphanWorktrees: number;
    archivedSessions: number;
    staleSlots: number;
  };
}

/** cfg check response data */
export interface ConfigCheckData {
  node: { version: string; ok: boolean };
  npm: { version: string; ok: boolean };
  git: { version: string; ok: boolean };
  gh: { version: string; ok: boolean; auth: boolean };
}

// ─────────────────────────────────────────────
// WebSocket message types (client → server)
// ─────────────────────────────────────────────

/** PTY input */
export interface WsPtyInput {
  type: 'pty-input';
  paneId: string;
  data: string;
}

/** PTY resize */
export interface WsPtyResize {
  type: 'pty-resize';
  paneId: string;
  cols: number;
  rows: number;
}

/** Subscribe to a session's PTY stream */
export interface WsSubscribe {
  type: 'subscribe';
  sessionId: string;
}

/** Unsubscribe from a session's PTY stream */
export interface WsUnsubscribe {
  type: 'unsubscribe';
  sessionId: string;
}

/** Request ring buffer replay for a specific pane (on Terminal mount) */
export interface WsPtyReplay {
  type: 'pty-replay';
  paneId: string;
}

/** Client → server message union */
export type WsClientMessage =
  | WsPtyInput
  | WsPtyResize
  | WsSubscribe
  | WsUnsubscribe
  | WsPtyReplay;

// ─────────────────────────────────────────────
// WebSocket message types (server → client)
// ─────────────────────────────────────────────

/** PTY output data */
export interface WsPtyOutput {
  type: 'pty-output';
  paneId: string;
  data: string;
}

/** Full state snapshot (on initial connect / reconnect) */
export interface WsState {
  type: 'state';
  data: {
    workspaces?: Workspace[];
    activeWorkspaceId?: string | null;
    sessions: Session[];
    /** Only included on initial connect. Omitted in subsequent broadcasts — managed per tab. */
    activeSessionId?: string | null;
  };
}

/** Session change notification */
export interface WsSessionUpdate {
  type: 'session-update';
  action: 'created' | 'updated' | 'deleted';
  session?: Session;
  sessionId?: string;
}

/** Pane change notification */
export interface WsPaneUpdate {
  type: 'pane-update';
  action: 'created' | 'status-changed' | 'exited' | 'removed';
  pane?: PaneRef;
  paneId?: string;
  status?: PaneStatus;
  exitCode?: number;
}

/** Workspace change notification */
export interface WsWorkspaceUpdate {
  type: 'workspace-update';
  action: 'created' | 'updated' | 'deleted';
  workspace?: Workspace;
  workspaceId?: string;
}

/** Agent status change notification */
export interface WsAgentStatus {
  type: 'agent-status';
  paneId: string;
  status: PaneStatus;
  sessionId: string;
}

/** View slot change notification */
export interface WsViewUpdate {
  type: 'view-update';
  action: 'pushed' | 'updated' | 'removed';
  guiPaneId: string;
  slot?: ViewSlot;
  slotId?: string;
}

/** Server → client message union */
export type WsServerMessage =
  | WsPtyOutput
  | WsState
  | WsSessionUpdate
  | WsPaneUpdate
  | WsViewUpdate
  | WsWorkspaceUpdate
  | WsAgentStatus;

// ─────────────────────────────────────────────
// WebSocket message full union
// ─────────────────────────────────────────────

/** All WebSocket messages (discriminated union, distinguished by the `type` field) */
export type WsMessage = WsClientMessage | WsServerMessage;

// ─── Layout tree (frontend only) ─────────────

/** Split node */
export interface SplitNode {
  id: string;
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  sizes: number[];
}

/** Leaf node (actual pane) */
export interface LeafNode {
  type: 'leaf';
  paneId: string;
}

export type LayoutNode = SplitNode | LeafNode;

/** Drop position */
export type DropPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

// ─── GUI Pane (Multi-View Slot Container) ────────────

/** Individual view slot inside a GUI pane */
export interface GuiSlot {
  id: string;
  viewType: ViewSlotType;
  data: Record<string, unknown>;
  label?: string;
}

/** GUI container placed in the PaneGrid (multiple views coexist in tabs) */
export interface GuiPane {
  id: string;
  contentType: 'gui';
  sessionId: string;
  /** null when there are no slots */
  activeSlotId: string | null;
  slots: GuiSlot[];
}

/** Server-side ViewSlot (GuiSlot + ownership info) */
export interface ViewSlot {
  id: string;
  guiPaneId: string;
  sessionId: string;
  type: ViewSlotType;
  data: Record<string, unknown>;
  label?: string;
}
