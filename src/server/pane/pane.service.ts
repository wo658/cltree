import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DbService, PaneRow } from '../db/db.service';
import { ConfigService } from '../config/config.service';
import { RepoService } from '../repo/repo.service';
import { PtyManagerService } from './pty-manager.service';
import { SessionService } from '../session/session.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { registerViewPaneFetcher, getViewPaneFetcher } from './view-pane-registry';
import { buildDiffViewData } from '../diff/diff.utils';
import type {
  PaneRef,
  PaneType,
  PaneInspectData,
  PaneReadData,
  PaneWriteData,
  ViewSlotType,
} from '../../shared/types';

/**
 * AI CLI tool kind.
 * - claude/codex/gemini: cltree handles system-prompt injection and resume automatically
 * - generic: arbitrary CLI. Spawned as-is; no tool-specific automation (user's responsibility)
 */
export type AgentTool = 'claude' | 'codex' | 'gemini' | 'generic';

/** Convert a DB row to PaneRef */
function toPaneRef(row: PaneRow): PaneRef {
  return {
    id: row.id,
    type: row.type as PaneRef['type'],
    cmd: row.cmd,
    cwd: row.cwd || undefined,
    status: row.status as PaneRef['status'],
    sessionId: row.session_id,
  };
}


/**
 * Pane CRUD + PTY integration service.
 * Manages metadata via DbService and actual processes via PtyManagerService.
 */
@Injectable()
export class PaneService {
  private readonly logger = new Logger(PaneService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly repoService: RepoService,
    private readonly ptyManager: PtyManagerService,
    @Inject(forwardRef(() => SessionService))
    private readonly sessionService: SessionService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.registerDefaultFetchers();
  }

