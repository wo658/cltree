/**
 * Diff utilities
 *
 * Parses git diff output + builds DiffViewData.
 * Composed of pure functions with no NestJS dependencies → easy to unit test.
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve as pathResolve } from 'path';
import type { DiffFileEntry, DiffViewData } from '../../shared/types';

// ─── Language mapping ─────────────────────────────────────────

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml', html: 'html',
  css: 'css', scss: 'scss', less: 'less', sql: 'sql', md: 'markdown',
  graphql: 'graphql', dockerfile: 'dockerfile', toml: 'ini', ini: 'ini',
};

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return 'plaintext';
  return EXT_LANG_MAP[ext] ?? 'plaintext';
}

// ─── git command execution helper ────────────────────────────

function git(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

// ─── Parsing functions ────────────────────────────────────────

/**
 * Parse `git diff --name-status` output.
 * Line format:
 *   M\tpath
 *   A\tpath
 *   D\tpath
 *   R100\told\tnew
 */
export function parseDiffNameStatus(output: string): Pick<DiffFileEntry, 'path' | 'status' | 'oldPath' | 'language'>[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const parts = line.split('\t');
      const rawStatus = parts[0];
      const statusChar = rawStatus[0] as DiffFileEntry['status'];

      if (statusChar === 'R') {
        const oldPath = parts[1];
        const newPath = parts[2];
        return { path: newPath, status: 'R' as const, oldPath, language: inferLanguage(newPath) };
      }

      const filePath = parts[1];
      if (!filePath) return null;

      const status = statusChar as DiffFileEntry['status'];
      return { path: filePath, status, language: inferLanguage(filePath) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

// ─── File content retrieval ───────────────────────────────────

/**
 * Return file content at the HEAD version.
 * Returns empty string if the file does not exist in HEAD (newly added).
 */
export function getFileContentAtHead(cwd: string, filePath: string): string {
  try {
    return git(`git show HEAD:${filePath}`, cwd);
  } catch {
    return '';
  }
}

/**
 * Return the current working tree content of a file.
 * Returns empty string if the file has been deleted.
 */
export function getWorkingTreeContent(cwd: string, filePath: string): string {
  const absPath = pathResolve(cwd, filePath);
  if (!existsSync(absPath)) return '';
  try {
    return readFileSync(absPath, 'utf-8');
  } catch {
    return '';
  }
}

// ─── DiffViewData construction ────────────────────────────────

/**
 * Run git diff HEAD in the session cwd and build DiffViewData.
 * Includes staged + unstaged + untracked changes.
 */
export function buildDiffViewData(cwd: string, sessionId: string): DiffViewData {
  const emptyResult: DiffViewData = {
    sessionId,
    cwd,
    files: [],
    currentFileIndex: 0,
    diffMode: 'all',
    refreshedAt: new Date().toISOString(),
  };

  try {
    // Tracked file changes vs HEAD (staged + unstaged)
    const trackedOutput = git('git diff HEAD --name-status', cwd);
    const trackedEntries = parseDiffNameStatus(trackedOutput);

    // Untracked files (extracted via git status --short)
    const statusOutput = git('git status --short', cwd);
    const untrackedPaths = statusOutput
      .split('\n')
      .filter((line) => line.startsWith('??'))
      .map((line) => line.slice(3).trim())
      .filter((p) => p !== '');

    const allEntries: DiffFileEntry[] = [];

    // Tracked changes
    for (const entry of trackedEntries) {
      const originalContent = getFileContentAtHead(cwd, entry.oldPath ?? entry.path);
      const modifiedContent = entry.status === 'D' ? '' : getWorkingTreeContent(cwd, entry.path);
      allEntries.push({ ...entry, originalContent, modifiedContent });
    }

    // Untracked (new) files — not in HEAD, so original is empty string
    for (const filePath of untrackedPaths) {
      // Skip if already included in tracked entries
      if (allEntries.some((e) => e.path === filePath)) continue;
      const modifiedContent = getWorkingTreeContent(cwd, filePath);
      if (!modifiedContent) continue; // Empty file or read failure
      allEntries.push({
        path: filePath,
        status: 'A',
        language: inferLanguage(filePath),
        originalContent: '',
        modifiedContent,
      });
    }

    return {
      sessionId,
      cwd,
      files: allEntries,
      currentFileIndex: 0,
      diffMode: 'all',
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    // Not a git repo, etc.
    return emptyResult;
  }
}
