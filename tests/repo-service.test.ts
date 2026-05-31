import { RepoService } from '../src/server/repo/repo.service';
import { ConfigService } from '../src/server/config/config.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Pure-logic tests for RepoService.
 * Anything that requires git or the GitHub CLI is excluded — only pure functions.
 */

/** Minimal ConfigService mock */
function createMockConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const config = new ConfigService();
  // Skip onModuleInit and assign directly.
  (config as any).config = {
    agent: { worktreeBase: '~/.cltree/worktrees', ...overrides },
    worktree: { symlinks: [] },
  };
  return config;
}

describe('RepoService.generateBranchName', () => {
  let service: RepoService;

  beforeEach(() => {
    service = new RepoService(createMockConfig());
  });

  test('generates a default branch name', () => {
    const name = service.generateBranchName(42, 'Fix auth middleware');
    expect(name).toBe('issue-42-fix-auth-middleware');
  });

  test('strips special characters', () => {
    const name = service.generateBranchName(10, 'feat: Add [new] feature!');
    expect(name).toBe('issue-10-feat-add-new-feature');
  });

  test('strips non-ASCII characters', () => {
    const name = service.generateBranchName(5, '日本語 バグ修正: login page');
    expect(name).toBe('issue-5-login-page');
  });

  test('caps at 50 characters', () => {
    const longTitle = 'A very long title that should be truncated to fit the branch name limit';
    const name = service.generateBranchName(1, longTitle);
    expect(name.length).toBeLessThanOrEqual(50);
    expect(name.startsWith('issue-1-')).toBe(true);
  });

  test('no trailing hyphen', () => {
    const name = service.generateBranchName(99, 'test-');
    expect(name.endsWith('-')).toBe(false);
  });

  test('collapses consecutive hyphens', () => {
    const name = service.generateBranchName(1, 'hello   ---   world');
    expect(name).toBe('issue-1-hello-world');
  });
});

describe('RepoService.ensureGitignoreEntry (integration)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cltree-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates .gitignore if it does not exist', () => {
    const service = new RepoService(createMockConfig());
    // Private method — call directly.
    (service as any).ensureGitignoreEntry(tmpDir, '.worktrees/');

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(content.trim()).toBe('.worktrees/');
  });

  test('appends an entry to an existing .gitignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
    const service = new RepoService(createMockConfig());
    (service as any).ensureGitignoreEntry(tmpDir, '.worktrees/');

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.worktrees/');
  });

  test('does not duplicate an existing entry', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.worktrees/\n');
    const service = new RepoService(createMockConfig());
    (service as any).ensureGitignoreEntry(tmpDir, '.worktrees/');

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const matches = content.match(/\.worktrees\//g);
    expect(matches).toHaveLength(1);
  });

  test('detects the entry even without a trailing slash', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.worktrees\n');
    const service = new RepoService(createMockConfig());
    (service as any).ensureGitignoreEntry(tmpDir, '.worktrees/');

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    // .worktrees or .worktrees/ appears exactly once.
    const lines = content.split('\n').filter(l => l.trim().startsWith('.worktrees'));
    expect(lines).toHaveLength(1);
  });

  test('appends a newline if .gitignore does not end with one', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'dist');
    const service = new RepoService(createMockConfig());
    (service as any).ensureGitignoreEntry(tmpDir, '.worktrees/');

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('dist\n.worktrees/\n');
  });
});

describe('RepoService.createWorktree path', () => {
  test('worktree is created under repoPath/.worktrees/ (mocked)', () => {
    const service = new RepoService(createMockConfig());

    // createWorktree runs real git commands internally, so we only verify
    // the path-computation logic (mock exec).
    const originalExec = (service as any).exec.bind(service);
    let capturedCmd = '';
    (service as any).exec = (cmd: string) => {
      capturedCmd = cmd;
      return ''; // simulate a successful `git worktree add`
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cltree-wt-'));
    try {
      const result = service.createWorktree({
        repoPath: tmpDir,
        branch: 'issue-42-fix',
        worktreeName: 'main-issue-42',
      });

      // Path = repoPath/.worktrees/worktreeName
      expect(result).toBe(path.join(tmpDir, '.worktrees', 'main-issue-42'));

      // Git command contains the correct paths.
      expect(capturedCmd).toContain(tmpDir);
      expect(capturedCmd).toContain('.worktrees');
      expect(capturedCmd).toContain('issue-42-fix');

      // The .worktrees directory was created.
      expect(fs.existsSync(path.join(tmpDir, '.worktrees'))).toBe(true);

      // .worktrees/ was added to .gitignore.
      const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.worktrees/');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
