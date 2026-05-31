# Session & Subsession

## Workspace

One cltree instance = one Workspace (1:1 mapping).
A workspace manages multiple Sessions and is not tied to any specific repository.

```
Workspace
├── id: string (UUID)
├── name: string
├── sessions: Session[]
└── created_at: datetime
```

## Session

A Session is a **single directory (unit of work)**. Each Session has one working directory (`cwd`).
When a repository is linked, that directory becomes the local clone path.

```
Session
├── id: string (UUID)
├── name: string
├── status: "active" | "completed" | "archived"
├── repo: string?                 — owner/repo
├── repo_path: string?            — local clone path
├── parent_session_id: string?    — parent ID if this is a subsession
├── issue_number: int?
├── cwd: string                   — session working directory (1 session = 1 directory)
├── worktree_path: string?
├── branch: string?
├── children: Session[]
├── panes: PaneRef[]              — list of PTY pane references
└── created_at: datetime
```

## Session ↔ PTY Group Mapping

- **1 Session = 1 or more PTY process group.** PTY processes are prepared when the session is created.
- **All PTYs always run in the background.** Every session's PTY processes continue running regardless of which session is active.
- **Switching sessions = switching PTY stream subscriptions.** When a session is clicked in the sidebar:
  1. Unsubscribe from the current session's PTY output stream
  2. Subscribe to the new session's PTY output stream
  3. Replay the scrollback buffer — restores output from before the switch
- **Subsessions also create separate PTY process groups** within the same server.
- **The sidebar (left panel) is shared across sessions** — it is always rendered as a React component. Only the right terminal panel is swapped per session.

## Subsessions

A subsession is a child session derived from a parent session. There are two types:

1. **Worktree subsession**: created from the parent session's repository linked to an issue, branched as a `git worktree`. Has its own directory (the worktree path).
2. **Same-directory subsession**: an additional work session created in the same directory as the parent. Shares the same `cwd` without a worktree.

```
Session (cwd: /path/to/myapp, repo: owner/myapp)
├── SubSession: #42 auth-fix [wt] (worktree: ~/.cltree/worktrees/myapp-issue-42)
├── SubSession: #15 refactor-api [wt] (worktree: ~/.cltree/worktrees/myapp-issue-15)
└── SubSession: extra-task (same directory, no worktree)
```

### Creation Flow (Worktree Subsession)

```
cltree s create --parent <id> --issue 42 --spawn
│
├── 1. Fetch GitHub issue (gh issue view 42 --json ...)
├── 2. Create git worktree (branch: issue-42-auth-fix)
├── 3. Symlink runtime dependencies (node_modules, .venv, .env, etc. → based on config)
├── 4. Create session DB record (subsession-specific)
├── 5. Create subsession (set parent_session_id)
├── 6. Spawn agent (node-pty process, cwd = worktree)
└── 7. Update sidebar tree
```

