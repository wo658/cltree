import { useEffect, useRef } from 'react';
import { wsClient } from '@web/lib/ws-client';
import { apiClient } from '@web/lib/api-client';
import { useAppStore } from '@web/stores';
import type { Session, LayoutNode, WsServerMessage, GuiPane } from '@shared/types';

/** Remove stale leaves from layoutTree, keeping only paneIds that actually exist */
function pruneStaleLeaves(tree: LayoutNode, validIds: Set<string>): LayoutNode | null {
  if (tree.type === 'leaf') {
    return validIds.has(tree.paneId) ? tree : null;
  }
  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];
  for (let i = 0; i < tree.children.length; i++) {
    const result = pruneStaleLeaves(tree.children[i], validIds);
    if (result) {
      newChildren.push(result);
      newSizes.push(tree.sizes[i]);
    }
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  const total = newSizes.reduce((a, b) => a + b, 0);
  return { ...tree, children: newChildren, sizes: newSizes.map((s) => (s / total) * 100) };
}

/** Recursively search the session tree by id */
function findSessionById(sessions: Session[], id: string): Session | undefined {
  for (const s of sessions) {
    if (s.id === id) return s;
    if (s.children?.length) {
      const found = findSessionById(s.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * WebSocket connect/reconnect hook.
 * - Incoming messages → dispatched to the zustand store
 * - Automatically handles session subscribe/unsubscribe on activeSessionId change
 */
export function useWebSocket() {
  const prevSessionRef = useRef<string | null>(null);
  // Apply server activeSessionId/activeWorkspaceId only on first connect — preserve tab-local selection on reconnect
  const isSessionInitialized = useRef(false);
  const isWorkspaceInitialized = useRef(false);

  // Detect activeSessionId change → subscribe/unsubscribe
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  useEffect(() => {
    const prev = prevSessionRef.current;
    if (prev === activeSessionId) return;

    if (prev) {
      wsClient.send({ type: 'unsubscribe', sessionId: prev });
    }
    // Clear layoutTree immediately on session switch → prevent rendering with a stale layout
    useAppStore.setState({ layoutTree: null });

    if (activeSessionId) {
      wsClient.send({ type: 'subscribe', sessionId: activeSessionId });

      // Restore saved GuiPane + Layout from DB
      Promise.all([
        apiClient.cli<{ layout: unknown }>(['layout', 'load', activeSessionId]),
        apiClient.cli<{ guiPanes: GuiPane[] }>(['p', 'view-list', `--session=${activeSessionId}`]),
      ]).then(([layoutRes, guiRes]) => {
        const current = useAppStore.getState();

        // GuiPanes restored from DB (only for the current session)
        const restoredGuiPanes: GuiPane[] = (guiRes.ok && guiRes.data?.guiPanes) ? guiRes.data.guiPanes : [];

        // Preserve guiPanes of other sessions already in zustand + merge restored ones
        const otherGuiPanes = current.guiPanes.filter((gp) => gp.sessionId !== activeSessionId);
        const sessionGuiPanes = restoredGuiPanes.length > 0
          ? restoredGuiPanes
          : current.guiPanes.filter((gp) => gp.sessionId === activeSessionId);

        const mergedGuiPanes = [...otherGuiPanes, ...sessionGuiPanes];

        if (layoutRes.ok && layoutRes.data?.layout) {
          const rawLayout = layoutRes.data.layout as LayoutNode;
          const currentPanes = useAppStore.getState().panes;

          // If pane list already exists, prune; otherwise trust the saved layout
          // (stale leaves are removed after the state message arrives)
          let layout: LayoutNode | null;
          if (currentPanes.length > 0) {
            const validIds = new Set([
              ...currentPanes.map((p) => p.id),
              ...mergedGuiPanes.map((v) => v.id),
            ]);
            layout = pruneStaleLeaves(rawLayout, validIds);
          } else {
            layout = rawLayout;
          }

          // Insert GUI panes missing from layout (created via CLI)
          if (layout) {
            const existingLeafIds = new Set<string>();
            (function collect(node: LayoutNode) {
              if (node.type === 'leaf') existingLeafIds.add(node.paneId);
              else node.children.forEach(collect);
            })(layout);
            for (const gp of sessionGuiPanes) {
              if (!existingLeafIds.has(gp.id) && gp.slots.length > 0) {
                useAppStore.setState({ guiPanes: mergedGuiPanes, layoutTree: layout });
                useAppStore.getState().insertPaneIntoLayout(gp.id);
                layout = useAppStore.getState().layoutTree;
              }
            }
          }

          useAppStore.setState({ guiPanes: mergedGuiPanes, layoutTree: layout });
        } else {
          useAppStore.setState({ guiPanes: mergedGuiPanes });
          useAppStore.getState().rebuildLayoutForSession(activeSessionId!);
        }
      }).catch(() => {
        const current = useAppStore.getState();
        current.rebuildLayoutForSession(activeSessionId!);
      });
    }
    prevSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  // layoutTree persistence is performed immediately in paneSlice's structural-change actions (persistLayout)

  useEffect(() => {
    wsClient.connect();

    const unsubscribe = wsClient.onMessage((msg: WsServerMessage) => {
      const store = useAppStore.getState();

      switch (msg.type) {
        case 'state':
          store.setSessions(msg.data.sessions);
          // Recursively collect all panes from the sessions tree
          {
            type SessionLike = { panes?: unknown[]; children?: SessionLike[] };
            const collectPanes = (sessions: SessionLike[]): unknown[] => {
              const result: unknown[] = [];
              for (const s of sessions) {
                if (s.panes) result.push(...s.panes);
                if (s.children) result.push(...collectPanes(s.children));
              }
              return result;
            };
            const allPanes = collectPanes(msg.data.sessions) as import('@shared/types').PaneRef[];
            store.setPanes(allPanes);

            // Remove stale leaves after reconnect or layout restore
            const currentLayout = store.layoutTree;
            if (currentLayout) {
              const validIds = new Set([
                ...allPanes.map((p) => p.id),
                ...store.guiPanes.map((gp) => gp.id),
              ]);
              const pruned = pruneStaleLeaves(currentLayout, validIds);
              if (JSON.stringify(pruned) !== JSON.stringify(currentLayout)) {
                useAppStore.setState({ layoutTree: pruned });
              }
              // If layout is null after pruning, rebuild
              if (!pruned && store.activeSessionId) {
                store.rebuildLayoutForSession(store.activeSessionId);
              }
            }
          }
          // Apply activeSessionId only on first connect. On reconnect, preserve tab-local selection.
          if (msg.data.activeSessionId !== undefined && !isSessionInitialized.current) {
            isSessionInitialized.current = true;
            // sessionStorage takes priority (restored on refresh), fall back to server default
            const stored = sessionStorage.getItem('cltree_activeSessionId');
            const candidate = stored ?? (msg.data.activeSessionId ?? null);
            if (candidate && !findSessionById(msg.data.sessions, candidate)) {
              // stale: session no longer exists → fall back to server default
              store.setActiveSession(msg.data.activeSessionId ?? null);
            } else {
              store.setActiveSession(candidate);
            }
          }
          // Workspace state
          if (msg.data.workspaces) {
            store.setWorkspaces(msg.data.workspaces);
          }
          // Apply activeWorkspaceId only on first connect — preserve tab-local selection on reconnect/broadcast
          if (msg.data.activeWorkspaceId !== undefined && !isWorkspaceInitialized.current) {
            isWorkspaceInitialized.current = true;
            // sessionStorage takes priority (restored on refresh), fall back to server default
            const stored = sessionStorage.getItem('cltree_activeWorkspaceId');
            const wsExists = stored && msg.data.workspaces?.some((w) => w.id === stored);
            const wsId = wsExists ? stored : (msg.data.activeWorkspaceId ?? null);
            store.setActiveWorkspace(wsId);
          }
          // xterm config (delivered from server)
          if ((msg.data as Record<string, unknown>).xtermConfig) {
            store.setXtermConfig((msg.data as Record<string, unknown>).xtermConfig as Record<string, unknown>);
          }
          break;

        case 'session-update':
          if (msg.action === 'created' && msg.session) {
            store.addSession(msg.session);
          } else if (msg.action === 'updated' && msg.session) {
            store.updateSession(msg.session);
          } else if (msg.action === 'deleted' && msg.sessionId) {
            const wasActive = store.activeSessionId === msg.sessionId;
            store.removeSession(msg.sessionId);
            // If this tab was viewing the deleted session, fall back to another session
            if (wasActive) {
              const remaining = useAppStore.getState().sessions;
              store.setActiveSession(remaining[0]?.id ?? null);
            }
          }
          break;

        case 'pane-update':
          if (msg.action === 'created' && msg.pane) {
            // Always attempt to add to array + layout via addPane.
            // Panes of inactive sessions are only added to the array inside addPane,
            // and their layout is built by rebuildLayoutForSession when switching to that session.
            store.addPane(msg.pane);
          } else if (msg.action === 'status-changed') {
            if (msg.pane) {
              store.updatePane(msg.pane);
            } else if (msg.paneId && msg.status) {
              // fallback: only paneId + status received without a pane object
              const existing = store.panes.find((p) => p.id === msg.paneId);
              if (existing) {
                store.updatePane({ ...existing, status: msg.status });
              }
            }
          } else if (msg.action === 'removed' && msg.paneId) {
            // Fully deleted (also removed from DB)
            store.removePane(msg.paneId);
          } else if (msg.action === 'exited' && msg.paneId) {
            // Do not remove exited panes; only update status (can be restarted)
            const existing = store.panes.find((p) => p.id === msg.paneId);
            if (existing) {
              store.updatePane({ ...existing, status: 'exited' });
            } else {
              store.removePane(msg.paneId);
            }
          }
          break;

        case 'workspace-update':
          if (msg.action === 'created' && msg.workspace) {
            store.addWorkspace(msg.workspace);
          } else if (msg.action === 'updated' && msg.workspace) {
            store.updateWorkspace(msg.workspace);
          } else if (msg.action === 'deleted' && msg.workspaceId) {
            store.removeWorkspace(msg.workspaceId);
          }
          break;

        case 'agent-status':
          {
            const pane = store.panes.find((p) => p.id === msg.paneId);
            if (pane) {
              store.updatePane({ ...pane, status: msg.status as typeof pane.status });
            }
          }
          break;

        case 'view-update':
          {
            const gp = store.guiPanes.find((p) => p.id === msg.guiPaneId);
            console.log('[WS] view-update:', msg.action, 'guiPaneId=', msg.guiPaneId, 'slotId=', msg.slot?.id,
              'storeHasPane=', !!gp, 'storeSlotIds=', gp?.slots.map((s) => s.id),
              'activeSlotId=', gp?.activeSlotId, 'msgData=', msg.slot?.data);
          }
          if (msg.action === 'pushed' && msg.slot) {
            // Server created a new GuiPane → create on the frontend too + insert into layout
            if (!store.guiPanes.some((p) => p.id === msg.guiPaneId)) {
              store.addGuiPane({
                id: msg.guiPaneId,
                contentType: 'gui',
                sessionId: msg.slot.sessionId,
                activeSlotId: msg.slot.id,
                slots: [],
              });
              store.insertPaneIntoLayout(msg.guiPaneId);
            }
            store.addSlotToGuiPane(msg.guiPaneId, {
              id: msg.slot.id,
              viewType: msg.slot.type,
              data: msg.slot.data,
              label: msg.slot.label,
            });
          } else if (msg.action === 'updated' && msg.slot) {
            store.updateSlotData(msg.guiPaneId, msg.slot.id, {
              viewType: msg.slot.type,
              data: msg.slot.data,
            });
            {
              const after = useAppStore.getState().guiPanes.find((p) => p.id === msg.guiPaneId);
              const updatedSlot = after?.slots.find((s) => s.id === msg.slot!.id);
              const slotSteps = (updatedSlot?.data as { steps?: unknown[] })?.steps;
              console.log('[WS] after updateSlotData:', 'slotFound=', !!updatedSlot, 'stepsLen=', slotSteps?.length ?? 'N/A', 'activeSlotId=', after?.activeSlotId);
            }
          } else if (msg.action === 'removed' && msg.slotId) {
            const before = store.guiPanes.find((p) => p.id === msg.guiPaneId);
            console.log('[WS] view removed:', 'slotId=', msg.slotId, 'beforeSlots=', before?.slots.length, 'beforeIds=', before?.slots.map((s) => s.id.slice(0, 8)));
            store.removeSlotFromGuiPane(msg.guiPaneId, msg.slotId);
          }
          break;

        // pty-output is handled directly in the Terminal component (useTerminal hook)
        case 'pty-output':
          break;
      }
    });

    return () => {
      unsubscribe();
      wsClient.disconnect();
    };
  }, []);

  return { send: wsClient.send.bind(wsClient) };
}
