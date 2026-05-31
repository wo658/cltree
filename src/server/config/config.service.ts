/**
 * Config service
 *
 * Loads ~/.config/cltree/config.yaml (global) + .cltree/config.yaml (project).
 * Project config overrides global config.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

/** Default configuration values */
const DEFAULT_CONFIG: Record<string, unknown> = {
  session: { onExit: 'keep-alive' },
  agent: {
    /**
     * Default Agent CLI binary used when `cltree p spawn` is called without --cmd.
     * Supported with full automation (system-prompt + resume): claude, codex, gemini.
     * Any other binary is treated as "generic" — spawned as-is without prompt injection.
     *
     * IMPORTANT: If you change this away from `claude`, also update `agent.flags` —
     * the default `--dangerously-skip-permissions` is a Claude-only flag.
     * Suggested per-tool flags:
     *   - claude: ['--dangerously-skip-permissions']
     *   - codex:  ['--full-auto']  (or '--dangerously-bypass-approvals-and-sandbox')
     *   - gemini: ['--yolo']       (or '--approval-mode', 'yolo')
     */
    cli: 'claude',
    /** Agent CLI flags (tool-specific — see `agent.cli` note above) */
    flags: ['--dangerously-skip-permissions'],
    /**
     * Whether to use the tool's resume mechanism on restart.
     *   - claude → `--resume <conversation-id>`
     *   - codex  → `codex resume --last`
     *   - gemini → `--resume latest`
     */
    resumeOnRestart: true,
    /** --model value to pass (empty string uses CLI default) */
    model: '',
    /**
     * Whether to automatically inject the cltree system prompt.
     *   - claude → `--append-system-prompt "$ENV"`  (true system slot)
     *   - codex  → positional `"$ENV"`              (delivered as first user msg)
     *   - gemini → `-i "$ENV"`                      (prompt-interactive)
     */
    injectSystemPrompt: true,
  },
  terminal: { shell: '', term: 'xterm-256color', scrollback: 10000 },
  web: {
    port: 0,
    openBrowser: true,
    sidebarWidth: 240,
    theme: 'dark',
    xterm: {
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorStyle: 'block',
      cursorBlink: true,
    },
  },
  worktree: {
    symlinks: ['.env', '.env.local'],
    postCreate: [],
    /** Whether to automatically send an initial message to the agent when creating a worktree */
    autoStart: true,
    /** Initial message to send to the agent on auto-start */
    initialMessage: '/plan Please create an issue plan.',
    /** Flags exclusive to the worktree agent (empty array inherits agent.flags) */
    agentFlags: [] as string[],
  },
};

/** Descriptions per config key */
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  // session
  'session.onExit': 'Action on session exit (keep-alive: keep process, kill: terminate process)',

  // agent
  'agent.cli': 'Agent CLI executable (claude, codex, gemini, or any other). When changing this, also update agent.flags accordingly.',
  'agent.flags': 'Default Agent CLI flags — tool-specific (claude:["--dangerously-skip-permissions"], codex:["--full-auto"], gemini:["--yolo"])',
  'agent.resumeOnRestart': 'Whether to use the tool\'s resume mechanism when restarting (--resume for claude/gemini, "resume --last" subcommand for codex)',
  'agent.model': '--model value to pass to the Agent (empty string uses CLI default)',
  'agent.injectSystemPrompt': 'Whether to automatically inject the cltree system prompt (tool-specific delivery: --append-system-prompt for claude, positional arg for codex, -i for gemini)',

  // terminal
  'terminal.shell': 'Terminal pane shell path (empty string uses $SHELL)',
  'terminal.term': 'TERM environment variable value',
  'terminal.scrollback': 'Number of lines in the terminal scrollback buffer',

  // web
  'web.port': 'Web server port (0 = auto-select)',
  'web.openBrowser': 'Automatically open browser when server starts',
  'web.sidebarWidth': 'Default sidebar width (px)',
  'web.theme': 'UI theme (dark, light)',
  'web.xterm.fontFamily': 'Terminal font family',
  'web.xterm.fontSize': 'Terminal font size',
  'web.xterm.cursorStyle': 'Terminal cursor style (block, underline, bar)',
  'web.xterm.cursorBlink': 'Whether the terminal cursor blinks',

  // worktree
  'worktree.symlinks': 'Files to symlink from the parent when creating a worktree',
  'worktree.postCreate': 'Commands to run after creating a worktree',
  'worktree.autoStart': 'Whether to automatically send an initial message to the agent when creating a worktree',
  'worktree.initialMessage': 'Initial message to send to the agent on worktree auto-start',
  'worktree.agentFlags': 'Flags exclusive to the worktree agent (empty array inherits agent.flags)',
};

@Injectable()
export class ConfigService implements OnModuleInit {
  private config: Record<string, unknown> = {};

  onModuleInit(): void {
    // Load global config
    const globalPath = path.join(os.homedir(), '.config', 'cltree', 'config.yaml');
    const globalConfig = this.loadYaml(globalPath);

    // Load project config (relative to cwd)
    const projectPath = path.join(process.cwd(), '.cltree', 'config.yaml');
    const projectConfig = this.loadYaml(projectPath);

    // Deep merge: defaults ← global ← project
    this.config = this.deepMerge(
      this.deepMerge(structuredClone(DEFAULT_CONFIG), globalConfig),
      projectConfig,
    );
  }

  /** Get a config value by dot-notation key (e.g. 'terminal.scrollback') */
  get<T = unknown>(key?: string): T {
    if (!key) {
      return this.config as T;
    }
    const parts = key.split('.');
    let current: unknown = this.config;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined as T;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current as T;
  }

  /** Change a config value at runtime */
  set(key: string, value: unknown): void {
    const parts = key.split('.');
    let current: Record<string, unknown> = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }

  /** Return the full configuration */
  getAll(): Record<string, unknown> {
    return this.config;
  }

  /** Get the description for a config key */
  getDescription(key: string): string | undefined {
    // Exact key match
    if (CONFIG_DESCRIPTIONS[key]) return CONFIG_DESCRIPTIONS[key];
    // Section prefix matching (e.g. 'agent' → does not return agent.* descriptions, single key only)
    return undefined;
  }

  /** Return the full description map */
  getAllDescriptions(): Record<string, string> {
    return CONFIG_DESCRIPTIONS;
  }

  /** Return description map for a specific section (e.g. 'agent' → agent.* keys) */
  getSectionDescriptions(section: string): Record<string, string> {
    const prefix = section + '.';
    const result: Record<string, string> = {};
    for (const [key, desc] of Object.entries(CONFIG_DESCRIPTIONS)) {
      if (key.startsWith(prefix)) result[key] = desc;
    }
    return result;
  }

  /** Load a YAML file (returns empty object if file is absent) */
  private loadYaml(filePath: string): Record<string, unknown> {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return (yaml.load(content) as Record<string, unknown>) || {};
      }
    } catch {
      // Return empty object on file load failure
    }
    return {};
  }

  /** Deep merge (overwrites target with source) */
  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        target[key] = this.deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        );
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }
}
