import { useState, useEffect, useCallback } from 'react';
import { useCli } from '@web/hooks/useCli';
import { useAppStore } from '@web/stores';
import { cn } from '@web/lib/utils';
import { apiClient } from '@web/lib/api-client';
import { MarkdownRenderer } from '@web/components/common/MarkdownRenderer';

/**
 * Issue list + detail view.
 * Clicking an issue switches the entire view to detail mode.
 */

interface Issue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string; color: string }[];
  assignees: string[];
  createdAt: string;
  comments?: { author: string; body: string; createdAt: string }[];
}

interface IssueListViewProps {
  data: { repo?: string; mode?: string };
}

export function IssueListView({ data }: IssueListViewProps) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const { executeCli } = useCli();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const repo = activeSession?.issueRepo || activeSession?.repo || (data.repo as string | undefined);

  const fetchIssues = useCallback(async () => {
    if (!repo) return;
    setLoadingIssues(true);
    try {
      const res = await apiClient.cli<{ issues: Issue[] }>(['issue', 'list', '--repo', repo]);
      if (res.ok && res.data?.issues) {
        setIssues(res.data.issues);
      }
    } catch {
      // Keep empty list on failure
    } finally {
      setLoadingIssues(false);
    }
  }, [repo]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  /** Fetch issue detail (including comments) */
  const openDetail = async (issue: Issue) => {
    setSelectedIssue(issue);
    if (!repo) return;
    setLoadingDetail(true);
    try {
      const res = await apiClient.cli<{ issue: Issue }>(['issue', 'view', String(issue.number), '--repo', repo]);
      if (res.ok && res.data?.issue) {
        setSelectedIssue(res.data.issue);
      }
    } catch {
      // Display with base data
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleWorktree = (issueNumber: number) => {
    if (!activeSessionId) return;
    executeCli(['s', 'create', '--parent', activeSessionId, '--issue', String(issueNumber)]);
  };

  const handleCreate = async () => {
    if (!newTitle.trim() || !repo) return;
    setCreating(true);
    try {
      await apiClient.cli(['issue', 'create', '--repo', repo, '--title', newTitle.trim(), '--body', newBody.trim()]);
      setNewTitle('');
      setNewBody('');
      setShowCreate(false);
      fetchIssues();
    } finally {
      setCreating(false);
    }
  };

  if (!repo) {
    return <RepoSetup data={data} />;
  }

  // Detail view
  if (selectedIssue) {
    return (
      <IssueDetailView
        issue={selectedIssue}
        loading={loadingDetail}
        onBack={() => setSelectedIssue(null)}
        onWorktree={() => handleWorktree(selectedIssue.number)}
      />
    );
  }

  // List view
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2.5 bg-zinc-900/60">
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
          </svg>
          <div>
            <span className="text-sm font-medium text-zinc-200">{repo.split('/')[1] || repo}</span>
            <span className="ml-1.5 text-xs text-zinc-500">{repo.split('/')[0]}</span>
          </div>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 font-medium">
            {issues.length} open
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchIssues}
            disabled={loadingIssues}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Refresh"
          >
            {loadingIssues ? '⟳' : '↻'}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-600 transition-colors"
          >
            New issue
          </button>
        </div>
      </div>

      {/* Issue creation form */}
      {showCreate && (
        <div className="border-b border-zinc-800/80 bg-zinc-900/40 p-4 space-y-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Issue title"
            autoFocus
            className="w-full rounded-md border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Description (optional)"
            rows={4}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              className="rounded-md bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-40 transition-colors"
            >
              {creating ? 'Creating…' : 'Submit new issue'}
            </button>
          </div>
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-auto">
        {loadingIssues && issues.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Loading issues…
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-500">
            <svg className="w-8 h-8 text-zinc-700" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
            </svg>
            <p className="text-sm">No issues</p>
          </div>
        ) : (
          <div>
            {issues.map((issue) => (
              <div
                key={issue.number}
                className="flex items-start gap-3 px-4 py-3 border-b border-zinc-800/50 cursor-pointer group transition-colors hover:bg-zinc-900/80"
                onClick={() => openDetail(issue)}
              >
                {/* Open/Closed icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {issue.state === 'open' ? (
                    <svg className="w-4 h-4 text-green-500" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
                      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-purple-500" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" />
                      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />
                    </svg>
                  )}
                </div>

                {/* Issue content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="text-[13px] font-semibold text-zinc-100 leading-snug group-hover:text-blue-400 transition-colors">
                      {issue.title}
                    </span>
                  </div>

                  {/* Labels */}
                  {issue.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {issue.labels.map((label) => {
                        const bg = `#${label.color}`;
                        return (
                          <span
                            key={label.name}
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
                            style={{
                              backgroundColor: `${bg}20`,
                              color: bg,
                              border: `1px solid ${bg}40`,
                            }}
                          >
                            {label.name}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Meta info */}
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="font-mono">#{issue.number}</span>
                    <span>·</span>
                    <span>{new Date(issue.createdAt).toLocaleDateString('ko')}</span>
                    {issue.assignees.length > 0 && (
                      <>
                        <span>·</span>
                        {issue.assignees.map((a) => (
                          <span key={a} className="text-zinc-400">@{a}</span>
                        ))}
                      </>
                    )}
                  </div>
                </div>

                {/* Worktree button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWorktree(issue.number);
                  }}
                  className={cn(
                    'flex-shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all',
                    'border-cyan-700/50 text-cyan-400 hover:bg-cyan-900/30 hover:border-cyan-600',
                    'opacity-0 group-hover:opacity-100',
                  )}
                  title="Create worktree sub-session"
                >
                  ⎇ Worktree
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Issue detail view */
function IssueDetailView({
  issue,
  loading,
  onBack,
  onWorktree,
}: {
  issue: Issue;
  loading: boolean;
  onBack: () => void;
  onWorktree: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Top navigation bar */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2 bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            ← Issues
          </button>
          <span className="text-zinc-600 text-xs">·</span>
          <span className="text-xs text-zinc-500 font-mono">#{issue.number}</span>
        </div>
        <button
          onClick={onWorktree}
          className="rounded-md border border-cyan-700/50 px-2.5 py-1 text-[11px] font-medium text-cyan-400 hover:bg-cyan-900/30 hover:border-cyan-600 transition-colors"
        >
          ⎇ Worktree
        </button>
      </div>

      {/* Body scroll area */}
      <div className="flex-1 overflow-auto">
        <div className="px-5 py-4">
          {/* Title */}
          <h2 className="text-base font-semibold text-zinc-100 leading-snug">
            {issue.title}
            <span className="ml-2 text-zinc-500 font-normal">#{issue.number}</span>
          </h2>

          {/* Status + labels + assignees */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                issue.state === 'open'
                  ? 'bg-green-900/50 text-green-400'
                  : 'bg-purple-900/50 text-purple-400',
              )}
            >
              {issue.state === 'open' ? 'Open' : 'Closed'}
            </span>
            {issue.labels.map((label) => (
              <span
                key={label.name}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
            {issue.assignees.map((a) => (
              <span key={a} className="text-xs text-zinc-500">@{a}</span>
            ))}
            <span className="text-[11px] text-zinc-600 ml-1">
              {new Date(issue.createdAt).toLocaleDateString('en-US')}
            </span>
          </div>

          {/* Body markdown */}
          {issue.body ? (
            <div className="mt-4 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
              <MarkdownRenderer content={issue.body} />
            </div>
          ) : (
            <p className="mt-4 text-xs text-zinc-600 italic">No content.</p>
          )}

          {/* Comments */}
          {loading ? (
            <div className="mt-6 text-xs text-zinc-500">Loading comments…</div>
          ) : (
            issue.comments &&
            issue.comments.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 text-xs font-medium text-zinc-500">
                  Comments ({issue.comments.length})
                </div>
                <div className="space-y-3">
                  {issue.comments.map((c, i) => (
                    <div key={i} className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 overflow-hidden">
                      {/* Comment header */}
                      <div className="flex items-center gap-2 px-4 py-2 bg-zinc-800/30 border-b border-zinc-800/60">
                        <span className="text-xs font-medium text-zinc-300">@{c.author}</span>
                        <span className="text-[11px] text-zinc-600">
                          {new Date(c.createdAt).toLocaleDateString('en-US')}
                        </span>
                      </div>
                      {/* Comment body */}
                      <div className="px-4 py-3">
                        <MarkdownRenderer content={c.body} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>

    </div>
  );
}

/** Settings UI when no repo is connected */
function RepoSetup({ data: _data }: { data: { repo?: string | null; mode?: string } }) {
  const [repoInput, setRepoInput] = useState('');
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const handleConnect = async () => {
    if (!repoInput.trim() || !activeSessionId) return;
    const store = useAppStore.getState();
    // Find the issue slot in GuiPane and update its data
    const gp = store.guiPanes.find((g) => g.sessionId === activeSessionId && g.slots.some((s) => s.viewType === 'issue'));
    if (gp) {
      const issueSlot = gp.slots.find((s) => s.viewType === 'issue');
      if (issueSlot) {
        store.updateSlotData(gp.id, issueSlot.id, {
          data: { ...issueSlot.data, repo: repoInput.trim() },
        });
      }
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 bg-zinc-950">
      <svg className="w-10 h-10 text-zinc-700" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-200">Connect a GitHub repo</p>
        <p className="mt-1 text-xs text-zinc-500">
          Connect a repo to manage issues
        </p>
      </div>

      <div className="w-full max-w-xs space-y-2">
        <input
          type="text"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          placeholder="owner/repo"
          className="w-full rounded-md border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
        />
        <button
          onClick={handleConnect}
          disabled={!repoInput.trim()}
          className="w-full rounded-md bg-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 transition-colors"
        >
          Connect
        </button>
      </div>

      <p className="text-[11px] text-zinc-600 text-center">
        cltree auto-detects a repo when launched in a directory with a git remote
      </p>
    </div>
  );
}