  /** Register default ViewPane fetchers (issue, config) */
  private registerDefaultFetchers(): void {
    const repoService = this.repoService;
    const configService = this.config;

    registerViewPaneFetcher({
      type: 'issue',
      fetchState(meta) {
        const repo = meta.repo as string;
        if (!repo) return [];
        if (meta.issueNumber) {
          return repoService.fetchIssue(repo, meta.issueNumber as number);
        }
        return repoService.listIssues(repo);
      },
      formatLines(data) {
        if (Array.isArray(data)) {
          return data.map((i: { number: number; title: string; state: string }) =>
            `#${i.number} ${i.title} [${i.state}]`,
          );
        }
        const issue = data as { number: number; title: string; state: string; body: string };
        return [`#${issue.number} ${issue.title} [${issue.state}]`, '', issue.body || ''];
      },
    });

    registerViewPaneFetcher({
      type: 'config',
      fetchState() {
        return configService.getAll();
      },
      formatLines(data) {
        return Object.entries(data as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
      },
    });

    registerViewPaneFetcher({
      type: 'preview',
      fetchState(meta) {
        return { url: meta.url };
      },
      formatLines(data) {
        const d = data as { url?: string };
        return [`Preview: ${d.url || '(none)'}`];
      },
    });

    registerViewPaneFetcher({
      type: 'explain',
      fetchState(meta) {
        return meta;
      },
      formatLines(data) {
        const d = data as { title?: string; steps?: { markdown: string }[]; completed?: boolean };
        const lines = [`# ${d.title || 'Explanation'} (${d.steps?.length || 0} steps, ${d.completed ? 'complete' : 'in progress'})`];
        if (d.steps) {
          d.steps.forEach((s, i) => {
            lines.push(`  ${i + 1}. ${s.markdown.slice(0, 80)}${s.markdown.length > 80 ? '...' : ''}`);
          });
        }
        return lines;
      },
    });

    registerViewPaneFetcher({
      type: 'diff',
      fetchState(meta, context) {
        const cwd = (meta.cwd as string) || process.cwd();
        return buildDiffViewData(cwd, context.sessionId);
      },
      formatLines(data) {
        const d = data as { files?: { path: string; status: string }[]; refreshedAt?: string };
        if (!d.files || d.files.length === 0) {
          return ['No changed files'];
        }
        const lines = [`${d.files.length} changed file(s) (${d.refreshedAt ? new Date(d.refreshedAt).toLocaleTimeString() : ''})`];
        d.files.forEach((f) => {
          lines.push(`  [${f.status}] ${f.path}`);
        });
        return lines;
      },
    });

    registerViewPaneFetcher({
      type: 'filesearch',
      fetchState(meta) {
        // meta: { query?, mode?, cwd? } — passthrough since the frontend calls the fs search API directly
        return meta;
      },
      formatLines(data) {
        const d = data as { query?: string; mode?: string; results?: { path: string }[] };
        if (!d.results?.length) {
          return [`FileSearch: ${d.query || '(no query)'} (${d.mode || 'filename'} mode) — no results`];
        }
        return [
          `FileSearch: ${d.query || ''} (${d.mode || 'filename'} mode) — ${d.results.length} result(s)`,
          ...d.results.slice(0, 10).map((r) => `  ${r.path}`),
        ];
      },
    });
  }

  /** cltree command system prompt (teaches the Agent how to use cltree) */
  private static readonly CLTREE_SYSTEM_PROMPT = [
    'You have access to cltree CLI for managing sessions, panes, and issues.',
    'cltree commands:',
    '  cltree w list                      — list workspaces',
    '  cltree w create --name <n>        — create a workspace',
    '  cltree w switch <id>              — switch workspace',
    '  cltree w set-gh-profile --profile <name> — set workspace gh profile',
    '  cltree s list                     — session list (active workspace)',
    '  cltree s create --name <n>        — create a session',
    '  cltree s switch <id>              — switch session',
    '  cltree s delete <id>              — delete a session',
    '  cltree s set-issue-repo --repo owner/repo — change issue tracking repo',
    '  cltree p spawn --session <id>     — create an agent pane',
    '  cltree p attach --session <id>    — create a terminal pane',
    '  cltree p kill <id>                — kill a pane',
    '  cltree p restart <id>             — restart a pane',
    '  cltree p ls --all                 — list all panes in the workspace',
    '  cltree p inspect <id>             — inspect pane details',
    '  cltree p read <id> [--lines N] [--plain] — read pane output',
    '  cltree p write <id> <data>        — send input to a terminal pane',
    '  cltree p pin-cwd <id>             — pin the terminal pane\'s current path as the session cwd',
    '  cltree p set-cmd <id> <cmd>       — change pane cmd',
    '  cltree p set-cwd <id> <cwd>       — change pane cwd',
    '  cltree issue list                 — GitHub issue list (uses session issueRepo)',
    '  cltree issue create --title <t>   — create an issue',
    '  cltree issue view <n>             — view issue details',
    '  cltree cfg get                    — get all configuration',
    '  cltree cfg get agent              — get agent configuration',
    '  cltree cfg set agent.cli codex    — change agent CLI',
    '  cltree cfg set agent.flags \'["--dangerously-skip-permissions"]\' — set agent flags',
    '  cltree cfg agent                  — shortcut to get agent config',
    '  cltree cfg info                   — environment + path info',
    '',
    'GUI Pane commands (manage GUI tabs within a session):',
    '  cltree p view-list               — list GUI panes + slots for the current session (check id, viewType, data)',
    '  cltree p view-register --id <paneId> --type <viewType> --session <id> — register a GUI slot',
    '  cltree p view-unregister <paneId> — delete a GUI pane',
    '  Each session has one GuiPane containing multiple slots (tabs): issue, config, explain, etc.',
    '',
    'Explain commands (display step-by-step code/diagram explanations in a GUI pane):',
    '  cltree explain create --title "title"  — create an explanation session (adds a tab to the existing GuiPane, auto-cleans previous explain)',
    '  cltree explain step --md "markdown description"  — add a step',
    '    [--code file:L1-L2]   — file code reference (e.g. src/auth.ts:10-25; server reads the file and auto-detects language)',
    '    [--snippet "code"]    — provide inline code directly (instead of --code; must be used with --lang)',
    '    [--lang typescript]   — syntax highlighting language (required when using --snippet; auto-detected with --code)',
    '    [--highlight "1,3-5"] — line highlighting (comma-separated, supports ranges)',
    '    [--annotate "3:desc"] — inline annotation for a specific line (multiple allowed; "start-end:desc" range also supported)',
    '    [--mermaid "source"]  — Mermaid diagram (mutually exclusive with --code; rendered as SVG)',
    '  cltree explain update --step <idx> [--md ...] [--code ...] [--mermaid ...] — update a specific step (0-based)',
    '  cltree explain done  — mark explanation as complete (removes in-progress indicator from UI)',
    '',
    'Explain tips:',
    '- Calling create repeatedly auto-cleans the previous explain slot (always keeps only one)',
    '- Omitting --slot auto-selects the most recent explain slot for the current session',
    '- --md supports markdown syntax (##, **, ```, etc.). ```mermaid code blocks are also auto-rendered',
    '- Using --code and --annotate together shows inline annotations in the code viewer',
    '- --mermaid renders flowchart/sequence/architecture diagrams as SVG (e.g. "graph TD; A-->B")',
    '- Use --code for code explanations, --mermaid for flow/sequence/structure explanations',
    '- Users navigate steps with a stepper in the GUI (code or diagram + markdown description)',
    '',
    'Diff commands (display git diff in a GUI pane):',
    '  cltree diff open --session <id>    — show git diff HEAD of the session cwd in a GUI pane',
    '  cltree diff refresh [--slot <id>]  — refresh diff (re-fetch changes)',
    '',
    'Browse commands (control the in-app browser):',
    '  cltree browse open <url>           — open a URL in a Preview pane',
    '  cltree browse navigate <url>       — change the URL of an existing preview',
    '  cltree browse read [--url <url>]   — extract page text (Puppeteer)',
    '  cltree browse screenshot [--url <url>] [--output <path>] — capture a screenshot',
    '  cltree browse close                — close the Preview slot',
    '',
    'Use cltree commands to manage the workspace, create worktree sub-sessions for issues, and coordinate with other agents.',
  ].join('\\n');

  /** Retrieve GH_TOKEN from the gh profile and return as an env var map */
  private resolveGhEnv(sessionId: string): Record<string, string> | undefined {
    const ghProfile = this.sessionService.getGhProfileForSession(sessionId);
    if (!ghProfile) return undefined;
    try {
      const token = execSync(`gh auth token -u ${ghProfile}`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (token) {
        this.logger.log(`GH_TOKEN injected: profile=${ghProfile}, session=${sessionId}`);
        return { GH_TOKEN: token };
      }
    } catch (err) {
      this.logger.warn(`gh auth token failed: profile=${ghProfile} — ${err instanceof Error ? err.message : String(err)}`);
    }
    return undefined;
  }

  /**
   * Look up the latest conversation ID from ~/.claude/projects/ based on the session path.
   * Path conversion: / → -, /. → -- (removes the . from hidden directory names)
   */
  private findLatestConversationId(cwd: string): string | null {
    try {
      const projectKey = cwd.replace(/\//g, '-').replace(/-\./g, '--');
      const projectDir = join(homedir(), '.claude', 'projects', projectKey);
      if (!existsSync(projectDir)) return null;

      const latest = readdirSync(projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ id: f.replace('.jsonl', ''), mtime: statSync(join(projectDir, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];

      return latest?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Detect and save to DB the newly created conversation file at the path right after agent pane spawn.
   * Takes a snapshot of existing files before spawn, then looks for new files shortly after.
   */
  private trackConversationId(paneId: string, cwd: string): void {
    try {
      const projectKey = cwd.replace(/\//g, '-').replace(/-\./g, '--');
      const projectDir = join(homedir(), '.claude', 'projects', projectKey);

      // Snapshot of existing files before spawn
      const existingFiles = new Set(
        existsSync(projectDir) ? readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')) : [],
      );

      // Wait up to 15 seconds for claude to create the conversation file (polling every 500ms)
      const maxAttempts = 30;
      let attempt = 0;
      const poll = setInterval(() => {
        attempt++;
        try {
          if (!existsSync(projectDir)) {
            if (attempt >= maxAttempts) clearInterval(poll);
            return;
          }
          const newFile = readdirSync(projectDir)
            .filter((f) => f.endsWith('.jsonl') && !existingFiles.has(f))[0];

          if (newFile) {
            clearInterval(poll);
            const conversationId = newFile.replace('.jsonl', '');
            this.db.updatePane(paneId, { conversation_id: conversationId });
            this.logger.log(`Conversation ID saved: pane=${paneId}, id=${conversationId}`);
          } else if (attempt >= maxAttempts) {
            clearInterval(poll);
            this.logger.warn(`Conversation ID detection failed: pane=${paneId}, cwd=${cwd}`);
          }
        } catch {
          clearInterval(poll);
        }
      }, 500);
    } catch (err) {
      this.logger.warn(`trackConversationId error: ${err}`);
    }
  }

  /**
   * Detect which AI CLI tool is invoked by inspecting the first word.
   * Handles absolute paths (e.g. /opt/homebrew/bin/codex).
   */
  detectAgentTool(baseCmd: string): AgentTool {
    const first = (baseCmd || '').trim().split(/\s+/)[0] || '';
    const binary = first.split('/').pop() || '';
    if (binary === 'claude' || binary.startsWith('claude-')) return 'claude';
    if (binary === 'codex') return 'codex';
    if (binary === 'gemini') return 'gemini';
    return 'generic';
  }

  /**
   * Inject system prompt into the command based on tool-specific conventions.
   * The prompt content is passed via the `$envVar` environment variable to
   * avoid shell escaping issues.
   *
   * - claude: `--append-system-prompt "$envVar"` (true system slot)
   * - codex:  positional `"$envVar"`           (delivered as initial user msg)
   * - gemini: `-i "$envVar"`                   (prompt-interactive)
   * - generic: unchanged (no prompt injection)
   */
  applySystemPrompt(tool: AgentTool, base: string, envVar: string): string {
    switch (tool) {
      case 'claude':
        return `${base} --append-system-prompt "$${envVar}"`;
      case 'codex':
        return `${base} "$${envVar}"`;
      case 'gemini':
        return `${base} -i "$${envVar}"`;
      case 'generic':
        return base;
    }
  }

  /**
   * Build a "resume previous conversation" version of the command.
   * Returns `null` if the tool does not support resume or no prior conversation
   * is known.
   *
   * - claude: `claude --resume <id>` (id is required)
   * - codex:  `codex resume --last`  (uses tool's most-recent mechanism)
   * - gemini: `gemini --resume latest` (no-op if --resume already present)
   * - generic: not supported
   */
  applyResume(
    tool: AgentTool,
    base: string,
    storedConvId: string | null,
    cwd: string,
  ): string | null {
    const parts = base.trim().split(/\s+/);
    const [binary, ...rest] = parts;
    if (!binary) return null;
    switch (tool) {
      case 'claude': {
        const id = storedConvId || this.findLatestConversationId(cwd);
        if (!id) return null;
        return [binary, '--resume', id, ...rest].join(' ');
      }
      case 'codex':
        return [binary, 'resume', '--last', ...rest].join(' ');
      case 'gemini':
        if (rest.some((p) => p === '--resume' || p.startsWith('--resume='))) return base;
        return [binary, '--resume', 'latest', ...rest].join(' ');
      case 'generic':
        return null;
    }
  }

  /** Assemble the Agent CLI command based on config */
  private buildAgentCmd(
    baseCmd: string | undefined,
    sessionRow: Record<string, unknown> | undefined,
    issueHint?: { title: string; labels: string[] },
    extraMission?: string,
    terminalPaneId?: string,
    parentCwd?: string,
    agentFlagsOverride?: string[],
  ): { cmd: string; baseCmd: string; promptEnv?: string } {
    const cli = this.config.get<string>('agent.cli') || 'claude';
    const flags = agentFlagsOverride?.length
      ? agentFlagsOverride
      : (this.config.get<string[]>('agent.flags') || []);
    const model = this.config.get<string>('agent.model') || '';
    const injectPrompt = this.config.get<boolean>('agent.injectSystemPrompt') !== false;

    // Use baseCmd as-is if provided, otherwise assemble from config
    let base = baseCmd || [cli, ...flags].join(' ');
    if (model && !base.includes('--model') && !/\s-m\s/.test(` ${base} `)) {
      base += ` --model ${model}`;
    }

    // Inject system prompt — tool-specific. Content is passed via env var to
    // avoid shell escaping issues.
    const tool = this.detectAgentTool(base);
    let cmd = base;
    let promptEnv: string | undefined;
    if (injectPrompt && tool !== 'generic') {
      const sessionInfo = sessionRow
        ? `Your session: id=${sessionRow.id}, name=${sessionRow.name}, cwd=${sessionRow.cwd}, repo=${sessionRow.repo || 'none'}, issueRepo=${sessionRow.issue_repo || sessionRow.repo || 'none'}`
        : '';

      // Add mission prompt if this is an issue session
      let missionPrompt = '';
      if (sessionRow?.issue_number) {
        const issueNum = sessionRow.issue_number;
        if (issueHint) {
          const labelStr = issueHint.labels.length ? ` [${issueHint.labels.join(', ')}]` : '';
          missionPrompt = `Your mission: Fix issue #${issueNum} "${issueHint.title}"${labelStr}.\nRead .cltree/issue.md for full issue context.`;
        } else {
          missionPrompt = `Your mission: Work on issue #${issueNum}. Read .cltree/issue.md for full context.`;
        }
      }

      // Guide for accessing the terminal pane within the session
      let terminalPrompt = '';
      if (terminalPaneId) {
        terminalPrompt = [
          `You have a terminal pane in this session (id=${terminalPaneId}).`,
          'Use it to run builds, tests, dev servers, etc:',
          `  cltree p write ${terminalPaneId} "pnpm dev"   — run a command`,
          `  cltree p read ${terminalPaneId} --lines 50    — check recent output`,
          `  cltree p read ${terminalPaneId} --plain       — output with ANSI codes stripped`,
          `  cltree p inspect ${terminalPaneId}            — inspect pane status`,
          'Use the terminal pane for runtime tasks instead of running long processes in your own shell.',
        ].join('\n');
      }

      // Guide for environment setup when this is a worktree session
      let worktreePrompt = '';
      if (sessionRow?.worktree_path && sessionRow?.parent_session_id) {
        const parentCwdInfo = parentCwd ? ` (parent cwd: ${parentCwd})` : '';
        worktreePrompt = [
          `IMPORTANT: This is a worktree session${parentCwdInfo}.`,
          'Worktrees share git history but have NO runtime dependencies installed.',
          'Before making any code changes, you MUST:',
          '1. Detect the project type (check for lockfiles: pnpm-lock.yaml, package-lock.json, yarn.lock, requirements.txt, go.sum, etc.)',
          '2. Install dependencies accordingly (e.g. pnpm install, npm install, pip install, etc.)',
          '3. Verify the project builds/runs successfully',
          'NEVER symlink or share node_modules with the parent repo — always install independently.',
        ].join('\n');
      }

      promptEnv = [PaneService.CLTREE_SYSTEM_PROMPT, sessionInfo, worktreePrompt, terminalPrompt, missionPrompt, extraMission].filter(Boolean).join('\n');
      cmd = this.applySystemPrompt(tool, base, 'CLTREE_AGENT_PROMPT');
    }

    return { cmd, baseCmd: base, promptEnv };
  }

  /** Create an agent pane */
  spawn(opts: { sessionId: string; cmd?: string; cwd?: string; issueHint?: { title: string; labels: string[] }; mission?: string; terminalPaneId?: string; parentCwd?: string; agentFlags?: string[] }): PaneRef {
    const id = uuidv4();
    const now = new Date().toISOString();
    const type: PaneType = 'agent';

    const sessionRow = this.db.getSession(opts.sessionId);
    const cwd = opts.cwd || (sessionRow?.cwd as string) || process.cwd();

    const { cmd, baseCmd, promptEnv } = this.buildAgentCmd(opts.cmd, sessionRow as Record<string, unknown> | undefined, opts.issueHint, opts.mission, opts.terminalPaneId, opts.parentCwd, opts.agentFlags);

    // workspace ghProfile → GH_TOKEN env var
    const ghEnv = this.resolveGhEnv(opts.sessionId);

    // Pass prompt + session ID via env vars (to avoid shell escaping issues)
    const extraEnv: Record<string, string> = {
      CLTREE_SESSION_ID: opts.sessionId,
      CLTREE_PANE_ID: id,
    };
    if (ghEnv) Object.assign(extraEnv, ghEnv);
    if (promptEnv) extraEnv.CLTREE_AGENT_PROMPT = promptEnv;

    // Spawn PTY process (runs as shell -c "cmd")
    const shell = process.env.SHELL || '/bin/zsh';
    this.ptyManager.spawn({
      id,
      sessionId: opts.sessionId,
      shell,
      args: ['-c', cmd],
      cwd,
      env: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
    });

    // Save to DB (baseCmd only — system prompt is runtime-only)
    this.db.insertPane({
      id,
      type,
      cmd: baseCmd,
      cwd: cwd,
      status: 'running',
      session_id: opts.sessionId,
      conversation_id: null,
      created_at: now,
    });

    // For agent panes, asynchronously track the newly created conversation ID
    if (type === 'agent') {
      this.trackConversationId(id, cwd);
    }

    const pane: PaneRef = { id, type, cmd: baseCmd, cwd, status: 'running', sessionId: opts.sessionId };
    this.logger.log(`Pane spawn: id=${id}, cmd=${baseCmd}, session=${opts.sessionId}`);
    this.eventEmitter.emit('pane.created', pane);
    return pane;
  }

  /**
   * Send an initial message to an agent pane (for auto-start only).
   * PTY idle detection: types the message and hits Enter when Claude enters input-wait state (no output for 1s).
   * Forces execution after a maximum wait of 15 seconds.
   */
  writeToAgentDelayed(paneId: string, message: string, _delayMs = 3000): void {
    // Start idle detection at least 2 seconds in (ignore Claude initial output)
    setTimeout(async () => {
      if (!this.ptyManager.has(paneId)) {
        this.logger.warn(`Auto-start skipped: pane=${paneId} not alive`);
        return;
      }
      // Wait until Claude finishes initial output and enters input-wait state (idle 1s, max 13s)
      await this.ptyManager.waitForIdle(paneId, 1000, 13000);
      if (!this.ptyManager.has(paneId)) {
        this.logger.warn(`Auto-start skipped after idle wait: pane=${paneId} not alive`);
        return;
      }
      this.ptyManager.write(paneId, message + '\n');
      this.logger.log(`Auto-start message sent: pane=${paneId}`);
    }, 2000);
  }

  /** Create a terminal pane (runs a shell) */
  attach(opts: { sessionId: string; cmd?: string; cwd?: string }): PaneRef {
    const id = uuidv4();
    const now = new Date().toISOString();
    const shell = process.env.SHELL || '/bin/zsh';
    const cmd = opts.cmd || shell;
    const type: PaneType = 'terminal';

    const sessionRow = this.db.getSession(opts.sessionId);
    const cwd = opts.cwd || (sessionRow?.cwd as string) || process.cwd();

    // workspace ghProfile → GH_TOKEN env var
    const ghEnv = this.resolveGhEnv(opts.sessionId);

    // Running the shell itself vs running via shell -c "command"
    const isShellCmd = cmd === shell || cmd === 'zsh' || cmd === 'bash' || cmd === 'sh';
    this.ptyManager.spawn({
      id,
      sessionId: opts.sessionId,
      shell,
      args: isShellCmd ? [] : ['-c', cmd],
      cwd,
      env: ghEnv,
    });

    this.db.insertPane({
      id,
      type,
      cmd,
      cwd: cwd,
      status: 'running',
      session_id: opts.sessionId,
      conversation_id: null,
      created_at: now,
    });

    const pane: PaneRef = { id, type, cmd, cwd, status: 'running', sessionId: opts.sessionId };
    this.logger.log(`Pane attach: id=${id}, cmd=${cmd}, session=${opts.sessionId}`);
    this.eventEmitter.emit('pane.created', pane);
    return pane;
  }

  /** Pin the terminal pane's current cwd as the session cwd */
  pinCwd(paneId: string): { cwd: string; sessionId: string } | null {
    const row = this.db.getPane(paneId);
    if (!row) return null;
    const cwd = this.ptyManager.getCwd(paneId);
    if (!cwd) return null;
    // Update the pane's own cwd too
    this.db.updatePane(paneId, { cwd });
    // Update the session cwd
    this.db.updateSession(row.session_id, { cwd });
    this.logger.log(`Pin CWD: pane=${paneId}, session=${row.session_id}, cwd=${cwd}`);
    return { cwd, sessionId: row.session_id };
  }

  /** Kill a pane (PTY only; DB record is kept → restartable) */
  kill(paneId: string): void {
    const row = this.db.getPane(paneId);
    if (!row) {
      throw new NotFoundException(`Pane not found: ${paneId}`);
    }

    this.ptyManager.kill(paneId);
    this.db.updatePane(paneId, { status: 'exited' });
    this.logger.log(`Pane kill: id=${paneId}`);
    const pane = toPaneRef({ ...row, status: 'exited' });
    this.eventEmitter.emit('pane.statusChanged', { paneId, status: 'exited', pane });
  }

  /** Fully delete a pane (removes from DB too) */
  remove(paneId: string): void {
    const row = this.db.getPane(paneId);
    if (!row) {
      throw new NotFoundException(`Pane not found: ${paneId}`);
    }

    this.ptyManager.kill(paneId);
    this.db.deletePane(paneId);
    this.logger.log(`Pane remove: id=${paneId}`);
    this.eventEmitter.emit('pane.removed', { paneId, sessionId: row.session_id });
  }

  /** Restart a pane (re-spawn PTY using the saved cmd) */
  restart(paneId: string): PaneRef {
    const row = this.db.getPane(paneId);
    if (!row) {
      throw new NotFoundException(`Pane not found: ${paneId}`);
    }

    // Kill the existing PTY if still alive
    if (this.ptyManager.has(paneId)) {
      this.ptyManager.kill(paneId);
    }

    const sessionRow = this.db.getSession(row.session_id);
    // For a worktree session, prefer worktree_path
    const cwd = row.cwd || (sessionRow as unknown as Record<string, unknown>)?.worktree_path as string || (sessionRow?.cwd as string) || process.cwd();
    const shell = process.env.SHELL || '/bin/zsh';
    const ghEnv = this.resolveGhEnv(row.session_id);

    if (row.type === 'agent') {
      const { cmd: agentBaseCmd, promptEnv } = this.buildAgentCmd(row.cmd, sessionRow as unknown as Record<string, unknown>);
      // Prefer conversation_id from DB; fall back to latest conversation found by path
      const resumeOnRestart = this.config.get<boolean>('agent.resumeOnRestart') !== false;
      let agentCmd = agentBaseCmd;
      if (resumeOnRestart) {
        const tool = this.detectAgentTool(agentBaseCmd);
        const resumed = this.applyResume(tool, agentBaseCmd, row.conversation_id, cwd);
        if (resumed && resumed !== agentBaseCmd) {
          agentCmd = resumed;
          const src = tool === 'claude' ? (row.conversation_id ? 'DB' : 'path-search') : 'tool-latest';
          this.logger.log(`Pane restart resume: tool=${tool}, src=${src}`);
        }
      }
      const agentEnv: Record<string, string> = { CLTREE_SESSION_ID: row.session_id, CLTREE_PANE_ID: paneId };
      if (ghEnv) Object.assign(agentEnv, ghEnv);
      if (promptEnv) agentEnv.CLTREE_AGENT_PROMPT = promptEnv;
      this.ptyManager.spawn({
        id: paneId,
        sessionId: row.session_id,
        shell,
        args: ['-c', agentCmd],
        cwd,
        env: agentEnv,
      });
      // Track new conversation ID after restart (updates conversation_id)
      this.trackConversationId(paneId, cwd);
    } else {
      const isShellCmd = row.cmd === shell || ['zsh', 'bash', 'sh'].includes(row.cmd);
      const termEnv: Record<string, string> = { CLTREE_SESSION_ID: row.session_id, CLTREE_PANE_ID: paneId };
      if (ghEnv) Object.assign(termEnv, ghEnv);
      this.ptyManager.spawn({
        id: paneId,
        sessionId: row.session_id,
        shell,
        args: isShellCmd ? [] : ['-c', row.cmd],
        cwd,
        env: termEnv,
      });
    }

    this.db.updatePane(paneId, { status: 'running' });
    const pane = toPaneRef({ ...row, status: 'running' });
    this.logger.log(`Pane restart: id=${paneId}, cmd=${row.cmd}`);
    this.eventEmitter.emit('pane.statusChanged', { paneId, status: 'running', pane });
    return pane;
  }

  /** Stop all PTY panes for a session (DB records kept; recursively includes sub-sessions) */
  stopAllBySession(sessionId: string): number {
    let stopped = 0;
    const paneRows = this.db.listPanesBySession(sessionId);
    for (const row of paneRows) {
      if (this.ptyManager.has(row.id)) {
        this.ptyManager.kill(row.id);
        this.db.updatePane(row.id, { status: 'exited' });
        const pane = toPaneRef({ ...row, status: 'exited' });
        this.eventEmitter.emit('pane.statusChanged', { paneId: row.id, status: 'exited', pane });
        stopped++;
      }
    }
    // Recursively process sub-sessions
    const children = this.sessionService.getChildren(sessionId);
    for (const child of children) {
      stopped += this.stopAllBySession(child.id);
    }
    this.logger.log(`Session ${sessionId} stop: ${stopped} pane(s) stopped`);
    return stopped;
  }

  /** Restart all exited panes for a session (recursively includes sub-sessions) */
  startAllBySession(sessionId: string): number {
    let started = 0;
    const paneRows = this.db.listPanesBySession(sessionId);
    for (const row of paneRows) {
      if (row.status === 'exited' && !this.ptyManager.has(row.id)) {
        this.restart(row.id);
        started++;
      }
    }
    // Recursively process sub-sessions
    const children = this.sessionService.getChildren(sessionId);
    for (const child of children) {
      started += this.startAllBySession(child.id);
    }
    this.logger.log(`Session ${sessionId} start: ${started} pane(s) started`);
    return started;
  }

  /** List panes by session */
  list(sessionId: string): { panes: PaneRef[] } {
    const paneRows = this.db.listPanesBySession(sessionId);
    return {
      panes: paneRows.map(toPaneRef),
    };
  }

  /** Update pane status (called from PTY exit events, etc.) */
  updateStatus(paneId: string, status: PaneRef['status']): void {
    this.db.updatePane(paneId, { status });
    const row = this.db.getPane(paneId);
    const pane = row ? toPaneRef({ ...row, status }) : undefined;
    this.eventEmitter.emit('pane.statusChanged', { paneId, status, pane });
  }

  /** Fully delete all panes for a session (called on session deletion) */
  killAllBySession(sessionId: string): void {
    const paneRows = this.db.listPanesBySession(sessionId);
    for (const row of paneRows) {
      const paneId = row.id as string;
      this.ptyManager.kill(paneId);
      this.db.deletePane(paneId);
      this.eventEmitter.emit('pane.removed', { paneId, sessionId });
    }
    this.logger.log(`All panes for session ${sessionId} deleted`);
  }

  /** Inspect pane details (unified PTY + ViewPane) */
  inspect(paneId: string): PaneInspectData {
    // Check PTY pane first
    const paneRow = this.db.getPane(paneId);
    if (paneRow) {
      const sessionRow = this.db.getSession(paneRow.session_id);
      return {
        pane: toPaneRef(paneRow),
        sessionName: (sessionRow?.name as string) || 'unknown',
        sessionId: paneRow.session_id,
        ptyAlive: this.ptyManager.has(paneId),
        ringBufferSize: this.ptyManager.getRingBufferSize(paneId),
      };
    }

    // Check ViewPane
    const viewRow = this.db.getViewPane(paneId);
    if (viewRow) {
      const sessionRow = this.db.getSession(viewRow.session_id);
      return {
        pane: { id: viewRow.id, type: 'gui' as const, viewType: viewRow.view_type as ViewSlotType, sessionId: viewRow.session_id },
        sessionName: (sessionRow?.name as string) || 'unknown',
        sessionId: viewRow.session_id,
        ptyAlive: false,
        ringBufferSize: 0,
        viewType: viewRow.view_type as ViewSlotType,
        viewMeta: JSON.parse(viewRow.meta || '{}'),
      };
    }

    throw new NotFoundException(`Pane not found: ${paneId}`);
  }

  /** Read pane output (PTY ring buffer or ViewPane state) */
  read(paneId: string, opts?: { lines?: number; plain?: boolean }): PaneReadData {
    const lines = opts?.lines ?? 50;
    const plain = opts?.plain ?? false;

    // PTY pane
    const paneRow = this.db.getPane(paneId);
    if (paneRow) {
      const textLines = this.ptyManager.getRingBufferAsText(paneId, lines, plain);
      return {
        paneId,
        type: paneRow.type as PaneType,
        lines: textLines,
        totalChunks: this.ptyManager.getRingBufferSize(paneId),
      };
    }

    // ViewPane — fetch state using the registry fetcher
    const viewRow = this.db.getViewPane(paneId);
    if (viewRow) {
      const fetcher = getViewPaneFetcher(viewRow.view_type as ViewSlotType);
      if (!fetcher) {
        return { paneId, type: 'gui', lines: [`Unsupported viewType: ${viewRow.view_type}`], totalChunks: 0 };
      }
      const meta = JSON.parse(viewRow.meta || '{}');
      try {
        const data = fetcher.fetchState(meta, { sessionId: viewRow.session_id });
        const formatted = fetcher.formatLines(data);
        return { paneId, type: 'gui', lines: formatted.slice(-lines), totalChunks: formatted.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { paneId, type: 'gui', lines: [`State fetch failed: ${msg}`], totalChunks: 0 };
      }
    }

    throw new NotFoundException(`Pane not found: ${paneId}`);
  }

  /** Send input to a terminal pane (blocked for agent panes) */
  write(paneId: string, data: string): PaneWriteData {
    const paneRow = this.db.getPane(paneId);
    if (!paneRow) {
      throw new NotFoundException(`Pane not found: ${paneId}`);
    }
    if (paneRow.type === 'agent') {
      throw new BadRequestException('Cannot write directly to an agent pane. Only terminal panes are supported.');
    }
    if (!this.ptyManager.has(paneId)) {
      throw new BadRequestException('PTY process is not running');
    }
    this.ptyManager.write(paneId, data + '\n');
    return { paneId, written: true };
  }

  /** List all panes in a workspace (PTY + GuiPane) */
  listByWorkspace(workspaceId: string): { panes: (PaneRef & { sessionName: string })[]; viewPanes: { id: string; type: 'gui'; viewType: string; sessionId: string; sessionName: string }[] } {
    const sessions = this.db.listSessionsByWorkspace(workspaceId);
    const panes: (PaneRef & { sessionName: string })[] = [];
    const viewPanes: { id: string; type: 'gui'; viewType: string; sessionId: string; sessionName: string }[] = [];

    for (const sess of sessions) {
      const paneRows = this.db.listPanesBySession(sess.id);
      for (const row of paneRows) {
        panes.push({ ...toPaneRef(row), sessionName: sess.name });
      }
      const viewRows = this.db.listViewPanesBySession(sess.id);
      for (const vr of viewRows) {
        viewPanes.push({ id: vr.id, type: 'gui', viewType: vr.view_type, sessionId: vr.session_id, sessionName: sess.name });
      }
    }

    return { panes, viewPanes };
  }

  /**
   * Restore pane state from DB.
   * Called on cltree restart.
   * - Agent pane: automatically re-run with --resume
   * - Terminal pane: kept in exited state (user manually starts)
   */
  restoreFromDb(): number {
    const allPanes = this.db.listSessions()
      .flatMap((sess) => this.db.listPanesBySession(sess.id));

    let restored = 0;
    for (const row of allPanes) {
      // Skip if already running
      if (this.ptyManager.has(row.id)) continue;

      const sessionRow = this.db.getSession(row.session_id);
      if (!sessionRow) continue;

      // For a worktree session, prefer worktree_path (so --resume runs in the correct directory)
      const cwd = row.cwd || (sessionRow as unknown as Record<string, unknown>).worktree_path as string || sessionRow.cwd;
      const shell = process.env.SHELL || '/bin/zsh';
      const ghEnv = this.resolveGhEnv(row.session_id);

      try {
        if (row.type === 'terminal') {
          // Terminal pane: recreate the shell
          const isShellCmd = row.cmd === shell || ['zsh', 'bash', 'sh'].includes(row.cmd);
          const termEnv: Record<string, string> = { CLTREE_SESSION_ID: row.session_id, CLTREE_PANE_ID: row.id };
          if (ghEnv) Object.assign(termEnv, ghEnv);
          this.ptyManager.spawn({
            id: row.id,
            sessionId: row.session_id,
            shell,
            args: isShellCmd ? [] : ['-c', row.cmd],
            cwd,
            env: termEnv,
          });
          this.db.updatePane(row.id, { status: 'running' });
          restored++;
          this.logger.log(`Terminal pane restored: id=${row.id}, cmd=${row.cmd}`);
        } else {
          // Agent pane: prefer conversation_id from DB; otherwise restart with the latest conversation found by path
          const { cmd: agentCmd, promptEnv } = this.buildAgentCmd(row.cmd, sessionRow as unknown as Record<string, unknown>);
          const resumeOnRestart = this.config.get<boolean>('agent.resumeOnRestart') !== false;
          let cmd = agentCmd;
          if (resumeOnRestart) {
            const tool = this.detectAgentTool(agentCmd);
            const resumed = this.applyResume(tool, agentCmd, row.conversation_id, cwd);
            if (resumed && resumed !== agentCmd) {
              cmd = resumed;
              const src = tool === 'claude' ? (row.conversation_id ? 'DB' : 'path-search') : 'tool-latest';
              this.logger.log(`Agent pane restart resume: tool=${tool}, src=${src}, cwd=${cwd}`);
            } else if (tool === 'claude') {
              this.logger.log(`Agent pane restart: no previous conversation, starting new one cwd=${cwd}`);
            }
          }

          const agentEnv: Record<string, string> = { CLTREE_SESSION_ID: row.session_id, CLTREE_PANE_ID: row.id };
          if (ghEnv) Object.assign(agentEnv, ghEnv);
          if (promptEnv) agentEnv.CLTREE_AGENT_PROMPT = promptEnv;

          this.ptyManager.spawn({
            id: row.id,
            sessionId: row.session_id,
            shell,
            args: ['-c', cmd],
            cwd,
            env: agentEnv,
          });
          this.db.updatePane(row.id, { status: 'running' });
          restored++;
          this.logger.log(`Agent pane restored: id=${row.id}, cmd=${row.cmd}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Pane restore failed: id=${row.id} — ${msg}`);
        this.db.updatePane(row.id, { status: 'exited' });
      }
    }

    return restored;
  }
}
