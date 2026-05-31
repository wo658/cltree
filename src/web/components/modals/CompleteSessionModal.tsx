import { useState } from 'react';
import { useCli } from '@web/hooks/useCli';
import { cn } from '@web/lib/utils';
import type { Session, MergeConflictInfo } from '@shared/types';

interface CompleteSessionModalProps {
  session: Session;
  onClose: () => void;
}

type MergeMode = 'merge' | 'pr';
type ResultState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; pr?: { number: number; url: string } }
  | { type: 'conflict'; conflict: MergeConflictInfo }
  | { type: 'error'; message: string };

/**
 * Session completion modal.
 * Select merge/PR method → execute → display result (success/conflict/error).
 */
export function CompleteSessionModal({ session, onClose }: CompleteSessionModalProps) {
  const [mode, setMode] = useState<MergeMode>('merge');
  const [result, setResult] = useState<ResultState>({ type: 'idle' });
  const { executeCli } = useCli();

  const handleComplete = async () => {
    setResult({ type: 'loading' });

    const cmd = ['s', 'complete', session.id];
    if (mode === 'pr') cmd.push('--pr');

    const res = await executeCli(cmd);

    if (!res.ok) {
      setResult({ type: 'error', message: res.error || 'Unknown error' });
      return;
    }

    const data = res.data as Record<string, unknown>;

    // Conflict occurred
    if (data.conflict) {
      setResult({ type: 'conflict', conflict: data.conflict as MergeConflictInfo });
      return;
    }

    // Success
    setResult({
      type: 'success',
      pr: data.pr as { number: number; url: string } | undefined,
    });
  };

  const isWorktree = !!session.worktreePath;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-xl">
        <h2 className="mb-1 text-sm font-medium text-zinc-100">Complete session</h2>
        <p className="mb-3 text-xs text-zinc-500 truncate">
          {session.issueNumber && !session.name.startsWith(`#${session.issueNumber}`) ? `#${session.issueNumber} ` : ''}{session.name}
          {session.branch && <span className="ml-1 font-mono text-zinc-600">({session.branch})</span>}
        </p>

        {/* Render per result state */}
        {result.type === 'idle' && isWorktree && (
          <div className="space-y-3">
            {/* Merge method selection */}
            <div className="space-y-1.5">
              <label className="block text-xs text-zinc-500">Completion method</label>
              <div className="flex gap-2">
                <ModeButton
                  active={mode === 'merge'}
                  onClick={() => setMode('merge')}
                  label="Local merge"
                  desc="Merge directly into main"
                />
                <ModeButton
                  active={mode === 'pr'}
                  onClick={() => setMode('pr')}
                  label="Pull Request"
                  desc="Open a GitHub PR"
                />
              </div>
            </div>

            {/* Info */}
            <div className="rounded-md bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
              {mode === 'merge' ? (
                <span>Merge into the main branch, then clean up the worktree and branch. If there&apos;s a conflict, an agent is spawned automatically to help resolve it.</span>
              ) : (
                <span>Push the branch and open a PR. The worktree is cleaned up, but the branch is kept.</span>
              )}
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleComplete}
                className="rounded-md bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-600 transition-colors"
              >
                Complete
              </button>
            </div>
          </div>
        )}

        {result.type === 'idle' && !isWorktree && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">Mark this session as complete.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
              <button onClick={handleComplete} className="rounded-md bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-600 transition-colors">Complete</button>
            </div>
          </div>
        )}

        {result.type === 'loading' && (
          <div className="flex items-center gap-2 py-4 text-xs text-zinc-400">
            <span className="animate-spin">&#9696;</span>
            <span>{mode === 'pr' ? 'Creating PR…' : 'Merging…'}</span>
          </div>
        )}

        {result.type === 'success' && (
          <div className="space-y-3">
            <div className="rounded-md bg-green-900/30 border border-green-800/50 px-3 py-2 text-xs text-green-400">
              {result.pr ? (
                <span>PR #{result.pr.number} created. Switched to the parent session.</span>
              ) : (
                <span>Merge complete. The worktree and branch have been cleaned up.</span>
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-md bg-zinc-700 px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 transition-colors">Close</button>
            </div>
          </div>
        )}

        {result.type === 'conflict' && (
          <div className="space-y-3">
            <div className="rounded-md bg-amber-900/30 border border-amber-800/50 px-3 py-2 text-xs text-amber-400">
              <p className="font-medium mb-1">Merge conflict</p>
              <p>
                <span className="font-mono">{result.conflict.branch}</span> → <span className="font-mono">{result.conflict.mainBranch}</span>
              </p>
            </div>

            {/* Conflict file list */}
            <div className="space-y-1">
              <span className="text-xs text-zinc-500">Conflicting files ({result.conflict.files.length})</span>
              <div className="max-h-32 overflow-y-auto rounded-md bg-zinc-800/50 px-3 py-2">
                {result.conflict.files.map((f) => (
                  <div key={f} className="text-xs font-mono text-red-400">{f}</div>
                ))}
              </div>
            </div>

            <div className="rounded-md bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
              A conflict-resolution agent has been spawned in the parent session. It will analyze and resolve the conflict.
            </div>

            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-md bg-zinc-700 px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 transition-colors">OK</button>
            </div>
          </div>
        )}

        {result.type === 'error' && (
          <div className="space-y-3">
            <div className="rounded-md bg-red-900/30 border border-red-800/50 px-3 py-2 text-xs text-red-400">
              {result.message}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Close</button>
              <button onClick={() => setResult({ type: 'idle' })} className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 transition-colors">Retry</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Merge method selection button */
function ModeButton({ active, onClick, label, desc }: { active: boolean; onClick: () => void; label: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md border px-3 py-2 text-left transition-colors',
        active
          ? 'border-green-700 bg-green-900/20 text-green-400'
          : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600',
      )}
    >
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[10px] text-zinc-500 mt-0.5">{desc}</div>
    </button>
  );
}
