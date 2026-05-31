/**
 * Tests for the diff view.
 *
 * - parseDiffOutput: parses `git diff --name-status` output
 * - getFileContent: reads HEAD version / current version file contents
 * - buildDiffViewData: builds DiffViewData from a session cwd
 */

import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  parseDiffNameStatus,
  getFileContentAtHead,
  buildDiffViewData,
} from '../src/server/diff/diff.utils';

// ─── Temporary git repo helpers ───────────────────────────────

function setupGitRepo(): string {
  const repoDir = join(tmpdir(), `cltree-diff-test-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const git = (cmd: string) =>
    execSync(cmd, { cwd: repoDir, stdio: 'pipe', encoding: 'utf-8' });

  git('git init');
  git('git config user.email "test@test.com"');
  git('git config user.name "Test"');

  // initial commit
  writeFileSync(join(repoDir, 'hello.ts'), 'const x = 1;\n');
  writeFileSync(join(repoDir, 'readme.md'), '# Hello\n');
  git('git add -A');
  git('git commit -m "init"');

  return repoDir;
}

function cleanupRepo(repoDir: string) {
  if (existsSync(repoDir)) {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// ─── Unit tests: parseDiffNameStatus ──────────────────────────

describe('parseDiffNameStatus', () => {
  test('parses modified files (M)', () => {
    const input = 'M\tsrc/foo.ts\n';
    const result = parseDiffNameStatus(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: 'src/foo.ts', status: 'M' });
  });

  test('parses added files (A)', () => {
    const input = 'A\tsrc/new.ts\n';
    const result = parseDiffNameStatus(input);
    expect(result[0]).toMatchObject({ path: 'src/new.ts', status: 'A' });
  });

  test('parses deleted files (D)', () => {
    const input = 'D\tsrc/old.ts\n';
    const result = parseDiffNameStatus(input);
    expect(result[0]).toMatchObject({ path: 'src/old.ts', status: 'D' });
  });

  test('parses renames (R)', () => {
    const input = 'R100\tsrc/old.ts\tsrc/new.ts\n';
    const result = parseDiffNameStatus(input);
    expect(result[0]).toMatchObject({ path: 'src/new.ts', status: 'R', oldPath: 'src/old.ts' });
  });

  test('returns empty array for empty input', () => {
    expect(parseDiffNameStatus('')).toHaveLength(0);
    expect(parseDiffNameStatus('\n')).toHaveLength(0);
  });

  test('parses multiple files', () => {
    const input = 'M\ta.ts\nA\tb.ts\nD\tc.ts\n';
    const result = parseDiffNameStatus(input);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  test('infers language from file extension', () => {
    const input = 'M\tsrc/foo.tsx\nM\tsrc/bar.py\nM\tsrc/baz.unknown\n';
    const result = parseDiffNameStatus(input);
    expect(result[0].language).toBe('typescript');
    expect(result[1].language).toBe('python');
    expect(result[2].language).toBe('plaintext');
  });
});

// ─── Unit tests: getFileContentAtHead ─────────────────────────

describe('getFileContentAtHead', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = setupGitRepo();
  });

  afterEach(() => {
    cleanupRepo(repoDir);
  });

  test('returns content for file present in HEAD', () => {
    const content = getFileContentAtHead(repoDir, 'hello.ts');
    expect(content).toBe('const x = 1;\n');
  });

  test('returns empty string for file missing in HEAD (new file)', () => {
    const content = getFileContentAtHead(repoDir, 'nonexistent.ts');
    expect(content).toBe('');
  });
});

// ─── Integration tests: buildDiffViewData ─────────────────────

describe('buildDiffViewData', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = setupGitRepo();
  });

  afterEach(() => {
    cleanupRepo(repoDir);
  });

  test('includes modified files in the files list', () => {
    // modify hello.ts
    writeFileSync(join(repoDir, 'hello.ts'), 'const x = 2;\nconst y = 3;\n');

    const result = buildDiffViewData(repoDir, 'test-session-id');

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: 'hello.ts',
      status: 'M',
      language: 'typescript',
    });
    expect(result.files[0].originalContent).toBe('const x = 1;\n');
    expect(result.files[0].modifiedContent).toBe('const x = 2;\nconst y = 3;\n');
  });

  test('new (untracked) files have empty originalContent', () => {
    writeFileSync(join(repoDir, 'brand-new.ts'), 'export const z = 42;\n');

    const result = buildDiffViewData(repoDir, 'test-session-id');

    const newFile = result.files.find((f) => f.path === 'brand-new.ts');
    expect(newFile).toBeDefined();
    expect(newFile?.status).toBe('A');
    expect(newFile?.originalContent).toBe('');
    expect(newFile?.modifiedContent).toBe('export const z = 42;\n');
  });

  test('returns empty files for a non-git path', () => {
    const nonGitDir = join(tmpdir(), `cltree-non-git-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });

    const result = buildDiffViewData(nonGitDir, 'test-session-id');
    expect(result.files).toHaveLength(0);

    rmSync(nonGitDir, { recursive: true });
  });

  test('returns empty files array when there are no changes', () => {
    const result = buildDiffViewData(repoDir, 'test-session-id');
    expect(result.files).toHaveLength(0);
    expect(result.sessionId).toBe('test-session-id');
    expect(result.cwd).toBe(repoDir);
  });

  test('includes staged changes too (git diff HEAD)', () => {
    // modify file then stage
    writeFileSync(join(repoDir, 'hello.ts'), 'const x = 99;\n');
    execSync('git add hello.ts', { cwd: repoDir });

    const result = buildDiffViewData(repoDir, 'test-session-id');
    const file = result.files.find((f) => f.path === 'hello.ts');
    expect(file).toBeDefined();
    expect(file?.modifiedContent).toBe('const x = 99;\n');
  });
});
