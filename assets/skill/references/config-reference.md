# cltree Configuration Key Reference

## github

| Key | Default | Description |
|-----|---------|-------------|
| `github.default_repo` | `""` | owner/repo format |
| `github.issue_limit` | `30` | Maximum number of issues to fetch |

## tmux

| Key | Default | Description |
|-----|---------|-------------|
| `tmux.session_prefix` | `"cltree"` | tmux session name prefix |
| `tmux.max_panes` | `4` | Maximum number of panes |
| `tmux.agent_pane_direction` | `"below"` | Direction for the agent pane (below/right) |
| `tmux.chat_pane_direction` | `"right"` | Direction for the chat pane (below/right) |

## claude

| Key | Default | Description |
|-----|---------|-------------|
| `claude.model` | `""` | opus, sonnet, haiku |
| `claude.permission_mode` | `""` | default, plan, auto, bypassPermissions, acceptEdits |
| `claude.dangerously_skip_permissions` | `false` | Skip permission checks |
| `claude.system_prompt` | `""` | System prompt |
| `claude.append_system_prompt` | `""` | Appended to the system prompt |
| `claude.max_turns` | `0` | Maximum turns (0 = unlimited) |
| `claude.allowed_tools` | `[]` | Allowlist of tools |
| `claude.disallowed_tools` | `[]` | Blocklist of tools |
| `claude.mcp_config` | `""` | Path to the MCP config file |
| `claude.output_format` | `""` | text, json, stream-json |
| `claude.verbose` | `false` | Verbose output |
| `claude.resume` | `false` | Resume the last conversation |
| `claude.extra_args` | `[]` | Extra CLI arguments |

## agent

| Key | Default | Description |
|-----|---------|-------------|
| `agent.worktree_base` | `"~/.cltree/worktrees"` | Worktree storage path |
| `agent.prompt_template` | `"Fix issue #{number}..."` | Issue prompt template (supports `{number}`, `{title}`, `{body}`) |

## worktree

| Key | Default | Description |
|-----|---------|-------------|
| `worktree.venv_source` | `".venv"` | Source venv path |
| `worktree.symlink_venv` | `true` | Create a venv symlink inside each worktree |

## ui

| Key | Default | Description |
|-----|---------|-------------|
| `ui.body_preview_length` | `300` | Issue body preview length |

## keybindings

| Key | Default | Description |
|-----|---------|-------------|
| `keybindings.quit` | `q` | Quit |
| `keybindings.focus_next` | `tab` | Move focus |
| `keybindings.open_chat` | `c` | Open chat |
| `keybindings.cursor_up` | `up` | Move up |
| `keybindings.cursor_down` | `down` | Move down |
| `keybindings.select_issue` | `enter` | Select issue |
| `keybindings.refresh_issues` | `r` | Refresh issues |

## project

| Key | Default | Description |
|-----|---------|-------------|
| `project.default_path` | `""` | Default project path (for the global config) |
