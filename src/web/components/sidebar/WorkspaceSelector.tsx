import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@web/stores';
import { useCli } from '@web/hooks/useCli';
import { cn } from '@web/lib/utils';

/**
 * Linear-style workspace selector.
 * Single-line dropdown — click to expand workspace list.
 */
export function WorkspaceSelector() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const sessions = useAppStore((s) => s.sessions);
  const { executeCli } = useCli();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* Current workspace (single line) */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-zinc-800/40 transition-colors border-b border-zinc-800/60"
      >
        <div className="w-5 h-5 rounded bg-gradient-to-br from-zinc-600 to-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 font-bold flex-shrink-0">
          {(activeWs?.name || 'W')[0].toUpperCase()}
        </div>
        <span className="text-[13px] font-semibold text-zinc-200 truncate flex-1 text-left">
          {activeWs?.name || 'Workspace'}
        </span>
        <svg className={cn('w-3 h-3 text-zinc-500 transition-transform flex-shrink-0', open && 'rotate-180')} viewBox="0 0 16 16" fill="currentColor">
          <path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-2 right-2 top-full mt-1 z-30 rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
          <div className="px-2 pt-2 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 px-1">Workspaces</span>
          </div>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors rounded-sm mx-1',
                ws.id === activeWorkspaceId
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
              )}
              style={{ width: 'calc(100% - 8px)' }}
              onClick={() => {
                // Update local store immediately (this tab only) — send to server only for DB persistence
                setActiveWorkspace(ws.id);
                sessionStorage.setItem('cltree_activeWorkspaceId', ws.id);
                const firstSession = sessions.find((s) => s.workspaceId === ws.id && !s.parentSessionId);
                const sessionId = firstSession?.id ?? null;
                setActiveSession(sessionId);
                if (sessionId) sessionStorage.setItem('cltree_activeSessionId', sessionId);
                executeCli(['w', 'switch', ws.id]);
                setOpen(false);
              }}
            >
              <div className={cn(
                'w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0',
                ws.id === activeWorkspaceId ? 'bg-zinc-600 text-zinc-200' : 'bg-zinc-800 text-zinc-500',
              )}>
                {ws.name[0].toUpperCase()}
              </div>
              <span className="text-xs truncate flex-1">{ws.name}</span>
              {ws.id === activeWorkspaceId && (
                <svg className="w-3 h-3 text-green-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                </svg>
              )}
            </button>
          ))}

          <div className="border-t border-zinc-800 mt-1 p-1">
            {creating ? (
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name, then Enter"
                autoFocus
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    await executeCli(['w', 'create', '--name', newName.trim()]);
                    setNewName(''); setCreating(false); setOpen(false);
                  }
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 rounded-sm transition-colors"
              >
                <span className="text-zinc-600">+</span>
                <span>New workspace</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
