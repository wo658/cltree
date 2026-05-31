import { useEffect } from 'react';
import { useAppStore } from '@web/stores';
import { useCli } from '@web/hooks/useCli';
import type { LayoutNode } from '@shared/types';

/** Extract all leaf paneIds from the layoutTree in order */
function collectLeafIds(node: LayoutNode | null): string[] {
  if (!node) return [];
  if (node.type === 'leaf') return [node.paneId];
  return node.children.flatMap(collectLeafIds);
}

/**
 * Global keyboard shortcut hook.
 * Called from AppShell.
 *
 * - Cmd+\        : Horizontal split (new terminal)
 * - Cmd+Shift+\  : Vertical split (new terminal)
 * - Cmd+W        : Close focused pane
 * - Cmd+Shift+Enter : Toggle zoom
 * - Cmd+Option+Arrow : Move pane focus
 */
export function useKeyboard() {
  const { executeCli } = useCli();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      const store = useAppStore.getState();

      // Cmd+\ → horizontal split (new terminal to the right of focused pane)
      if (e.key === '\\' && !e.shiftKey) {
        e.preventDefault();
        store.setPendingSplit('horizontal');
        const sessionId = store.activeSessionId;
        if (sessionId) {
          executeCli(['p', 'attach', '--session', sessionId]);
        }
        return;
      }

      // Cmd+Shift+\ → vertical split (downward)
      if (e.key === '\\' && e.shiftKey) {
        e.preventDefault();
        store.setPendingSplit('vertical');
        const sessionId = store.activeSessionId;
        if (sessionId) {
          executeCli(['p', 'attach', '--session', sessionId]);
        }
        return;
      }

      // Cmd+W → close focused pane
      if (e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        const focused = store.focusedPaneId;
        if (!focused) return;

        const ptyPane = store.panes.find((p) => p.id === focused);
        if (ptyPane) {
          // PTY pane → send kill request to server
          executeCli(['p', 'kill', focused]);
        } else {
          // GUI pane → remove directly on the frontend
          store.removeGuiPane(focused);
          store.removeFromLayout(focused);
        }
        return;
      }

      // Cmd+Shift+Enter → toggle zoom
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const focused = store.focusedPaneId;
        if (focused) {
          store.toggleZoom(focused);
        }
        return;
      }

      // Cmd+Option+Arrow → move pane focus
      if (e.altKey) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          focusNextPane(store, 1);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          focusNextPane(store, -1);
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [executeCli]);
}

/** Move focus to the next/previous pane */
function focusNextPane(
  store: ReturnType<typeof useAppStore.getState>,
  delta: number,
) {
  const ids = collectLeafIds(store.layoutTree);
  if (ids.length === 0) return;
  const currentIdx = ids.indexOf(store.focusedPaneId ?? '');
  const nextIdx = (currentIdx + delta + ids.length) % ids.length;
  store.setFocused(ids[nextIdx]);
}
