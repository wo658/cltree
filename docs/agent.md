# Agent Integration

## Agent = A CLI User

An Agent is an AI CLI process running inside a cltree PTY. From the Agent's perspective, cltree is just **a shell command available on PATH**.

```bash
# How an Agent uses cltree = typing shell commands
$ cltree --help                    # Explore all available features
$ cltree s list -j                 # Session list (JSON)
$ cltree p push --type issue ...   # Display issue in sidebar slot
$ cltree p spawn --session abc     # Spawn a new Agent
```

No separate SDK, API, or protocol needed. Having `cltree` on PATH is all it takes.

---

## Interaction Patterns

| Pattern | Method |
|---------|--------|
| Agent → sidebar slot | `cltree p push` → reflected in React sidebar |
| Agent → spawn new Agent | `cltree p spawn` |
| Agent ← pull context from another Agent | `s inspect` + `p history` + git |
| Agent → send message to another Agent | `cltree ctx send --to <id>` (async) |

> Real-time push between Agents is not supported. The receiver actively pulls with `ctx history` — an async message-box model.

---

## How an Agent Extracts Context from Another Agent

```bash
# 1. List sessions
cltree s list -j

# 2. Target session state (issue, repo, worktree, pane list)
cltree s inspect <id> -j

# 3. Agent conversation history
cltree p history <agent-id> -j --last 10

# 4. Code changes in the worktree
git -C ~/.cltree/worktrees/myapp-issue-42 diff
git -C ~/.cltree/worktrees/myapp-issue-42 log --oneline -10

# 5. Cross-session message history
cltree ctx history <id> -j
```

| Extractable Information | Source |
|------------------------|--------|
| Issue / repo / worktree | `s inspect` |
| Code change history | worktree `git diff/log` |
| Sidebar slot contents | `p ls` |
| Agent conversation history | `p history --last N` |
| Cross-session messages | `ctx history` |

---

## Agent → Sidebar Scenarios

```bash
# Add an issue viewer
cltree p push --type issue --source "gh issue view 42"

# Code review result as markdown
cltree p push --type markdown --source "echo '# Review\n- auth.py:42 vulnerability'"

# Analysis result as a tree
cltree p push --type tree --data '{"label": "auth.ts", "children": [...]}'

# Display AWS instance status in a custom slot
cltree p push --type aws-instances
```

---

## Agent → Explain (Code Explanation + Diagrams)

Display code explanations or architecture diagrams step-by-step in the GUI pane.

```bash
# Code explanation example
cltree explain create --title "Auth Middleware Analysis"
cltree explain step --code "src/auth.ts:10-25" --md "JWT token validation logic" \
  --highlight "15,20" --annotate "15:Token decode" --annotate "20:Expiry check"
cltree explain step --code "src/auth.ts:30-45" --md "Authorization check middleware"

# Diagram step (can be mixed within the same explain)
cltree explain step --mermaid "sequenceDiagram
  Client->>API: POST /login
  API->>DB: SELECT user
  DB-->>API: user row
  API-->>Client: JWT token" --md "Auth sequence diagram"

cltree explain done
```

Within each step, `--code` (code viewer) and `--mermaid` (diagram) are mutually exclusive:
- **Code explanation** → `--code file:L1-L2` + `--highlight` + `--annotate`
- **Diagram** → `--mermaid "graph TD; ..."` (flowchart, sequence, class, state, etc.)
- **Inline in markdown** → ` ```mermaid ` code blocks inside `--md` are automatically rendered as SVG

---

## Agent Headless Pattern

Agents use the `-j` flag to receive JSON + actions for autonomous discovery:

```bash
cltree s list -j           # Session tree + actions
cltree s inspect <id> -j   # Details + actions
cltree p slots -j          # Available slot types
cltree status -j           # Full system state + actions
```

Agents can progressively explore information by following the returned actions.

---

## Context Message Structure

```json
{
  "from_session": "def456",
  "to_session": "abc123",
  "type": "message",
  "content": "Auth middleware update complete, see PR #55",
  "timestamp": "2026-03-23T14:30:00"
}
```

---

## Agent Status Detection

Agents run in independent PTYs, so the main process detects their status from the outside.

### Detection Method

1-second polling against the PTY ring buffer. Status is determined by pattern matching on the most recent N lines.

| Status | Detection Criteria |
|--------|-------------------|
| idle | Prompt-waiting pattern (e.g., `> `, `$ `) |
| busy | Output changed since last capture |
| done | Completion message pattern (e.g., "Task completed") |
| error | Error pattern (e.g., "Error:", "failed") |

### Per-provider Pattern Configuration

```yaml
terminal:
  agent_patterns:
    claude:
      idle: "^> $"
      done: "^Task completed"
    codex:
      idle: "^\\$ $"
```

### Status Update Flow

```
ring buffer (1-second interval)
  → pattern matching
  → on status change detected
  → write to SQLite
  → WebSocket push → UI update (status shown in session tree)
```

---

## Scenario: Distributed Issue Work

```bash
# Agent A inspects Agent B's work
$ cltree s list -j                          # Session list
$ cltree s inspect def456 -j                # Session B state
$ cltree p history agent-1 -j --last 10     # Agent B's recent conversation
$ git -C ~/.cltree/worktrees/myapp-issue-15 diff   # Code changes

# Agent A leaves a message
$ cltree ctx send --to def456 "API endpoint /auth/token is being changed"
```
