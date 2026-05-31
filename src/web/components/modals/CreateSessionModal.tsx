import { useState, useEffect } from 'react';
import { useCli } from '@web/hooks/useCli';
import { useAppStore } from '@web/stores';
import { apiClient } from '@web/lib/api-client';
import type { GuiPane, GuiSlot } from '@shared/types';

interface CreateSessionModalProps {
  onClose: () => void;
}

/**
 * Session creation modal.
 * Displays the default path as actual text — user can view and edit it.
 */
export function CreateSessionModal({ onClose }: CreateSessionModalProps) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const { executeCli, loading } = useCli();

  // Fetch server's working directory when modal opens and set it as the default cwd
  useEffect(() => {
    apiClient.cli<{ env: { cwd: string } }>(['cfg', 'info']).then((res) => {
      if (res.ok && res.data?.env?.cwd) {
        setCwd(res.data.env.cwd);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const cmd = ['s', 'create', '--name', name.trim()];
    if (cwd.trim()) {
      cmd.push('--cwd', cwd.trim());
    }
    const res = await executeCli(cmd);
    if (!res.ok) return;

    const data = res.data as { session: { id: string; repo?: string } };
    const sessionId = data.session.id;

    const store = useAppStore.getState();
    const guiPaneId = `gui-${sessionId}`;
    const slotId = crypto.randomUUID();
    const issueSlot: GuiSlot = {
      id: slotId,
      viewType: 'issue',
      data: { repo: data.session.repo || null, mode: 'list' },
    };
    const guiPane: GuiPane = {
      id: guiPaneId,
      contentType: 'gui',
      sessionId,
      activeSlotId: slotId,
      slots: [issueSlot],
    };
    store.addGuiPane(guiPane);
    // Register GuiPane + slot on server
    apiClient.cli(['p', 'view-register'], {
      id: guiPaneId,
      viewType: 'issue',
      sessionId,
      meta: issueSlot.data,
      slotId,
    }).catch(() => {});

    // Configure agent pane to attach horizontally (left-right) beside the guiPane
    // WebSocket addPane uses this direction to create the layout + persist
    store.setPendingSplit('horizontal');
    store.setFocused(guiPaneId);

    await executeCli(['p', 'spawn', '--session', sessionId]);

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-96 rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-medium text-zinc-100">New session</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="myapp"
              autoFocus
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          {/* Directory — actual path is shown as value */}
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Directory</label>
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 font-mono outline-none focus:border-zinc-500 selection:bg-zinc-600"
            />
            <p className="mt-1 text-[10px] text-zinc-600">Defaults to the server&apos;s working directory. Editable.</p>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-md bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-40 transition-colors"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
