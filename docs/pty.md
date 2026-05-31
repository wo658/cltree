# PTY Management Layer

node-pty-based PTY management. For context within the overall architecture, see [architecture.md](architecture.md).

---

## Why node-pty

node-pty + xterm.js = the same architecture as the VS Code terminal. Works in both the browser and Electron.

| Problem solved | How |
|----------------|-----|
| **Browser/Electron rendering** | xterm.js renders colors, cursor, and interactive input at native terminal quality |
| **Real PTY provisioning** | node-pty creates an OS-level PTY, automatically loading the user's shell configuration |
| **Process isolation** | Each pane = an independent PTY process, isolated at the OS level |
| **No external dependencies** | No tmux needed. No nested session issues |
| **Proven architecture** | Same structure as the VS Code terminal |

---

## cltree Concept → Implementation Mapping

| cltree Concept | Implementation | Description |
|----------------|----------------|-------------|
| Workspace | Node.js process | A single process manages all PTYs |
| Session | SQLite record + PTY processes | 1 Session = DB record + N PTYs |
| Agent/Terminal Pane | node-pty PTY + xterm.js instance | Each has its own independent PTY and renderer |
| Sidebar slot | React component | No PTY needed — read-only visualization |

- **Session switch** = swap the active PTY group. Only changes which PTY stream xterm.js receives.
- **Sub-sessions** also have their own PTY group. The parent-child relationship is managed in SQLite.

---

## node-pty API Usage Pattern

```typescript
import * as pty from 'node-pty';

const shell = process.env.SHELL || 'zsh';
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: '/path/to/project',
  env: process.env,
});

// Stream output (→ WebSocket → xterm.js)
ptyProcess.onData((data: string) => {
  ws.send(JSON.stringify({ type: 'pty-output', paneId, data }));
});

// Receive input (xterm.js → WebSocket →)
ptyProcess.write(userKeystroke);

// Resize
ptyProcess.resize(cols, rows);

// Detect exit
ptyProcess.onExit(({ exitCode }) => {
  // Update SQLite, notify WebSocket
});
```

| Operation | node-pty API |
|-----------|-------------|
| Create PTY | `pty.spawn(shell, args, options)` |
| Receive output | `ptyProcess.onData(callback)` |
| Send input | `ptyProcess.write(data)` |
| Resize | `ptyProcess.resize(cols, rows)` |
| Detect exit | `ptyProcess.onExit(callback)` |
| Terminate process | `ptyProcess.kill()` |

---

## PTY Event System

| Event | node-pty API | Handling |
|-------|-------------|----------|
| PTY created | Return value of `pty.spawn()` | DB insert + WS broadcast |
| PTY output | `onData` callback | Save to ring buffer + stream over WS |
| PTY exited | `onExit` callback | DB update + WS broadcast |
| PTY resized | `resize()` call | Triggered by browser resize events |

---

## Agent Status Polling

Agent status is determined by pattern matching against the PTY ring buffer. Details: [agent.md](agent.md#agent-status-detection)

- **Target**: Per-pane ring buffer (last N bytes)
- **Interval**: Every 1 second
- **Mechanism**: Ring buffer → pattern match against last N lines
- **Overhead**: In-process memory read, no external calls

---

## Terminal Customization

Because node-pty spawns a real shell, the user's shell configuration (`.zshrc`, etc.) is loaded automatically.

```yaml
terminal:
  shell: "/bin/zsh"
  term: "xterm-256color"

web:
  xterm:
    font_family: "JetBrains Mono"
    font_size: 14
    cursor_style: "block"
    cursor_blink: true
```

xterm.js theme settings control the terminal appearance. Styled to blend naturally with the sidebar (zinc dark theme).

---

## Error Handling

| Situation | Handling |
|-----------|----------|
| PTY spawn failure | Log error + push WS message → display error in UI |
| Shell not found | Fall back to `/bin/sh` |
| PTY abnormal exit | `onExit` → update DB → push WS → update UI |
| node-pty not installed | Auto-built during `npm install` (native module) |
