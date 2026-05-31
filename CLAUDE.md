# cltree Development Guide

A CLI-first multi-agent orchestrator. PTY management with node-pty + web rendering with React/xterm.js.

## Core Principles

1. **CLI = the only interface**: Every feature is reachable through the `cltree` CLI. The web UI is just a visualization layer on top of the CLI.
2. **Web UI = a GUI for the CLI**: Visualizes results/state and exposes actions as buttons. It owns no logic or state of its own.
3. **Main process = single source of truth**: CLI → HTTP → main process → SQLite/PTY → reflected back to the web UI.
4. **Sidebar = session/sub-session management only**: Always pinned to the left. Pane/slot management does not belong in the sidebar.
5. **Session = one directory**: A sub-session is either a worktree branch or a child session sharing the same directory.
6. **Switching sessions = switching the PTY stream subscription**: Processes stay alive — only the PTY the frontend listens to changes.
7. **node-pty = the PTY management layer**: Every terminal process is managed by node-pty. xterm.js handles rendering only.
8. **Pane spawn/kill = CLI**: Web UI buttons are reserved for multi-step automation (issue → worktree → session).
9. **Single Node.js process**: HTTP server + WebSocket + PTY management + SQLite all live in one process.
10. **Session binding is required**: Every pane and GUI pane must be bound to a session. Agent PTYs detect their own session automatically via the `CLTREE_SESSION_ID` environment variable. When the CLI client omits `--session`, this env var is injected automatically.

Design docs: [docs/](docs/) — [Architecture](docs/architecture.md) · [Sessions](docs/session.md) · [Pane & View](docs/panes.md) · [Frontend](docs/frontend.md)

## Tech Stack

- Node.js 18+ / TypeScript
- NestJS (server framework, unifying WebSocket/HTTP/CLI)
- React 18+ (web UI), xterm.js (terminal rendering)
- shadcn/ui + Tailwind CSS (UI components, zinc dark theme — visually consistent with the terminal)
- node-pty (PTY management, battle-tested by VS Code)
- better-sqlite3 (state persistence)
- react-resizable-panels (split panes)
- Vite (frontend build), nest build (server build)
- Electron (desktop app, planned)

## Directory Structure

```
src/
├── server/                     # NestJS server
│   ├── main.ts                 # NestJS bootstrap + open browser
│   ├── app.module.ts           # Root module
│   ├── cli/                    # CLI module
│   │   ├── cli.module.ts
│   │   ├── cli.controller.ts   # POST /api/cli single endpoint (handles all CLI commands)
│   │   └── fs-handler.ts       # Filesystem-related CLI handlers
│   ├── session/                # Session module
│   │   ├── session.module.ts
│   │   ├── session.controller.ts
│   │   └── session.service.ts
│   ├── pane/                   # Pane module
│   │   ├── pane.module.ts
│   │   ├── pane.controller.ts
│   │   ├── pane.service.ts
│   │   ├── pty-manager.service.ts   # node-pty management
│   │   └── view-pane-registry.ts    # GUI pane slot registry
│   ├── repo/                   # Git/Repo module
│   │   ├── repo.module.ts
│   │   └── repo.service.ts
│   ├── browse/                 # File browsing module
│   │   ├── browse.module.ts
│   │   ├── browse.controller.ts
│   │   └── browse.service.ts
│   ├── diff/                   # Git diff utilities
│   │   └── diff.utils.ts
│   ├── config/                 # Config module
│   │   ├── config.module.ts
│   │   └── config.service.ts
│   ├── db/                     # SQLite module
│   │   ├── db.module.ts
│   │   └── db.service.ts
│   └── gateway/                # WebSocket Gateway
│       ├── gateway.module.ts
│       └── pty.gateway.ts      # PTY I/O streaming
├── shared/
│   └── types.ts                # Shared types (used by both frontend and backend)
└── web/                        # React frontend (Vite)
    ├── index.html
    ├── main.tsx                # React entry point
    ├── App.tsx                 # Root component
    ├── components/
    │   ├── ui/                 # shadcn/ui base components
    │   ├── common/
    │   │   └── MarkdownRenderer.tsx
    │   ├── layout/
    │   │   ├── AppShell.tsx         # Top-level layout (sidebar + pane grid)
    │   │   ├── PaneGrid.tsx         # react-resizable-panels wrapper
    │   │   ├── PaneContainer.tsx    # PTY pane container
    │   │   ├── GuiPaneContainer.tsx # GUI pane container (multi-view slot)
    │   │   ├── ViewPaneContainer.tsx
    │   │   ├── PaneSlot.tsx
    │   │   ├── SplitPane.tsx
    │   │   └── DropZoneOverlay.tsx
    │   ├── sidebar/
    │   │   ├── Sidebar.tsx          # Sidebar root
    │   │   ├── SessionTree.tsx      # Session tree + Agent status badges
    │   │   └── WorkspaceSelector.tsx
    │   ├── terminal/
    │   │   └── Terminal.tsx         # xterm.js instance wrapper
    │   ├── views/                   # View components hosted inside GUI panes
    │   │   ├── IssueView.tsx        # GitHub issue/PR view
    │   │   ├── IssueListView.tsx    # Issue list view
    │   │   ├── ExplainView.tsx      # Step-by-step code explanation + Mermaid diagrams
    │   │   ├── DiffView.tsx         # Inline git diff viewer
    │   │   ├── FileSearchView.tsx   # File/content search view
    │   │   ├── PreviewView.tsx      # iframe web app preview
    │   │   ├── ConfigView.tsx       # Settings view
    │   │   └── explain/
    │   │       ├── ExplainCodeViewer.tsx
    │   │       ├── ExplainStepper.tsx
    │   │       └── MermaidDiagram.tsx
    │   └── modals/
    │       ├── CreateSessionModal.tsx
    │       └── CompleteSessionModal.tsx
    ├── stores/
    │   ├── index.ts            # zustand store composition
    │   ├── sessionSlice.ts     # Session/workspace state
    │   └── paneSlice.ts        # Panes + layout + GUI pane slots
    ├── hooks/
    │   ├── useWebSocket.ts     # WS connection management
    │   ├── useTerminal.ts      # xterm.js lifecycle
    │   ├── useKeyboard.ts      # Keyboard shortcuts
    │   └── useCli.ts           # HTTP POST /api/cli wrapper
    ├── lib/
    │   ├── utils.ts            # Common utilities
    │   ├── ws-client.ts        # WebSocket client
    │   ├── api-client.ts       # HTTP client
    │   └── persist-layout.ts   # Local layout persistence
    ├── mocks/                  # Dev-only mocks (excluded from production)
    │   ├── mock-server.ts
    │   ├── handlers.ts
    │   └── data/
    └── styles/
        └── globals.css         # Tailwind base + global styles
```

