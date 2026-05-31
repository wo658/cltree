/**
 * FileSearchView utility unit tests (TDD).
 *
 * Validates pure functions extracted from the component.
 * Runs in Node without any UI rendering.
 */
import {
  formatResultPath,
  getFileIcon,
  truncateLine,
  buildSearchPayload,
} from '../src/web/components/views/file-search-utils';

// ─── formatResultPath ─────────────────────────────────────────────────────────

describe('formatResultPath', () => {
  test('splits filename and directory', () => {
    const result = formatResultPath('src/server/pane.service.ts');
    expect(result.filename).toBe('pane.service.ts');
    expect(result.dir).toBe('src/server');
  });

  test('root files have empty dir', () => {
    const result = formatResultPath('README.md');
    expect(result.filename).toBe('README.md');
    expect(result.dir).toBe('');
  });

  test('splits deeply nested paths correctly', () => {
    const result = formatResultPath('src/web/components/views/FileSearchView.tsx');
    expect(result.filename).toBe('FileSearchView.tsx');
    expect(result.dir).toBe('src/web/components/views');
  });
});

// ─── getFileIcon ──────────────────────────────────────────────────────────────

describe('getFileIcon', () => {
  test('TypeScript files use ts icon', () => {
    expect(getFileIcon('app.ts')).toBe('ts');
    expect(getFileIcon('App.tsx')).toBe('tsx');
  });

  test('JavaScript files use js icon', () => {
    expect(getFileIcon('index.js')).toBe('js');
    expect(getFileIcon('component.jsx')).toBe('jsx');
  });

  test('unknown extensions fall back to file icon', () => {
    expect(getFileIcon('data.bin')).toBe('file');
    expect(getFileIcon('noextension')).toBe('file');
  });
});

// ─── truncateLine ─────────────────────────────────────────────────────────────

describe('truncateLine', () => {
  test('returns lines of 80 chars or fewer unchanged', () => {
    const line = 'const x = 1;';
    expect(truncateLine(line)).toBe(line);
  });

  test('truncates lines over 80 chars and appends ...', () => {
    const long = 'a'.repeat(100);
    const result = truncateLine(long);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(83); // 80 + '...'
  });

  test('strips leading whitespace', () => {
    const indented = '    const x = 1;';
    expect(truncateLine(indented)).toBe('const x = 1;');
  });
});

// ─── buildSearchPayload ───────────────────────────────────────────────────────

describe('buildSearchPayload', () => {
  test('builds filename mode payload', () => {
    const payload = buildSearchPayload({ query: 'pane', cwd: '/app', mode: 'filename' });
    expect(payload.cmd).toEqual(['fs', 'search']);
    expect(payload.data.query).toBe('pane');
    expect(payload.data.mode).toBe('filename');
    expect(payload.data.cwd).toBe('/app');
  });

  test('builds content mode payload', () => {
    const payload = buildSearchPayload({ query: 'handleFs', cwd: '/app', mode: 'content' });
    expect(payload.data.mode).toBe('content');
  });
});
