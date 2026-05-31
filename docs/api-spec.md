# API Specification

HTTP/WebSocket API definition for cltree. Exposes the CLI command system directly over HTTP/WebSocket.

---

## Design Principles

1. **Single HTTP endpoint**: `POST /api/cli` — accepts CLI commands as JSON and executes them
2. **CLI response = API response**: Same structure as the `-j` flag JSON output
3. **WebSocket**: PTY I/O streaming + state change push notifications
4. **No authentication**: Local-only (localhost)

---

## HTTP API

### `POST /api/cli`

Execute a CLI command passed as JSON.

#### Request

```typescript
interface CliRequest {
  cmd: string[];  // CLI command token array
}
```

```json
POST /api/cli
Content-Type: application/json

{ "cmd": ["s", "list"] }
```

#### Response

All responses take the form `CliResponse<T>`:

```typescript
interface CliResponse<T = any> {
  ok: boolean;
  data: T;
  actions: { cmd: string[]; desc: string }[];
  error?: string;
}
```

#### Error Response

```json
{
  "ok": false,
  "data": null,
  "actions": [],
  "error": "Session not found: abc123"
}
```

HTTP status codes:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (invalid parameters, unknown command) |
| 404 | Resource not found (session, pane, etc.) |
| 409 | Conflict (duplicate name, session already completed, etc.) |
| 500 | Internal server error |

---

## Domain Response Definitions

### session (s)

#### `s list`

```json
{ "cmd": ["s", "list"] }
```

```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "id": "abc123",
        "name": "myapp",
        "status": "active",
        "repo": "owner/myapp",
        "cwd": "/Users/alice/myapp",
        "children": [
          {
            "id": "def456",
            "name": "#42 auth-fix",
            "status": "active",
            "repo": "owner/myapp",
            "cwd": "/Users/alice/.cltree/worktrees/myapp-issue-42",
            "parentSessionId": "abc123",
            "issueNumber": 42,
            "worktreePath": "/Users/alice/.cltree/worktrees/myapp-issue-42",
            "branch": "issue-42-auth-fix",
            "children": [],
            "panes": [
              { "id": "pty-1", "type": "agent", "cmd": "claude", "status": "busy", "sessionId": "def456" }
            ]
          }
        ],
        "panes": [
          { "id": "pty-0", "type": "agent", "cmd": "claude", "status": "idle", "sessionId": "abc123" },
          { "id": "pty-3", "type": "terminal", "cmd": "pnpm run dev", "status": "running", "sessionId": "abc123" }
        ]
      }
    ]
  },
  "actions": [
    { "cmd": ["s", "inspect", "<id>"], "desc": "Session details" },
    { "cmd": ["s", "complete", "<id>"], "desc": "Complete session" },
    { "cmd": ["s", "archive", "<id>"], "desc": "Archive session" },
    { "cmd": ["s", "create", "--repo", "<repo>"], "desc": "Create session linked to repo" },
    { "cmd": ["s", "create", "--parent", "<id>", "--issue", "<n>"], "desc": "Create issue sub-session" }
  ]
}
```

#### `s inspect <id>`

