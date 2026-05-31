import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../config/config.service';
import type { IssueViewData, MergeConflictInfo, WorktreeInfo } from '../../shared/types';

/**
 * Git/GitHub CLI wrapper service.
 * Manages the repository by synchronously executing gh and git commands.
 */
@Injectable()
export class RepoService {
  private readonly logger = new Logger(RepoService.name);

  constructor(private readonly config: ConfigService) {}

  /** Fetch GitHub issue list */
  listIssues(repo: string, ghToken?: string): { number: number; title: string; body: string; state: string; labels: { name: string; color: string }[]; assignees: string[]; createdAt: string }[] {
    if (!repo || !repo.match(/^[^/]+\/[^/]+$/)) {
      return [];
    }
    const env = ghToken ? { GH_TOKEN: ghToken } : undefined;
    try {
      const json = this.exec(
        `gh issue list --repo ${repo} --state open --json number,title,body,state,labels,assignees,createdAt --limit 30`,
        env,
      );
      const raw = JSON.parse(json) as Array<Record<string, unknown>>;
      return raw.map((r) => ({
        number: r.number as number,
        title: r.title as string,
        body: (r.body as string) || '',
        state: ((r.state as string) || 'open').toLowerCase(),
        labels: ((r.labels as Array<{ name: string; color: string }>) || []).map((l) => ({
          name: l.name,
          color: l.color || '888888',
        })),
        assignees: ((r.assignees as Array<{ login: string }>) || []).map((a) => a.login),
        createdAt: r.createdAt as string,
      }));
    } catch {
      return [];
    }
  }

  /** Create a GitHub issue */
  createIssue(repo: string, title: string, body?: string, ghToken?: string): { number: number; url: string } {
    const bodyFlag = body ? ` --body "${body.replace(/"/g, '\\"')}"` : '';
    const env = ghToken ? { GH_TOKEN: ghToken } : undefined;
    const json = this.exec(
      `gh issue create --repo ${repo} --title "${title.replace(/"/g, '\\"')}"${bodyFlag} --json number,url`,
      env,
    );
    return JSON.parse(json);
  }

  /**
   * Fetch a GitHub issue
   * Retrieves issue data via gh issue view.
   */
  fetchIssue(repo: string, issueNumber: number, ghToken?: string): IssueViewData {
    const env = ghToken ? { GH_TOKEN: ghToken } : undefined;
    const json = this.exec(
      `gh issue view ${issueNumber} --repo ${repo} --json number,title,body,state,labels,assignees,comments`,
      env,
    );
    const raw = JSON.parse(json);

    return {
      number: raw.number,
      title: raw.title,
      state: raw.state?.toLowerCase() === 'open' ? 'open' : 'closed',
      labels: (raw.labels || []).map((l: { name: string; color: string }) => ({
        name: l.name,
        color: l.color || '888888',
      })),
      assignees: (raw.assignees || []).map((a: { login: string }) => a.login),
      body: raw.body || '',
      comments: (raw.comments || []).map(
        (c: { author: { login: string }; body: string; createdAt: string }) => ({
          author: c.author?.login || 'unknown',
          body: c.body,
          createdAt: c.createdAt,
        }),
      ),
    };
  }

  /**
   * Create a Git worktree
   * Also auto-creates the configured symlinks.
   */
  createWorktree(opts: {
    repoPath: string;
    branch: string;
    worktreeName: string;
  }): string {
    // Create under .worktrees/ inside the project (auto-inherits direnv, gitconfig includeIf, etc.)
    const resolvedBase = path.join(opts.repoPath, '.worktrees');
    if (!fs.existsSync(resolvedBase)) {
      fs.mkdirSync(resolvedBase, { recursive: true });
    }
    // Add .worktrees/ to .gitignore (if not already present)
    this.ensureGitignoreEntry(opts.repoPath, '.worktrees/');
    const worktreePath = path.join(resolvedBase, opts.worktreeName);

    // Attempt to create the worktree (-b: create new branch)
    try {
      this.exec(
        `git -C "${opts.repoPath}" worktree add "${worktreePath}" -b "${opts.branch}"`,
      );
    } catch (err) {
      const stderr = (err as { stderr?: string })?.stderr?.trim() || '';
      // If branch already exists (branch left without a worktree), retry without -b
      if (stderr.includes('already exists')) {
        // Prune dead worktree references before retrying
        try { this.exec(`git -C "${opts.repoPath}" worktree prune`); } catch { /* ignore */ }
        this.exec(
          `git -C "${opts.repoPath}" worktree add "${worktreePath}" "${opts.branch}"`,
        );
      } else {
        throw err;
      }
    }
    this.logger.log(`Worktree created: ${worktreePath}, branch=${opts.branch}`);

    // Create symlinks (node_modules, .venv, etc.)
    const symlinks =
      this.config.get<string[]>('worktree.symlinks') || [];
    for (const name of symlinks) {
      const source = path.join(opts.repoPath, name);
      const target = path.join(worktreePath, name);
      if (fs.existsSync(source) && !fs.existsSync(target)) {
        const targetDir = path.dirname(target);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        try {
          fs.symlinkSync(source, target);
          this.logger.log(`Symlink created: ${name}`);
        } catch (err) {
          this.logger.warn(`Symlink creation failed: ${name} — ${err}`);
        }
      }
    }

    return worktreePath;
  }

