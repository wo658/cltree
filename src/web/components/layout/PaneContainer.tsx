import { memo } from 'react';
import { useAppStore } from '@web/stores';
import { useCli } from '@web/hooks/useCli';
import { Terminal } from '@web/components/terminal/Terminal';
import { SplitPane } from '@web/components/layout/SplitPane';
import { cn } from '@web/lib/utils';
import { X, MapPin } from 'lucide-react';

/** Status badge colors */
const statusColor: Record<string, string> = {
  running: 'bg-green-500',
  idle: 'bg-zinc-400',
  busy: 'bg-yellow-500',
  done: 'bg-blue-500',
  error: 'bg-red-500',
  exited: 'bg-zinc-600',
};

/** Check if cmd is a shell (no fixed cmd assigned) */
function isShellCmd(cmd: string): boolean {
  return ['zsh', 'bash', 'sh', '/bin/zsh', '/bin/bash', '/bin/sh'].includes(cmd);
}

/** Header subscribes to pane state only — Terminal is render-isolated */
const PaneHeader = memo(function PaneHeader({ paneId }: { paneId: string }) {
  const pane = useAppStore((s) => s.panes.find((p) => p.id === paneId));
  const setDragging = useAppStore((s) => s.setDragging);
  const { executeCli } = useCli();

  if (!pane) return null;

  const hasCmd = !isShellCmd(pane.cmd);

  return (
    <div
      className="flex h-8 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-2 group cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/pane-id', paneId);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(paneId);
      }}
      onDragEnd={() => setDragging(null)}
    >
      <div className="flex items-center gap-1.5 text-xs min-w-0">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400 text-[10px] flex-shrink-0">
          {pane.type}
        </span>

        <span
          className={cn(
            'truncate max-w-[180px] text-[11px]',
            hasCmd ? 'text-zinc-400' : 'text-zinc-600 italic',
          )}
          title={hasCmd ? pane.cmd : 'shell'}
        >
          {hasCmd ? pane.cmd : 'shell'}
        </span>

        <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', statusColor[pane.status] ?? 'bg-zinc-500')} title={pane.status} />
      </div>

      <div className="flex items-center gap-0.5">
        {/* Pin cwd button (terminal pane) */}
        {pane.type === 'terminal' && (
          <button
            onClick={(e) => { e.stopPropagation(); executeCli(['p', 'pin-cwd', paneId]); }}
            className="hidden group-hover:inline-flex rounded p-0.5 text-zinc-600 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
            title="Pin current path as session cwd"
          >
            <MapPin className="w-3 h-3" />
          </button>
        )}

        <SplitPane paneId={paneId} />

        {/* Delete (fully remove pane) */}
        <button
          onClick={(e) => { e.stopPropagation(); executeCli(['p', 'remove', paneId]); }}
          className="rounded p-0.5 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          title="Delete pane"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});

interface PaneContainerProps {
  paneId: string;
}

/** PTY pane wrapper. Top bar + xterm.js terminal. Header and terminal are render-isolated. */
export function PaneContainer({ paneId }: PaneContainerProps) {
  const focusedPaneId = useAppStore((s) => s.focusedPaneId);
  const setFocused = useAppStore((s) => s.setFocused);
  const paneType = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.type);

  const isFocused = focusedPaneId === paneId;

  return (
    <div
      className={cn('flex h-full flex-col border-l border-r', isFocused ? 'border-zinc-600' : 'border-transparent')}
      onClick={() => setFocused(paneId)}
    >
      <PaneHeader paneId={paneId} />
      <div className="flex-1 min-h-0">
        <Terminal paneId={paneId} paneType={paneType} />
      </div>
    </div>
  );
}