```json
{ "cmd": ["s", "inspect", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "abc123",
      "name": "myapp",
      "status": "active",
      "repo": "owner/myapp",
      "cwd": "/Users/alice/myapp",
      "branch": "main",
      "parentSessionId": null,
      "issueNumber": null,
      "worktreePath": null,
      "children": [],
      "panes": []
    },
    "panes": [
      { "id": "pty-0", "type": "agent", "cmd": "claude --permission-mode auto", "status": "busy", "sessionId": "abc123" },
      { "id": "pty-3", "type": "terminal", "cmd": "pnpm run dev", "status": "running", "sessionId": "abc123" }
    ],
    "children": [
      {
        "session": {
          "id": "def456",
          "name": "#42 auth-fix",
          "status": "active",
          "repo": "owner/myapp",
          "cwd": "/Users/alice/.cltree/worktrees/myapp-issue-42",
          "parentSessionId": "abc123",
          "issueNumber": 42,
          "worktreePath": "/Users/alice/.cltree/worktrees/myapp-issue-42",
          "branch": "issue-42-auth-fix",
          "children": [],
          "panes": []
        },
        "panes": [
          { "id": "pty-1", "type": "agent", "cmd": "claude", "status": "busy", "sessionId": "def456" }
        ]
      }
    ],
    "slots": [
      { "id": "slot-1", "type": "issue", "sessionId": "abc123", "data": {} }
    ]
  },
  "actions": [
    { "cmd": ["s", "complete", "abc123"], "desc": "Complete session" },
    { "cmd": ["s", "complete", "abc123", "--create-pr"], "desc": "Complete + create PR" },
    { "cmd": ["p", "spawn", "--session", "abc123"], "desc": "Spawn agent" },
    { "cmd": ["p", "attach", "--session", "abc123", "--cmd", "<cmd>"], "desc": "Attach terminal" },
    { "cmd": ["p", "focus", "pty-0"], "desc": "Switch focus" },
    { "cmd": ["ctx", "send", "--to", "<id>"], "desc": "Send context message" }
  ]
}
```

#### `s create`

Session linked to a repo:
```json
{ "cmd": ["s", "create", "--repo", "owner/myapp", "--name", "myapp"] }
```

Issue sub-session + spawn agent:
```json
{ "cmd": ["s", "create", "--parent", "abc123", "--issue", "42", "--spawn"] }
```

Free session:
```json
{ "cmd": ["s", "create", "--name", "my-task"] }
```

Response (common structure):

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "ghi789",
      "name": "#42 auth-fix",
      "status": "active",
      "repo": "owner/myapp",
      "cwd": "/Users/alice/.cltree/worktrees/myapp-issue-42",
      "parentSessionId": "abc123",
      "issueNumber": 42,
      "worktreePath": "/Users/alice/.cltree/worktrees/myapp-issue-42",
      "branch": "issue-42-auth-fix",
      "children": [],
      "panes": []
    },
    "spawnedPane": {
      "id": "pty-5",
      "type": "agent",
      "cmd": "claude",
      "status": "running",
      "sessionId": "ghi789"
    }
  },
  "actions": [
    { "cmd": ["s", "inspect", "ghi789"], "desc": "Session details" },
    { "cmd": ["p", "spawn", "--session", "ghi789"], "desc": "Add agent" },
    { "cmd": ["p", "attach", "--session", "ghi789", "--cmd", "<cmd>"], "desc": "Attach terminal" }
  ]
}
```

> `spawnedPane` is only included when the `--spawn` flag is used.

#### `s rename <id> <name>`

```json
{ "cmd": ["s", "rename", "abc123", "new-name"] }
```

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "abc123",
      "name": "new-name"
    }
  },
  "actions": [
    { "cmd": ["s", "inspect", "abc123"], "desc": "Session details" }
  ]
}
```

#### `s complete <id>`

```json
{ "cmd": ["s", "complete", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "abc123",
      "name": "myapp",
      "status": "completed"
    },
    "pr": null
  },
  "actions": [
    { "cmd": ["s", "archive", "abc123"], "desc": "Archive" },
    { "cmd": ["s", "list"], "desc": "Session list" }
  ]
}
```

With `--create-pr`:

