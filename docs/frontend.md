# Frontend Design

## Core Philosophy

1. **Dumb Client** — State and logic are owned by the server. The frontend only handles rendering and event forwarding.
2. **Server-driven State** — WebSocket push -> zustand store -> React re-render
3. **CLI Result Visualization** — View components render JSON delivered by the server.
4. **Unidirectional Flow** — UI action -> HTTP -> server processing -> WS push -> Store -> UI (UI never directly mutates the store)
5. **Terminal-native Feel** — zinc dark theme, seamless boundary with xterm.js

---

## Tech Stack

| Category | Choice | Rationale |
|----------|--------|-----------|
| Framework | React 18 | Ecosystem, xterm.js integration |
| Build | Vite | Fast HMR |
| State Management | Zustand (slice pattern) | Lightweight, optimal for WS events -> store |
| UI | shadcn/ui + Tailwind CSS | zinc dark, highly customizable |
| Terminal | @xterm/xterm + addon-webgl + addon-fit | Same stack as VS Code |
| Layout | react-resizable-panels | Drag-to-split, nesting, serialization |

---

## Folder Structure

```
src/web/
├── index.html
├── main.tsx                        # React entry point
├── App.tsx                         # Root component
├── components/
│   ├── ui/                         # shadcn/ui base components
│   ├── common/
│   │   └── MarkdownRenderer.tsx    # Shared markdown renderer
│   ├── layout/
│   │   ├── AppShell.tsx            # Top-level layout (sidebar + pane grid)
│   │   ├── PaneGrid.tsx            # react-resizable-panels wrapper
│   │   ├── PaneContainer.tsx       # PTY pane container
│   │   ├── GuiPaneContainer.tsx    # GUI pane container (multi-view slot)
│   │   ├── ViewPaneContainer.tsx   # View tab switching + dynamic rendering
│   │   ├── PaneSlot.tsx
│   │   ├── SplitPane.tsx
│   │   └── DropZoneOverlay.tsx
│   ├── sidebar/
│   │   ├── Sidebar.tsx             # Sidebar root
│   │   ├── SessionTree.tsx         # Session/sub-session tree + Agent status badges
│   │   └── WorkspaceSelector.tsx   # Workspace switcher
│   ├── terminal/
│   │   └── Terminal.tsx            # xterm.js instance wrapper
│   ├── views/                      # View components inside GUI pane
│   │   ├── IssueView.tsx           # GitHub issue/PR view
│   │   ├── IssueListView.tsx       # Issue list view
│   │   ├── ExplainView.tsx         # Step-by-step code explanation + Mermaid diagrams
│   │   ├── DiffView.tsx            # git diff inline viewer
│   │   ├── FileSearchView.tsx      # File/content search view
│   │   ├── PreviewView.tsx         # iframe web app preview
│   │   ├── ConfigView.tsx          # Settings view
│   │   └── explain/
│   │       ├── ExplainCodeViewer.tsx
│   │       ├── ExplainStepper.tsx
│   │       └── MermaidDiagram.tsx
│   └── modals/
│       ├── CreateSessionModal.tsx  # Session creation modal
│       └── CompleteSessionModal.tsx
├── stores/
│   ├── index.ts                    # Zustand store composition (slice combination)
│   ├── sessionSlice.ts             # Session/workspace state
│   └── paneSlice.ts                # Pane list + layout + GUI pane slots
├── hooks/
│   ├── useWebSocket.ts             # WS connection management + event dispatch
│   ├── useTerminal.ts              # xterm.js instance lifecycle
│   ├── useKeyboard.ts              # Keyboard shortcuts
│   └── useCli.ts                   # HTTP POST /api/cli wrapper
├── lib/
│   ├── utils.ts                    # Common utilities (cn, etc.)
│   ├── ws-client.ts                # WebSocket client (reconnect, message parsing)
│   ├── api-client.ts               # HTTP client (fetch wrapper)
│   └── persist-layout.ts           # Layout local persistence
├── mocks/
│   ├── mock-server.ts              # Dev mock WebSocket + HTTP server
│   ├── handlers.ts                 # MSW handler definitions
│   └── data/                       # Mock data fixtures
├── styles/
│   └── globals.css                 # Tailwind base + global styles
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── components.json                 # shadcn/ui config
```

---

## Data Flow

### Server -> Frontend (real-time state)

```
NestJS WebSocket Gateway
  │
  │  WS push (JSON message)
  ▼
ws-client.ts
  │  Dispatch by message type
  ▼
Zustand Store (slices)
  │  sessionSlice / paneSlice / viewSlice
  ▼
React components (subscribed via selectors)
  │  Re-render
  ▼
Browser screen
```

### Frontend -> Server (user actions)

