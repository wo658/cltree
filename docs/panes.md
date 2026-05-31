# Pane & View

## Goal: A Workspace Without Alt-Tabbing

Handle everything inside cltree — code writing, issue review, agent management, and build monitoring.

---

## Layout

```
┌─ Browser / Electron ──────────────────────────────────┐
│ Sidebar          │  PaneGrid (react-resizable-panels)   │
│ ┌── sessions ──┐ │  ┌─ xterm.js ──────────────────────┐│
│ │ ▶ myapp      │ │  │ $ claude                        ││
│ │  ├── #42 ●   │ │  │ > modifying auth middleware...  ││
│ │  └── #15 ●   │ │  └─────────────────────────────────┘│
│ ├── views ─────┤ ├─────────────────────────────────────┤
│ │ Issue #42    │ │  ┌─ xterm.js ──────────────────────┐│
│ │ ● open  bug  │ │  │ $ pnpm run dev                  ││
│ │ [Worktree]   │ │  │ > ready on :3000                ││
│ └──────────────┘ │  └─────────────────────────────────┘│
└──────────────────┴─────────────────────────────────────┘
```

- **Sidebar**: Session Tree (session navigation/switching) + View slots + agent notifications
- **PaneGrid**: PTY panes (Agent, Terminal). Split via react-resizable-panels

---

## Sidebar

### Session Tree

Fixed at the top of the sidebar. Session/subsession tree + agent status notifications.

```
┌─ Sessions ──────────────────────┐
│ ▶ myapp (owner/myapp)           │
│   ├── #42 auth-fix [wt]  ● busy│  ← inline status badge
│   ├── #15 refactor        ● idle│
│   └── extra-task          ● done│
│                                 │
│ + new   × del                   │
└─────────────────────────────────┘
```

- Click session = `cltree s switch <id>` (switches PTY stream)
- Agent status shown as **inline badges** only (● busy / ● idle / ● done / ● error)
- No separate agent monitoring panel — minimal notifications, tmux-style

### GUI Pane

A GUI container placed in the PaneGrid. Manages View slots in tabs, with no PTY.
Each GUI pane holds multiple slots and switches between them via tabs.

