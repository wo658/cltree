/**
 * fs handler unit tests (TDD).
 *
 * Validates the handleFsSearch / handleFsReadFile pure functions.
 * Invoked directly without NestJS DI, using a real (temporary) filesystem.
 */
import * as fss from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleFsSearch, handleFsReadFile } from '../src/server/cli/fs-handler';

// ─── Temporary directory fixture ─────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fss.mkdtempSync(path.join(os.tmpdir(), 'cltree-fs-test-'));

  // Create directory structure
  fss.mkdirSync(path.join(tmpDir, 'src', 'server'), { recursive: true });
  fss.mkdirSync(path.join(tmpDir, 'src', 'web'), { recursive: true });
  fss.mkdirSync(path.join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
  fss.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });

  // Create files
  fss.writeFileSync(
    path.join(tmpDir, 'src', 'server', 'pane.service.ts'),
    'export class PaneService {\n  search() {}\n  registerFetcher() {}\n}\n',
  );
  fss.writeFileSync(
    path.join(tmpDir, 'src', 'server', 'cli.controller.ts'),
    'export class CliController {\n  handleFs() {}\n  search(query: string) {}\n}\n',
  );
  fss.writeFileSync(
    path.join(tmpDir, 'src', 'web', 'FileSearchView.tsx'),
    'export function FileSearchView() {\n  return <div>search</div>;\n}\n',
  );
  fss.writeFileSync(
    path.join(tmpDir, 'src', 'web', 'IssueView.tsx'),
    'export function IssueView() {\n  return <div>issue</div>;\n}\n',
  );
  fss.writeFileSync(
    path.join(tmpDir, 'node_modules', 'some-pkg', 'index.js'),
    'module.exports = {};\n',
  );
});

afterAll(() => {
  fss.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── filename mode ────────────────────────────────────────────────────────────

describe('handleFsSearch — filename mode', () => {
  test('returns results whose filename contains the query', async () => {
    const res = await handleFsSearch({ query: 'Search', cwd: tmpDir, mode: 'filename' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.results.length).toBeGreaterThan(0);
    expect(res.data.results.some((r) => r.path.includes('FileSearchView'))).toBe(true);
  });

  test('returns an empty array when nothing matches the query', async () => {
    const res = await handleFsSearch({ query: 'NonExistentXYZ123', cwd: tmpDir, mode: 'filename' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.results.length).toBe(0);
  });

  test('excludes node_modules and .git directories', async () => {
    const res = await handleFsSearch({ query: 'some-pkg', cwd: tmpDir, mode: 'filename' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    const paths = res.data.results.map((r) => r.path);
    expect(paths.every((p) => !p.includes('node_modules'))).toBe(true);
    expect(paths.every((p) => !p.includes('.git'))).toBe(true);
  });

  test('caps results at 100 entries', async () => {
    fss.mkdirSync(path.join(tmpDir, 'bulk'), { recursive: true });
    for (let i = 0; i < 120; i++) {
      fss.writeFileSync(path.join(tmpDir, 'bulk', `file${i}.ts`), '');
    }
    const res = await handleFsSearch({ query: 'file', cwd: tmpDir, mode: 'filename' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.results.length).toBeLessThanOrEqual(100);
  });

  test('returns ok:false when cwd does not exist', async () => {
    const res = await handleFsSearch({ query: 'foo', cwd: '/nonexistent/path/xyz', mode: 'filename' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(res.error).toBeTruthy();
  });
});

// ─── content mode ─────────────────────────────────────────────────────────────

describe('handleFsSearch — content mode', () => {
  test('finds query in file contents and returns lineNumber and lineContent', async () => {
    const res = await handleFsSearch({ query: 'handleFs', cwd: tmpDir, mode: 'content' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.results.length).toBeGreaterThan(0);
    const match = res.data.results.find((r) => r.path.includes('cli.controller'));
    expect(match).toBeDefined();
    expect(match!.lineNumber).toBeGreaterThan(0);
    expect(match!.lineContent).toContain('handleFs');
  });

  test('also excludes node_modules and .git in content mode', async () => {
    const res = await handleFsSearch({ query: 'module.exports', cwd: tmpDir, mode: 'content' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    const paths = res.data.results.map((r) => r.path);
    expect(paths.every((p) => !p.includes('node_modules'))).toBe(true);
  });

  test('caps results at 100 entries (content)', async () => {
    const bulkDir = path.join(tmpDir, 'bulk');
    fss.mkdirSync(bulkDir, { recursive: true });
    for (let i = 0; i < 120; i++) {
      fss.writeFileSync(path.join(bulkDir, `match${i}.ts`), 'const UNIQUE_MARKER = 1;\n');
    }
    const res = await handleFsSearch({ query: 'UNIQUE_MARKER', cwd: tmpDir, mode: 'content' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.results.length).toBeLessThanOrEqual(100);
  });
});

// ─── handleFsReadFile ────────────────────────────────────────────────────────

describe('handleFsReadFile', () => {
  test('reads a TypeScript file and detects its language', async () => {
    const filePath = path.join(tmpDir, 'src', 'server', 'pane.service.ts');
    const res = await handleFsReadFile(filePath);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.content).toContain('PaneService');
    expect(res.data.language).toBe('typescript');
    expect(res.data.path).toBe(filePath);
  });

  test('reads a TSX file and detects its language', async () => {
    const filePath = path.join(tmpDir, 'src', 'web', 'FileSearchView.tsx');
    const res = await handleFsReadFile(filePath);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.language).toBe('typescript');
  });

  test('reads a JS file and detects its language', async () => {
    const filePath = path.join(tmpDir, 'node_modules', 'some-pkg', 'index.js');
    const res = await handleFsReadFile(filePath);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.data.language).toBe('javascript');
  });

  test('returns ok:false for missing file', async () => {
    const res = await handleFsReadFile('/nonexistent/file.ts');
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(res.error).toBeTruthy();
  });

  test('returns ok:false for directory path', async () => {
    const res = await handleFsReadFile(path.join(tmpDir, 'src'));
    expect(res.ok).toBe(false);
  });
});