```json
{ "cmd": ["s", "complete", "abc123", "--create-pr"] }
```

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "abc123",
      "name": "#42 auth-fix",
      "status": "completed"
    },
    "pr": {
      "number": 55,
      "url": "https://github.com/owner/myapp/pull/55",
      "title": "fix: auth middleware JWT validation",
      "branch": "issue-42-auth-fix"
    }
  },
  "actions": [
    { "cmd": ["s", "archive", "abc123"], "desc": "Archive" },
    { "cmd": ["s", "list"], "desc": "Session list" }
  ]
}
```

#### `s archive <id>`

```json
{ "cmd": ["s", "archive", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "abc123",
      "name": "myapp",
      "status": "archived"
    }
  },
  "actions": [
    { "cmd": ["s", "list"], "desc": "Session list" }
  ]
}
```

#### `s delete <id>`

```json
{ "cmd": ["s", "delete", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "deleted": "abc123"
  },
  "actions": [
    { "cmd": ["s", "list"], "desc": "Session list" }
  ]
}
```

---

### pane (p)

#### `p spawn`

```json
{ "cmd": ["p", "spawn", "--session", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "pane": {
      "id": "pty-5",
      "type": "agent",
      "cmd": "claude",
      "status": "running",
      "sessionId": "abc123"
    }
  },
  "actions": [
    { "cmd": ["p", "focus", "pty-5"], "desc": "Switch focus" },
    { "cmd": ["p", "kill", "pty-5"], "desc": "Kill" },
    { "cmd": ["p", "history", "pty-5", "--last", "10"], "desc": "History" }
  ]
}
```

Custom agent:
```json
{ "cmd": ["p", "spawn", "--cmd", "codex"] }
```

#### `p attach`

```json
{ "cmd": ["p", "attach", "--cmd", "pnpm run dev"] }
```

```json
{
  "ok": true,
  "data": {
    "pane": {
      "id": "pty-6",
      "type": "terminal",
      "cmd": "pnpm run dev",
      "status": "running",
      "sessionId": "abc123"
    }
  },
  "actions": [
    { "cmd": ["p", "focus", "pty-6"], "desc": "Switch focus" },
    { "cmd": ["p", "kill", "pty-6"], "desc": "Kill" }
  ]
}
```

#### `p ls`

```json
{ "cmd": ["p", "ls", "--session", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "panes": [
      { "id": "pty-0", "type": "agent", "cmd": "claude", "status": "busy", "sessionId": "abc123" },
      { "id": "pty-3", "type": "terminal", "cmd": "pnpm run dev", "status": "running", "sessionId": "abc123" }
    ],
    "slots": [
      { "id": "slot-1", "type": "issue", "sessionId": "abc123", "data": { "number": 42, "title": "fix auth middleware", "state": "open" } }
    ]
  },
  "actions": [
    { "cmd": ["p", "spawn", "--session", "abc123"], "desc": "Spawn agent" },
    { "cmd": ["p", "attach", "--session", "abc123", "--cmd", "<cmd>"], "desc": "Attach terminal" },
    { "cmd": ["p", "push", "--type", "<type>"], "desc": "Add slot" },
    { "cmd": ["p", "focus", "<id>"], "desc": "Switch focus" },
    { "cmd": ["p", "kill", "<id>"], "desc": "Kill" }
  ]
}
```

#### `p push`

Issue slot:
```json
{ "cmd": ["p", "push", "--type", "issue", "--source", "gh issue view 42"] }
```

```json
{
  "ok": true,
  "data": {
    "slot": {
      "id": "slot-2",
      "type": "issue",
      "sessionId": "abc123",
      "data": {
        "number": 42,
        "title": "fix auth middleware",
        "state": "open",
        "labels": [{ "name": "bug", "color": "d73a4a" }],
        "assignees": ["alice"],
        "body": "JWT token validation fails on login.\nRepro: POST /api/login → 401",
        "comments": [
          { "author": "dev1", "body": "middleware order issue?", "createdAt": "2026-03-20T10:00:00Z" }
        ]
      }
    }
  },
  "actions": [
    { "cmd": ["p", "update", "--slot", "slot-2"], "desc": "Refresh" },
    { "cmd": ["p", "rm", "--slot", "slot-2"], "desc": "Remove" },
    { "cmd": ["s", "create", "--parent", "abc123", "--issue", "42", "--spawn"], "desc": "Create worktree" }
  ]
}
```

Diff slot:
```json
{ "cmd": ["p", "push", "--type", "diff"] }
```

FileSearch slot:
```json
{ "cmd": ["p", "push", "--type", "filesearch"] }
```

Explain slot (created via the explain create/step/done CLI):
```json
{ "cmd": ["explain", "create", "--title", "Auth flow"] }
```

Preview slot:
```json
{ "cmd": ["p", "push", "--type", "preview", "--url", "http://localhost:3000"] }
```

#### `p update --slot <id>`

```json
{ "cmd": ["p", "update", "--slot", "slot-1"] }
```

```json
{
  "ok": true,
  "data": {
    "slot": {
      "id": "slot-1",
      "type": "issue",
      "sessionId": "abc123",
      "data": { "number": 42, "title": "fix auth middleware", "state": "open" }
    }
  },
  "actions": [
    { "cmd": ["p", "rm", "--slot", "slot-1"], "desc": "Remove" }
  ]
}
```

#### `p rm --slot <id>`

```json
{ "cmd": ["p", "rm", "--slot", "slot-1"] }
```

```json
{
  "ok": true,
  "data": { "deleted": "slot-1" },
  "actions": [
    { "cmd": ["p", "ls"], "desc": "Pane/slot list" }
  ]
}
```

#### `p slots`

```json
{ "cmd": ["p", "slots"] }
```

```json
{
  "ok": true,
  "data": {
    "types": [
      { "type": "issue", "desc": "GitHub issue/PR viewer" },
      { "type": "explain", "desc": "Step-by-step code explanation + Mermaid diagrams" },
      { "type": "diff", "desc": "git diff inline viewer" },
      { "type": "filesearch", "desc": "File and content search" },
      { "type": "preview", "desc": "Web app preview (iframe)" },
      { "type": "config", "desc": "Configuration viewer" }
    ]
  },
  "actions": [
    { "cmd": ["p", "push", "--type", "<type>"], "desc": "Add slot" }
  ]
}
```

#### `p kill <id>`

```json
{ "cmd": ["p", "kill", "pty-5"] }
```

```json
{
  "ok": true,
  "data": { "killed": "pty-5" },
  "actions": [
    { "cmd": ["p", "ls"], "desc": "Pane/slot list" },
    { "cmd": ["p", "spawn"], "desc": "Spawn agent" }
  ]
}
```

#### `p focus <id>`

```json
{ "cmd": ["p", "focus", "pty-0"] }
```

```json
{
  "ok": true,
  "data": { "focused": "pty-0" },
  "actions": [
    { "cmd": ["p", "zoom", "pty-0"], "desc": "Toggle maximize" }
  ]
}
```

#### `p resize <id>`

```json
{ "cmd": ["p", "resize", "pty-0", "--width", "120", "--height", "40"] }
```

```json
{
  "ok": true,
  "data": { "resized": "pty-0", "width": 120, "height": 40 },
  "actions": []
}
```

#### `p layout <pattern>`

```json
{ "cmd": ["p", "layout", "2x1"] }
```

```json
{
  "ok": true,
  "data": { "layout": "2x1" },
  "actions": []
}
```

#### `p zoom <id>`

```json
{ "cmd": ["p", "zoom", "pty-0"] }
```

```json
{
  "ok": true,
  "data": { "zoomed": "pty-0", "isZoomed": true },
  "actions": [
    { "cmd": ["p", "zoom", "pty-0"], "desc": "Unmaximize" }
  ]
}
```

#### `p swap <id1> <id2>`

```json
{ "cmd": ["p", "swap", "pty-0", "pty-3"] }
```

```json
{
  "ok": true,
  "data": { "swapped": ["pty-0", "pty-3"] },
  "actions": []
}
```

#### `p history <agent-id>`

```json
{ "cmd": ["p", "history", "pty-0", "--last", "10"] }
```

```json
{
  "ok": true,
  "data": {
    "paneId": "pty-0",
    "entries": [
      { "role": "user", "content": "Fix the JWT validation logic in the auth middleware", "timestamp": "2026-03-23T14:00:00Z" },
      { "role": "assistant", "content": "I'll fix the JWT validation logic...", "timestamp": "2026-03-23T14:00:05Z" }
    ]
  },
  "actions": [
    { "cmd": ["p", "focus", "pty-0"], "desc": "Switch focus" }
  ]
}
```

---

### repo (r)

#### `r attach <repo>`

```json
{ "cmd": ["r", "attach", "owner/myapp"] }
```

```json
{
  "ok": true,
  "data": {
    "repo": "owner/myapp",
    "path": "/Users/alice/myapp",
    "branch": "main"
  },
  "actions": [
    { "cmd": ["r", "info"], "desc": "Repo status" },
    { "cmd": ["r", "worktrees"], "desc": "Worktree list" }
  ]
}
```

#### `r detach`

```json
{ "cmd": ["r", "detach"] }
```

```json
{
  "ok": true,
  "data": { "detached": "owner/myapp" },
  "actions": [
    { "cmd": ["r", "attach", "<repo>"], "desc": "Attach repo" }
  ]
}
```

#### `r info`

```json
{ "cmd": ["r", "info"] }
```

```json
{
  "ok": true,
  "data": {
    "repo": "owner/myapp",
    "path": "/Users/alice/myapp",
    "branch": "main",
    "status": "clean",
    "remoteUrl": "https://github.com/owner/myapp.git",
    "worktreeCount": 2
  },
  "actions": [
    { "cmd": ["r", "worktrees"], "desc": "Worktree list" },
    { "cmd": ["r", "detach"], "desc": "Detach repo" },
    { "cmd": ["r", "cleanup"], "desc": "Clean up orphan worktrees" }
  ]
}
```

#### `r worktrees`

```json
{ "cmd": ["r", "worktrees"] }
```

```json
{
  "ok": true,
  "data": {
    "worktrees": [
      {
        "path": "/Users/alice/.cltree/worktrees/myapp-issue-42",
        "branch": "issue-42-auth-fix",
        "sessionId": "def456",
        "issueNumber": 42
      },
      {
        "path": "/Users/alice/.cltree/worktrees/myapp-issue-15",
        "branch": "issue-15-refactor-api",
        "sessionId": "ghi789",
        "issueNumber": 15
      }
    ]
  },
  "actions": [
    { "cmd": ["r", "cleanup"], "desc": "Clean up orphan worktrees" }
  ]
}
```

#### `r cleanup`

```json
{ "cmd": ["r", "cleanup"] }
```

```json
{
  "ok": true,
  "data": {
    "cleaned": [
      { "path": "/Users/alice/.cltree/worktrees/myapp-issue-99", "reason": "session archived" }
    ]
  },
  "actions": [
    { "cmd": ["r", "worktrees"], "desc": "Worktree list" }
  ]
}
```

---

### ctx (c) — Context Exchange

#### `ctx send`

```json
{ "cmd": ["ctx", "send", "--to", "def456", "--type", "message", "Auth middleware fix complete, see PR #55"] }
```

```json
{
  "ok": true,
  "data": {
    "message": {
      "id": "msg-1",
      "fromSessionId": "abc123",
      "toSessionId": "def456",
      "type": "message",
      "content": "Auth middleware fix complete, see PR #55",
      "timestamp": "2026-03-23T14:30:00Z"
    }
  },
  "actions": [
    { "cmd": ["ctx", "history", "def456"], "desc": "Message history" },
    { "cmd": ["s", "inspect", "def456"], "desc": "Target session details" }
  ]
}
```

#### `ctx history <id>`

```json
{ "cmd": ["ctx", "history", "abc123"] }
```

```json
{
  "ok": true,
  "data": {
    "sessionId": "abc123",
    "messages": [
      {
        "id": "msg-1",
        "fromSessionId": "def456",
        "toSessionId": "abc123",
        "type": "message",
        "content": "Planning to change API endpoint /auth/token",
        "timestamp": "2026-03-23T14:00:00Z"
      },
      {
        "id": "msg-2",
        "fromSessionId": "abc123",
        "toSessionId": "def456",
        "type": "event",
        "content": "PR #55 created",
        "timestamp": "2026-03-23T14:30:00Z"
      }
    ]
  },
  "actions": [
    { "cmd": ["ctx", "send", "--to", "<id>"], "desc": "Send message" }
  ]
}
```

---

### config (cfg) — Settings & System

#### `cfg get`

```json
{ "cmd": ["cfg", "get"] }
```

```json
{
  "ok": true,
  "data": {
    "config": {
      "terminal": {
        "agent_cmd": "claude",
        "shell": "zsh",
        "agent_patterns": {
          "claude": { "idle": "^> $", "done": "^Task completed" }
        }
      },
      "web": {
        "xterm": { "fontSize": 14, "fontFamily": "JetBrains Mono" }
      },
      "worktree": {
        "symlinks": ["node_modules", ".venv", ".env"]
      },
      "session": {
        "on_exit": "keep-alive"
      }
    }
  },
  "actions": [
    { "cmd": ["cfg", "set", "<key>", "<value>"], "desc": "Update config" }
  ]
}
```

Specific key:
```json
{ "cmd": ["cfg", "get", "terminal.agent_cmd"] }
```

```json
{
  "ok": true,
  "data": { "key": "terminal.agent_cmd", "value": "claude" },
  "actions": [
    { "cmd": ["cfg", "set", "terminal.agent_cmd", "<value>"], "desc": "Update" }
  ]
}
```

#### `cfg set`

```json
{ "cmd": ["cfg", "set", "web.xterm.fontSize", "16"] }
```

```json
{
  "ok": true,
  "data": { "key": "web.xterm.fontSize", "value": 16 },
  "actions": [
    { "cmd": ["cfg", "get"], "desc": "View full config" }
  ]
}
```

#### `cfg init`

```json
{ "cmd": ["cfg", "init"] }
```

```json
{
  "ok": true,
  "data": {
    "configPath": "/Users/alice/.cltree/config.yaml",
    "dbPath": "/Users/alice/.cltree/cltree.db",
    "created": true
  },
  "actions": [
    { "cmd": ["cfg", "get"], "desc": "View config" }
  ]
}
```

#### `cfg cleanup`

```json
{ "cmd": ["cfg", "cleanup"] }
```

```json
{
  "ok": true,
  "data": {
    "cleaned": {
      "orphanWorktrees": 1,
      "archivedSessions": 3,
      "staleSlots": 2
    }
  },
  "actions": [
    { "cmd": ["s", "list"], "desc": "Session list" }
  ]
}
```

#### `cfg check`

```json
{ "cmd": ["cfg", "check"] }
```

```json
{
  "ok": true,
  "data": {
    "node": { "version": "v20.11.0", "ok": true },
    "npm": { "version": "10.2.4", "ok": true },
    "git": { "version": "2.43.0", "ok": true },
    "gh": { "version": "2.40.0", "ok": true, "auth": true }
  },
  "actions": []
}
```

#### `cfg install-skill`

```json
{ "cmd": ["cfg", "install-skill"] }
```

```json
{
  "ok": true,
  "data": {
    "installed": ["k8s-pods", "aws-instances"],
    "path": "/Users/alice/.cltree/views/"
  },
  "actions": [
    { "cmd": ["p", "slots"], "desc": "Slot type list" }
  ]
}
```

---

## WebSocket Protocol

### Connection

```
ws://localhost:{PORT}/ws
```

The port is available in the lock file (`~/.cltree/cltree.lock`).

### Client → Server Messages

#### `pty-input`

Send key input to a PTY.

```json
{
  "type": "pty-input",
  "paneId": "pty-0",
  "data": "ls -la\r"
}
```

#### `pty-resize`

Resize a PTY.

```json
{
  "type": "pty-resize",
  "paneId": "pty-0",
  "cols": 120,
  "rows": 40
}
```

#### `subscribe`

Subscribe to a session's PTY output stream. Used when switching sessions.

```json
{
  "type": "subscribe",
  "sessionId": "abc123"
}
```

#### `pty-replay`

Request ring buffer replay for a specific pane. Used when a Terminal mounts.

```json
{
  "type": "pty-replay",
  "paneId": "pty-0"
}
```

The server responds by replaying the pane's ring buffer as `pty-output` messages.

#### `unsubscribe`

Unsubscribe from a session's PTY output stream.

```json
{
  "type": "unsubscribe",
  "sessionId": "abc123"
}
```

### Server → Client Messages

#### `pty-output`

Stream PTY output data.

```json
{
  "type": "pty-output",
  "paneId": "pty-0",
  "data": "\u001b[32m$\u001b[0m "
}
```

#### `state`

Full state snapshot. Sent on initial WebSocket connection. On session/workspace changes, only `workspaces` + `sessions` are included (`activeSessionId`/`activeWorkspaceId` are omitted — managed independently per tab).

```json
{
  "type": "state",
  "data": {
    "workspaces": [ ... ],
    "activeWorkspaceId": "ws-1",
    "sessions": [ ... ],
    "activeSessionId": "abc123",
    "xtermConfig": { "fontSize": 14, "fontFamily": "monospace" }
  }
}
```

#### `session-update`

Session created/updated/deleted notification.

```json
{
  "type": "session-update",
  "action": "created",
  "session": { "id": "ghi789", "name": "#42 auth-fix", "status": "active", ... }
}
```

```json
{
  "type": "session-update",
  "action": "updated",
  "session": { "id": "abc123", "name": "myapp", "status": "completed", ... }
}
```

```json
{
  "type": "session-update",
  "action": "deleted",
  "sessionId": "abc123"
}
```

#### `pane-update`

Pane created/status-changed/exited notification.

```json
{
  "type": "pane-update",
  "action": "created",
  "pane": { "id": "pty-5", "type": "agent", "cmd": "claude", "status": "running", "sessionId": "abc123" }
}
```

```json
{
  "type": "pane-update",
  "action": "status-changed",
  "pane": { "id": "pty-0", "type": "agent", "cmd": "claude", "status": "idle", "sessionId": "abc123" }
}
```

```json
{
  "type": "pane-update",
  "action": "exited",
  "paneId": "pty-5",
  "exitCode": 0
}
```

#### `view-update`

View slot change notification. `guiPaneId` is the owning GUI pane ID.

```json
{
  "type": "view-update",
  "action": "pushed",
  "guiPaneId": "gui-1",
  "slot": { "id": "slot-2", "guiPaneId": "gui-1", "type": "issue", "sessionId": "abc123", "data": { ... } }
}
```

```json
{
  "type": "view-update",
  "action": "updated",
  "guiPaneId": "gui-1",
  "slot": { "id": "slot-2", "guiPaneId": "gui-1", "type": "issue", "sessionId": "abc123", "data": { ... } }
}
```

```json
{
  "type": "view-update",
  "action": "removed",
  "guiPaneId": "gui-1",
  "slotId": "slot-2"
}
```

#### `workspace-update`

Workspace change notification.

```json
{
  "type": "workspace-update",
  "action": "created",
  "workspace": { "id": "ws-1", "name": "myworkspace", "sessions": [] }
}
```

#### `agent-status`

Agent status change notification (result of 1-second polling).

```json
{
  "type": "agent-status",
  "paneId": "pty-0",
  "status": "busy",
  "sessionId": "abc123"
}
```

---

## Static File Serving

| Path | Content |
|------|---------|
| `GET /` | React bundle (`index.html`) |
| `GET /assets/*` | Vite build static files |

---

## Type Reference

Shared TypeScript type definitions: [`src/shared/types.ts`](../src/shared/types.ts)