```
UI button click / session tree click
  │
  ▼
useCli() hook call
  │  POST /api/cli { cmd: ["s", "switch", "<id>"] }
  ▼
NestJS HTTP Controller
  │  CLI parsing -> Service call
  ▼
State change (SQLite + PTY)
  │
  ▼
WebSocket push -> Store -> UI update
```

### PTY I/O Streaming

```
node-pty (server)
  │  onData callback
  ▼
pty.gateway.ts (WebSocket)
  │  Binary/text stream
  ▼
Terminal.tsx (xterm.js)
  │  terminal.write(data)
  ▼
xterm.js rendering (WebGL)

xterm.js onData (user key input)
  │
  ▼
WebSocket -> pty.gateway.ts
  │
  ▼
node-pty.write(data) -> PTY process
```

Key principle: **The frontend never directly mutates state.** All state changes go through the server and return via WS push.

---

## Core Component Design

### Terminal.tsx

Component that manages xterm.js terminal instances.

- **Role**: Render PTY output + forward user key input
- **Props**: `paneId: string` (PTY identifier)
- **Internal state**: Manages xterm.js `Terminal`, `WebglAddon`, and `FitAddon` instances via `useRef`
- **Lifecycle**:
  1. Mount: Create xterm.js instance -> Load WebGL/Fit addons -> Attach to DOM
  2. PTY subscription: Subscribe to the PTY stream for the given `paneId` via `ws-client`
  3. Data reception: Call `terminal.write(data)`
  4. Key input: `terminal.onData` -> Send to PTY over WebSocket
  5. Resize: `ResizeObserver` + `fitAddon.fit()` -> Send cols/rows to server
  6. Unmount: Unsubscribe from PTY stream, dispose xterm.js
- **On session switch**: Unsubscribe -> Subscribe to new PTY -> Replay scrollback buffer

### PaneGrid.tsx

Wraps react-resizable-panels to build a split-pane layout for PTY panes.

- **Role**: Pane splitting/resizing, nested splits supported
- **Props**: None (subscribes to layout from paneSlice)
- **State management**: Reads split structure from `paneSlice.layout`, sends drag results to the server
- **Layout serialization**: Matches the format stored by the server in SQLite; restorable on restart
- **Nesting**: Recursively places `PanelGroup` inside `PanelGroup`

### PaneContainer.tsx

Container for individual panes. Branches on pane type to render the appropriate inner component.

- **Role**: Renders `Terminal.tsx` based on pane type (agent/terminal)
- **Props**: `paneId: string`
- **Focus**: On click, updates `paneSlice.focusedPaneId` (notifies server)

### AppShell.tsx

Top-level layout. Splits sidebar (left) + PaneGrid (right).

- **Role**: Overall layout frame
- **Structure**: `PanelGroup` > `Panel(sidebar)` + `PanelResizeHandle` + `Panel(PaneGrid)`

### Sidebar.tsx

Sidebar root. Combines SessionTree (top) + ViewSlot (bottom).

- **Role**: Session navigation/switching + View slot display
- **Props**: None (subscribes from store)

### SessionTree.tsx

Renders the session/sub-session tree.

- **Role**: Display session tree, switch sessions on click, Agent status badges
- **State management**: Subscribes to `sessionSlice.sessions`
- **Session switching**: Click -> `useCli().exec(["s", "switch", id])` -> Server switches PTY stream -> WS push updates `activeSessionId`
- **Agent status badges**: Inline display (● busy / ● idle / ● done / ● error)
- **Action buttons**: `+new` (open CreateSessionModal), `x del` (confirm session deletion)

### ViewSlot.tsx

View tab area at the bottom of the sidebar. Dynamically renders the active View.

- **Role**: View tab switching, dynamic View component loading
- **State management**: Subscribes to `viewSlice.viewSlots`, current tab determined by `viewSlice.activeViewTab`
- **View mapping**: Branches to IssueView / SessionDetailView / DiagramView etc. based on `type` field

### IssueView (v1)

Renders GitHub issues/PRs as a structured view.

- **Role**: Issue title, label badges, body, comment list, action buttons
- **Data source**: Subscribes to the slot's data from `viewSlice`
- **Action buttons**: [Worktree] -> `cltree s create --parent <id> --issue {n} --spawn`, [Close] -> `gh issue close {n}`, [Comment] -> Comment input modal

### SessionDetailView (v1)

Displays the full structure of the current session.

- **Role**: Session metadata (repo, cwd, branch), pane list (type/status/command), sub-session list
- **Data source**: Subscribes to the slot's data from `viewSlice`
- **Action buttons**: [Spawn Agent] -> `cltree p spawn`, [Attach Term] -> `cltree p attach`

### DiagramView (v2)

Renders Mermaid code as an SVG diagram.

