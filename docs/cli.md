# CLI Command Reference

## CLI = The Only API for cltree

Every feature in cltree is accessible through CLI commands. Web UI buttons, Agent automation, and direct human execution all invoke the same CLI commands.

```
cltree <domain> <verb> [flags]
```

Five orthogonal domains. CLI framework: nest-commander.

### How It Works

```
$ cltree                     ← no args → start NestJS server
$ cltree s list              ← with args → client mode
                                           read port from lock file
                                           HTTP POST localhost:PORT/api/cli
                                           running server handles it → return result
```

### Three Entry Points, One CLI

| Entry Point | How It Calls | Example |
|-------------|-------------|---------|
| **Human** | Typed directly in terminal | `$ cltree s create --name myapp` |
| **Agent** | Shell command executed inside PTY | `$ cltree p spawn --session abc` |
| **Web UI** | Button click → HTTP request | `POST /api/cli {cmd: ["s", "create", ...]}` |

For an Agent to use cltree features, all it needs to do is run `cltree --help`. No separate SDK or API to learn.

---

## Return-based Progressive Discovery

Every command returns its result along with **the next available actions**.

```
$ cltree s list
  myapp (owner/myapp)
    ├── #42 auth-fix     active   worktree
    └── #15 refactor     active   worktree

  Actions: inspect <id> | complete <id> | archive <id>
           create --repo R | create --parent <id> --issue N
```

```
$ cltree s inspect abc123
  Session: #42 auth-fix
  repo: owner/myapp
  worktree: ~/.cltree/worktrees/myapp-issue-42
  Panes:
    [agent] pty-1 claude    [term] pty-2 pnpm-dev
  Slots:
    [issue] issue-viewer

  Actions: complete abc123 | pane spawn | pane focus pty-1 | ctx send --to <id>
```

### Actions Return Rules

1. **Domain help** → list of verbs
2. **List query** → results + per-item actions
3. **Single query** → details + available actions (including other domains)
4. **Mutation** → result + suggested next steps

### JSON Mode

Use the `-j` flag for structured output that Agents can parse:

```json
{
  "data": { ... },
  "actions": [
    { "cmd": "cltree s inspect abc123", "desc": "Session details" },
    { "cmd": "cltree p spawn --session abc123", "desc": "Spawn Agent" }
  ]
}
```

---

## Common Flags

```
--json, -j               # JSON output (for Agent parsing)
--project, -P <path>     # Project path
--config, -c <path>      # Config file path
```

---

## Domain Reference

### session (s) — Session Lifecycle

```bash
cltree s create --repo owner/myapp --name "myapp"        # Session linked to a repo
cltree s create --parent myapp --issue 42 --spawn        # Issue sub-session + Agent
cltree s create --name "my-task"                         # Free-form session
cltree s list                                            # Session tree
cltree s inspect <id>                                    # Session details
cltree s rename <id> <name>                              # Rename session
cltree s complete <id>                                   # Mark complete
cltree s complete <id> --create-pr                       # Mark complete + create PR
cltree s archive <id>                                    # Archive session
```

### pane (p) — Pane Management

Unified domain for Agent, Terminal, and sidebar slots.

```bash
# GUI pane slots
cltree p push --type issue --source "gh issue view 42"   # Add slot (type: issue|diff|filesearch|preview|config)
cltree p ls --session <id>                               # List slots
cltree p update --slot <id>                              # Refresh slot
cltree p rm --slot <id>                                  # Remove slot
cltree p slots                                           # List available slot types

# Agent
cltree p spawn --session <id>                            # Spawn Agent
cltree p spawn --cmd "codex"                             # Custom Agent
cltree p history <agent-id> --last 10                    # Conversation history

# Terminal
cltree p attach --cmd "pnpm run dev"                     # Attach terminal

# Common
cltree p kill <id>                                       # Kill pane

# Pane control
cltree p focus <id>                                      # Switch focus
cltree p resize <id> --width N --height M                # Resize
cltree p layout <pattern>                                # Change layout
cltree p zoom <id>                                       # Toggle maximize
cltree p swap <id1> <id2>                                # Swap positions
```

### repo (r) — Git Repo & Worktree

```bash
cltree r attach owner/myapp          # Link a repo to the session
cltree r detach                      # Unlink repo
cltree r info                        # Repo status
cltree r worktrees                   # List worktrees
cltree r cleanup                     # Clean up orphaned worktrees
```

### ctx (c) — Context Exchange

```bash
cltree ctx send --to <id> [--type message|data|event] <content>
cltree ctx history <id>              # Message history
```

> `ctx send` records messages in the session's message history. The receiver must actively pull with `ctx history` to read them. This is an async message-box model.

Message types:

| type | Description |
|------|-------------|
| `message` | Text message (task status, requests) |
| `data` | Structured data (JSON, file paths) |
| `event` | Event notification (PR created, tests passed) |

### explain — Step-by-step Code/Diagram Explanation

Displays step-by-step code explanations or Mermaid diagrams in the GUI pane.

```bash
cltree explain create --title "Auth Flow"                    # Create explanation session
cltree explain step --md "Explanation text"                  # Add step (markdown)
  --code src/auth.ts:10-25                                   # File code reference (server reads it)
  --snippet "const x = 1"                                    # Inline code
  --lang typescript                                          # Syntax highlighting language
  --highlight "1,3-5"                                        # Line highlights
  --annotate "3:Token validation"                            # Inline line annotation
  --mermaid "graph TD; A-->B"                                # Mermaid diagram (exclusive with --code)
cltree explain update --step 0 [--md ...] [--code ...]       # Update a specific step (0-based)
cltree explain done                                          # Finalize explanation
```

Each step shows either a **code viewer** or a **Mermaid diagram**:
- `--code`/`--snippet` → Monaco editor (line highlights + inline annotations)
- `--mermaid` → SVG diagram rendering (flowchart, sequence, class, state, etc.)
- ` ```mermaid ` code blocks inside `--md` markdown are also automatically rendered as SVG diagrams

### config (cfg) — Settings & System

```bash
cltree cfg get [key]                 # Get config value
cltree cfg set <key> <value>         # Set config value
cltree cfg init                      # Initialize project
cltree cfg cleanup                   # Clean up resources
cltree cfg install-skill             # Install a skill
cltree cfg check                     # Verify Node.js/npm environment
```
