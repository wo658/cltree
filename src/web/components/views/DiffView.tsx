/**
 * Diff View
 *
 * Renders git diff HEAD relative to the session's cwd using Monaco DiffEditor.
 * Left: file list sidebar / Right: Monaco DiffEditor
 */
import { useState, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { RefreshCw, GitBranch, FilePlus, FileMinus, FileEdit } from 'lucide-react';
import type { DiffViewData, DiffFileEntry } from '@shared/types';
import { apiClient } from '@web/lib/api-client';

interface DiffViewProps {
  data: DiffViewData;
  slotId?: string;
  guiPaneId?: string;
}

/** File status → icon/color mapping */
function FileStatusIcon({ status }: { status: DiffFileEntry['status'] }) {
  switch (status) {
    case 'A':
      return <FilePlus className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />;
    case 'D':
      return <FileMinus className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    case 'R':
      return <FileEdit className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />;
    default: // M, U
      return <FileEdit className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />;
  }
}

/** File status label */
function statusLabel(status: DiffFileEntry['status']): string {
  switch (status) {
    case 'A': return 'A';
    case 'D': return 'D';
    case 'R': return 'R';
    default:  return 'M';
  }
}

/** Status badge color */
function statusColor(status: DiffFileEntry['status']): string {
  switch (status) {
    case 'A': return 'text-green-400';
    case 'D': return 'text-red-400';
    case 'R': return 'text-blue-400';
    default:  return 'text-yellow-400';
  }
}

/** Diff View component */
export function DiffView({ data: raw, slotId, guiPaneId }: DiffViewProps) {
  const data: DiffViewData = {
    sessionId: raw?.sessionId || '',
    cwd: raw?.cwd || '',
    files: raw?.files || [],
    currentFileIndex: raw?.currentFileIndex ?? 0,
    diffMode: raw?.diffMode || 'all',
    refreshedAt: raw?.refreshedAt || '',
  };

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const selectedFile = data.files[selectedIndex];

  /** Refresh diff */
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (slotId) {
        await apiClient.cli(['diff', 'refresh', '--slot', slotId]);
      } else {
        await apiClient.cli(['diff', 'refresh', '--session', data.sessionId]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, slotId, data.sessionId]);

  const refreshedAt = data.refreshedAt
    ? new Date(data.refreshedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-300">
            {data.files.length > 0
              ? `${data.files.length} file${data.files.length === 1 ? '' : 's'} changed`
              : 'No changed files'}
          </span>
          {refreshedAt && (
            <span className="text-xs text-zinc-600">{refreshedAt}</span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
          title="Refresh diff"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {data.files.length === 0 ? (
        /* No changes */
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-600">
          <GitBranch className="w-8 h-8 opacity-30" />
          <span className="text-sm">No changed files</span>
          <button
            onClick={handleRefresh}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* File list sidebar */}
          <div className="flex w-48 flex-shrink-0 flex-col border-r border-zinc-800 overflow-y-auto">
            {data.files.map((file, idx) => {
              const fileName = file.path.split('/').pop() || file.path;
              const dirPath = file.path.includes('/')
                ? file.path.slice(0, file.path.lastIndexOf('/'))
                : '';
              const isSelected = idx === selectedIndex;

              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedIndex(idx)}
                  className={`flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-zinc-700/60 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <FileStatusIcon status={file.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] font-bold font-mono ${statusColor(file.status)}`}>
                        {statusLabel(file.status)}
                      </span>
                      <span className="truncate text-xs font-medium">{fileName}</span>
                    </div>
                    {dirPath && (
                      <div className="truncate text-[10px] text-zinc-600">{dirPath}</div>
                    )}
                    {file.oldPath && (
                      <div className="truncate text-[10px] text-zinc-600 italic">
                        ← {file.oldPath.split('/').pop()}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Monaco DiffEditor */}
          <div className="flex flex-1 min-w-0 flex-col">
            {selectedFile && (
              <>
                {/* File path display */}
                <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-1 text-xs text-zinc-500 flex-shrink-0">
                  <FileStatusIcon status={selectedFile.status} />
                  <span className="font-mono truncate">{selectedFile.path}</span>
                  {selectedFile.oldPath && (
                    <span className="text-zinc-700">← {selectedFile.oldPath}</span>
                  )}
                </div>

                <div className="flex-1 min-h-0">
                  <DiffEditor
                    height="100%"
                    language={selectedFile.language}
                    original={selectedFile.originalContent}
                    modified={selectedFile.modifiedContent}
                    theme="vs-dark"
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 12,
                      lineHeight: 18,
                      padding: { top: 8, bottom: 8 },
                      overviewRulerLanes: 0,
                      folding: false,
                      renderLineHighlight: 'none',
                      scrollbar: {
                        verticalScrollbarSize: 6,
                        horizontalScrollbarSize: 6,
                      },
                    }}
                    loading={
                      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                        Loading…
                      </div>
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
