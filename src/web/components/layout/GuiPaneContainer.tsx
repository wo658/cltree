import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@web/stores';
import { apiClient } from '@web/lib/api-client';
import { IssueView } from '@web/components/views/IssueView';
import { IssueListView } from '@web/components/views/IssueListView';
import { ConfigView } from '@web/components/views/ConfigView';
import { ExplainView } from '@web/components/views/ExplainView';
import { PreviewView } from '@web/components/views/PreviewView';
import { DiffView } from '@web/components/views/DiffView';
import { FileSearchView } from '@web/components/views/FileSearchView';
import { SplitPane } from '@web/components/layout/SplitPane';
import type { GuiSlot, ViewSlotType, IssueViewData, ExplainViewData, PreviewViewData, DiffViewData, FileSearchViewData } from '@shared/types';
import { CircleDot, Settings, BookOpen, Globe, GitBranch, Search, X, Plus } from 'lucide-react';

/** Icon/color mapping per view type */
const VIEW_TYPE_META: Record<string, { label: string; icon: typeof CircleDot; color: string }> = {
  issue: { label: 'Issues', icon: CircleDot, color: 'text-green-500' },
  config: { label: 'Settings', icon: Settings, color: 'text-zinc-400' },
  explain: { label: 'Explain', icon: BookOpen, color: 'text-blue-400' },
  preview: { label: 'Preview', icon: Globe, color: 'text-cyan-400' },
  diff: { label: 'Diff', icon: GitBranch, color: 'text-orange-400' },
  filesearch: { label: 'File Search', icon: Search, color: 'text-amber-400' },
};

/** List of addable view types */
const ADDABLE_TYPES: { type: ViewSlotType; label: string; icon: typeof CircleDot }[] = [
  { type: 'issue', label: 'Issues', icon: CircleDot },
  { type: 'config', label: 'Settings', icon: Settings },
  { type: 'explain', label: 'Explain', icon: BookOpen },
  { type: 'preview', label: 'Preview', icon: Globe },
  { type: 'diff', label: 'Diff', icon: GitBranch },
  { type: 'filesearch', label: 'File Search', icon: Search },
];