- **Role**: Parse Mermaid code + render SVG
- **Data source**: Subscribes to Mermaid source from `viewSlice`
- **Dependencies**: `mermaid` library

### PreviewView (v2)

Embeds a web app in an iframe.

- **Role**: Display a given URL in an iframe
- **Action buttons**: [Reload], [Open External]

### FileTrackerView (v2)

Displays changed files in a tree structure.

- **Role**: Renders `git status` + `git diff --stat` results as a file tree
- **Data source**: Changed file list periodically pushed from the server
- **Display**: File path tree + change stats (+/- lines) + status badges (M/A/D)

---

## State Management (Zustand Slices)

A single Zustand store split using the slice pattern. Each slice is updated only by server WS push events.

### sessionSlice

```typescript
interface SessionSlice {
  /** All workspaces */
  workspaces: Workspace[];
  /** Currently active workspace ID */
  activeWorkspaceId: string | null;
  /** Full session list (tree structure) */
  sessions: Session[];
  /** Active session ID for the current tab (managed independently per tab) */
  activeSessionId: string | null;
}
```

- `sessions`: Full session tree delivered by the server. The frontend does not transform it.
- `activeSessionId`: Managed independently per tab (not broadcast by the server; local state)
- Session switch requests are sent via HTTP through `useCli()`. The store is never directly mutated.

### paneSlice

```typescript
interface PaneSlice {
  /** Layout tree (SplitNode | LeafNode) */
  layout: LayoutNode | null;
  /** Currently focused pane ID */
  focusedPaneId: string | null;
  /** GUI pane list (slot containers) */
  guiPanes: GuiPane[];
}
```

- `layout`: Tree structure synchronized with react-resizable-panels. References GuiPane/PTY panes by paneId.
- `guiPanes`: Slot list per GUI pane. Updated by `view-update` WS events.
- View tab switching is a local UI operation (changes `guiPane.activeSlotId`)

---

## Mock Strategy

A mock system for developing and testing the frontend independently without a server during development.

### Setup

- `mock-server.ts`: Initializes mock WebSocket server + HTTP mock handlers
- `handlers.ts`: MSW (Mock Service Worker) handler definitions. Mocks HTTP endpoints such as `/api/cli`
- `data/`: Fixture data for sessions, panes, views, etc.

### How It Works

```
Vite dev server
  │
  ├── import.meta.env.DEV && MOCK=true
  │   ├── Start MSW (HTTP mock)
  │   └── Start mock WebSocket server (WS mock)
  │
  └── Frontend code behaves identically
      ├── api-client.ts -> MSW intercepts and returns mock responses
      └── ws-client.ts -> Mock WS server pushes events
```

### Production Build

- Mock code is tree-shaken out when the `MOCK` env var is not set
- Mock code is not included in the production bundle

---

## WebSocket Message Protocol

List of WS message types handled by the frontend. All messages are server -> client direction (except PTY I/O).

| Event | Payload | Target Slice |
|-------|---------|--------------|
| `session:list` | `Session[]` | sessionSlice |
| `session:switched` | `{ id: string }` | sessionSlice |
| `session:created` | `Session` | sessionSlice |
| `session:deleted` | `{ id: string }` | sessionSlice |
| `session:updated` | `Session` | sessionSlice |
| `pane:list` | `Pane[]` | paneSlice |
| `pane:created` | `Pane` | paneSlice |
| `pane:removed` | `{ id: string }` | paneSlice |
| `pane:status` | `{ id: string, status: string }` | paneSlice |
| `pane:focused` | `{ id: string }` | paneSlice |
| `layout:updated` | `PanelLayout` | paneSlice |
| `view-update` (pushed) | `{ guiPaneId, slot: ViewSlot }` | paneSlice |
| `view-update` (updated) | `{ guiPaneId, slot: ViewSlot }` | paneSlice |
| `view-update` (removed) | `{ guiPaneId, slotId }` | paneSlice |
| `workspace-update` | `Workspace` | sessionSlice |
| `agent-status` | `{ paneId, status, sessionId }` | paneSlice |
| `pty:output` | `{ paneId: string, data: string }` | Terminal.tsx direct |
| `pty:exit` | `{ paneId: string, code: number }` | paneSlice |

---

## Live Reconnect

Flow for reconnecting to the existing server when a browser tab is closed or refreshed.

1. `ws-client.ts` detects WebSocket disconnection
2. Attempts to reconnect with exponential backoff
3. On successful connection, requests `session:list` + `pane:list` + `view:list`
4. Server pushes the entire current state
5. PTY scrollback buffer for the active session is replayed
6. Store updated -> UI restored

---

## References

- [Architecture](architecture.md): Overall system design
- [Pane & View](panes.md): Detailed pane/view design
- [Session](session.md): Session/sub-session design