See: [Implemented Views](#implemented-views).

---

## PTY Pane (Agent / Terminal)

### Agent Pane

An AI CLI process. Spawned via node-pty, rendered with xterm.js.

```bash
cltree p spawn                                    # create agent in current session
cltree p spawn --session <id>                     # create agent in specific session
cltree p spawn --cmd "codex"                      # specify custom agent CLI
cltree p history <agent-id> --last 10             # agent conversation history
cltree p kill <agent-id>                          # terminate agent
```

- Actual AI CLI processes (Claude Code, Codex, Gemini CLI, etc.) run in independent PTYs
- The agent uses the `cltree` CLI as its tool. All features are accessible via `cltree --help`
- No separate SDK required

### Terminal Pane

A local process. Spawned via node-pty, rendered with xterm.js.

```bash
cltree p attach --cmd "pnpm run dev"                   # attach terminal
cltree p attach --session <id> --cmd "tail -f app.log" # attach to specific session
cltree p kill <terminal-id>                             # terminate terminal
```

### Common

- **Lifecycle**: create (`pty.spawn`) → active → exit (`onExit` callback)
- **Focus switching**: click in PaneGrid or `cltree p focus <id>`
- **Layout**: react-resizable-panels drag-to-resize
- **Zoom**: `cltree p zoom <id>` → toggle maximize

---

## Process Persistence Limits and State Storage

### Difference from tmux

cltree is node-pty based, which means **processes are terminated when cltree exits**. This is not the same as tmux, where processes survive after detaching.

### What Is Saved: Initial CLI State

While the process itself cannot be preserved, the **configuration at the time the pane was created** is saved in SQLite. This allows the same environment to be reconstructed on restart.

| Saved Item | Example | Purpose |
|-----------|---------|---------|
| **Pane layout** | 2-split, left 60% / right 40% | Restore split state |
| **Agent pane command** | `claude --permission-mode auto` | Re-spawn agent |
| **Terminal pane command** | `pnpm run dev` | Re-execute process |
| **Pane type** | agent / terminal | Differentiation |
| **Session binding** | session_id, cwd | Restore working directory |

### What Is Not Saved

| Item | Reason |
|------|--------|
| Agent conversation history / internal state | Managed by the agent CLI itself (e.g., Claude Code's ~/.claude) |
| Terminal output (scrollback) | Meaningless after the process exits |
| In-flight process state | node-pty limitation — cannot be restored |

### Restore Flow

```
cltree restarts
│
├── Load last session state from SQLite
│   ├── pane list per session
│   ├── type + command for each pane
│   └── layout (split ratios)
│
├── Reconstruct layout (react-resizable-panels)
│
├── Re-execute the initial command for each pane
│   ├── agent pane → pty.spawn('claude --permission-mode auto')
│   └── terminal pane → pty.spawn('pnpm run dev')
│
└── Restored to the same state as when first opened
    (in-progress agent conversation and terminal output will not be present)
```

### CLI

```bash
cltree exit --keep     # keep server running (processes also stay alive in keep-alive mode)
cltree exit --clean    # clean up everything + save state to SQLite
```

In `keep-alive` mode, the server + PTY processes remain running in the background. Reopening the browser restores everything as-is (Tier 1: Live Reconnect). State save/restore is only used when the server has been fully shut down and restarts (Tier 2: Replay Preset).

---

## Implemented Views

### 1. Issue View

View GitHub issues/PRs from within cltree. Intended for **worktree creation and issue management** from the main session.

```
┌─ Issue #42: fix auth middleware ──┐
│ ● open    bug  auth    @alice    │
│                                  │
│ JWT token validation fails on    │
│ login. Repro: POST /api/login    │
│ → 401                            │
│                                  │
│ ─── Comments (3) ─────────────── │
│ @dev1: middleware ordering?      │
│   └ @alice: looking into it     │
│ @dev2: check JWT_SECRET          │
├──────────────────────────────────┤
│ [Worktree] [Close] [Comment]     │
└──────────────────────────────────┘
```

```bash
cltree p push --type issue --source "gh issue view 42"
cltree p push --type issue --source "gh pr view 43"
# (slot type: issue)
```

Button mappings:

| Button | CLI |
|--------|-----|
| Worktree | `cltree s create --parent <id> --issue {n} --spawn` |
| Close | `gh issue close {n}` |
| Comment | `gh issue comment {n} --body <text>` |
| Refresh | `cltree p update --slot <id>` |

### 2. Diff View

Displays `git diff HEAD` output as an inline viewer.

```bash
cltree p push --type diff
# (slot type: diff)
```

Shows a list of all changed files relative to the current session's `cwd`, with inline diffs (Monaco editor).

### 3. Explain View

Displays step-by-step code explanations or Mermaid diagrams in a GUI pane.

```bash
cltree explain create --title "Auth flow"
cltree explain step --code "src/auth.ts:10-25" --md "explanation"
cltree explain step --mermaid "sequenceDiagram\n  A->>B: ..."
cltree explain done
# (slot type: explain)
```

### 4. FileSearch View

Displays file name or content search results in a GUI pane.

```bash
cltree p push --type filesearch
# (slot type: filesearch)
```

### 5. Preview View

Embeds a web app in an iframe.

```bash
cltree p push --type preview --url "http://localhost:3000"
# (slot type: preview)
```

### Implemented Views Summary

| View | Slot Type | Purpose | Replaces |
|------|-----------|---------|---------|
| **Issue View** | `issue` | Review issues + create worktrees | GitHub browser tab |
| **Diff View** | `diff` | Inline git diff review | Repeated `git diff` in terminal |
| **Explain View** | `explain` | Code explanation + diagrams | Checking design docs |
| **FileSearch View** | `filesearch` | File/content search | `grep` / IDE search |
| **Preview View** | `preview` | Iframe web app preview | Switching browser tabs |

---


---

## Custom View System (Extension Design)

> **Note: The following is an extensibility design and is not an immediate implementation target.**
> Once v1 Views are working well, this can be implemented incrementally as needed.

### Design Principle: CLI Output → UI Box Composition

Any CLI response can be quickly ported to a View by composing a few **UI primitives (boxes)**.

```
Run CLI command → JSON/text output → parser → UI box composition → render
```

### UI Box Primitives

| Box | Purpose | Example |
|-----|---------|---------|
| `TextBox` | Text block | Issue body, logs |
| `KVBox` | Key-value pairs | `state: open`, `repo: owner/myapp` |
| `BadgeBox` | Tag/label badges | `bug`, `● busy` |
| `TableBox` | Table | Pod list, instance list |
| `TreeBox` | Collapsible tree | Dependency tree, file structure |
| `ListBox` | List | Comment list, timeline |
| `ButtonBar` | Action button bar | `[Close] [Label+] [Refresh]` |
| `MarkdownBox` | Markdown rendering | README, Mermaid diagrams |

### v1 Views Are Also Box Compositions Internally

Issue View = KVBox + BadgeBox + TextBox + ListBox + ButtonBar
Session Detail = KVBox + ListBox(panes) + ListBox(subsessions) + ButtonBar

This means the custom view system can be introduced later without architectural changes.

### Custom View Definition (Future)

```yaml
# ~/.cltree/views/k8s-pods.yaml
name: k8s-pods
description: "Kubernetes Pod status"
source_cmd: "kubectl get pods -o json"
parser: jq
transform: |
  .items[] | { name: .metadata.name, status: .status.phase }
layout:
  - TableBox: { columns: [name, status] }
  - ButtonBar:
    - { label: "Delete", cmd: "kubectl delete pod {name}", confirm: true }
    - { label: "Logs", cmd: "cltree p push --type log --source 'kubectl logs -f {name}'" }
refresh: 30s
```

---

## Worktree Button Full Flow

The [Worktree] button in Issue View is a multi-step automation:

```
[Worktree] clicked
│
▼ cltree s create --parent <id> --issue 42 --spawn
│
├── 1. gh issue view 42 --json title,body,labels,assignees
├── 2. git worktree add ~/.cltree/worktrees/myapp-issue-42 -b issue-42-fix-auth
├── 3. Symlinks (node_modules, .venv, .env → based on config)
├── 4. Create PTY process group (record in SQLite)
├── 5. Auto-push Issue View
└── 6. Spawn agent (node-pty, cwd = worktree)
```

```yaml
worktree:
  symlinks: [node_modules, .venv, .env]
  post_create: ["pnpm install --frozen-lockfile"]
```

---

## Action Button Principle

Every button in every View = a CLI command. No additional logic.

```
Button click → POST /api/cli {cmd: [...]} → server processes → View auto-refreshes
```

---

## View Management CLI

```bash
cltree p push --type <type> --source <command>    # add view
cltree p ls --session <id>                        # list panes/views
cltree p update --slot <id>                       # refresh view
cltree p rm --slot <id>                           # remove view
cltree p slots                                    # list view types
```
