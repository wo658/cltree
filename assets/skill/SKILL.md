---
name: cltree
description: Comprehensive cltree CLI/TUI guide — installation, usage, configuration, multi-agent orchestration. Triggers on keywords like "cltree", "agent management", "worktree", "issue agent".
version: 0.1.0
---

# cltree — CLI/TUI Comprehensive Guide

Unified terminal tool integrating GitHub Issues, git worktrees, and Claude Code agents.
Issue-based agents run inside isolated git worktrees, while free agents run on the main branch.

---

## Installation

```bash
# uv (recommended)
uv pip install -e .

# pip
pip install -e .

# Install the Claude Code skill
cltree install-skill

# Verify installation
cltree --help
```

---

## Basic Usage

```bash
# Launch the TUI (outside tmux → automatically creates and attaches to a tmux session)
cltree --repo owner/repo

# Run from a different directory (use --project to specify the project path)
cltree --project /path/to/repo --repo owner/repo

# repo is auto-detected from config's default_repo or from the git remote
cltree

# Initialize the project
cltree init
```

### --project / -P Option

Use cltree from any directory:
```bash
cd ~ && cltree -P /path/to/repo status
cd ~ && cltree -P /path/to/repo config --json
```

If not specified, auto-detection order is:
1. The git repo root of the CWD
2. `project.default_path` in the global config

### CLI Option Overrides

```bash
cltree --model sonnet --max-turns 20 --permission-mode auto
cltree --system-prompt "Always reply with concise, plain prose." --verbose
cltree --mcp-config ./mcp.json --allowed-tools "Read,Write"
cltree --claude-resume            # Resume the last conversation
cltree --claude-arg "--flag"      # Extra arguments forwarded to the claude CLI
```

---

## Subcommands

### init — Initialize a project

```bash
cltree init                      # Create .cltree/config.yaml in the current git repo
```

### spawn — Create an agent

```bash
# Issue-based (worktree is created automatically)
cltree spawn 42
cltree spawn 42 --json

# Free agent (runs on the main branch)
cltree spawn --prompt "Update README.md"
cltree spawn                      # Interactive
```

### kill — Terminate an agent

```bash
cltree kill 42                    # By issue number
cltree kill issue-42              # By session_id
cltree kill free-%5               # By free agent session_id
```

### status — List running agents

```bash
cltree status
cltree status --json
# → session_id, issue_number, pane_id, worktree_path, branch, started_at, status
```

### worktrees — List worktrees

```bash
cltree worktrees
cltree worktrees --json
```

### cleanup — Clean up

```bash
cltree cleanup
cltree cleanup --json
# Removes dead sessions and orphaned worktrees
```

### config — Inspect and modify settings

```bash
cltree config                             # Print the full configuration
cltree config --json                      # JSON format
cltree config claude.model                # Read a specific key
cltree config claude.model --set sonnet   # Update (saved to the project's .cltree/config.yaml)
cltree config --global claude.model --set opus  # Update the global configuration
```

### install-skill — Install the Claude Code Skill

```bash
cltree install-skill
# Installs to ~/.claude/skills/cltree/
```

---

## Configuration

### Config File Locations (priority: global ← project, deep merge)

| Priority | Path | Purpose |
|---------|------|---------|
| 1 (low) | `~/.config/cltree/config.yaml` | Global defaults |
| 2 (high) | `<project>/.cltree/config.yaml` | Per-project overrides |

> Use `--config path` to load a specific file only.
> Use the `--global` / `-g` flag to modify the global configuration.

### Configuration Key Reference

See [config-reference.md](references/config-reference.md).

---

## Session Binding Rules

**Every pane / GUI pane creation command requires `--session`.**

