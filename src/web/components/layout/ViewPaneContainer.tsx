import { useAppStore } from '@web/stores';
import { apiClient } from '@web/lib/api-client';
import { IssueView } from '@web/components/views/IssueView';
import { IssueListView } from '@web/components/views/IssueListView';
import { ConfigView } from '@web/components/views/ConfigView';
import { SplitPane } from '@web/components/layout/SplitPane';
import type { GuiPane, ViewSlotType, IssueViewData } from '@shared/types';
import { CircleDot, Settings, X } from 'lucide-react';

/** View type definitions */
const VIEW_TYPES = [
  { type: 'issue', label: 'Issues', icon: CircleDot, color: 'text-green-500' },
  { type: 'config', label: 'Settings', icon: Settings, color: 'text-zinc-400' },
] as const;

/** View pane container */
export function ViewPaneContainer({ paneId }: { paneId: string }) {
  const guiPane = useAppStore((s) => s.guiPanes.find((p) => p.id === paneId));
  const focusedPaneId = useAppStore((s) => s.focusedPaneId);
  const setFocused = useAppStore((s) => s.setFocused);
  const removeGuiPane = useAppStore((s) => s.removeGuiPane);
  const removeFromLayout = useAppStore((s) => s.removeFromLayout);
  const updateGuiPane = useAppStore((s) => s.updateGuiPane);
  const sessions = useAppStore((s) => s.sessions);

  if (!guiPane) return null;
  const isFocused = focusedPaneId === paneId;

  // Get the current viewType from the activeSlot
  const activeSlot = guiPane.slots.find((s) => s.id === guiPane.activeSlotId);
  const currentViewType = activeSlot?.viewType;

  /** Tab click → switch viewType */
  const handleTabClick = (type: ViewSlotType) => {
    if (type === currentViewType) return;
    let data: Record<string, unknown> = {};
    if (type === 'issue') {
      const session = sessions.find((s) => s.id === guiPane.sessionId);
      data = { repo: session?.issueRepo || session?.repo, mode: 'list' };
    }
    if (activeSlot) {
      const updatedSlots = guiPane.slots.map((s) =>
        s.id === activeSlot.id ? { ...s, viewType: type, data } : s,
      );
      updateGuiPane(paneId, { slots: updatedSlots });
    }
  };

  return (
    <div
      className={`flex h-full flex-col border-l border-r ${isFocused ? 'border-zinc-600' : 'border-transparent'}`}
      onClick={() => setFocused(guiPane.id)}
    >
      {/* Header: view switch tabs + controls */}
      <div className="flex h-8 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-1 group">
        <div className="flex items-center gap-0">
          {VIEW_TYPES.map((vt) => {
            const Icon = vt.icon;
            const isActive = vt.type === currentViewType;
            return (
              <button
                key={vt.type}
                onClick={(e) => { e.stopPropagation(); handleTabClick(vt.type); }}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors rounded-sm ${
                  isActive
                    ? 'text-zinc-200 bg-zinc-700/60'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <Icon className={`w-3 h-3 ${isActive ? vt.color : ''}`} />
                <span>{vt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5">
          {/* Split button */}
          <SplitPane paneId={guiPane.id} />

          {/* Close */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeGuiPane(guiPane.id);
              removeFromLayout(guiPane.id);
              // Unregister ViewPane on server
              apiClient.cli(['p', 'view-unregister', guiPane.id]).catch(() => {});
            }}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* View body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeSlot && renderView(guiPane, activeSlot.viewType, activeSlot.data)}
      </div>
    </div>
  );
}

function renderView(guiPane: GuiPane, viewType: ViewSlotType, data: Record<string, unknown>) {
  switch (viewType) {
    case 'issue':
      if (data.mode === 'list') {
        return <IssueListView data={data as { repo?: string; mode?: string }} />;
      }
      return <IssueView data={data as unknown as IssueViewData} />;
    case 'config':
      return <ConfigView />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
          Unsupported view: {viewType}
        </div>
      );
  }
}
