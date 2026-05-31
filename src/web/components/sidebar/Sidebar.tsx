import { WorkspaceSelector } from './WorkspaceSelector';
import { SessionTree } from './SessionTree';

/**
 * Sidebar.
 * Top: workspace selector (dropdown)
 * Bottom: session tree (active workspace)
 */
export function Sidebar() {
  return (
    <div className="flex h-full flex-col bg-zinc-900 border-r border-zinc-800">
      <WorkspaceSelector />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SessionTree />
      </div>
    </div>
  );
}
