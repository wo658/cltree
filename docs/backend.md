# Backend Architecture

A detailed guide to the cltree server implementation. All code lives under `src/server/`.

---

## 1. Core Philosophy

The cltree server handles HTTP, WebSocket, PTY management, and SQLite all within a **single Node.js process**.

- **CLI = the only API**: All functionality is accessed through a single `POST /api/cli` endpoint. Web UI buttons call this same API.
- **Single source of truth**: The main process manages all state. The frontend has no logic or state of its own.
- **Session = one directory**: Sessions map 1:1 to a working directory. Sub-sessions branch off as worktrees.
- **Session switch = stream subscription switch**: PTY processes are kept alive. Only the PTY stream the frontend receives changes.

```
Human/Agent → CLI → HTTP POST /api/cli → CliController → Service → DB/PTY
Web UI button → HTTP POST /api/cli → CliController → Service → DB/PTY
                                                          ↓
                                               EventEmitter2 → PtyGateway → WS → Browser
```

---

## 2. Technology Stack

| Technology | Role | Why chosen |
|------------|------|------------|
| NestJS | Server framework | DI container, module system, HTTP/WS integration |
| node-pty | PTY management | Battle-tested native PTY bindings (used in VS Code) |
| better-sqlite3 | State storage | Synchronous API, WAL mode, single-file DB |
| @nestjs/platform-ws | WebSocket | Raw WS (lightweight, no Socket.IO) |
| @nestjs/event-emitter | Internal events | Loose coupling between services, WS broadcast triggers |
| @nestjs/serve-static | Static file serving | Serve Vite build output from the same process |
| js-yaml | Config loading | YAML config file parsing |

---

## 3. Directory Structure

```
src/server/
├── main.ts                       # NestJS bootstrap, lock file, SIGINT/SIGTERM handling
├── app.module.ts                 # Root module (integrates all feature modules)
│
├── config/                       # Config module (@Global)
│   ├── config.module.ts
│   └── config.service.ts         # YAML deep merge, dot-notation get/set
│
├── db/                           # SQLite module (@Global)
│   ├── db.module.ts
│   └── db.service.ts             # Prepared statement cache, DDL, CRUD
│
├── session/                      # Session module
│   ├── session.module.ts
│   ├── session.service.ts        # create, list (tree), inspect, switchTo, delete (recursive)
│   └── session.controller.ts     # REST /api/sessions (supplementary)
│
├── pane/                         # Pane module
│   ├── pane.module.ts
│   ├── pane.service.ts           # spawn, attach, kill, GUI pane/slot management
│   ├── pane.controller.ts        # REST /api/panes (supplementary)
│   ├── pty-manager.service.ts    # node-pty wrapper, ring buffer, EventEmitter
│   └── view-pane-registry.ts     # GUI pane slot registry (in-memory)
│
├── repo/                         # Git/GitHub module
│   ├── repo.module.ts
│   └── repo.service.ts           # gh issue view, git worktree, branch name generation
│
├── browse/                       # File browsing module
│   ├── browse.module.ts
│   ├── browse.controller.ts
│   └── browse.service.ts         # Directory traversal, file search
│
├── diff/                         # Git diff utilities
│   └── diff.utils.ts             # Parse git diff → DiffViewData
│
├── gateway/                      # WebSocket Gateway
│   ├── gateway.module.ts
│   └── pty.gateway.ts            # PTY I/O streaming, state event broadcasting
│
└── cli/                          # CLI router
    ├── cli.module.ts
    ├── cli.controller.ts         # POST /api/cli single endpoint
    └── fs-handler.ts             # Filesystem-related CLI handlers
```

---

## 4. Module Dependency Graph

