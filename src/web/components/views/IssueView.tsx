import { useCli } from '@web/hooks/useCli';
import { useAppStore } from '@web/stores';
import { cn } from '@web/lib/utils';
import { MarkdownRenderer } from '@web/components/common/MarkdownRenderer';
import type { IssueViewData } from '@shared/types';

interface IssueViewProps {
  data: IssueViewData;
}

/**
 * Issue View.
 * Displays GitHub issues/PRs in a structured format.
 * Bottom buttons = CLI commands exposed as GUI actions.
 */
export function IssueView({ data }: IssueViewProps) {
  const { executeCli } = useCli();
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const handleWorktree = () => {
    if (!activeSessionId) return;
    executeCli([
      's', 'create',
      '--parent', activeSessionId,
      '--issue', String(data.number),
      '--spawn',
    ]);
  };

  const handleClose = () => {
    executeCli(['gh', 'issue', 'close', String(data.number)]);
  };

  return (
    <div className="p-3 text-sm">
      {/* Title + status */}
      <div className="mb-2">
        <h3 className="font-medium text-zinc-100 text-sm leading-tight">
          #{data.number}: {data.title}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {/* Status badge */}
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              data.state === 'open'
                ? 'bg-green-900/50 text-green-400'
                : 'bg-purple-900/50 text-purple-400',
            )}
          >
            {data.state}
          </span>

          {/* Label badges */}
          {data.labels.map((label) => (
            <span
              key={label.name}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: `#${label.color}22`,
                color: `#${label.color}`,
                border: `1px solid #${label.color}44`,
              }}
            >
              {label.name}
            </span>
          ))}

          {/* Assignees */}
          {data.assignees.map((a) => (
            <span key={a} className="text-xs text-zinc-500">
              @{a}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="mb-3 rounded bg-zinc-800/50 p-2">
        <MarkdownRenderer content={data.body} />
      </div>

      {/* Comments */}
      {data.comments.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-zinc-500">
            Comments ({data.comments.length})
          </div>
          <div className="space-y-2">
            {data.comments.map((c, i) => (
              <div key={i} className="rounded bg-zinc-800/30 p-2 text-xs">
                <div className="flex items-center gap-1 text-zinc-500">
                  <span className="font-medium text-zinc-400">@{c.author}</span>
                  <span>{'\u00B7'}</span>
                  <span>{new Date(c.createdAt).toLocaleDateString('ko')}</span>
                </div>
                <div className="mt-1">
                  <MarkdownRenderer content={c.body} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
        <button
          onClick={handleWorktree}
          className="rounded bg-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-600 transition-colors"
        >
          Worktree
        </button>
        <button
          onClick={handleClose}
          className="rounded bg-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-600 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
