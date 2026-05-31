import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@web/stores';
import { useCli } from '@web/hooks/useCli';
import { apiClient } from '@web/lib/api-client';
import type { GuiPane } from '@shared/types';
import { Terminal, Bot, LayoutDashboard } from 'lucide-react';

/** New pane options */
const NEW_PANE_OPTIONS = [
  { id: 'terminal', label: 'Terminal', icon: Terminal, type: 'pty' as const },
  { id: 'agent', label: 'Agent', icon: Bot, type: 'pty' as const },
  { id: 'gui', label: 'GUI pane', icon: LayoutDashboard, type: 'view' as const },
];

interface SplitPaneProps {
  paneId: string;
}

/**
 * Two split buttons (left-right / top-bottom).
 * VS Code style: filled rectangle icon. Click → type selection dropdown.
 */
export function SplitPane({ paneId }: SplitPaneProps) {
  const [openDir, setOpenDir] = useState<'horizontal' | 'vertical' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { executeCli } = useCli();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenDir(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (optionId: string, optionType: 'pty' | 'view') => {
    const store = useAppStore.getState();
    const sessionId = store.activeSessionId;
    if (!sessionId || !openDir) return;

    if (optionType === 'pty') {
      store.setPendingSplit(openDir);
      store.setFocused(paneId);
      if (optionId === 'terminal') {
        executeCli(['p', 'attach', '--session', sessionId]);
      } else {
        executeCli(['p', 'spawn', '--session', sessionId]);
      }
    } else {
      // GUI pane: create with empty slots
      const guiPaneId = crypto.randomUUID();
      const guiPane: GuiPane = {
        id: guiPaneId,
        contentType: 'gui',
        sessionId,
        activeSlotId: null,
        slots: [],
      };
      store.addGuiPane(guiPane);
      store.splitPane(paneId, openDir, guiPaneId);
      // Register GuiPane on server (no slot)
      apiClient.cli(['p', 'view-register'], {
        id: guiPaneId,
        viewType: 'gui',
        sessionId,
      }).catch(() => {});
    }

    setOpenDir(null);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-px">
      {/* Left-right split icon */}
      <button
        onClick={(e) => { e.stopPropagation(); setOpenDir(openDir === 'horizontal' ? null : 'horizontal'); }}
        className={`rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100 ${
          openDir === 'horizontal' ? 'text-zinc-200 bg-zinc-700' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800'
        }`}
        title="Split horizontally"
      >
        {/* Left-right split filled icon */}
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h5.5v12H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6.5 0H14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8.5V2Z" fillOpacity="0.5" />
          <path d="M2 2.5A1.5 1.5 0 0 0 .5 4v8A1.5 1.5 0 0 0 2 13.5h12a1.5 1.5 0 0 0 1.5-1.5V4A1.5 1.5 0 0 0 14 2.5H2ZM2 4h5v8H2V4Zm7 0h5v8H9V4Z" />
        </svg>
      </button>

      {/* Top-bottom split icon */}
      <button
        onClick={(e) => { e.stopPropagation(); setOpenDir(openDir === 'vertical' ? null : 'vertical'); }}
        className={`rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100 ${
          openDir === 'vertical' ? 'text-zinc-200 bg-zinc-700' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800'
        }`}
        title="Split vertically"
      >
        {/* Top-bottom split filled icon */}
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4.5H1V3Zm0 5.5h14V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V8.5Z" fillOpacity="0.5" />
          <path d="M2 2.5A1.5 1.5 0 0 0 .5 4v8A1.5 1.5 0 0 0 2 13.5h12a1.5 1.5 0 0 0 1.5-1.5V4A1.5 1.5 0 0 0 14 2.5H2ZM2 4h12v3H2V4Zm0 5h12v3H2V9Z" />
        </svg>
      </button>

      {/* Type selection dropdown */}
      {openDir && (
        <div className="absolute right-0 top-full mt-1 z-40 rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden w-36">
          {NEW_PANE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onClick={(e) => { e.stopPropagation(); handleSelect(opt.id, opt.type); }}
              >
                <Icon className="w-3.5 h-3.5 text-zinc-500" />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
