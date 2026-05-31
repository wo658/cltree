# Configuration

## Config File Locations

| Scope | Path | Priority |
|-------|------|----------|
| Global | `~/.config/cltree/config.yaml` | Lower (base defaults) |
| Project | `.cltree/config.yaml` | Higher (overrides) |

Project config overrides global config on a per-field basis.

## Full Schema

```yaml
session:
  on_exit: "keep-alive"              # keep-alive | clean
                                     # keep-alive: retain PTY + server
                                     # clean: terminate all PTYs, shut down server

agent:
  default_cmd: "claude"              # default CLI used by cltree p spawn
  worktree_base: "~/.cltree/worktrees"

terminal:
  shell: ""                          # empty = use $SHELL
  term: "xterm-256color"
  scrollback: 10000                  # ring buffer size (lines)
  agent_patterns:                    # patterns for detecting agent status (regex)
    claude:
      idle: "^> $"
      done: "^Task completed"
    codex:
      idle: "^\\$ $"

web:
  port: 0                            # 0 = random port (default)
  open_browser: true                 # auto-open browser on startup
  sidebar_width: 240                 # sidebar width (px)
  theme: "dark"                      # light | dark | system

  xterm:                             # xterm.js options
    font_family: "monospace"
    font_size: 14
    cursor_style: "block"            # block | underline | bar
    cursor_blink: true

keybindings:
  quit: "q"
  focus_next: "tab"
  session_next: "ctrl+n"
  session_prev: "ctrl+p"
  spawn_agent: "ctrl+a"
  kill_pane: "ctrl+w"
  zoom_pane: "ctrl+z"
  next_pane: "ctrl+o"

worktree:
  symlinks: [node_modules, .venv, .env]
  post_create: []                    # commands to run after worktree creation
```

`agent.default_cmd` accepts the full command string as-is. cltree simply executes this string in the PTY — it does not manage provider-specific options.

---

## CLI

```bash
cltree cfg get [key]                   # read config value
cltree cfg set <key> <value>           # update config value
cltree cfg init                        # initialize project config
cltree cfg check                       # verify Node.js environment
```
