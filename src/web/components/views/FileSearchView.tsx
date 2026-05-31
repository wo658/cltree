import { useState, useCallback, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { apiClient } from '@web/lib/api-client';
import { Search, FileText, ChevronLeft, X } from 'lucide-react';
import { formatResultPath, getFileIcon, truncateLine, buildSearchPayload } from './file-search-utils';
import type { FileSearchViewData, FileSearchResult } from '@shared/types';

/**
 * FileSearch View
 *
 * Two sub-views:
 *   - List view: search input + filename/content mode toggle + result list
 *   - Viewer view: Monaco read-only editor shown when a result is clicked
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileContent {
  content: string;
  path: string;
  language: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileSearchView({ data }: { data: FileSearchViewData }) {
  const cwd = data.cwd ?? '';
  const [query, setQuery] = useState(data.query ?? '');
  const [mode, setMode] = useState<'filename' | 'content'>(data.mode ?? 'filename');
  const [results, setResults] = useState<FileSearchResult[]>(data.results ?? []);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Viewer state
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [selectedResult, setSelectedResult] = useState<FileSearchResult | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Monaco editor ref — for scrolling to the matching line
  const editorRef = useRef<Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0] | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ─── Search ────────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const payload = buildSearchPayload({ query: query.trim(), cwd, mode });
      const res = await apiClient.cli<FileSearchViewData>(payload.cmd, payload.data);
      if (res.ok && res.data.results) {
        setResults(res.data.results);
      } else {
        setResults([]);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, cwd, mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // ─── Open file ─────────────────────────────────────────────────────────────

  const openFile = useCallback(async (result: FileSearchResult) => {
    setSelectedResult(result);
    setFileLoading(true);
    setFileError(null);
    try {
      // Build absolute path (join with cwd if available, otherwise use as-is)
      const absPath = cwd ? `${cwd}/${result.path}` : result.path;
      const res = await apiClient.cli<FileContent>(['fs', 'read-file', absPath]);
      if (res.ok) {
        setFileContent(res.data);
      } else {
        setFileError('Cannot open file');
        setFileContent(null);
      }
    } catch {
      setFileError('Failed to read file');
      setFileContent(null);
    } finally {
      setFileLoading(false);
    }
  }, [cwd]);

  const handleEditorMount = useCallback(
    (editor: Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0]) => {
      editorRef.current = editor;
      // Scroll to matching line in content mode
      if (selectedResult?.lineNumber) {
        editor.revealLineInCenter(selectedResult.lineNumber);
      }
    },
    [selectedResult],
  );

  // ─── Back ──────────────────────────────────────────────────────────────────

  const handleBack = () => {
    setFileContent(null);
    setSelectedResult(null);
    setFileError(null);
  };

  // ─── Viewer view ───────────────────────────────────────────────────────────

  if (selectedResult !== null) {
    const { filename } = formatResultPath(selectedResult.path);
    return (
      <div className="flex h-full flex-col bg-zinc-950">
        {/* Viewer header */}
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5 flex-shrink-0">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <span className="text-zinc-700">·</span>
          <FileText className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-xs text-zinc-300 font-mono truncate" title={selectedResult.path}>
            {filename}
          </span>
          {selectedResult.lineNumber && (
            <span className="text-xs text-zinc-600 ml-auto">:{selectedResult.lineNumber}</span>
          )}
        </div>

        {/* File content */}
        <div className="flex-1 min-h-0 relative">
          {fileLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs bg-zinc-950">
              Loading…
            </div>
          )}
          {fileError && (
            <div className="flex items-center justify-center h-full text-red-400 text-xs">
              {fileError}
            </div>
          )}
          {fileContent && !fileLoading && (
            <Editor
              value={fileContent.content}
              language={fileContent.language}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: true },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'off',
              }}
              onMount={handleEditorMount}
            />
          )}
        </div>
      </div>
    );
  }

  // ─── List view ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Search input area */}
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2 flex-shrink-0">
        <Search className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search…"
          className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setSearched(false); }}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {/* filename / content toggle */}
        <div className="flex items-center rounded border border-zinc-700 overflow-hidden flex-shrink-0">
          {(['filename', 'content'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                mode === m
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {m === 'filename' ? 'name' : 'content'}
            </button>
          ))}
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="rounded px-2 py-0.5 text-[10px] bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {/* Results area */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full text-zinc-500 text-xs">Searching…</div>
        )}

        {!loading && searched && results.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-xs">No results</div>
        )}

        {!loading && !searched && (
          <div className="flex items-center justify-center h-full text-zinc-700 text-xs">
            Type a query and press Enter, or click Search
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="p-1">
            {/* Result count */}
            <div className="px-2 py-1 text-[10px] text-zinc-600">
              {results.length} result{results.length === 1 ? '' : 's'}{results.length === 100 ? ' (max 100)' : ''}
            </div>
            {/* Result list */}
            {results.map((result, idx) => (
              <FileResultItem
                key={`${result.path}-${result.lineNumber ?? idx}`}
                result={result}
                mode={mode}
                onClick={() => openFile(result)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Result item ──────────────────────────────────────────────────────────────

function FileResultItem({
  result,
  mode,
  onClick,
}: {
  result: FileSearchResult;
  mode: 'filename' | 'content';
  onClick: () => void;
}) {
  const { filename, dir } = formatResultPath(result.path);
  const icon = getFileIcon(filename);

  return (
    <button
      onClick={onClick}
      className="w-full flex flex-col px-2 py-1.5 hover:bg-zinc-800/60 rounded transition-colors text-left group"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <FileTypeIcon icon={icon} />
        <span className="text-xs text-zinc-200 font-mono truncate flex-1">{filename}</span>
        {mode === 'content' && result.lineNumber && (
          <span className="text-[10px] text-zinc-600 flex-shrink-0">:{result.lineNumber}</span>
        )}
      </div>
      {dir && (
        <span className="text-[10px] text-zinc-600 font-mono ml-5 mt-0.5 truncate">{dir}</span>
      )}
      {mode === 'content' && result.lineContent && (
        <span className="text-[10px] text-zinc-500 font-mono ml-5 mt-0.5 truncate">
          {truncateLine(result.lineContent)}
        </span>
      )}
    </button>
  );
}

// ─── File type icon ───────────────────────────────────────────────────────────

function FileTypeIcon({ icon }: { icon: string }) {
  const colors: Record<string, string> = {
    ts: 'text-blue-400',
    tsx: 'text-cyan-400',
    js: 'text-yellow-400',
    jsx: 'text-yellow-300',
    py: 'text-green-400',
    rs: 'text-orange-400',
    go: 'text-cyan-300',
    json: 'text-yellow-500',
    md: 'text-zinc-400',
    css: 'text-blue-300',
    scss: 'text-pink-400',
    html: 'text-orange-300',
    sh: 'text-green-300',
  };
  return (
    <span className={`text-[10px] font-bold font-mono flex-shrink-0 w-4 ${colors[icon] ?? 'text-zinc-500'}`}>
      {icon === 'file' ? '·' : icon.slice(0, 2)}
    </span>
  );
}
