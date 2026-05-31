import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@web/stores';
import { useCli } from '@web/hooks/useCli';
import { apiClient } from '@web/lib/api-client';
import type { GuiPane, GuiSlot } from '@shared/types';

/** Command definition */
interface Command {
  id: string;
  label: string;
  description: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

/**
 * VS Code-style command palette.
 * Open with Cmd+Shift+P; select from a searchable command list.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { executeCli } = useCli();

  const store = useAppStore.getState;

  const addGuiPaneWithSlot = useCallback((viewType: string) => {
    const s = store();
    const sessionId = s.activeSessionId;
    if (!sessionId) return;

    const session = s.sessions.find((ss) => ss.id === sessionId);
    const guiPaneId = crypto.randomUUID();
    const slotId = crypto.randomUUID();
    const data: Record<string, unknown> = viewType === 'issue'
      ? { repo: session?.issueRepo || session?.repo, mode: 'list' }
      : viewType === 'filesearch'
        ? { cwd: session?.cwd ?? '', query: '', mode: 'filename', results: [] }
        : {};
    const slot: GuiSlot = { id: slotId, viewType: viewType as GuiSlot['viewType'], data };
    const guiPane: GuiPane = {
      id: guiPaneId,
      contentType: 'gui',
      sessionId,
      activeSlotId: slotId,
      slots: [slot],
    };
    s.addGuiPane(guiPane);
    s.insertPaneIntoLayout(guiPaneId);
    // Register GuiPane + slot on server
    apiClient.cli(['p', 'view-register'], {
      id: guiPaneId,
      viewType,
      sessionId,
      meta: data,
      slotId,
    }).catch(() => {});
    setOpen(false);
  }, [store]);

  // ─── Command list ───
  const buildCommands = useCallback((): Command[] => {
    const s = store();
    const sessionId = s.activeSessionId;

    return [
      // Add view pane
      {
        id: 'view:issue',
        label: 'Add Issue View',
        description: 'Add issue list view',
        category: 'View',
        action: () => addGuiPaneWithSlot('issue'),
      },
      {
        id: 'view:config',
        label: 'Add Config View',
        description: 'Add settings visualization view',
        category: 'View',
        action: () => addGuiPaneWithSlot('config'),
      },
      {
        id: 'filesearch:open',
        label: 'Open File Search',
        description: 'Filename/content search + Monaco viewer',
        category: 'View',
        shortcut: '⌘⇧F',
        action: () => addGuiPaneWithSlot('filesearch'),
      },
      // Pane management
      {
        id: 'pane:terminal',
        label: 'New Terminal',
        description: 'New terminal pane',
        category: 'Pane',
        shortcut: '⌘\\',
        action: () => {
          if (sessionId) executeCli(['p', 'attach', '--session', sessionId]);
        },
      },
      {
        id: 'pane:agent',
        label: 'Spawn Agent',
        description: 'Create new Agent pane',
        category: 'Pane',
        action: () => {
          if (sessionId) executeCli(['p', 'spawn', '--session', sessionId]);
        },
      },
      {
        id: 'pane:close',
        label: 'Close Pane',
        description: 'Close current focused pane',
        category: 'Pane',
        shortcut: '⌘W',
        action: () => {
          const focused = s.focusedPaneId;
          if (!focused) return;
          const pty = s.panes.find((p) => p.id === focused);
          if (pty) executeCli(['p', 'kill', focused]);
          else { s.removeGuiPane(focused); s.removeFromLayout(focused); }
        },
      },
      {
        id: 'pane:zoom',
        label: 'Toggle Zoom',
        description: 'Maximize/restore focused pane',
        category: 'Pane',
        shortcut: '⇧⏎',
        action: () => {
          const focused = s.focusedPaneId;
          if (focused) s.toggleZoom(focused);
        },
      },

      // Session management
      {
        id: 'session:create',
        label: 'New Session',
        description: 'Create new session',
        category: 'Session',
        action: () => {
          // Should open CreateSessionModal, but using CLI for simplicity
          const name = prompt('Session name:');
          if (name) executeCli(['s', 'create', '--name', name]);
        },
      },

      // Workspace
      {
        id: 'workspace:create',
        label: 'New Workspace',
        description: 'Create new workspace',
        category: 'Workspace',
        action: () => {
          const name = prompt('Workspace name:');
          if (name) executeCli(['w', 'create', '--name', name]);
        },
      },

      // Config
      {
        id: 'config:open',
        label: 'Open Settings',
        description: 'Open settings view',
        category: 'Config',
        shortcut: '⌘,',
        action: () => addGuiPaneWithSlot('config'),
      },
    ];
  }, [executeCli, store, addGuiPaneWithSlot]);

  const commands = open ? buildCommands() : [];
  const filtered = commands.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  });

  // Keyboard event: open/close with Cmd+Shift+P
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      // Cmd+, → open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        addGuiPaneWithSlot('config');
      }
      // Cmd+Shift+F → open File Search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        addGuiPaneWithSlot('filesearch');
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, addGuiPaneWithSlot]);

  // Keyboard navigation within the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action();
      setOpen(false);
    }
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset selected index on query change — handled directly in the onChange handler

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      {/* Background overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Palette body */}
      <div
        className="relative w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden"
        style={{ maxHeight: '60vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="text-zinc-500 text-sm">{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 font-mono">ESC</kbd>
        </div>

        {/* Command list */}
        <div className="overflow-auto" style={{ maxHeight: 'calc(60vh - 52px)' }}>
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-zinc-600 text-sm">
              No results
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                className={`flex items-center justify-between px-4 py-2 cursor-pointer transition-colors ${
                  i === selectedIndex
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/50'
                }`}
                onClick={() => {
                  cmd.action();
                  setOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wider w-16 flex-shrink-0 font-medium">
                    {cmd.category}
                  </span>
                  <div>
                    <span className="text-sm">{cmd.label}</span>
                    <span className="ml-2 text-xs text-zinc-600">{cmd.description}</span>
                  </div>
                </div>
                {cmd.shortcut && (
                  <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 font-mono flex-shrink-0">
                    {cmd.shortcut}
                  </kbd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
