# Architecture

## Core Principle: CLI as the Sole Interface

Every feature in cltree is defined as a CLI command. All other interfaces are simply means to invoke the CLI.

```
Human typing in terminal     Agent typing in PTY          Web UI button click
$ cltree s create ...        $ cltree s create ...        POST /api/cli
         │                           │                        │
         └───────────────────────────┼────────────────────────┘
                                     ▼
                              CLI Parser
                          (nest-commander)
                                     │
                                     ▼
                            NestJS Service
                                     │
                                     ▼
                          PTY / SQLite / Git
```

- **Adding a feature = adding a CLI command.** Humans, agents, and the Web UI all gain access automatically.
- **Agents only need `cltree --help`** to access all functionality. No separate SDK or API required.
- **Web UI buttons = CLI commands made visual.** A button click sends the corresponding CLI command to the server.
- **No business logic in the Web UI.** All state is managed by the server; the UI is responsible for rendering only.

### CLI Installation and Access

Building from source and running `pnpm link --global` installs both the server and the CLI (see the [README](../README.md#installation)).

```json
{ "bin": { "cltree": "./bin/cltree.js" } }
```

After installation, `cltree` is available on PATH — usable from any shell, by humans or agents alike.

```
$ cltree                          ← no args → start the server
$ cltree session create --name x  ← args present → HTTP request to the running instance
```

### The Role of the Web UI

The Web UI provides a GUI layer for two things:

1. **CLI commands as GUI** — button click = CLI command execution
2. **CLI results as GUI** — rich rendering of data returned by CLI/server (issue views, diagrams, file trees, etc.)

Running `cltree s list` in a terminal produces text output; in the Web UI, the same data is rendered as a session tree. The text output of `gh issue view 42` becomes a label badge + comment thread in the Web UI.

| Web UI Action | Under the Hood | Type |
|---------------|----------------|------|
| "New session" button | `cltree s create --name <name>` | Command as GUI |
| Click in session tree | `cltree s switch <id>` | Command as GUI |
| Issue View rendering | `gh issue view 42` result → structured view | Result as GUI |
| Diagram View | Mermaid code → SVG rendering | Result as GUI |
| Session Detail | `cltree s inspect` result → pane/subsession graph | Result as GUI |
| File Tracker | `git status` + `git diff --stat` → file tree | Result as GUI |

Key point: **no proprietary business logic in the Web UI.** All data is managed by the server. The UI receives and renders data, and sends actions as CLI commands.

### Relationship with External Commands

External commands like `gh`, `git`, and `npm` are executed directly in PTY — they do not go through cltree.

```
cltree commands  → CLI Parser → Service → state change    ← managed by cltree
gh, git, npm     → executed directly in PTY               ← cltree not involved
```

However, when external commands need to modify cltree state (e.g., creating a worktree from an issue), they are wrapped in a cltree command and invoked inside the Service.

```
cltree s create --parent <id> --issue 42 --spawn
  → Inside the Service:
     1. gh issue view 42 (fetch info)
     2. git worktree add (create branch)
     3. PTY spawn (start session)
```

---

## Runtime Architecture

cltree runs as a **single Node.js process**. It serves a local web app rendered in the browser, with future support for desktop packaging via Electron.

```
cltree (single Node.js process)
  ├── NestJS HTTP server
  │     ├── /api/cli    ← receives CLI requests (human/agent CLI + Web UI buttons)
  │     └── /static     ← static serving of the React bundle
  ├── WebSocket server   ← real-time sync (PTY I/O streaming + state push)
  ├── node-pty management
  │     ├── pty 0 ── claude agent (PTY)
  │     ├── pty 1 ── zsh (PTY)
  │     └── pty N ── ...
  ├── SQLite (better-sqlite3) ← persistent state
  └── CLI (nest-commander)    ← client mode, sends HTTP requests to the running instance
```

### Rendering Environments

| Environment | Approach | Status |
|-------------|----------|--------|
| **Browser** | `cltree` starts → local HTTP server launches → browser opens automatically | Current |
| **Electron** | Same Node.js process + Electron BrowserWindow | Future |

Both environments render the same React + xterm.js UI. No changes to server logic.

---

## CLI → Server Communication Flow

All state changes pass through the Node.js main process.

```
$ cltree p spawn --session abc123
│
▼
cltree CLI (client mode, nest-commander)
│
├── reads ~/.cltree/cltree.lock → gets PID + port
└── HTTP POST localhost:PORT/api/cli
│
▼
NestJS server (main process)
│
├── parses CLI → calls PaneService.spawn()
├── creates PTY process via node-pty
├── updates SQLite state
├── WebSocket push → React UI update
└── returns HTTP response → CLI prints result
```

- **Lock file** (`~/.cltree/cltree.lock`): records PID + port. Used by the CLI to locate the running instance.
- **HTTP**: CLI ↔ server communication. Request-response pattern.
- **WebSocket**: server → UI real-time push. PTY output streaming + state change notifications.
- **Race condition prevention**: all requests pass through the main process, guaranteeing serialization.

---

## Bootstrap Sequence

1. Environment check (Node.js version)
2. Check lock file (`~/.cltree/cltree.lock`) → error if already running
3. Load config (YAML)
4. Initialize SQLite DB (better-sqlite3, create tables / run migrations)
5. Bootstrap NestJS app (HTTP + WebSocket Gateway) on a random port
6. Write lock file (record PID + port)
7. Open browser (or Electron window)
8. Begin listening for CLI commands (HTTP) and UI connections (WebSocket)

---

## State Synchronization

| Event | Mechanism | Reason |
|-------|-----------|--------|
| Pane CRUD | node-pty events (`onData`, `onExit`) + WebSocket push | node-pty native callbacks |
| Agent state (idle/busy/done) | 1-second polling (ring buffer pattern matching) | Detects prompt patterns in PTY output |
| Session metadata | HTTP API + WebSocket push | Bidirectional sync between CLI and UI |

---

## Module Map

```
┌─────────────┐
│   cli.ts    │  ← nest-commander CLI entry point
└──────┬──────┘
       │ HTTP (reads port from lock file and sends request)
┌──────▼──────────────────────────────────────────────┐
│                 NestJS server layer                  │
│  app.module.ts · session/ · pane/ · repo/           │
│  db/ · config/ · browse/ · cli/ · gateway/          │
└──────┬──────────────────────────────────────────────┘
       │ WebSocket
┌──────▼──────┐     ┌──────────────┐
│  App.tsx    │────▶│  components/ │  ← React (xterm.js + sidebar)
└─────────────┘     └──────────────┘
```

### Module Responsibilities

- `cli/cli.controller.ts`: single `POST /api/cli` endpoint — parses all CLI commands and routes to services
- `cli/fs-handler.ts`: CLI handlers for filesystem operations (file reads, etc.)
- `app.module.ts`: NestJS root module. Statically serves the React bundle
- Each module's controller + service (`session/`, `pane/`, `repo/`, etc.): feature-specific command logic
- `db/db.service.ts`: SQLite DAO (better-sqlite3). Session/pane/slot CRUD. Single source of truth
- `pane/pty-manager.service.ts`: node-pty wrapper. PTY creation, teardown, and stream management
- `pane/view-pane-registry.ts`: GUI pane slot registry
- `gateway/pty.gateway.ts`: WebSocket Gateway. PTY I/O streaming + state push
- `config/config.service.ts`: YAML config loading and merging
- `browse/browse.service.ts`: file browsing (directory traversal, file search)
- `diff/diff.utils.ts`: git diff parsing utilities
- `repo/repo.service.ts`: git worktree / issue / PR integration
- `web/App.tsx` + `components/`: React components. xterm.js terminal + sidebar

---

## Shutdown Sequence

1. Send `SIGTERM` to all PTY processes (or keep alive depending on config)
2. Close WebSocket connections
3. Shut down NestJS HTTP server
4. Delete lock file (`~/.cltree/cltree.lock`)
