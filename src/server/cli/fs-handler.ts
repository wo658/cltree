/**
 * FileSearch handler pure functions
 *
 * Can run independently without NestJS DI. Used by both tests and CliController.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fg from 'fast-glob';
import { rgPath } from '@vscode/ripgrep';
import type { FileSearchResult } from '../../shared/types';

const execFileAsync = promisify(execFile);

/** Maximum number of search results (server-side limit) */
const MAX_RESULTS = 100;

/** Glob patterns to ignore */
const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**',
];

// ─── Response types ───────────────────────────────────────────────────────────

export interface FsSearchResponse {
  ok: true;
  data: { results: FileSearchResult[]; cwd: string; query: string; mode: 'filename' | 'content' };
  actions: [];
  error?: never;
}

export interface FsErrorResponse {
  ok: false;
  data: null;
  actions: [];
  error: string;
}

export type FsResponse<T> = T | FsErrorResponse;

export interface FsReadFileResponse {
  ok: true;
  data: { content: string; path: string; language: string };
  actions: [];
  error?: never;
}

// ─── Language detection ───────────────────────────────────────────────────────

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  xml: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return EXT_LANGUAGE_MAP[ext] ?? 'plaintext';
}

// ─── Filename mode search ─────────────────────────────────────────────────────

async function searchByFilename(query: string, cwd: string): Promise<FileSearchResult[]> {
  // fast-glob: case-insensitive search with **/*<query>* pattern
  const pattern = `**/*${fg.escapePath(query).replace(/\\\*/g, '*')}*`;
  const entries = await fg(pattern, {
    cwd,
    ignore: IGNORE_PATTERNS,
    caseSensitiveMatch: false,
    onlyFiles: true,
    absolute: false,
  });

  return entries.slice(0, MAX_RESULTS).map((p) => ({ path: p }));
}

// ─── Content mode search ──────────────────────────────────────────────────────

interface RgMatch {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
  };
}

async function searchByContent(query: string, cwd: string): Promise<FileSearchResult[]> {
  const args = [
    '--json',
    '--max-count', '1',         // Only first match per file (to control result count)
    '--',
    query,
    cwd,
  ];

  // Convert IGNORE_PATTERNS to rg --glob '!pattern' format
  for (const pat of IGNORE_PATTERNS) {
    args.unshift('--glob', `!${pat}`);
  }

  let stdout = '';
  try {
    const result = await execFileAsync(rgPath, args, { maxBuffer: 10 * 1024 * 1024 });
    stdout = result.stdout;
  } catch (err: unknown) {
    // rg returns exit code 1 when no matches are found (normal behavior)
    if (err && typeof err === 'object' && 'stdout' in err) {
      stdout = (err as { stdout: string }).stdout ?? '';
    } else {
      throw err;
    }
  }

  const results: FileSearchResult[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RgMatch;
      if (parsed.type !== 'match') continue;
      results.push({
        path: path.relative(cwd, parsed.data.path.text),
        lineNumber: parsed.data.line_number,
        lineContent: parsed.data.lines.text.replace(/\n$/, ''),
      });
    } catch {
      // Ignore lines that fail JSON parsing
    }
  }

  return results.slice(0, MAX_RESULTS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function handleFsSearch(opts: {
  query: string;
  cwd: string;
  mode: 'filename' | 'content';
}): Promise<FsResponse<FsSearchResponse>> {
  const { query, cwd, mode } = opts;

  if (!fs.existsSync(cwd)) {
    return { ok: false, data: null, actions: [], error: `Directory does not exist: ${cwd}` };
  }

  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) {
    return { ok: false, data: null, actions: [], error: `Not a directory: ${cwd}` };
  }

  try {
    const results =
      mode === 'filename'
        ? await searchByFilename(query, cwd)
        : await searchByContent(query, cwd);

    return { ok: true, data: { results, cwd, query, mode }, actions: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, data: null, actions: [], error: `Search failed: ${message}` };
  }
}

export async function handleFsReadFile(
  filePath: string,
): Promise<FsResponse<FsReadFileResponse>> {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, data: null, actions: [], error: `File does not exist: ${filePath}` };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { ok: false, data: null, actions: [], error: `Not a file: ${filePath}` };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      ok: true,
      data: { content, path: filePath, language: detectLanguage(filePath) },
      actions: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, data: null, actions: [], error: `File read failed: ${message}` };
  }
}
