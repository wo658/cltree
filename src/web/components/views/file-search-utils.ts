/**
 * Pure utility functions for FileSearchView
 *
 * Logic separated for UI-independent testability.
 */

// ─── Path format ──────────────────────────────────────────────────────────────

export function formatResultPath(filePath: string): { filename: string; dir: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return { filename: filePath, dir: '' };
  }
  return {
    filename: filePath.slice(lastSlash + 1),
    dir: filePath.slice(0, lastSlash),
  };
}

// ─── File icon type ───────────────────────────────────────────────────────────

const ICON_MAP: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  py: 'py',
  rs: 'rs',
  go: 'go',
  json: 'json',
  md: 'md',
  css: 'css',
  scss: 'scss',
  html: 'html',
  sh: 'sh',
  yaml: 'yaml',
  yml: 'yaml',
};

export function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return ICON_MAP[ext] ?? 'file';
}

// ─── Line trim/truncate ───────────────────────────────────────────────────────

export function truncateLine(line: string, maxLen = 80): string {
  const trimmed = line.trimStart();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + '...';
}

// ─── Search payload builder ───────────────────────────────────────────────────

export interface SearchPayload {
  cmd: string[];
  data: { query: string; cwd: string; mode: 'filename' | 'content' };
}

export function buildSearchPayload(opts: {
  query: string;
  cwd: string;
  mode: 'filename' | 'content';
}): SearchPayload {
  return {
    cmd: ['fs', 'search'],
    data: { query: opts.query, cwd: opts.cwd, mode: opts.mode },
  };
}
