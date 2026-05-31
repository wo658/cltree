# cltree

CLI-first multi-agent orchestrator. PTY management via node-pty + React/xterm.js web rendering.

[한국어 문서](README.ko.md)

## Demo

![cltree demo — workspace → session → Claude + Codex agents → GUI panes → worktree](docs/demo/demo.gif)

> A workspace, a session, two AI agents (Claude + Codex) running side by side, GitHub issues as a GUI pane, and an issue branched into its own worktree session — all in a single orchestrator.

Higher-quality MP4: [`docs/demo/demo.mp4`](docs/demo/demo.mp4) · English captions: [`docs/demo/captions.srt`](docs/demo/captions.srt) · Re-record with `pnpm demo` (see [`scripts/demo/README.md`](scripts/demo/README.md))

## Core Principles

- **CLI = Single Interface**: All features accessible via the `cltree` CLI
- **Web UI = CLI Visualization**: Every UI interaction maps to an internal CLI command. No separate logic
- **Agent = CLI User**: Agents invoke `cltree` CLI as a tool — same path as humans
- **Main Process = Single Source of Truth**: CLI → HTTP → main process → SQLite/PTY → Web UI
- **node-pty = PTY Layer**: Agent/Terminal runs in a real node-pty PTY. xterm.js is rendering only

## Architecture

```
cltree (single Node.js process, top-level orchestrator)
├── NestJS HTTP/WS Gateway
│   ├── React bundle static serving (Web UI)
│   ├── HTTP API (CLI command intake)
│   └── WebSocket (PTY I/O streaming + state push)
├── node-pty (PTY process management)
├── SQLite (state persistence)
└── CLI (Commander.js, HTTP client mode)

┌─ Browser / Electron ────────────────────────────────────┐
│ Sidebar (React)  │ PaneGrid (react-resizable-panels)    │
│ ┌──────────────┐ │                                      │
│ │ Sessions     │ │  Terminal (xterm.js)                  │
│ │ ▶ myapp      │ │  $ claude (agent)                    │
│ │   backend    │ │  > ...                               │
│ │              │ ├──────────────────────────────────────│
│ │ +new  ×del   │ │  Terminal (xterm.js)                  │
│ │              │ │  $ pnpm dev                           │
│ │ SlotPanel    │ │  > ready on :3000                     │
│ └──────────────┘ │                                      │
└──────────────────┴──────────────────────────────────────┘
```

→ Details: [docs/architecture.md](docs/architecture.md) · [docs/pty.md](docs/pty.md)

## Data Model

```
CltreeInstance (1 process)
└── Workspace (1:1)
    └── Sessions[]
        └── Session (repo?, issue?, worktree?)
            ├── children[]      — sub-sessions (issue → worktree branch)
            ├── panes[]         — PTY references (Agent/Terminal)
            └── tui_slots[]     — sidebar internal slots
```

- **Workspace**: 1 instance = 1 Workspace. Multiple repo Sessions can coexist
- **Session**: Unit of work. Can attach its own git repo. 1 Session = 1 PTY group
- **Sub-session**: Child session derived from parent — via git worktree or same directory

→ Details: [docs/session.md](docs/session.md)

## PTY Panes + Sidebar Slots

| Type | Role | Created via |
|------|------|-------------|
| **Agent Pane** | AI CLI process (node-pty, real PTY) | `cltree p spawn` |
| **Terminal Pane** | Local process (node-pty, real PTY) | `cltree p attach --cmd "..."` |
| **Sidebar Slot** | CLI output → structured view (React sidebar) | `cltree p push --type <t> --source <s>` |

Sidebar slots include **3 built-in types** (`issue`, `markdown`, `tree`) and
**custom slots** (user-defined in `~/.cltree/slots/`, reusable by agents).

→ Details: [docs/panes.md](docs/panes.md)

## CLI Reference

`cltree <domain> <verb> [flags]` — 2-level hierarchy. Every command **returns possible next actions**.

```
cltree                                   # Start server + open browser
cltree status                            # Status tree
│
├── session (s)                          # Session lifecycle
│   ├── list / create / inspect <id>
│   ├── rename <id> / complete <id> / archive <id>
│
├── pane (p)                             # Pane management (Agent · Terminal · slots)
│   ├── push --type <t> --source <s>     # Add sidebar slot
│   ├── spawn / attach --cmd <cmd>       # Create PTY pane
│   ├── focus <id> / zoom <id>           # Pane control
│   ├── layout <pattern> / resize / swap
│   ├── ls / kill <id>
│   └── slots                            # List slot types
│
├── repo (r)                             # Git repo · worktree
│   ├── attach <repo> / detach / info
│   └── worktrees / cleanup
│
├── ctx (c)                              # Context exchange
│   ├── send --to <id> <msg>
│   └── history <id>
│
└── config (cfg)                         # Configuration
    ├── get [key] / set <key> <value>
    └── init / cleanup / check
```

Common flags: `--json, -j` (for agent parsing) · `--project, -P` · `--config, -c`

→ Details: [docs/cli.md](docs/cli.md)

## Agent Integration

| Pattern | Method | Status |
|---------|--------|--------|
| Agent → Sidebar slot | `cltree p push` | ✓ |
| Agent → new Agent | `cltree p spawn` | ✓ |
| Agent ← other Agent context (pull) | `s inspect` + `p history --last N` + git | ✓ |
| Agent → direct push to existing Agent | real-time push not supported | ✗ |

→ Details: [docs/agent.md](docs/agent.md)

## Configuration

| Scope | Path |
|-------|------|
| Global | `~/.config/cltree/config.yaml` |
| Project | `.cltree/config.yaml` (override) |

→ Details: [docs/config.md](docs/config.md)

## Prerequisites

- **Node.js 20+** (tested on 20–26) and **[pnpm](https://pnpm.io/)** (`npm install -g pnpm`)
- **git**
- **Agent CLI** — at least one of [`claude`](https://docs.claude.com/en/docs/claude-code), `codex`, or `gemini`, installed and authenticated (default: `claude`)
- **[GitHub CLI](https://cli.github.com/) (`gh`)** — required for issue/PR features (`--issue`, `gh issue view ...`); log in once via `gh auth login`

## Installation

> Not yet published to npm — install from source.

```bash
git clone https://github.com/wo658/cltree.git
cd cltree
pnpm install
pnpm build
pnpm link --global   # makes the `cltree` command available globally
```

Then run from any project directory (the directory you launch from becomes the default session cwd):

```bash
cltree    # starts the server + opens the browser
```

> **Local development** (hot reload): `pnpm dev` runs the server (`:4870`) and web UI (`:5173`) together.

## Quick Start

```bash
cltree                                              # Start server + open browser
cltree s create --repo owner/myapp --name "myapp"   # Create session
cltree s create --parent myapp --issue 42 --spawn   # Issue sub-session + Agent
cltree p push --type issue --source "gh issue view 42"  # Show issue in sidebar
cltree s list                                       # Session tree
```

## Tech Stack

- Node.js 20+ / TypeScript
- [NestJS](https://nestjs.com/) (server framework) · [React](https://react.dev/) (Web UI) · [xterm.js](https://xtermjs.org/) (terminal rendering) · [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS (UI components)
- [node-pty](https://github.com/microsoft/node-pty) (PTY management) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (state persistence)
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) (split panes) · [Vite](https://vite.dev/) (frontend build)
- Electron (desktop app, future)

## License

MIT