/** GUI pane container (multi-slot tabs) */
export function GuiPaneContainer({ paneId }: { paneId: string }) {
  const guiPane = useAppStore((s) => s.guiPanes.find((p) => p.id === paneId));
  const focusedPaneId = useAppStore((s) => s.focusedPaneId);
  const setFocused = useAppStore((s) => s.setFocused);
  const removeGuiPane = useAppStore((s) => s.removeGuiPane);
  const removeFromLayout = useAppStore((s) => s.removeFromLayout);
  const setActiveSlot = useAppStore((s) => s.setActiveSlot);
  const addSlotToGuiPane = useAppStore((s) => s.addSlotToGuiPane);
  const removeSlotFromGuiPane = useAppStore((s) => s.removeSlotFromGuiPane);
  const updateSlotData = useAppStore((s) => s.updateSlotData);
  const sessions = useAppStore((s) => s.sessions);

  const setDragging = useAppStore((s) => s.setDragging);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (addMenuRef.current?.contains(target) || addBtnRef.current?.contains(target)) return;
      setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!guiPane) return null;
  const isFocused = focusedPaneId === paneId;
  const activeSlot = guiPane.slots.find((s) => s.id === guiPane.activeSlotId);

  /** Add slot */
  const handleAddSlot = (viewType: ViewSlotType) => {
    const session = sessions.find((s) => s.id === guiPane.sessionId);
    const slotId = crypto.randomUUID();
    const data: Record<string, unknown> = viewType === 'issue'
      ? { repo: session?.issueRepo || session?.repo, mode: 'list' }
      : viewType === 'explain'
        ? { title: 'Explanation', currentStep: 0, steps: [], completed: false }
        : viewType === 'preview'
          ? { url: '', status: 'ready' }
          : viewType === 'diff'
            ? { sessionId: guiPane.sessionId, cwd: session?.cwd || '', files: [], currentFileIndex: 0, diffMode: 'all', refreshedAt: '' }
            : viewType === 'filesearch'
              ? { cwd: session?.cwd ?? '', query: '', mode: 'filename', results: [] }
              : {};
    const slot: GuiSlot = { id: slotId, viewType, data };
    addSlotToGuiPane(paneId, slot);

    if (viewType === 'diff') {
      // diff view: send diff open to server → fetch actual git diff data + register slot
      apiClient.cli(['diff', 'open', '--session', guiPane.sessionId]).catch(() => {});
    } else {
      // Other views: standard view-register
      apiClient.cli(['p', 'view-register'], {
        id: paneId,
        viewType,
        sessionId: guiPane.sessionId,
        meta: data,
        slotId,
      }).catch(() => {});
    }
    setAddMenuOpen(false);
  };

  /** Close slot */
  const handleCloseSlot = (e: React.MouseEvent, slotId: string) => {
    e.stopPropagation();
    removeSlotFromGuiPane(paneId, slotId);
    // If last slot, remove the entire pane
    if (guiPane.slots.length <= 1) {
      removeGuiPane(paneId);
      removeFromLayout(paneId);
      apiClient.cli(['p', 'view-unregister', paneId]).catch(() => {});
    } else {
      apiClient.cli(['p', 'slot-delete', slotId, paneId]).catch(() => {});
    }
  };

  /** Close entire pane */
  const handleClosePane = () => {
    removeGuiPane(paneId);
    removeFromLayout(paneId);
    apiClient.cli(['p', 'view-unregister', paneId]).catch(() => {});
  };

  return (
    <div
      className={`flex h-full flex-col border-l border-r ${isFocused ? 'border-zinc-600' : 'border-transparent'}`}
      onClick={() => setFocused(paneId)}
    >
      {/* Header: draggable + slot tab bar + controls */}
      <div
        className="flex h-8 items-center border-b border-zinc-800 bg-zinc-900/80 px-1 group cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/pane-id', paneId);
          e.dataTransfer.effectAllowed = 'move';
          setDragging(paneId);
        }}
        onDragEnd={() => setDragging(null)}
      >
        {/* Tab list: left-aligned, takes remaining space */}
        <div className="flex items-center min-w-0 flex-1 overflow-x-auto">
          {guiPane.slots.map((slot) => {
            const meta = VIEW_TYPE_META[slot.viewType];
            const Icon = meta?.icon || CircleDot;
            const isActive = slot.id === guiPane.activeSlotId;
            return (
              <div
                key={slot.id}
                onClick={(e) => { e.stopPropagation(); setActiveSlot(paneId, slot.id); }}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors rounded-sm cursor-pointer flex-shrink-0 group/tab ${
                  isActive
                    ? 'text-zinc-200 bg-zinc-700/60'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <Icon className={`w-3 h-3 ${isActive ? (meta?.color || '') : ''}`} />
                <span>{slot.label || meta?.label || slot.viewType}</span>
                {/* Tab close button */}
                <button
                  onClick={(e) => handleCloseSlot(e, slot.id)}
                  className="ml-0.5 rounded p-0.5 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 opacity-0 group-hover/tab:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}

          {/* + button — next to tab list (always visible when no slots) */}
          <button
            ref={addBtnRef}
            onClick={(e) => { e.stopPropagation(); setAddMenuOpen(!addMenuOpen); }}
            className={`rounded p-0.5 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors flex-shrink-0 ${guiPane.slots.length === 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            title="Add tab"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Right controls (split/close) */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <SplitPane paneId={paneId} />
          <button
            onClick={(e) => { e.stopPropagation(); handleClosePane(); }}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Add slot dropdown — positioned outside the header to avoid being obscured */}
      {addMenuOpen && (
        <div ref={addMenuRef} className="relative z-40">
          <div className="absolute left-1 top-0 rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden w-32">
            {ADDABLE_TYPES.map((at) => {
              const AtIcon = at.icon;
              return (
                <button
                  key={at.type}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  onClick={(e) => { e.stopPropagation(); handleAddSlot(at.type); }}
                >
                  <AtIcon className="w-3.5 h-3.5 text-zinc-500" />
                  {at.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* View body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeSlot ? renderSlotView(activeSlot, guiPane.sessionId, updateSlotData.bind(null, paneId)) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
            <Plus className="w-5 h-5" />
            <span className="text-xs">Use the + button in the header to add a tab</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Render the appropriate view component based on the slot's viewType */
function renderSlotView(
  slot: GuiSlot,
  _sessionId: string,
  _updateSlot: (slotId: string, updates: Partial<Pick<GuiSlot, 'viewType' | 'data'>>) => void,
) {
  switch (slot.viewType) {
    case 'issue':
      if ((slot.data as Record<string, unknown>).mode === 'list') {
        return <IssueListView data={slot.data as { repo?: string; mode?: string }} />;
      }
      return <IssueView data={slot.data as unknown as IssueViewData} />;
    case 'config':
      return <ConfigView />;
    case 'explain':
      return <ExplainView data={slot.data as unknown as ExplainViewData} />;
    case 'preview':
      return <PreviewView data={slot.data as unknown as PreviewViewData} />;
    case 'diff':
      return <DiffView data={slot.data as unknown as DiffViewData} slotId={slot.id} />;
    case 'filesearch':
      return <FileSearchView data={slot.data as unknown as FileSearchViewData} />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
          Unsupported view: {slot.viewType}
        </div>
      );
  }
}