  /**
   * Save issue context to .cltree/issue.md inside the worktree.
   * Allows the Agent to read the issue context from a file right after spawn.
   */
  writeIssueContext(worktreePath: string, issue: IssueViewData): string {
    const dir = path.join(worktreePath, '.cltree');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, 'issue.md');
    fs.writeFileSync(filePath, this.formatIssueMarkdown(issue), 'utf-8');
    this.logger.log(`Issue context saved: ${filePath}`);

    // Add .cltree/ to .gitignore (if not already present)
    this.ensureGitignoreEntry(worktreePath, '.cltree/');

    return filePath;
  }

  /** Add an entry to .gitignore (if not already present) */
  private ensureGitignoreEntry(dirPath: string, entry: string): void {
    const gitignorePath = path.join(dirPath, '.gitignore');
    try {
      const existing = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, 'utf-8')
        : '';
      const trimmedEntry = entry.trim();
      if (!existing.split('\n').some((line) => line.trim() === trimmedEntry || line.trim() === trimmedEntry.replace(/\/$/, ''))) {
        const suffix = existing.endsWith('\n') || existing === '' ? '' : '\n';
        fs.appendFileSync(gitignorePath, `${suffix}${trimmedEntry}\n`);
      }
    } catch {
      // Ignore .gitignore processing failures
    }
  }

  /** Format IssueViewData as markdown */
  private formatIssueMarkdown(issue: IssueViewData): string {
    const lines: string[] = [];
    lines.push(`# Issue #${issue.number}: ${issue.title}`);
    lines.push('');
    lines.push(`- **State**: ${issue.state}`);
    if (issue.labels.length) {
      lines.push(`- **Labels**: ${issue.labels.map((l) => l.name).join(', ')}`);
    }
    if (issue.assignees.length) {
      lines.push(`- **Assignees**: ${issue.assignees.join(', ')}`);
    }
    lines.push('');
    lines.push('## Description');
    lines.push('');

    const MAX_BODY = 8000;
    if (issue.body.length > MAX_BODY) {
      lines.push(issue.body.slice(0, MAX_BODY));
      lines.push('');
      lines.push(`... [truncated, run \`cltree issue view ${issue.number}\` for full text]`);
    } else {
      lines.push(issue.body || '*No description provided.*');
    }

    const recentComments = issue.comments.slice(-5);
    if (recentComments.length > 0) {
      lines.push('');
      lines.push('## Comments');
      lines.push('');
      for (const c of recentComments) {
        const date = c.createdAt.split('T')[0];
        lines.push(`### @${c.author} (${date})`);
        lines.push('');
        lines.push(c.body);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /** Find an existing worktree path by branch name */
  findWorktreeByBranch(repoPath: string, branch: string): WorktreeInfo | undefined {
    const worktrees = this.listWorktrees(repoPath);
    return worktrees.find((w) => w.branch === branch);
  }

  /** Delete a Git worktree */
  removeWorktree(worktreePath: string): void {
    this.exec(`git worktree remove "${worktreePath}" --force`);
    this.logger.log(`Worktree deleted: ${worktreePath}`);
  }

  /**
   * Locally merge a worktree branch into the main branch.
   * repoPath = main session directory (original repo, not worktree).
   * On conflict, keeps the merge state and returns conflict info.
   */
  mergeToMain(repoPath: string, branch: string): { merged: boolean; conflict?: MergeConflictInfo } {
    const mainBranch = this.getDefaultBranch(repoPath);
    this.exec(`git -C "${repoPath}" checkout "${mainBranch}"`);

    try {
      this.exec(`git -C "${repoPath}" merge "${branch}"`);
      this.logger.log(`Local merge completed: ${branch} → ${mainBranch}`);
      return { merged: true };
    } catch (err) {
      const stderr = (err as { stderr?: string })?.stderr?.trim() || '';
      if (stderr.includes('CONFLICT') || stderr.includes('Automatic merge failed')) {
        const conflict = this.collectConflictInfo(repoPath, branch, mainBranch);
        this.logger.warn(`Merge conflict: ${branch} → ${mainBranch}, ${conflict.files.length} file(s)`);
        return { merged: false, conflict };
      }
      throw err;
    }
  }

  /** Collect conflicted file list + diff */
  collectConflictInfo(repoPath: string, branch: string, mainBranch: string): MergeConflictInfo {
    // List of conflicted files
    let files: string[] = [];
    try {
      const output = this.exec(`git -C "${repoPath}" diff --name-only --diff-filter=U`);
      files = output.split('\n').filter(Boolean);
    } catch { /* empty */ }

    // Conflict diff (includes markers)
    let diff = '';
    try {
      diff = this.exec(`git -C "${repoPath}" diff`);
      // Truncate if too long
      if (diff.length > 10000) {
        diff = diff.slice(0, 10000) + '\n... [truncated]';
      }
    } catch { /* empty */ }

    return { branch, mainBranch, files, diff };
  }

  /** Abort a merge conflict */
  abortMerge(repoPath: string): void {
    this.exec(`git -C "${repoPath}" merge --abort`);
    this.logger.log(`Merge abort: ${repoPath}`);
  }

  /**
   * Create a GitHub PR (gh cli).
   * Pushes the worktree branch then creates the PR.
   */
  createPr(opts: {
    repoPath: string;
    repo: string;
    branch: string;
    title: string;
    body?: string;
    ghToken?: string;
  }): { number: number; url: string } {
    const env = opts.ghToken ? { GH_TOKEN: opts.ghToken } : undefined;
    // Push branch
    this.exec(`git -C "${opts.repoPath}" push -u origin "${opts.branch}"`, env);
    // Create PR
    const bodyFlag = opts.body ? ` --body "${opts.body.replace(/"/g, '\\"')}"` : ' --body ""';
    const json = this.exec(
      `gh pr create --repo ${opts.repo} --head "${opts.branch}" --title "${opts.title.replace(/"/g, '\\"')}"${bodyFlag} --json number,url`,
      env,
    );
    const pr = JSON.parse(json);
    this.logger.log(`PR created: #${pr.number} ${pr.url}`);
    return pr;
  }

  /** Delete local + remote branch */
  deleteBranch(repoPath: string, branch: string): void {
    // Delete local branch
    try { this.exec(`git -C "${repoPath}" branch -D "${branch}"`); } catch { /* already deleted */ }
    // Delete remote branch (ignore failure)
    try { this.exec(`git -C "${repoPath}" push origin --delete "${branch}"`); } catch { /* ignore */ }
    this.logger.log(`Branch deleted: ${branch}`);
  }

  /** Get the main branch name (main/master) */
  getDefaultBranch(repoPath: string): string {
    try {
      return this.exec(`git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD`).replace('refs/remotes/origin/', '');
    } catch {
      // Fallback: main → master
      try {
        this.exec(`git -C "${repoPath}" rev-parse --verify main`);
        return 'main';
      } catch {
        return 'master';
      }
    }
  }

  /** List Git worktrees */
  listWorktrees(repoPath: string): WorktreeInfo[] {
    const output = this.exec(`git -C "${repoPath}" worktree list --porcelain`);
    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = { path: line.slice('worktree '.length).trim() };
      } else if (line.startsWith('branch ')) {
        // refs/heads/branch-name → branch-name
        const ref = line.slice('branch '.length).trim();
        current.branch = ref.replace('refs/heads/', '');
      }
    }

    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    return worktrees;
  }

  /**
   * Generate a branch name from an issue number + title
   * Example: issue-42-fix-auth-middleware (lowercase, special chars removed, 50-char limit)
   */
  generateBranchName(issueNumber: number, title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const prefix = `issue-${issueNumber}-`;
    const maxSlugLen = 50 - prefix.length;
    const trimmedSlug = slug.slice(0, maxSlugLen).replace(/-$/, '');

    return `${prefix}${trimmedSlug}`;
  }

  /** Synchronously execute a shell command (single-process model) */
  private exec(cmd: string, env?: Record<string, string>): string {
    try {
      return execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env ? { ...process.env, ...env } : undefined,
      }).trim();
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string })?.stderr?.trim() || '';
      const shortCmd = cmd.split(' ').slice(0, 4).join(' ');
      this.logger.debug(`Command failed: ${shortCmd}... — ${stderr || (err instanceof Error ? err.message : String(err))}`);
      throw err;
    }
  }
}
