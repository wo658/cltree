/**
 * CLI router controller
 *
 * Handles all CLI commands through the single POST /api/cli endpoint.
 * The frontend's api-client.ts sends requests in the form { cmd: ['s', 'list'] }.
 */
import { Controller, Post, Body } from '@nestjs/common';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CliResponse, ExplainViewData, ExplainStep, CodeAnnotation, PreviewViewData, DiffViewData } from '../../shared/types';
import { buildDiffViewData } from '../diff/diff.utils';
import { SessionService } from '../session/session.service';
import { PaneService } from '../pane/pane.service';
import { RepoService } from '../repo/repo.service';
import { ConfigService } from '../config/config.service';
import { DbService } from '../db/db.service';
import { BrowseService } from '../browse/browse.service';

@Controller('api')
export class CliController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly paneService: PaneService,
    private readonly repoService: RepoService,
    private readonly configService: ConfigService,
    private readonly db: DbService,
    private readonly eventEmitter: EventEmitter2,
    private readonly browseService: BrowseService,
  ) {}

  @Post('cli')
  handleCli(@Body() body: { cmd: string[]; data?: unknown }): CliResponse | Promise<CliResponse> {
    const [domain, verb, ...args] = body.cmd;

    try {
      if (domain === 's' || domain === 'session') {
        return this.handleSession(verb, args);
      }
      if (domain === 'p' || domain === 'pane') {
        return this.handlePane(verb, args, body);
      }
      if (domain === 'w' || domain === 'workspace') {
        return this.handleWorkspace(verb, args);
      }
      if (domain === 'issue') {
        return this.handleIssue(verb, args);
      }
      if (domain === 'layout') {
        return this.handleLayout(verb, args, body);
      }
      if (domain === 'cfg' || domain === 'config') {
        return this.handleConfig(verb, args);
      }
      if (domain === 'fs') {
        return this.handleFs(verb, args, body);
      }
      if (domain === 'explain') {
        return this.handleExplain(verb, args);
      }
      if (domain === 'browse') {
        return this.handleBrowse(verb, args);
      }
      if (domain === 'diff') {
        return this.handleDiff(verb, args);
      }
      return { ok: false, data: null, actions: [], error: `Unknown domain: ${domain}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, data: null, actions: [], error: message };
    }
  }

  // ─────────────────────────────────────────────
  // Session command routing
  // ─────────────────────────────────────────────

  private handleSession(verb: string, args: string[]): CliResponse {
    switch (verb) {
      case 'list': {
        const sessions = this.sessionService.list();
        return {
          ok: true,
          data: { sessions },
          actions: [{ cmd: ['s', 'create', '--name', '<name>'], desc: 'Create session' }],
        };
      }

      case 'inspect': {
        const data = this.sessionService.inspect(this.sessionService.resolveId(args[0]));
        return {
          ok: true,
          data,
          actions: [
            { cmd: ['p', 'spawn', '--session', args[0]], desc: 'Spawn agent' },
            { cmd: ['s', 'complete', args[0]], desc: 'Complete session' },
          ],
        };
      }

      case 'create': {
        const name = this.getArg(args, '--name');
        const cwd = this.getArg(args, '--cwd') || undefined;
        const parentSessionId = this.getArg(args, '--parent');
        const workspaceId = this.getArg(args, '--workspace') || undefined;
        const issueNumber = this.getArg(args, '--issue');
        const shouldSpawn = args.includes('--spawn');

        // --parent + --issue = worktree sub-session flow
        if (parentSessionId && issueNumber) {
          return this.createWorktreeSession(parentSessionId, parseInt(issueNumber, 10), workspaceId);
        }

        const session = this.sessionService.create({
          name: name || `session-${Date.now()}`,
          cwd: cwd || undefined,
          parentSessionId: parentSessionId || undefined,
          workspaceId: workspaceId || undefined,
        });

        // --spawn: Auto-create agent
        let spawnedPane = null;
        if (shouldSpawn) {
          spawnedPane = this.paneService.spawn({ sessionId: session.id });
        }

        // Switch session
        this.sessionService.switchTo(session.id);

        return {
          ok: true,
          data: { session, spawnedPane },
          actions: spawnedPane
            ? [{ cmd: ['p', 'kill', spawnedPane.id], desc: 'Stop agent' }]
            : [{ cmd: ['p', 'spawn', '--session', session.id], desc: 'Spawn agent' }],
        };
      }

      case 'switch': {
        this.sessionService.switchTo(this.sessionService.resolveId(args[0]));
        return { ok: true, data: { switched: args[0] }, actions: [] };
      }

      case 'delete': {
        const delId = this.sessionService.resolveId(args[0]);
        this.sessionService.delete(delId);
        return { ok: true, data: { deleted: delId }, actions: [] };
      }

      case 'rename': {
        const session = this.sessionService.rename(this.sessionService.resolveId(args[0]), args[1]);
        return { ok: true, data: { session }, actions: [] };
      }

      case 'complete': {
        return this.completeSession(args);
      }

      case 'archive': {
        const session = this.sessionService.archive(this.sessionService.resolveId(args[0]));
        return { ok: true, data: { session }, actions: [] };
      }

      case 'open-editor': {
        const id = args[0]
          ? this.sessionService.resolveId(args[0])
          : this.sessionService.getActiveSessionId();
        if (!id) {
          return { ok: false, data: null, actions: [], error: 'Session ID required' };
        }
        const sess = this.sessionService.findById(id);
        if (!sess) {
          return { ok: false, data: null, actions: [], error: `Session not found: ${id}` };
        }
        const targetPath = sess.worktreePath || sess.cwd;
        try {
          execSync(`code "${targetPath}"`, {
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('not found') || msg.includes('ENOENT')) {
            return { ok: false, data: null, actions: [], error: 'VS Code CLI (code) not found. Run "Shell Command: Install code command in PATH" in VS Code.' };
          }
          return { ok: false, data: null, actions: [], error: `Failed to open editor: ${msg}` };
        }
        return { ok: true, data: { opened: targetPath }, actions: [] };
      }

      case 'set-issue-repo': {
        const rawId = this.getArg(args, '--session');
        const id = rawId
          ? this.sessionService.resolveId(rawId)
          : this.sessionService.getActiveSessionId();
        const issueRepo = this.getArg(args, '--repo') || args[0];
        if (!id || !issueRepo || !issueRepo.includes('/')) {
          return { ok: false, data: null, actions: [], error: '--repo owner/repo required. Example: cltree s set-issue-repo --repo owner/repo' };
        }
        const session = this.sessionService.setIssueRepo(id, issueRepo);
        return {
          ok: true,
          data: { session },
          actions: [{ cmd: ['issue', 'list'], desc: 'View issue list' }],
        };
      }

      case 'start': {
        const id = this.sessionService.resolveId(args[0]);
        const started = this.paneService.startAllBySession(id);
        return { ok: true, data: { started, sessionId: id }, actions: [
          { cmd: ['s', 'stop', args[0]], desc: 'Stop all panes in session' },
        ] };
      }

      case 'stop': {
        const id = this.sessionService.resolveId(args[0]);
        const stopped = this.paneService.stopAllBySession(id);
        return { ok: true, data: { stopped, sessionId: id }, actions: [
          { cmd: ['s', 'start', args[0]], desc: 'Start all panes in session' },
        ] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown session command: ${verb}` };
    }
  }

  // ─────────────────────────────────────────────
  // Pane command routing
  // ─────────────────────────────────────────────

  private handlePane(verb: string, args: string[], body: { cmd: string[]; data?: unknown }): CliResponse {
    switch (verb) {
      case 'spawn': {
        const sessionId = this.getArg(args, '--session') || '';
        if (!sessionId) return { ok: false, data: null, actions: [], error: '--session required. CLTREE_SESSION_ID env var is automatically injected inside an agent PTY.' };
        const cmd = this.getArg(args, '--cmd') || undefined;
        const pane = this.paneService.spawn({ sessionId, cmd });
        return {
          ok: true,
          data: { pane },
          actions: [{ cmd: ['p', 'kill', pane.id], desc: 'Kill pane' }],
        };
      }

      case 'attach': {
        const sessionId = this.getArg(args, '--session') || '';
        if (!sessionId) return { ok: false, data: null, actions: [], error: '--session required. CLTREE_SESSION_ID env var is automatically injected inside an agent PTY.' };
        const cmd = this.getArg(args, '--cmd') || 'zsh';
        const cwd = this.getArg(args, '--cwd') || undefined;
        const pane = this.paneService.attach({ sessionId, cmd, cwd });
        return { ok: true, data: { pane }, actions: [] };
      }

      case 'kill': {
        this.paneService.kill(args[0]);
        return { ok: true, data: { killed: args[0] }, actions: [
          { cmd: ['p', 'restart', args[0]], desc: 'Restart pane' },
        ] };
      }

      case 'remove': {
        this.paneService.remove(args[0]);
        return { ok: true, data: { removed: args[0] }, actions: [] };
      }

      case 'restart': {
        const pane = this.paneService.restart(args[0]);
        return { ok: true, data: { pane }, actions: [
          { cmd: ['p', 'kill', pane.id], desc: 'Kill pane' },
        ] };
      }

      case 'set-cmd': {
        const paneId = args[0];
        const cmd = args.slice(1).join(' ') || this.getArg(args, '--cmd') || '';
        if (!paneId || !cmd) {
          return { ok: false, data: null, actions: [], error: 'Usage: cltree p set-cmd <paneId> <cmd>' };
        }
        this.db.updatePane(paneId, { cmd });
        const row = this.db.getPane(paneId);
        if (!row) {
          return { ok: false, data: null, actions: [], error: `Pane not found: ${paneId}` };
        }
        const pane: import('../../shared/types').PaneRef = {
          id: row.id,
          type: row.type as import('../../shared/types').PaneType,
          cmd: row.cmd,
          cwd: row.cwd || undefined,
          status: row.status as import('../../shared/types').PaneStatus,
          sessionId: row.session_id,
        };
        this.eventEmitter.emit('pane.statusChanged', { paneId, status: row.status, pane });
        return { ok: true, data: { pane }, actions: [
          { cmd: ['p', 'restart', paneId], desc: 'Restart pane' },
        ] };
      }

      case 'set-cwd': {
        const paneId = args[0];
        const cwd = args[1] || this.getArg(args, '--cwd') || '';
        if (!paneId || !cwd) {
          return { ok: false, data: null, actions: [], error: 'Usage: cltree p set-cwd <paneId> <cwd>' };
        }
        this.db.updatePane(paneId, { cwd });
        const row = this.db.getPane(paneId);
        if (!row) {
          return { ok: false, data: null, actions: [], error: `Pane not found: ${paneId}` };
        }
        const pane: import('../../shared/types').PaneRef = {
          id: row.id,
          type: row.type as import('../../shared/types').PaneType,
          cmd: row.cmd,
          cwd: row.cwd || undefined,
          status: row.status as import('../../shared/types').PaneStatus,
          sessionId: row.session_id,
        };
        this.eventEmitter.emit('pane.statusChanged', { paneId, status: row.status, pane });
        return { ok: true, data: { pane }, actions: [] };
      }

      case 'pin-cwd': {
        const paneId = args[0];
        if (!paneId) {
          return { ok: false, data: null, actions: [], error: 'Usage: cltree p pin-cwd <paneId>' };
        }
        const result = this.paneService.pinCwd(paneId);
        if (!result) {
          return { ok: false, data: null, actions: [], error: 'Cannot get cwd of PTY process' };
        }
        // Emit session update event
        const session = this.sessionService.inspect(result.sessionId);
        if (session) {
          this.eventEmitter.emit('session.updated', session);
        }
        return { ok: true, data: { cwd: result.cwd, sessionId: result.sessionId }, actions: [] };
      }

      case 'ls': {
        if (args.includes('--all')) {
          const wsId = this.sessionService.getActiveWorkspaceId();
          if (!wsId) return { ok: false, data: null, actions: [], error: 'No active workspace' };
          const data = this.paneService.listByWorkspace(wsId);
          return { ok: true, data, actions: [] };
        }
        const sessionId = this.getArg(args, '--session') || this.sessionService.getActiveSessionId() || '';
        const result = this.paneService.list(sessionId);
        return { ok: true, data: result, actions: [] };
      }

      case 'inspect': {
        const paneId = args[0];
        if (!paneId) return { ok: false, data: null, actions: [], error: 'paneId required' };
        const data = this.paneService.inspect(paneId);
        return {
          ok: true,
          data,
          actions: [
            { cmd: ['p', 'read', paneId], desc: 'Read output' },
            { cmd: ['p', 'kill', paneId], desc: 'Kill pane' },
          ],
        };
      }

      case 'read': {
        const paneId = args[0];
        if (!paneId) return { ok: false, data: null, actions: [], error: 'paneId required' };
        const lines = parseInt(this.getArg(args, '--lines') || '50', 10);
        const plain = args.includes('--plain');
        const data = this.paneService.read(paneId, { lines, plain });
        return { ok: true, data, actions: [] };
      }

      case 'write': {
        const paneId = args[0];
        if (!paneId) return { ok: false, data: null, actions: [], error: 'paneId required' };
        const input = args.slice(1).join(' ');
        if (!input) return { ok: false, data: null, actions: [], error: 'Input data required' };
        const data = this.paneService.write(paneId, input);
        return { ok: true, data, actions: [] };
      }

      case 'view-register': {
        const { id, viewType, sessionId, meta, slotId } = (body as { data?: Record<string, unknown> }).data as Record<string, unknown>;
        if (!id || !viewType || !sessionId) {
          return { ok: false, data: null, actions: [], error: 'id, viewType, sessionId required' };
        }
        // Create/update GuiPane (view_panes)
        const existingVp = this.db.getViewPane(id as string);
        if (!existingVp) {
          this.db.insertViewPane({
            id: id as string,
            view_type: viewType as string,
            session_id: sessionId as string,
            meta: JSON.stringify(meta || {}),
            active_slot_id: (slotId as string) || null,
            created_at: new Date().toISOString(),
          });
        }
        // Create initial slot (if slotId is provided)
        if (slotId) {
          const existingSlot = this.db.getSlot(slotId as string);
          if (!existingSlot) {
            this.db.insertSlot({
              id: slotId as string,
              gui_pane_id: id as string,
              view_type: viewType as string,
              data: JSON.stringify(meta || {}),
              label: null,
              created_at: new Date().toISOString(),
            });
          }
        }
        return { ok: true, data: { registered: id }, actions: [] };
      }

      case 'view-list': {
        const sessionId = this.getArg(args, '--session') || this.sessionService.getActiveSessionId() || '';
        if (!sessionId) return { ok: false, data: null, actions: [], error: 'sessionId required' };
        const vpRows = this.db.listViewPanesBySession(sessionId);
        const guiPanes = vpRows.map((vp) => {
          const slotRows = this.db.listSlotsByGuiPane(vp.id);
          return {
            id: vp.id,
            contentType: 'gui' as const,
            sessionId: vp.session_id,
            activeSlotId: vp.active_slot_id || slotRows[0]?.id || '',
            slots: slotRows.map((s) => ({
              id: s.id,
              viewType: s.view_type,
              data: JSON.parse(s.data || '{}'),
              label: s.label || undefined,
            })),
          };
        });
        return { ok: true, data: { guiPanes }, actions: [] };
      }

      case 'slot-activate': {
        const slotId = args[0];
        const guiPaneId = args[1];
        if (!slotId || !guiPaneId) return { ok: false, data: null, actions: [], error: 'slotId, guiPaneId required' };
        this.db.updateViewPane(guiPaneId, { active_slot_id: slotId });
        return { ok: true, data: { guiPaneId, activeSlotId: slotId }, actions: [] };
      }

      case 'slot-delete': {
        const slotId = args[0];
        const guiPaneId = args[1];
        if (!slotId) return { ok: false, data: null, actions: [], error: 'slotId required' };
        this.db.deleteSlot(slotId);
        if (guiPaneId) {
          this.eventEmitter.emit('view.removed', { guiPaneId, slotId });
        }
        return { ok: true, data: { deleted: slotId }, actions: [] };
      }

      case 'view-unregister': {
        const vpId = args[0];
        if (!vpId) return { ok: false, data: null, actions: [], error: 'viewPane id required' };
        this.db.deleteViewPane(vpId);
        return { ok: true, data: { unregistered: vpId }, actions: [] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown pane command: ${verb}` };
    }
  }

  // ─────────────────────────────────────────────
  // Workspace command routing
  // ─────────────────────────────────────────────

  private handleWorkspace(verb: string, args: string[]): CliResponse {
    switch (verb) {
      case 'list': {
        const workspaces = this.sessionService.listWorkspaces();
        return {
          ok: true,
          data: { workspaces },
          actions: [{ cmd: ['w', 'create', '--name', '<name>'], desc: 'Create workspace' }],
        };
      }

      case 'create': {
        const name = this.getArg(args, '--name');
        if (!name) {
          return { ok: false, data: null, actions: [], error: '--name required' };
        }
        const desc = this.getArg(args, '--desc') || undefined;
        const workspace = this.sessionService.createWorkspace({ name, description: desc });
        // Auto-switch
        this.sessionService.switchWorkspace(workspace.id);
        return {
          ok: true,
          data: { workspace },
          actions: [{ cmd: ['s', 'create', '--name', '<name>'], desc: 'Create session' }],
        };
      }

      case 'switch': {
        this.sessionService.switchWorkspace(args[0]);
        return { ok: true, data: { switched: args[0] }, actions: [] };
      }

      case 'delete': {
        this.sessionService.deleteWorkspace(args[0]);
        return { ok: true, data: { deleted: args[0] }, actions: [] };
      }

      case 'rename': {
        const workspace = this.sessionService.renameWorkspace(args[0], args[1]);
        return { ok: true, data: { workspace }, actions: [] };
      }

      case 'set-gh-profile': {
        const profile = this.getArg(args, '--profile');
        if (!profile) {
          return { ok: false, data: null, actions: [], error: '--profile required. Example: cltree w set-gh-profile --profile octo-user' };
        }
        const wsId = this.getArg(args, '--workspace') || this.sessionService.getActiveWorkspaceId();
        if (!wsId) {
          return { ok: false, data: null, actions: [], error: 'No active workspace' };
        }
        const workspace = this.sessionService.setGhProfile(wsId, profile === 'none' ? null : profile);
        return {
          ok: true,
          data: { workspace },
          actions: [],
        };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown workspace command: ${verb}` };
    }
  }

  // ─────────────────────────────────────────────
  // Issue command routing
  // ─────────────────────────────────────────────

  private handleIssue(verb: string, args: string[]): CliResponse {
    const repo = this.getArg(args, '--repo') || this.getActiveSessionIssueRepo();

    if (!repo || !repo.includes('/') || repo === '/') {
      return { ok: false, data: null, actions: [], error: 'repo not found. Provide --repo owner/repo or set it via cltree s set-issue-repo' };
    }

    // ghProfile token for the active session's workspace
    const ghToken = this.resolveGhTokenFromActiveSession();

    switch (verb) {
      case 'list': {
        const issues = this.repoService.listIssues(repo, ghToken);
        return { ok: true, data: { issues }, actions: [] };
      }

      case 'create': {
        const title = this.getArg(args, '--title');
        if (!title) {
          return { ok: false, data: null, actions: [], error: '--title required' };
        }
        const body = this.getArg(args, '--body') || undefined;
        const result = this.repoService.createIssue(repo, title, body, ghToken);
        return { ok: true, data: result, actions: [] };
      }

      case 'view': {
        const number = parseInt(args[0], 10);
        if (isNaN(number)) {
          return { ok: false, data: null, actions: [], error: 'Issue number required' };
        }
        const issue = this.repoService.fetchIssue(repo, number, ghToken);
        return { ok: true, data: { issue }, actions: [] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown issue command: ${verb}` };
    }
  }

  // ─────────────────────────────────────────────
  // Layout save/load
  // ─────────────────────────────────────────────

  private handleLayout(verb: string, args: string[], body: { data?: unknown }): CliResponse {
    const sessionId = args[0] || this.sessionService.getActiveSessionId();

    switch (verb) {
      case 'save': {
        if (!sessionId) return { ok: false, data: null, actions: [], error: 'sessionId required' };
        const layoutJson = typeof body.data === 'string' ? body.data : JSON.stringify(body.data);
        this.db.setAppState(`layout:${sessionId}`, layoutJson);
        return { ok: true, data: { saved: sessionId }, actions: [] };
      }

      case 'load': {
        if (!sessionId) return { ok: false, data: null, actions: [], error: 'sessionId required' };
        const raw = this.db.getAppState(`layout:${sessionId}`);
        let layout = null;
        if (raw) {
          try { layout = JSON.parse(raw); } catch { /* Ignore parse failure */ }
        }
        return { ok: true, data: { sessionId, layout }, actions: [] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown layout command: ${verb}` };
    }
  }

  // ─────────────────────────────────────────────
  // Filesystem command routing
  // ─────────────────────────────────────────────

  private handleFs(verb: string, args: string[], body?: { cmd: string[]; data?: unknown }): CliResponse | Promise<CliResponse> {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');

    switch (verb) {
      case 'ls': {
        const dirPath = args[0] || process.env.CLTREE_CWD || process.cwd();
        const resolved = dirPath.startsWith('~')
          ? dirPath.replace('~', os.homedir())
          : path.resolve(dirPath);

        try {
          const entries = fs.readdirSync(resolved, { withFileTypes: true });
          const dirs = entries
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => ({
              name: e.name,
              path: path.join(resolved, e.name),
              isGitRepo: fs.existsSync(path.join(resolved, e.name, '.git')),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

          return {
            ok: true,
            data: { path: resolved, dirs, parent: path.dirname(resolved) },
            actions: [],
          };
        } catch {
          return { ok: false, data: null, actions: [], error: `Failed to read directory: ${resolved}` };
        }
      }

      case 'search': {
        const { handleFsSearch } = require('./fs-handler') as typeof import('./fs-handler');
        const d = (body?.data ?? {}) as { query?: string; cwd?: string; mode?: 'filename' | 'content' };
        const query = d.query ?? '';
        const cwd = d.cwd ?? process.env.CLTREE_CWD ?? process.cwd();
        const mode = d.mode ?? 'filename';
        return handleFsSearch({ query, cwd, mode });
      }

      case 'read-file': {
        const { handleFsReadFile } = require('./fs-handler') as typeof import('./fs-handler');
        const filePath = args[0];
        if (!filePath) {
          return { ok: false, data: null, actions: [], error: 'File path required' };
        }
        return handleFsReadFile(filePath);
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown fs command: ${verb}` };
    }
  }

  /**
   * Worktree sub-session creation orchestration.
   * 1. Fetch repo/issueRepo from the parent session
   * 2. gh issue view → issue info
   * 3. git worktree add → branch + directory
   * 4. Create sub-session (cwd = worktree)
   * 5. Spawn agent (cwd = worktree) + auto-send initial issue message
   * 6. Switch to the sub-session
   */
  private createWorktreeSession(parentId: string, issueNumber: number, workspaceId?: string): CliResponse {
    const resolvedParentId = this.sessionService.resolveId(parentId);
    const parent = this.sessionService.findById(resolvedParentId);
    if (!parent) {
      return { ok: false, data: null, actions: [], error: `Parent session not found: ${parentId}` };
    }

    const repo = parent.repo;
    if (!repo) {
      return { ok: false, data: null, actions: [], error: 'Parent session has no repo' };
    }

    // 1. Fetch issue info (using workspace ghProfile token)
    const ghToken = this.resolveGhToken(resolvedParentId);
    const issueRepo = parent.issueRepo || repo;
    let issueTitle = `issue-${issueNumber}`;
    let issueData: import('../../shared/types').IssueViewData | null = null;
    try {
      issueData = this.repoService.fetchIssue(issueRepo, issueNumber, ghToken);
      issueTitle = issueData.title;
    } catch {
      // Continue even if issue fetch fails
    }

    // 2. Look up existing session (issue number + workspace)
    const resolvedWorkspaceId = workspaceId || parent.workspaceId;
    const existingSession = resolvedWorkspaceId
      ? this.db.findSessionByIssue(resolvedWorkspaceId, issueNumber)
      : undefined;
    if (existingSession) {
      this.sessionService.switchTo(existingSession.id);
      return {
        ok: true,
        data: { session: existingSession, worktreePath: existingSession.worktree_path, branch: existingSession.branch, reused: true },
        actions: [
          { cmd: ['issue', 'view', String(issueNumber)], desc: 'View issue details' },
        ],
      };
    }

    // 3. Look up existing worktree by branch name → create if not found
    const branch = this.repoService.generateBranchName(issueNumber, issueTitle);
    const existingWorktree = this.repoService.findWorktreeByBranch(parent.cwd, branch);
    let worktreePath: string;

    if (existingWorktree) {
      worktreePath = existingWorktree.path;
    } else {
      try {
        worktreePath = this.repoService.createWorktree({
          repoPath: parent.cwd,
          branch,
          worktreeName: `${parent.name}-issue-${issueNumber}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, data: null, actions: [], error: `Failed to create worktree: ${msg}` };
      }
    }

    // 4. Save issue context file (.cltree/issue.md)
    if (issueData) {
      try {
        this.repoService.writeIssueContext(worktreePath, issueData);
      } catch {
        // Continue even if file save fails (agent can fetch via cltree issue view)
      }
    }

    // 5. Create sub-session (cwd = worktree)
    const session = this.sessionService.createWorktreeSubSession({
      name: issueTitle.replace(/^#\d+\s*/, '').slice(0, 30),
      cwd: worktreePath,
      parentSessionId: resolvedParentId,
      workspaceId: resolvedWorkspaceId,
      issueNumber,
      worktreePath,
      branch,
      repo,
      issueRepo,
    });

    // 6. Agent spawn — use the same base cmd + flags as a regular spawn
    // Only the system prompt is overridden with issueHint/worktree context (handled inside buildAgentCmd)
    const spawnedPane = this.paneService.spawn({
      sessionId: session.id,
      cwd: worktreePath,
      issueHint: issueData
        ? { title: issueData.title, labels: issueData.labels.map((l) => l.name) }
        : undefined,
    });

    // 6.5 Auto-start: send worktree.initialMessage from config to the agent
    const autoStart = this.configService.get<boolean>('worktree.autoStart') !== false;
    if (autoStart) {
      const startMessage = this.configService.get<string>('worktree.initialMessage') ?? '';
      if (startMessage) {
        this.paneService.writeToAgentDelayed(spawnedPane.id, startMessage);
      }
    }

    // 7. Switch to the sub-session
    this.sessionService.switchTo(session.id);

    return {
      ok: true,
      data: { session, spawnedPane, worktreePath, branch },
      actions: [
        { cmd: ['issue', 'view', String(issueNumber)], desc: 'View issue details' },
        { cmd: ['p', 'kill', spawnedPane.id], desc: 'Stop agent' },
      ],
    };
  }

  /**
   * Session completion orchestration.
   * Worktree session: kill panes → merge or PR → remove worktree → delete branch → switch to parent
   * Regular session: change status to completed only
   *
   * Options:
   *   --pr          Use PR creation method (default: local merge)
   *   --no-cleanup  Skip worktree/branch deletion
   *
   * On conflict: keep merge state → spawn agent on parent session (conflict resolution mission)
   */
  private completeSession(args: string[]): CliResponse {
    const sessionId = this.sessionService.resolveId(args[0]);
    const session = this.sessionService.findById(sessionId);
    if (!session) {
      return { ok: false, data: null, actions: [], error: `Session not found: ${args[0]}` };
    }

    const usePr = args.includes('--pr');
    const noCleanup = args.includes('--no-cleanup');

    // Regular session (not a worktree) → change status only
    if (!session.worktreePath || !session.branch || !session.parentSessionId) {
      const updated = this.sessionService.complete(sessionId);
      return { ok: true, data: { session: updated, pr: null }, actions: [] };
    }

    // Look up parent session (repo to merge into)
    const parent = this.sessionService.findById(session.parentSessionId);
    if (!parent) {
      return { ok: false, data: null, actions: [], error: 'Parent session not found' };
    }

    const ghToken = this.resolveGhToken(sessionId);
    let prInfo: { number: number; url: string } | null = null;

    // 1. Kill all panes in this session
    this.paneService.killAllBySession(sessionId);

    // 2. Merge or create PR
    if (usePr) {
      try {
        const repo = session.repo || parent.repo;
        if (!repo) {
          return { ok: false, data: null, actions: [], error: 'No repo info' };
        }
        const nameWithoutIssue = session.name.replace(/^#\d+\s*/, '');
        const title = session.issueNumber
          ? `#${session.issueNumber} ${nameWithoutIssue}`
          : session.name;
        const body = session.issueNumber
          ? `Closes #${session.issueNumber}`
          : '';
        prInfo = this.repoService.createPr({
          repoPath: parent.cwd,
          repo,
          branch: session.branch,
          title,
          body,
          ghToken,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, data: null, actions: [], error: `Failed to create PR: ${msg}` };
      }
    } else {
      // Local merge — detect conflicts
      try {
        const result = this.repoService.mergeToMain(parent.cwd, session.branch);

        if (!result.merged && result.conflict) {
          // Conflict detected: spawn agent on parent session to guide conflict resolution
          const conflict = result.conflict;
          const fileList = conflict.files.join(', ');
          const mission = [
            `MERGE CONFLICT RESOLUTION REQUIRED.`,
            `A merge conflict occurred: Branch "${conflict.branch}" → "${conflict.mainBranch}".`,
            `Conflicting files: ${fileList}`,
            `The merge state is preserved in the current directory (${parent.cwd}).`,
            ``,
            `Steps to resolve:`,
            `1. Inspect the conflicting files and resolve conflict markers (<<<<<<< ======= >>>>>>>)`,
            `2. After resolving, run git add <file> && git commit to complete the merge`,
            `3. To abort the merge, run git merge --abort`,
            ``,
            `Conflict diff summary:`,
            conflict.diff.slice(0, 3000),
          ].join('\\n');

          const spawnedPane = this.paneService.spawn({
            sessionId: session.parentSessionId,
            cwd: parent.cwd,
            mission,
          });

          // Mark sub-session complete but keep the worktree (merge in progress)
          this.sessionService.complete(sessionId);
          this.sessionService.switchTo(session.parentSessionId);

          return {
            ok: true,
            data: {
              session: this.sessionService.findById(sessionId),
              conflict,
              resolverPane: spawnedPane,
              pr: null,
            },
            actions: [
              { cmd: ['s', 'switch', session.parentSessionId], desc: 'Resolving conflict on parent session' },
            ],
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, data: null, actions: [], error: `Merge failed: ${msg}` };
      }
    }

    // 3. Remove worktree + delete branch (unless --no-cleanup is specified)
    if (!noCleanup) {
      try {
        this.repoService.removeWorktree(session.worktreePath);
      } catch (err) {
        this.sessionService.complete(sessionId);
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: true,
          data: { session: this.sessionService.findById(sessionId), pr: prInfo, warning: `Failed to delete worktree: ${msg}` },
          actions: [],
        };
      }

      // Delete branch only for local merge (not PR workflow)
      if (!usePr) {
        try {
          this.repoService.deleteBranch(parent.cwd, session.branch);
        } catch { /* Ignore branch deletion failure */ }
      }
    }

    // 4. Mark session as complete
    const completed = this.sessionService.complete(sessionId);

    // 5. Switch to parent session
    this.sessionService.switchTo(session.parentSessionId);

    return {
      ok: true,
      data: { session: completed, pr: prInfo },
      actions: [{ cmd: ['s', 'switch', session.parentSessionId], desc: 'Switched to parent session' }],
    };
  }

  // ─────────────────────────────────────────────
  // Config command routing
  // ─────────────────────────────────────────────

  private handleConfig(verb: string, args: string[]): CliResponse {
    switch (verb) {
      case 'get': {
        const key = args[0];
        if (key) {
          const value = this.configService.get(key);
          return { ok: true, data: { key, value }, actions: [] };
        }
        return { ok: true, data: { config: this.configService.getAll() }, actions: [] };
      }

      case 'set': {
        const key = args[0];
        const value = args.slice(1).join(' ');
        if (!key) {
          return { ok: false, data: null, actions: [], error: 'key required. Example: cltree cfg set agent.cli claude' };
        }
        // Attempt JSON parsing (arrays/booleans/numbers)
        let parsed: unknown = value;
        try { parsed = JSON.parse(value); } catch { /* Keep as string */ }
        this.configService.set(key, parsed);
        return { ok: true, data: { key, value: parsed }, actions: [] };
      }

      case 'agent': {
        // Retrieve agent settings only (convenience shortcut)
        const agentConfig = this.configService.get('agent');
        return { ok: true, data: { agent: agentConfig }, actions: [] };
      }

      case 'info': {
        // Combine project/global settings + detected environment info
        const config = this.configService.getAll();
        const info = {
          config,
          env: {
            nodeVersion: process.version,
            shell: process.env.SHELL || 'unknown',
            cwd: process.env.CLTREE_CWD || process.cwd(),
            platform: process.platform,
          },
          paths: {
            globalConfig: '~/.config/cltree/config.yaml',
            projectConfig: '.cltree/config.yaml',
            db: '~/.cltree/cltree.db',
            lock: '~/.cltree/cltree.lock',
          },
        };
        return { ok: true, data: info, actions: [] };
      }

      case 'help': {
        const key = args[0];
        if (key) {
          // Exact key → single description, section name → descriptions for that section
          const exactDesc = this.configService.getDescription(key);
          if (exactDesc) {
            const value = this.configService.get(key);
            return { ok: true, data: { key, value, description: exactDesc }, actions: [] };
          }
          const sectionDescs = this.configService.getSectionDescriptions(key);
          if (Object.keys(sectionDescs).length > 0) {
            const value = this.configService.get(key);
            return { ok: true, data: { key, value, descriptions: sectionDescs }, actions: [] };
          }
          return { ok: false, data: null, actions: [], error: `Unknown config key: ${key}` };
        }
        // Full description map + current values
        const descriptions = this.configService.getAllDescriptions();
        const config = this.configService.getAll();
        return { ok: true, data: { descriptions, config }, actions: [] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown config command: ${verb}. Usage: get, set, agent, info, help` };
    }
  }

  // ─────────────────────────────────────────────
  // Explain command routing
  // ─────────────────────────────────────────────

  private handleExplain(verb: string, args: string[]): CliResponse {
    switch (verb) {
      case 'create': {
        const title = this.getArg(args, '--title') || 'Explanation';
        const sessionId = this.getArg(args, '--session') || '';
        if (!sessionId) return { ok: false, data: null, actions: [], error: '--session required. CLTREE_SESSION_ID env var is automatically injected inside an agent PTY.' };

        const explainData: ExplainViewData = { title, currentStep: 0, steps: [], completed: false };

        // Look up existing GuiPane for the session
        const existingVps = this.db.listViewPanesBySession(sessionId);
        let guiPaneId: string;

        if (existingVps.length > 0) {
          guiPaneId = existingVps[0].id;
        } else {
          // Create new GuiPane
          guiPaneId = `gui-explain-${crypto.randomUUID().slice(0, 8)}`;
          this.db.insertViewPane({
            id: guiPaneId,
            view_type: 'explain',
            session_id: sessionId,
            meta: JSON.stringify({ title }),
            active_slot_id: null,
            created_at: new Date().toISOString(),
          });
        }

        // Create new explain slot + update active_slot_id
        const slotId = crypto.randomUUID();
        this.db.updateViewPane(guiPaneId, { active_slot_id: slotId });
        this.db.insertSlot({
          id: slotId,
          gui_pane_id: guiPaneId,
          view_type: 'explain',
          data: JSON.stringify(explainData),
          label: title,
          created_at: new Date().toISOString(),
        });

        this.eventEmitter.emit('view.pushed', {
          guiPaneId,
          slot: { id: slotId, guiPaneId, sessionId, type: 'explain', data: explainData, label: title },
        });

        return {
          ok: true,
          data: { guiPaneId, slotId, title },
          actions: [
            { cmd: ['explain', 'step', '--slot', slotId, '--md', '<description>'], desc: 'Add step' },
            { cmd: ['explain', 'step', '--slot', slotId, '--code', '<file:start-end>', '--md', '<description>'], desc: 'Code reference step (auto-detect language)' },
            { cmd: ['explain', 'step', '--slot', slotId, '--snippet', '<code>', '--lang', '<language>', '--md', '<description>'], desc: 'Inline code step' },
            { cmd: ['explain', 'step', '--slot', slotId, '--mermaid', '<diagram>', '--md', '<description>'], desc: 'Add diagram step' },
          ],
        };
      }

      case 'step': {
        const slotId = this.getArg(args, '--slot') || this.findActiveExplainSlotId();
        if (!slotId) return { ok: false, data: null, actions: [], error: 'No active explain in progress. Run cltree explain create --title "<title>" first.' };

        const md = this.getArg(args, '--md');
        if (!md) return { ok: false, data: null, actions: [], error: '--md required (markdown description text)' };

        const slotRow = this.db.findSlotByIdPrefix(slotId);
        if (!slotRow) return { ok: false, data: null, actions: [], error: `Slot not found: ${slotId}` };

        const data = JSON.parse(slotRow.data || '{}') as ExplainViewData;
        if (!data.steps) data.steps = [];
        if (!data.title) data.title = 'Explanation';
        if (data.completed) return { ok: false, data: null, actions: [
          { cmd: ['explain', 'create', '--title', '<title>'], desc: 'Start a new explanation session' },
        ], error: 'This explain is already completed. Create a new explain.' };
        const step: ExplainStep = { index: data.steps.length, markdown: md };

        // --code: resolve file reference (includes automatic language detection)
        const codeRef = this.getArg(args, '--code');
        if (codeRef) {
          step.codeRef = codeRef;
          const resolved = this.resolveCodeRef(codeRef, slotRow.gui_pane_id);
          if (resolved.code) step.codeSnippet = resolved.code;
          if (resolved.lang) step.language = resolved.lang;
        }

        // --snippet: inline code (takes priority over --code)
        const snippet = this.getArg(args, '--snippet');
        if (snippet) step.codeSnippet = snippet;

        // --lang: explicit specification takes priority over automatic detection
        const lang = this.getArg(args, '--lang');
        if (lang) step.language = lang;

        // --highlight: "1,3-5,10"
        const highlight = this.getArg(args, '--highlight');
        if (highlight) step.highlightLines = this.parseLineRanges(highlight);

        // --annotate: "3:description" or "5-7:description" (multiple allowed)
        const annotations = this.parseAnnotations(args);
        if (annotations.length > 0) step.annotations = annotations;

        // --mermaid: diagram source (mutually exclusive with --code/--snippet)
        const mermaidSrc = this.getArg(args, '--mermaid');
        if (mermaidSrc) {
          step.mermaid = mermaidSrc;
          delete step.codeRef;
          delete step.codeSnippet;
          delete step.highlightLines;
          delete step.annotations;
        }

        data.steps.push(step);
        this.db.updateSlot(slotRow.id, { data: JSON.stringify(data) });

        const vpRow = this.db.getViewPane(slotRow.gui_pane_id);
        this.eventEmitter.emit('view.updated', {
          guiPaneId: slotRow.gui_pane_id,
          slot: {
            id: slotRow.id,
            guiPaneId: slotRow.gui_pane_id,
            sessionId: vpRow?.session_id || '',
            type: 'explain',
            data,
            label: data.title,
          },
        });

        return {
          ok: true,
          data: { slotId: slotRow.id, stepIndex: step.index, totalSteps: data.steps.length },
          actions: [
            { cmd: ['explain', 'step', '--slot', slotRow.id, '--md', '<description>'], desc: 'Add next step' },
            { cmd: ['explain', 'step', '--slot', slotRow.id, '--code', '<file:start-end>', '--md', '<description>'], desc: 'Code reference step' },
            { cmd: ['explain', 'step', '--slot', slotRow.id, '--snippet', '<code>', '--lang', '<language>', '--md', '<description>'], desc: 'Inline code step' },
            { cmd: ['explain', 'done', '--slot', slotRow.id], desc: 'Mark explanation complete' },
          ],
        };
      }

      case 'update': {
        const slotId = this.getArg(args, '--slot') || this.findActiveExplainSlotId();
        if (!slotId) return { ok: false, data: null, actions: [], error: '--slot required' };

        const stepIdxStr = this.getArg(args, '--step');
        if (stepIdxStr == null) return { ok: false, data: null, actions: [], error: '--step <index> required' };
        const stepIdx = parseInt(stepIdxStr, 10);

        const slotRow = this.db.findSlotByIdPrefix(slotId);
        if (!slotRow) return { ok: false, data: null, actions: [], error: `Slot not found: ${slotId}` };

        const data = JSON.parse(slotRow.data || '{}') as ExplainViewData;
        if (!data.steps) data.steps = [];
        if (stepIdx < 0 || stepIdx >= data.steps.length) {
          return { ok: false, data: null, actions: [], error: `Invalid step index: ${stepIdx} (total ${data.steps.length})` };
        }

        const step = data.steps[stepIdx];

        const md = this.getArg(args, '--md');
        if (md) step.markdown = md;

        const codeRef = this.getArg(args, '--code');
        if (codeRef) {
          step.codeRef = codeRef;
          const resolved = this.resolveCodeRef(codeRef, slotRow.gui_pane_id);
          if (resolved.code) step.codeSnippet = resolved.code;
          if (resolved.lang && !step.language) step.language = resolved.lang;
        }

        const snippet = this.getArg(args, '--snippet');
        if (snippet) step.codeSnippet = snippet;

        const lang = this.getArg(args, '--lang');
        if (lang) step.language = lang;

        const highlight = this.getArg(args, '--highlight');
        if (highlight) step.highlightLines = this.parseLineRanges(highlight);

        const annotations = this.parseAnnotations(args);
        if (annotations.length > 0) step.annotations = annotations;

        // --mermaid: diagram source (mutually exclusive with --code/--snippet)
        const mermaidSrc = this.getArg(args, '--mermaid');
        if (mermaidSrc) {
          step.mermaid = mermaidSrc;
          delete step.codeRef;
          delete step.codeSnippet;
          delete step.highlightLines;
          delete step.annotations;
        }

        this.db.updateSlot(slotRow.id, { data: JSON.stringify(data) });

        const vpRow = this.db.getViewPane(slotRow.gui_pane_id);
        this.eventEmitter.emit('view.updated', {
          guiPaneId: slotRow.gui_pane_id,
          slot: {
            id: slotRow.id,
            guiPaneId: slotRow.gui_pane_id,
            sessionId: vpRow?.session_id || '',
            type: 'explain',
            data,
            label: data.title,
          },
        });

        return { ok: true, data: { slotId: slotRow.id, stepIndex: stepIdx }, actions: [] };
      }

      case 'done': {
        const slotId = this.getArg(args, '--slot') || this.findActiveExplainSlotId();
        if (!slotId) return { ok: false, data: null, actions: [], error: '--slot required' };

        const slotRow = this.db.findSlotByIdPrefix(slotId);
        if (!slotRow) return { ok: false, data: null, actions: [], error: `Slot not found: ${slotId}` };

        const data = JSON.parse(slotRow.data || '{}') as ExplainViewData;
        data.completed = true;
        this.db.updateSlot(slotRow.id, { data: JSON.stringify(data) });

        const vpRow = this.db.getViewPane(slotRow.gui_pane_id);
        this.eventEmitter.emit('view.updated', {
          guiPaneId: slotRow.gui_pane_id,
          slot: {
            id: slotRow.id,
            guiPaneId: slotRow.gui_pane_id,
            sessionId: vpRow?.session_id || '',
            type: 'explain',
            data,
            label: data.title,
          },
        });

        return { ok: true, data: { slotId: slotRow.id, completed: true, totalSteps: data.steps.length }, actions: [] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown explain command: ${verb}. Usage: create, step, update, done` };
    }
  }

  // ─────────────────────────────────────────────
  // Diff command routing
  // ─────────────────────────────────────────────

  private handleDiff(verb: string, args: string[]): CliResponse {
    switch (verb) {
      case 'open': {
        const sessionId = this.getArg(args, '--session') || '';
        if (!sessionId) {
          return { ok: false, data: null, actions: [], error: '--session required. CLTREE_SESSION_ID env var is automatically injected inside an agent PTY.' };
        }

        const sessionRow = this.db.getSession(sessionId);
        if (!sessionRow) {
          return { ok: false, data: null, actions: [], error: `Session not found: ${sessionId}` };
        }

        const cwd = (sessionRow.cwd as string) || process.cwd();
        const diffData: DiffViewData = buildDiffViewData(cwd, sessionId);

        // Look up existing GuiPane for the session
        const existingVps = this.db.listViewPanesBySession(sessionId);
        let guiPaneId: string;

        if (existingVps.length > 0) {
          guiPaneId = existingVps[0].id;
        } else {
          guiPaneId = `gui-diff-${crypto.randomUUID().slice(0, 8)}`;
          this.db.insertViewPane({
            id: guiPaneId,
            view_type: 'diff',
            session_id: sessionId,
            meta: JSON.stringify({ cwd }),
            active_slot_id: null,
            created_at: new Date().toISOString(),
          });
        }

        const slotId = crypto.randomUUID();
        this.db.updateViewPane(guiPaneId, { active_slot_id: slotId });
        this.db.insertSlot({
          id: slotId,
          gui_pane_id: guiPaneId,
          view_type: 'diff',
          data: JSON.stringify(diffData),
          label: 'Diff',
          created_at: new Date().toISOString(),
        });

        this.eventEmitter.emit('view.pushed', {
          guiPaneId,
          slot: { id: slotId, guiPaneId, sessionId, type: 'diff', data: diffData, label: 'Diff' },
        });

        return {
          ok: true,
          data: { guiPaneId, slotId, filesChanged: diffData.files.length },
          actions: [
            { cmd: ['diff', 'refresh', '--slot', slotId], desc: 'Refresh diff' },
          ],
        };
      }

      case 'refresh': {
        const slotId = this.getArg(args, '--slot') || this.findActiveDiffSlotId();
        if (!slotId) {
          return { ok: false, data: null, actions: [], error: 'No diff slot found. Run diff open --session <id> first.' };
        }

        const slotRow = this.db.findSlotByIdPrefix(slotId);
        if (!slotRow) {
          return { ok: false, data: null, actions: [], error: `Slot not found: ${slotId}` };
        }

        const vpRow = this.db.getViewPane(slotRow.gui_pane_id);
        if (!vpRow) {
          return { ok: false, data: null, actions: [], error: 'GuiPane not found' };
        }

        const sessionRow = this.db.getSession(vpRow.session_id);
        const cwd = (sessionRow?.cwd as string) || process.cwd();
        const diffData: DiffViewData = buildDiffViewData(cwd, vpRow.session_id);

        this.db.updateSlot(slotRow.id, { data: JSON.stringify(diffData) });

        this.eventEmitter.emit('view.updated', {
          guiPaneId: slotRow.gui_pane_id,
          slot: {
            id: slotRow.id,
            guiPaneId: slotRow.gui_pane_id,
            sessionId: vpRow.session_id,
            type: 'diff',
            data: diffData,
            label: 'Diff',
          },
        });

        return {
          ok: true,
          data: { slotId: slotRow.id, filesChanged: diffData.files.length, refreshedAt: diffData.refreshedAt },
          actions: [
            { cmd: ['diff', 'refresh', '--slot', slotRow.id], desc: 'Refresh diff again' },
          ],
        };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown diff command: ${verb}. Usage: open, refresh` };
    }
  }

  /** Find the diff slot ID in the currently active session */
  private findActiveDiffSlotId(): string | null {
    const sessionId = this.sessionService.getActiveSessionId();
    if (!sessionId) return null;
    const vpRows = this.db.listViewPanesBySession(sessionId);
    for (const vp of vpRows.reverse()) {
      const slots = this.db.listSlotsByGuiPane(vp.id);
      const diffSlot = slots.reverse().find((s) => s.view_type === 'diff');
      if (diffSlot) return diffSlot.id;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // Browse command routing
  // ─────────────────────────────────────────────

  private async handleBrowse(verb: string, args: string[]): Promise<CliResponse> {
    switch (verb) {
      case 'open': {
        const url = args.find((a) => !a.startsWith('--')) || this.getArg(args, '--url');
        if (!url) return { ok: false, data: null, actions: [], error: 'URL required. Usage: browse open <url>' };

        const sessionId = this.getArg(args, '--session') || '';
        if (!sessionId) return { ok: false, data: null, actions: [], error: '--session required. Inside an agent PTY, the CLTREE_SESSION_ID environment variable is injected automatically.' };

        const previewData: PreviewViewData = { url, status: 'ready' };

        // Look up existing GuiPane for the session
        const existingVps = this.db.listViewPanesBySession(sessionId);
        let guiPaneId: string;

        if (existingVps.length > 0) {
          guiPaneId = existingVps[0].id;
        } else {
          guiPaneId = `gui-preview-${crypto.randomUUID().slice(0, 8)}`;
          this.db.insertViewPane({
            id: guiPaneId,
            view_type: 'preview',
            session_id: sessionId,
            meta: JSON.stringify({ url }),
            active_slot_id: null,
            created_at: new Date().toISOString(),
          });
        }

        const slotId = crypto.randomUUID();
        this.db.updateViewPane(guiPaneId, { active_slot_id: slotId });
        this.db.insertSlot({
          id: slotId,
          gui_pane_id: guiPaneId,
          view_type: 'preview',
          data: JSON.stringify(previewData),
          label: 'Preview',
          created_at: new Date().toISOString(),
        });

        this.eventEmitter.emit('view.pushed', {
          guiPaneId,
          slot: { id: slotId, guiPaneId, sessionId, type: 'preview', data: previewData, label: 'Preview' },
        });

        return {
          ok: true,
          data: { guiPaneId, slotId, url },
          actions: [
            { cmd: ['browse', 'navigate', '<url>', '--slot', slotId], desc: 'Navigate to URL' },
            { cmd: ['browse', 'read', '--slot', slotId], desc: 'Read page text' },
            { cmd: ['browse', 'screenshot', '--slot', slotId], desc: 'Capture screenshot' },
          ],
        };
      }

      case 'navigate': {
        const url = args.find((a) => !a.startsWith('--')) || this.getArg(args, '--url');
        if (!url) return { ok: false, data: null, actions: [], error: 'URL required. Usage: browse navigate <url>' };

        const slotId = this.getArg(args, '--slot') || this.findActivePreviewSlotId();
        if (!slotId) return { ok: false, data: null, actions: [], error: 'No preview slot. Run browse open <url> first.' };

        const slotRow = this.db.findSlotByIdPrefix(slotId);
        if (!slotRow) return { ok: false, data: null, actions: [], error: `Slot not found: ${slotId}` };

        const data: PreviewViewData = { url, status: 'ready' };
        this.db.updateSlot(slotRow.id, { data: JSON.stringify(data) });

        this.eventEmitter.emit('view.updated', {
          guiPaneId: slotRow.gui_pane_id,
          slot: { id: slotRow.id, guiPaneId: slotRow.gui_pane_id, sessionId: '', type: 'preview', data, label: 'Preview' },
        });

        return {
          ok: true,
          data: { slotId, url },
          actions: [
            { cmd: ['browse', 'read', '--slot', slotId], desc: 'Read page text' },
            { cmd: ['browse', 'screenshot', '--slot', slotId], desc: 'Capture screenshot' },
          ],
        };
      }

      case 'read': {
        const urlArg = this.getArg(args, '--url');
        const slotId = this.getArg(args, '--slot') || this.findActivePreviewSlotId();

        let url: string | null = urlArg;
        if (!url && slotId) {
          const slotRow = this.db.findSlotByIdPrefix(slotId);
          if (slotRow) {
            const slotData = JSON.parse(slotRow.data || '{}') as PreviewViewData;
            url = slotData.url;
          }
        }
        if (!url) return { ok: false, data: null, actions: [], error: '--url or --slot required' };

        try {
          const result = await this.browseService.readPage(url);
          return { ok: true, data: result, actions: [] };
        } catch (err: unknown) {
          return { ok: false, data: null, actions: [], error: `Failed to read page: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'screenshot': {
        const urlArg = this.getArg(args, '--url');
        const slotId = this.getArg(args, '--slot') || this.findActivePreviewSlotId();
        const output = this.getArg(args, '--output');

        let url: string | null = urlArg;
        if (!url && slotId) {
          const slotRow = this.db.findSlotByIdPrefix(slotId);
          if (slotRow) {
            const slotData = JSON.parse(slotRow.data || '{}') as PreviewViewData;
            url = slotData.url;
          }
        }
        if (!url) return { ok: false, data: null, actions: [], error: '--url or --slot required' };

        try {
          const result = await this.browseService.screenshot(url, output || undefined);
          return { ok: true, data: result, actions: [] };
        } catch (err: unknown) {
          return { ok: false, data: null, actions: [], error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'close': {
        const slotId = this.getArg(args, '--slot') || this.findActivePreviewSlotId();
        if (!slotId) return { ok: false, data: null, actions: [], error: 'No preview slot' };

        const slotRow = this.db.findSlotByIdPrefix(slotId);
        if (!slotRow) return { ok: false, data: null, actions: [], error: `Slot not found: ${slotId}` };

        this.db.deleteSlot(slotRow.id);
        this.eventEmitter.emit('view.removed', {
          guiPaneId: slotRow.gui_pane_id,
          slotId,
        });

        // Delete GuiPane too if no slots remain
        const remaining = this.db.listSlotsByGuiPane(slotRow.gui_pane_id);
        if (remaining.length === 0) {
          this.db.deleteViewPane(slotRow.gui_pane_id);
        }

        return { ok: true, data: { closed: slotId }, actions: [] };
      }

      default:
        return { ok: false, data: null, actions: [], error: `Unknown browse command: ${verb}. Usage: open, navigate, read, screenshot, close` };
    }
  }

  /** Find the preview slot ID in the currently active session */
  private findActivePreviewSlotId(): string | null {
    const sessionId = this.sessionService.getActiveSessionId();
    if (!sessionId) return null;
    const vpRows = this.db.listViewPanesBySession(sessionId);
    for (const vp of vpRows.reverse()) {
      const slots = this.db.listSlotsByGuiPane(vp.id);
      const previewSlot = slots.reverse().find((s) => s.view_type === 'preview');
      if (previewSlot) return previewSlot.id;
    }
    return null;
  }

  /** Find the active (completed=false) explain slot ID in the currently active session */
  private findActiveExplainSlotId(): string | null {
    const sessionId = this.sessionService.getActiveSessionId();
    if (!sessionId) return null;
    const vpRows = this.db.listViewPanesBySession(sessionId);
    for (const vp of vpRows.reverse()) {
      const slots = this.db.listSlotsByGuiPane(vp.id);
      const explainSlot = slots.reverse().find((s) => {
        if (s.view_type !== 'explain') return false;
        const data = JSON.parse(s.data || '{}');
        return !data.completed;
      });
      if (explainSlot) return explainSlot.id;
    }
    return null;
  }

  /** Parse --code "filepath:startLine-endLine" and read the file */
  /** File extension → Monaco language mapping */
  private static readonly EXT_LANG_MAP: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml', html: 'html',
    css: 'css', scss: 'scss', less: 'less', sql: 'sql', md: 'markdown',
    graphql: 'graphql', dockerfile: 'dockerfile', toml: 'ini', ini: 'ini',
  };

  /** Infer language from file extension */
  private inferLanguage(filePath: string): string | undefined {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) return undefined;
    return CliController.EXT_LANG_MAP[ext];
  }

  private resolveCodeRef(codeRef: string, guiPaneId: string): { code?: string; lang?: string } {
    const match = codeRef.match(/^(.+?):(\d+)-(\d+)$/);
    if (!match) return {};

    const [, filePath, startStr, endStr] = match;
    const startLine = parseInt(startStr, 10);
    const endLine = parseInt(endStr, 10);
    const lang = this.inferLanguage(filePath);

    // Resolve file path relative to the GuiPane session's cwd
    const vpRow = this.db.getViewPane(guiPaneId);
    let cwd = process.cwd();
    if (vpRow) {
      const sessionRow = this.db.getSession(vpRow.session_id);
      if (sessionRow) cwd = sessionRow.cwd;
    }

    try {
      const absPath = pathResolve(cwd, filePath);
      const content = readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      return { code: lines.slice(startLine - 1, endLine).join('\n'), lang };
    } catch {
      return { code: `// Failed to read file: ${codeRef}`, lang };
    }
  }

  /** Parse "1,3-5,10" → [1, 3, 4, 5, 10] */
  private parseLineRanges(input: string): number[] {
    const result: number[] = [];
    for (const part of input.split(',')) {
      const range = part.trim().split('-');
      if (range.length === 2) {
        const start = parseInt(range[0], 10);
        const end = parseInt(range[1], 10);
        for (let i = start; i <= end; i++) result.push(i);
      } else {
        result.push(parseInt(range[0], 10));
      }
    }
    return result.filter((n) => !isNaN(n));
  }

  /** Parse all --annotate "lineNumber:description" entries from args */
  private parseAnnotations(args: string[]): CodeAnnotation[] {
    const annotations: CodeAnnotation[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--annotate' && i + 1 < args.length) {
        const val = args[i + 1];
        const match = val.match(/^(\d+)(?:-(\d+))?:(.+)$/);
        if (match) {
          const ann: CodeAnnotation = { line: parseInt(match[1], 10), text: match[3] };
          if (match[2]) ann.endLine = parseInt(match[2], 10);
          annotations.push(ann);
        }
        i++; // skip value
      }
    }
    return annotations;
  }

  /** Get the issue repo of the currently active session (issueRepo → repo fallback) */
  private getActiveSessionIssueRepo(): string | null {
    const sessionId = this.sessionService.getActiveSessionId();
    if (!sessionId) return null;
    return this.sessionService.getEffectiveIssueRepo(sessionId);
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /** Look up the workspace ghProfile token for a given session ID */
  private resolveGhToken(sessionId: string): string | undefined {
    const ghProfile = this.sessionService.getGhProfileForSession(sessionId);
    if (!ghProfile) return undefined;
    try {
      return execSync(`gh auth token -u ${ghProfile}`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Look up the workspace ghProfile token for the active session */
  private resolveGhTokenFromActiveSession(): string | undefined {
    const sessionId = this.sessionService.getActiveSessionId();
    if (!sessionId) return undefined;
    return this.resolveGhToken(sessionId);
  }

  /** Extract the value following --flag from the args array */
  private getArg(args: string[], flag: string): string | null {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  }
}