- When invoked from inside an Agent PTY: the `CLTREE_SESSION_ID` environment variable is auto-injected → `--session` may be omitted (binds to the agent's own session).
- When invoked from outside an Agent PTY: `--session <id>` must be specified explicitly.
- Read-only commands (`p ls`, `view-list`, etc.) keep the activeSession fallback.

```bash
# Inside agent PTY → --session is automatic (via CLTREE_SESSION_ID)
cltree explain create --title "Analysis"
cltree p spawn

# Outside agent PTY → --session must be specified
cltree explain create --title "Analysis" --session 05a77b02
cltree p spawn --session 05a77b02
```

### PTY Environment Variables

Variables automatically injected into the Agent PTY:

| Variable | Description |
|----------|-------------|
| `CLTREE_SESSION_ID` | ID of the session the agent belongs to |
| `CLTREE_PANE_ID` | The agent's pane ID |
| `CLTREE_AGENT_PROMPT` | System prompt (runtime only) |

---

## Explain GUI Pane — Stepwise Code Walkthrough

When an agent injects a stepwise code walkthrough via the CLI, the user can explore it interactively in the GUI pane.
The Explain slot is rendered as a tab inside an existing GuiPane. Calling `explain create` again automatically cleans up the previous explain slot.

### Commands

```bash
# 1. Create an explanation session (adds a tab to the existing GuiPane, or creates a new GuiPane)
cltree explain create --title "Auth Flow Analysis"

# 2. Add a step (can be repeated)
cltree explain step --md "## JWT Validation\nThis function validates the token."

# Reference a code file (the server reads the file and renders it in the code viewer)
cltree explain step --md "Token extraction logic" --code src/auth.ts:10-25 --lang typescript

# Provide an inline code snippet directly
cltree explain step --md "Config structure" --snippet "const config = { port: 3000 }" --lang typescript

# Line highlights + inline annotations
cltree explain step \
  --md "Core validation logic" \
  --code src/auth.ts:10-25 \
  --lang typescript \
  --highlight "3,5-7" \
  --annotate "3:Extract bearer token" \
  --annotate "5-7:JWT signature validation"

# 3. Update a specific step
cltree explain update --step 0 --md "Updated description"

# 4. Mark the explanation complete (removes the 'in progress' marker in the UI)
cltree explain done
```

### Option Reference

| Option | Description | Example |
|--------|-------------|---------|
| `--title` | Explanation title | `--title "Auth Flow"` |
| `--slot <id>` | Target a specific slot (defaults to the most recent explain slot) | `--slot abc123` |
| `--md` | Markdown description text | `--md "## Overview\nDescription..."` |
| `--code` | File reference `filepath:startLine-endLine` (server reads the file) | `--code src/auth.ts:10-25` |
| `--snippet` | Inline code (provide instead of `--code`) | `--snippet "const x = 1;"` |
| `--lang` | Syntax-highlighting language hint | `--lang typescript` |
| `--highlight` | Line numbers to emphasize (comma-separated, ranges supported) | `--highlight "1,3-5,10"` |
| `--annotate` | Inline annotation for specific lines (repeatable) — `line:text` or `start-end:text` | `--annotate "3:Extract token"` |
| `--step` | Step index to modify on `update` (0-based) | `--step 2` |

### GUI Layout

```
GuiPane (tab container)
├── [Issues] tab
├── [Settings] tab
└── [Explain] tab  ← added by explain create
    ┌─ Header: "Auth Flow"  Step 2/5
    ├─ Stepper: [① ② ③ ④ ⑤ ···]
    ├─ Content:
    │   ├── Code Viewer (left): line numbers + highlights + annotations
    │   └── Markdown (right): description text
    └─ Navigation: [← Previous] [Next →]
```

### Usage Patterns

```bash
# Pattern 1: Issue analysis → share an implementation plan via explain
cltree explain create --title "Issue #42 implementation plan"
cltree explain step --md "## Problem\nphone_number is currently missing"
cltree explain step --md "## Step 1: Add config" --code src/config.ts:5-15 --lang typescript --annotate "8:Add environment variable"
cltree explain step --md "## Step 2: Update handler" --code src/handler.ts:20-40 --highlight "25,30-32"
cltree explain done

# Pattern 2: Code review / educational walkthrough
cltree explain create --title "How the auth middleware works"
# ... steps
cltree explain done
```

---

## Multi-Agent Patterns

```bash
# Process issues in parallel
cltree spawn 10 --json
cltree spawn 11 --json
cltree spawn --prompt "Run the full test suite" --json

# Monitor
cltree status --json

# Consume --json output programmatically
session=$(cltree spawn 42 --json)
pane_id=$(echo "$session" | jq -r '.pane_id')

# Clean up when done
cltree cleanup
```

---

## config.yaml Example

```yaml
github:
  default_repo: "owner/repo"
  issue_limit: 50

tmux:
  session_prefix: "cltree"
  max_panes: 6

claude:
  model: "opus"
  permission_mode: "auto"
  max_turns: 30
  append_system_prompt: "Always reply with concise, plain prose."  # Replace with any system prompt content.

agent:
  worktree_base: "~/.cltree/worktrees"

worktree:
  venv_source: ".venv"
  symlink_venv: true

project:
  default_path: ""  # For the global config: default project path
```