The worktree branches only the source code; dependencies and environment files are shared from the original repo via symlinks.
The list of targets is defined in `config.yaml` under `worktree.symlinks` (see: [panes.md](panes.md#worktree-button-full-flow)).

### Creation Flow (Same-Directory Subsession)

```
cltree s create --parent <id> --name "extra-task"
│
├── 1. Prepare PTY process
├── 2. Create subsession (set parent_session_id, cwd = parent cwd)
└── 3. Update sidebar tree
```

## Sidebar (Session Management Only)

Implemented as the React `SessionTree` component. Rendered in the left panel of the browser.
Handles only session/subsession creation and deletion, and session switching.

```
┌─────────────────────────┐
│ Sessions                │
│                         │
│ ▶ myapp (owner/myapp)   │  ← repo-linked session
│   ├── #42 auth-fix [wt] │  ← worktree subsession
│   ├── #15 refactor-api  │
│   └── extra-task        │  ← same-directory subsession
│                         │
│   backend (org/backend) │
│   └── #3 fix-db [wt]   │
│                         │
│   free-agent-1          │  ← free session (no repo)
│                         │
│ + new   × del           │
└─────────────────────────┘
```

## Session Persistence (Two Tiers)

Leverages node-pty's independent process execution and SQLite-based state persistence to support two tiers of session recovery.

| Tier | Name | Behavior | What Is Preserved |
|------|------|----------|-------------------|
| **Tier 1: Live Reconnect** | WebSocket reconnect | Reconnect WebSocket to existing server + resubscribe to PTY streams + replay scrollback | Processes, output, and scrollback — everything |
| **Tier 2: Replay Preset** | Restore initial state | Load pane configuration from SQLite + re-execute PTYs | Pane configuration and commands only (no output) |

### Exit Mode (`session.on_exit`)

| Value | Behavior | Use Case |
|-------|----------|----------|
| `keep-alive` **(default)** | Keep PTY processes alive, HTTP server continues running | Long-running tasks, agent running independently |
| `clean` | SIGTERM all PTYs + shut down server + delete lock file | Temporary work, resource cleanup |

### Startup Flow

```
cltree starts
│
├── lock file exists?
│   ├── YES → Tier 1: Live Reconnect
│   │   ├── Reconnect WebSocket to existing server
│   │   ├── Resubscribe to PTY streams + replay scrollback
│   │   └── Re-render React UI
│   │
│   └── NO → Tier 2: Replay Preset
│       ├── Load session state from SQLite
│       ├── Spawn PTYs and run commands in saved pane order
│       └── Apply layout
│
└── explicit fresh start?
    └── cltree s create --preset <name> → force Tier 2
```

### Shutdown Flow

```
cltree exit
│
├── on_exit == "keep-alive"?
│   ├── YES → close only the browser, keep server + PTY running in background
│   └── NO  → SIGTERM all PTYs + shut down server + delete lock file
│
└── CLI override (one-time)
    ├── cltree exit --clean  → clean up everything this time
    └── cltree exit --keep   → keep everything alive this time
```

### Tier 1: Live Reconnect — Details

The Node.js server and PTY processes keep running even after the browser is closed. On reconnect:

1. **WebSocket reconnect** — browser restores connection to the existing server
2. **PTY stream resubscription** — re-subscribes to the active session's PTY output stream
3. **Scrollback buffer replay** — restores previous output
4. **PaneRef matching** — synchronizes pane info in server memory with UI state

### Tier 2: Replay Preset — Details

When the server has been shut down and there is no lock file, rebuilds state from SQLite.

| Tracked Item | What Is Stored |
|--------------|----------------|
| Panel layout | react-resizable-panels size ratios |
| Agent pane | the CLI command that was spawned |
| Terminal pane | the CLI command that was attached |

Agent internal state (conversation history, etc.) and terminal output (scrollback) are not tracked. On restore, only the commands are re-executed.

## Lifecycle

```
[Created] ──▶ [Active] ──▶ [Completed / Archived]
                 │
                 ├── Add/remove panes (Agent, Terminal)
                 ├── Create subsessions (worktree or same-directory)
                 ├── Complete subsession (clean up worktree, create PR)
                 └── Receive/send context
```

## CLI

```bash
# Create
cltree s create --repo owner/myapp --name "myapp"        # repo-linked session
cltree s create --parent myapp --issue 42 --spawn        # worktree subsession + agent
cltree s create --parent myapp --name "extra-task"       # same-directory subsession
cltree s create --name "my-task"                         # free session

# Query
cltree s list                                            # session tree
cltree s inspect <id>                                    # session details

# Modify
cltree s rename <id> <name>                              # rename
cltree s complete <id>                                   # mark complete
cltree s complete <id> --create-pr                       # mark complete + create PR
cltree s archive <id>                                    # archive
cltree s delete <id>                                     # delete

# Exit
cltree exit                                              # follow config
cltree exit --clean                                      # clean up everything this time
cltree exit --keep                                       # keep everything alive this time
```