## Development Commands

```bash
pnpm install                   # Install dependencies
pnpm dev                       # Run server + web together (dev)
pnpm dev:server                # NestJS server only (watch mode)
pnpm dev:web                   # Vite frontend only (proxies to server)
pnpm dev:mock                  # Mock mode (no backend)
pnpm build                     # Production build (server + web)
pnpm start                     # Run in production
pnpm test                      # Tests (jest for server + vitest for web)
pnpm lint                      # Lint (eslint)
```

## Testing

### Unit tests
```bash
pnpm test                            # All tests
pnpm test -- tests/handler.test.ts   # A specific file
```

### E2E tests
```bash
# 1. Start the main process
cltree &

# 2. Create a session and spawn a pane via the CLI
cltree s create --name test
cltree p spawn --session <id>

# 3. Verify in the browser
# - "test" appears in the session tree
# - Input/output works in the xterm.js terminal
# - PTY processes survive across session switches
```

## UI/UX Principles

1. **Verify in a real browser**: Never assume "it should work" just from reading the code.
2. **Keep the sidebar minimal**: Session tree + `+new` / `×del` only. No big buttons, no complex forms.
3. **Complex input = modal**: Don't embed forms in the sidebar — use a modal.
4. **Visual feedback is mandatory**: Mark the active session with `▶`, and show the current session name in the status bar.
5. **Watch xterm.js settings**: Control fonts and themes through `web.xterm` in `config.yaml`.
6. **Consistent UI theme**: Use the shadcn/ui zinc dark palette. The sidebar (zinc-900) and xterm.js (black) should flow into each other naturally.

## Code Conventions

- Docstrings and comments: English
- Variables/functions: camelCase; classes/types: PascalCase
- TypeScript strict mode
- Keep SQLite DAO logic in `db.service.ts` (no direct SQL in other modules)
- Define CLI commands with NestJS Commander (`cli/`)
- NestJS module layout: one module per feature (`session/`, `pane/`, `repo/`, `browse/`, `config/`)
- Dependency Injection (DI): manage services through the NestJS DI container
- NestJS HTTP + WebSocket Gateway
- Web components are React function components (`components/`)
- `components/` must not import service-layer code (e.g. pty-manager) directly — talk to the server via WebSocket/HTTP
- The frontend holds no state of its own — all data is fetched from the server via WebSocket/HTTP

## Architecture Overview

```
┌─ Browser / Electron ────────────────────────────────────┐
│ Sidebar (React)  │ PaneGrid (react-resizable-panels)    │
│ ┌──────────────┐ │                                      │
│ │ Sessions     │ │  Terminal.tsx (xterm.js)              │
│ │ ▶ myapp      │ │  $ claude (agent)                    │
│ │   backend    │ │  > ...                               │
│ │              │ ├──────────────────────────────────────│
│ │ +new  ×del   │ │  Terminal.tsx (xterm.js)              │
│ │ Session: myapp│ │  $ pnpm dev                          │
│ └──────────────┘ │  > ready on :3000                     │
└──────────────────┴──────────────────────────────────────┘
        │ WebSocket (PTY I/O + state events)
        │ HTTP (CLI commands)
        ▼
┌─ Node.js main process ──────────────────────────────────┐
│ NestJS HTTP/WS Gateway │ Services │ PtyManager │ SQLite │
└─────────────────────────────────────────────────────────┘
```
