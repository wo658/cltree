import { useState } from 'react';
import { useAppStore } from '@web/stores';
import { useCli } from '@web/hooks/useCli';
import { cn } from '@web/lib/utils';
import { CreateSessionModal } from '@web/components/modals/CreateSessionModal';
import { CompleteSessionModal } from '@web/components/modals/CompleteSessionModal';
import { ExternalLink, Trash2 } from 'lucide-react';
import type { Session } from '@shared/types';

/**
 * Session tree.
 * Recursively renders sessions/sub-sessions in a tree structure.
 */
export function SessionTree() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const { executeCli } = useCli();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<Session | null>(null);

  // Active workspace
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  // Only root sessions of the current workspace
  const rootSessions = sessions.filter((s) => !s.parentSessionId && s.workspaceId === activeWorkspaceId);

  const setActiveSession = useAppStore((s) => s.setActiveSession);

  const handleSwitch = (id: string) => {
    // Update local store immediately (this tab only) → send to server only for DB persistence
    setActiveSession(id);
    sessionStorage.setItem('cltree_activeSessionId', id);
    executeCli(['s', 'switch', id]);
  };

  const handleDelete = (id: string) => {
    executeCli(['s', 'delete', id]);
  };

  const handleOpenEditor = (id: string) => {
    executeCli(['s', 'open-editor', id]);
  };

  const handleComplete = (session: Session) => {
    setCompleteTarget(session);
  };

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {activeWs ? activeWs.name : 'Sessions'}
        </span>
      </div>

      {/* Session tree */}
      <div className="space-y-0.5">
        {rootSessions.map((session) => (
          <SessionNode
            key={session.id}
            session={session}
            allSessions={sessions}
            activeSessionId={activeSessionId}
            depth={0}
            onSwitch={handleSwitch}
            onDelete={handleDelete}
            onOpenEditor={handleOpenEditor}
            onComplete={handleComplete}
          />
        ))}
      </div>

      {/* Bottom buttons */}
      <div className="mt-3 flex items-center gap-2 px-1">
        <button
          onClick={() => setShowCreateModal(true)}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          + new
        </button>
      </div>

      {/* Session creation modal */}
      {showCreateModal && (
        <CreateSessionModal onClose={() => setShowCreateModal(false)} />
      )}

      {/* Session complete modal */}
      {completeTarget && (
        <CompleteSessionModal
          session={completeTarget}
          onClose={() => setCompleteTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Session node (recursive) ─────────────────────────────────

interface SessionNodeProps {
  session: Session;
  allSessions: Session[];
  activeSessionId: string | null;
  depth: number;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onComplete: (session: Session) => void;
}

function SessionNode({
  session,
  allSessions,
  activeSessionId,
  depth,
  onSwitch,
  onDelete,
  onOpenEditor,
  onComplete,
}: SessionNodeProps) {
  const isActive = session.id === activeSessionId;
  const children = session.children || [];
  const isChild = depth > 0;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded px-2 cursor-pointer text-sm',
          'hover:bg-zinc-800 transition-colors',
          isActive && 'bg-zinc-800 text-zinc-100',
          !isActive && 'text-zinc-400',
          isChild ? 'py-0.5 pl-3' : 'py-1',
        )}
        onClick={() => onSwitch(session.id)}
      >
        {/* Active marker */}
        <span className={cn('text-xs flex-shrink-0', isActive ? 'text-green-400' : 'text-transparent')}>
          {'\u25B6'}
        </span>

        {/* Session name */}
        <span className={cn('truncate flex-1', isChild && 'text-xs')}>
          {session.issueNumber && !session.name.startsWith(`#${session.issueNumber}`)
            ? `#${session.issueNumber} `
            : ''}
          {session.name}
        </span>

        {/* Worktree badge (after name) */}
        {session.worktreePath && (
          <span className="rounded bg-cyan-900/40 px-1 py-0 text-[10px] text-cyan-400 font-mono flex-shrink-0">wt</span>
        )}

        {/* Open in VS Code (shown on hover) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenEditor(session.id);
          }}
          className="hidden group-hover:inline-flex items-center justify-center text-zinc-600 hover:text-blue-400 transition-colors flex-shrink-0"
          title="Open in editor"
        >
          <ExternalLink size={13} />
        </button>

        {/* Delete button (shown on hover) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.id);
          }}
          className="hidden group-hover:inline-flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"
          title="Delete session"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Child sessions (always shown) */}
      {children.map((child) => (
          <SessionNode
            key={child.id}
            session={child}
            allSessions={allSessions}
            activeSessionId={activeSessionId}
            depth={depth + 1}
            onSwitch={onSwitch}
            onDelete={onDelete}
            onOpenEditor={onOpenEditor}
            onComplete={onComplete}
          />
        ))}
    </div>
  );
}