```
                    AppModule
                       │
        ┌──────┬───────┼───────┬──────┬──────┬──────┐
        ▼      ▼       ▼       ▼      ▼      ▼      ▼
     Config   Db    Session   Pane   Repo  Context  Gateway
    (@Global) (@Global) │       │                     │
        │      │       │       ├─ PtyManager          │
        └──────┴───────┘       │                      │
         Injectable into        │                      │
         all modules           └──────────────────────┘
                               Connected via EventEmitter2

    CliModule → injects SessionService + PaneService
```

| Module | Injected services | Exports |
|--------|-------------------|---------|
| ConfigModule | — | ConfigService |
| DbModule | ConfigService | DbService |
| SessionModule | DbService, EventEmitter2 | SessionService |
| PaneModule | DbService, ConfigService, EventEmitter2 | PaneService, PtyManagerService |
| RepoModule | ConfigService | RepoService |
| BrowseModule | — | BrowseService |
| GatewayModule | PtyManagerService, PaneService, SessionService, ConfigService | PtyGateway |
| CliModule | SessionService, PaneService, RepoService, ConfigService, DbService, BrowseService, EventEmitter2 | CliController |

---

## 5. Bootstrap Sequence

The `bootstrap()` function in `main.ts`:

1. `NestFactory.create(AppModule)` — initialize the module tree
2. `app.useWebSocketAdapter(new WsAdapter(app))` — raw WS adapter
3. `app.enableCors()` — enable CORS (for Vite dev server integration)
4. `app.enableShutdownHooks()` — graceful shutdown
5. `app.listen(port)` — start HTTP + WS server
6. Ensure `~/.cltree/` directory exists
7. Create `cltree.lock` file (pid, port, startedAt)
8. SIGINT/SIGTERM handler deletes the lock file on exit

OnModuleInit order:
- `ConfigService.onModuleInit()`: Load YAML config (defaults ← global ← project)
- `DbService.onModuleInit()`: Open SQLite connection + run DDL
- `PtyGateway.afterInit()`: Bind PtyManager event listeners

---

## 6. Service Layer

### SessionService

| Method | Description |
|--------|-------------|
| `create(opts)` | Generate UUID → DB insert → emit event → return Session |
| `list()` | Fetch all sessions → assemble tree by parentSessionId → include panes |
| `inspect(id)` | Detailed query: session + panes + slots + children |
| `switchTo(id)` | Update workspace.active_session_id → emit session.switched event |
| `delete(id)` | Recursively delete children → delete pane/slot from DB → emit session.deleted event |
| `rename(id, name)` | Rename session → emit session.updated event |
| `complete(id)` | Set status → 'completed' |
| `archive(id)` | Set status → 'archived' |
| `getActiveSessionId()` | Look up current active session from workspace table |

### PaneService

| Method | Description |
|--------|-------------|
| `spawn(opts)` | Create agent pane. Default cmd: config.agent.defaultCmd ('claude') |
| `attach(opts)` | Create terminal pane. Default cmd: config.terminal.shell or $SHELL |
| `kill(paneId)` | Terminate PTY + delete from DB |
| `list(sessionId)` | Query panes + slots for a session |
| `pushSlot(opts)` | Create a view slot → emit slot.pushed event |
| `removeSlot(slotId)` | Delete a view slot → emit slot.removed event |
| `updateStatus(paneId, status)` | Update pane status (triggered on PTY exit) |
| `killAllBySession(sessionId)` | Kill all panes when a session is deleted |

### PtyManagerService

| Method | Description |
|--------|-------------|
| `spawn(opts)` | Call node-pty.spawn() → register onData/onExit listeners |
| `write(paneId, data)` | Send data to PTY stdin |
| `resize(paneId, cols, rows)` | Resize the terminal |
| `kill(paneId)` | Terminate the PTY process |
| `getRingBuffer(paneId)` | Get the last 1000 output chunks (for WS reconnect replay) |
| `getPaneIdsBySession(sessionId)` | List PTY IDs for a session |
| `on(event, listener)` | Register pty-data / pty-exit event listeners |
| `killAll()` | Terminate all PTY processes (server shutdown) |

### RepoService

| Method | Description |
|--------|-------------|
| `fetchIssue(repo, issueNumber)` | Run `gh issue view` → return IssueViewData |
| `createWorktree(opts)` | Run `git worktree add` + create symbolic links |
| `removeWorktree(path)` | Run `git worktree remove --force` |
| `listWorktrees(repoPath)` | Parse `git worktree list --porcelain` output |
| `generateBranchName(issueNumber, title)` | Produce names like `issue-42-fix-auth-middleware` |

### ContextService

| Method | Description |
|--------|-------------|
| `send(opts)` | DB insert → emit context.sent event |
| `getHistory(sessionId, limit?)` | Fetch messages related to a session (default: 50) |

---

## 7. Database Design

SQLite file: `~/.cltree/cltree.db` (WAL mode, foreign_keys ON)

```sql
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'default',
  description TEXT,
  gh_profile TEXT,
  active_session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',     -- active | completed | archived
  repo TEXT,
  cwd TEXT NOT NULL,
  parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  issue_number INTEGER,
  worktree_path TEXT,
  branch TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE panes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                        -- agent | terminal
  cmd TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',    -- running | idle | busy | done | error | exited
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                        -- issue | config | explain | preview | diff | filesearch
  gui_pane_id TEXT NOT NULL,                 -- owning GUI pane ID
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  data TEXT DEFAULT '{}',                    -- JSON string
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE context_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',      -- message | data | event
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

ER relationships:
```
workspace 1──0..1 sessions (active_session_id)
sessions  1──N    panes    (session_id, CASCADE)
sessions  1──N    slots    (session_id, CASCADE)
sessions  1──N    sessions (parent_session_id, SET NULL)
```

DbService characteristics:
- Prepared statement cache (`Map<string, Statement>`)
- `toDbRow()` / `fromDbRow()` helpers for automatic camelCase ↔ snake_case conversion
- All SQL is centralized in DbService (no direct SQL in other modules)

---

## 8. PTY Management

PtyManagerService maintains an in-memory store of `Map<string, PtyInstance>`.

```typescript
interface PtyInstance {
  id: string;
  process: pty.IPty;       // node-pty process
  sessionId: string;
  ringBuffer: string[];    // last 1000 output chunks
}
```

**Data flow**:
```
User input → WS 'pty-input' → PtyGateway → PtyManager.write() → node-pty stdin
                                                                        ↓
node-pty stdout → PtyManager.onData → EventEmitter 'pty-data'
                                         ↓
                              PtyGateway.broadcastToSession() → WS 'pty-output' → xterm.js
```

**Ring buffer**: Replays recent output on WS reconnect. When a `subscribe` message is received, the ring buffer for all panes in that session is sent.

**Shutdown handling**: Implements `OnModuleDestroy` to automatically clean up all PTY processes when the server shuts down.

---

## 9. WebSocket Protocol

Endpoint: `ws://localhost:3000/ws`

### Client → Server

| type | Fields | Description |
|------|--------|-------------|
| `pty-input` | paneId, data | Forward key input to PTY |
| `pty-resize` | paneId, cols, rows | Resize the terminal |
| `subscribe` | sessionId | Subscribe to a session's PTY stream (replays ring buffer) |
| `unsubscribe` | sessionId | Unsubscribe from a session |

### Server → Client

| type | Trigger | Description |
|------|---------|-------------|
| `state` | On connect / session.switched | Full state snapshot |
| `pty-output` | PtyManager pty-data | PTY output data |
| `session-update` | session.created/updated/deleted | Session change notification |
| `pane-update` | pane.created/exited/statusChanged | Pane change notification |
| `view-update` | slot.pushed/updated/removed | View slot change notification (includes guiPaneId) |
| `workspace-update` | workspace CRUD | Workspace change notification |
| `agent-status` | PtyManager polling | Agent idle/busy/done/error status change |

**Subscription model**: Per-client `Map<WebSocket, Set<sessionId>>`. `pty-output` is sent only to subscribers of that session. State events such as `session-update` are broadcast to all clients.

---

## 10. CLI Integration

Single endpoint: `POST /api/cli`. Request: `{ cmd: ['s', 'list'] }`

CliController parses the command as `[domain, verb, ...args]` and calls the corresponding service method:

```
s list          → SessionService.list()
s inspect <id>  → SessionService.inspect(id)
s create --name → SessionService.create(opts)
s switch <id>   → SessionService.switchTo(id)
s delete <id>   → SessionService.delete(id)
p spawn         → PaneService.spawn(opts)
p attach        → PaneService.attach(opts)
p kill <id>     → PaneService.kill(id)
p ls            → PaneService.list(sessionId)
p push          → PaneService.pushSlot(opts)
p rm <id>       → PaneService.removeSlot(id)
```

`--flag value` parsing is handled by the `getArg()` helper. When `--session` is omitted, `getActiveSessionId()` is used.

Response format: `{ ok, data, actions, error? }` — actions suggest the next available CLI commands.

---

## 11. Error Handling

- **NestJS NotFoundException**: Accessing a non-existent session or pane automatically returns a 404 response.
- **CliController try/catch**: Converts service errors into `{ ok: false, error: message }`.
- **PTY crash**: The `onExit` event cleans up the instance and sends a WS `pane-update` with action `exited`.
- **DB errors**: better-sqlite3's synchronous API throws immediately → handled by the NestJS exception filter.

---

## 12. Configuration System

ConfigService performs a 3-level deep merge:

```
Defaults (DEFAULT_CONFIG) ← Global (~/.config/cltree/config.yaml) ← Project (.cltree/config.yaml)
```

Key configuration options:

| Key | Default | Description |
|-----|---------|-------------|
| `agent.defaultCmd` | `'claude'` | Default command for agent panes |
| `terminal.shell` | `''` (→ $SHELL) | Default shell for terminal panes |
| `terminal.scrollback` | `10000` | Scrollback buffer size |
| `web.port` | `0` (→ 3000) | Server port |
| `web.openBrowser` | `true` | Auto-open browser on startup |
| `worktree.symlinks` | `['node_modules', '.venv', '.env']` | Symlink targets created with each worktree |

---

## 13. Data Model

Frontend/backend shared types are defined in `src/shared/types.ts`.

Core interfaces:
- **Workspace**: id, name, description?, ghProfile?, sessions[]
- **Session**: id, name, status, cwd, repo?, issueRepo?, parentSessionId?, children[], panes[]
- **PaneRef**: id, type(agent|terminal), cmd, cwd?, status, sessionId
- **GuiPane**: id, contentType('gui'), sessionId, activeSlotId, slots[]
- **GuiSlot**: id, viewType(issue|config|explain|preview|diff|filesearch), data, label?
- **ViewSlot**: id, guiPaneId, sessionId, type, data, label?

CLI communication:
- **CliRequest**: `{ cmd: string[] }`
- **CliResponse**: `{ ok, data, actions, error? }`

WebSocket:
- **WsClientMessage**: pty-input | pty-resize | subscribe | unsubscribe
- **WsServerMessage**: pty-output | state | session-update | pane-update | view-update

---

## 14. Python Reference Mapping

Migration table from the previous Python/Textual/tmux architecture to NestJS:

| Python | NestJS |
|--------|--------|
| `tmux` process management | `PtyManagerService` (node-pty) |
| `asyncio` event loop | NestJS EventEmitter2 |
| `textual` TUI | React + xterm.js (web UI) |
| `sqlite3` raw SQL | `DbService` (better-sqlite3, prepared stmt cache) |
| `pyyaml` config | `ConfigService` (js-yaml, deep merge) |
| `subprocess.run` | `child_process.execSync` (RepoService) |
| `tmux capture-pane` | `PtyManagerService.getRingBuffer()` |
| Python decorators | NestJS @Injectable(), @Controller(), @OnEvent() |
