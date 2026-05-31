import { StateCreator } from 'zustand';
import type {
  PaneRef,
  GuiPane,
  GuiSlot,
  LayoutNode,
  SplitNode,
  LeafNode,
  DropPosition,
} from '@shared/types';
import { apiClient } from '../lib/api-client';
import { persistLayout } from '@web/lib/persist-layout';
import type { SessionSlice } from './sessionSlice';

// ─── Tree traversal helpers (immutable) ──────────────────────

/** Replace a LeafNode in the tree (immutable) */
function replaceLeaf(
  tree: LayoutNode,
  paneId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (tree.type === 'leaf') {
    return tree.paneId === paneId ? replacement : tree;
  }
  return {
    ...tree,
    children: tree.children.map((child) =>
      replaceLeaf(child, paneId, replacement),
    ),
  };
}

/** Remove a LeafNode from the tree + collapse (immutable) */
function removeLeaf(tree: LayoutNode, paneId: string): LayoutNode | null {
  if (tree.type === 'leaf') {
    return tree.paneId === paneId ? null : tree;
  }

  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];

  for (let i = 0; i < tree.children.length; i++) {
    const result = removeLeaf(tree.children[i], paneId);
    if (result !== null) {
      newChildren.push(result);
      newSizes.push(tree.sizes[i]);
    }
  }

  // If no children remain, remove the node itself
  if (newChildren.length === 0) return null;

  // If only one child remains, collapse
  if (newChildren.length === 1) return newChildren[0];

  // Re-normalize sizes (so they sum to 100)
  const total = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map((s) => (s / total) * 100);

  return { ...tree, children: newChildren, sizes: normalizedSizes };
}

/** Update sizes of a SplitNode (immutable) */
function updateSplitSizes(
  tree: LayoutNode,
  splitId: string,
  sizes: number[],
): LayoutNode {
  if (tree.type === 'leaf') return tree;
  if (tree.id === splitId) return { ...tree, sizes };
  return {
    ...tree,
    children: tree.children.map((child) =>
      updateSplitSizes(child, splitId, sizes),
    ),
  };
}

// ─── Pane slice ──────────────────────────────────

/** Pane slice state + actions */
export interface PaneSlice {
  panes: PaneRef[];
  focusedPaneId: string | null;
  guiPanes: GuiPane[];
  layoutTree: LayoutNode | null;
  zoomedPaneId: string | null;
  /** Split direction to use on the next addPane call (for keyboard shortcuts) */
  pendingSplitDirection: 'horizontal' | 'vertical' | null;
  /** ID of the pane currently being dragged */
  draggingPaneId: string | null;

  setPanes: (panes: PaneRef[]) => void;
  setFocused: (id: string | null) => void;
  addPane: (pane: PaneRef) => void;
  updatePane: (pane: PaneRef) => void;
  removePane: (id: string) => void;
  /** Set the split direction for the next addPane call */
  setPendingSplit: (dir: 'horizontal' | 'vertical' | null) => void;
  /** Set dragging state */
  setDragging: (id: string | null) => void;

  /** Auto-place a pane in the layout tree */
  insertPaneIntoLayout: (paneId: string) => void;
  /** Split a specific pane in the specified direction */
  splitPane: (
    targetPaneId: string,
    direction: 'horizontal' | 'vertical',
    newPaneId: string,
  ) => void;
  /** Remove a pane from the layout tree + collapse */
  removeFromLayout: (paneId: string) => void;
  /** Drag & drop: move source to the given position relative to target */
  movePaneToTarget: (
    sourceId: string,
    targetId: string,
    position: DropPosition,
  ) => void;
  /** Update SplitNode sizes (react-resizable-panels onLayout) */
  updateSizes: (splitId: string, sizes: number[]) => void;
  /** Toggle zoom */
  toggleZoom: (paneId: string) => void;

  /** Directly set the layout tree (used during initial layout setup) */
  setLayoutTree: (tree: LayoutNode | null) => void;
  /** Rebuild layoutTree with the panes of the given session on session switch */
  rebuildLayoutForSession: (sessionId: string) => void;
  /** Add a GuiPane */
  addGuiPane: (guiPane: GuiPane) => void;
  /** Remove a GuiPane */
  removeGuiPane: (id: string) => void;
  /** Update a GuiPane */
  updateGuiPane: (id: string, updates: Partial<GuiPane>) => void;
  /** Add a slot to a GuiPane */
  addSlotToGuiPane: (guiPaneId: string, slot: GuiSlot) => void;
  /** Remove a slot from a GuiPane */
  removeSlotFromGuiPane: (guiPaneId: string, slotId: string) => void;
  /** Change the activeSlotId of a GuiPane */
  setActiveSlot: (guiPaneId: string, slotId: string) => void;
  /** Update slot data */
  updateSlotData: (guiPaneId: string, slotId: string, updates: Partial<Pick<GuiSlot, 'viewType' | 'data'>>) => void;
}

/** Pane slice creator */
export const createPaneSlice: StateCreator<
  PaneSlice & SessionSlice,
  [],
  [],
  PaneSlice
> = (set, get) => ({
  panes: [],
  focusedPaneId: null,
  guiPanes: [],
  layoutTree: null,
  zoomedPaneId: null,
  pendingSplitDirection: null,
  draggingPaneId: null,

  setPanes: (panes) => set({ panes }),

  setFocused: (id) => set({ focusedPaneId: id }),

  setPendingSplit: (dir) => set({ pendingSplitDirection: dir }),

  setDragging: (id) => set({ draggingPaneId: id }),

  addPane: (pane) => {
    set((state) => {
      const panes = [...state.panes, pane];
      // Panes from inactive sessions are only added to the array, not inserted into the layout
      // → layout is built by rebuildLayoutForSession when switching to that session
      if (pane.sessionId !== state.activeSessionId) {
        return { panes };
      }
      const layoutTree = insertIntoTree(
        state.layoutTree,
        pane.id,
        state.focusedPaneId,
        state.pendingSplitDirection,
      );
      return { panes, layoutTree, pendingSplitDirection: null };
    });
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  updatePane: (pane) =>
    set((state) => ({
      panes: state.panes.map((p) => (p.id === pane.id ? pane : p)),
    })),

  removePane: (id) => {
    set((state) => {
      const panes = state.panes.filter((p) => p.id !== id);
      const layoutTree = state.layoutTree
        ? removeLeaf(state.layoutTree, id)
        : null;
      return {
        panes,
        layoutTree,
        focusedPaneId:
          state.focusedPaneId === id ? null : state.focusedPaneId,
        zoomedPaneId:
          state.zoomedPaneId === id ? null : state.zoomedPaneId,
      };
    });
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  insertPaneIntoLayout: (paneId) => {
    set((state) => ({
      layoutTree: insertIntoTree(
        state.layoutTree,
        paneId,
        state.focusedPaneId,
        state.pendingSplitDirection,
      ),
      pendingSplitDirection: null,
    }));
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  splitPane: (targetPaneId, direction, newPaneId) => {
    set((state) => {
      if (!state.layoutTree) return state;
      const newSplit: SplitNode = {
        id: crypto.randomUUID(),
        type: 'split',
        direction,
        children: [
          { type: 'leaf', paneId: targetPaneId },
          { type: 'leaf', paneId: newPaneId },
        ],
        sizes: [50, 50],
      };
      return {
        layoutTree: replaceLeaf(state.layoutTree, targetPaneId, newSplit),
      };
    });
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  removeFromLayout: (paneId) => {
    set((state) => ({
      layoutTree: state.layoutTree
        ? removeLeaf(state.layoutTree, paneId)
        : null,
    }));
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  movePaneToTarget: (sourceId, targetId, position) => {
    set((state) => {
      if (!state.layoutTree || position === 'center') return state;

      // 1. Remove source from the tree
      let tree = removeLeaf(state.layoutTree, sourceId);
      if (!tree) {
        // If the tree is empty, keep only the source
        return { layoutTree: { type: 'leaf' as const, paneId: sourceId } };
      }

      // 2. Insert source as a split at the target position
      const direction: 'horizontal' | 'vertical' =
        position === 'left' || position === 'right'
          ? 'horizontal'
          : 'vertical';

      const sourceLeaf: LeafNode = { type: 'leaf', paneId: sourceId };
      const targetLeaf: LeafNode = { type: 'leaf', paneId: targetId };

      // Determine order based on position
      const children: LayoutNode[] =
        position === 'left' || position === 'top'
          ? [sourceLeaf, targetLeaf]
          : [targetLeaf, sourceLeaf];

      const newSplit: SplitNode = {
        id: crypto.randomUUID(),
        type: 'split',
        direction,
        children,
        sizes: [50, 50],
      };

      tree = replaceLeaf(tree, targetId, newSplit);
      return { layoutTree: tree };
    });
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  updateSizes: (splitId, sizes) =>
    set((state) => ({
      layoutTree: state.layoutTree
        ? updateSplitSizes(state.layoutTree, splitId, sizes)
        : null,
    })),

  toggleZoom: (paneId) =>
    set((state) => ({
      zoomedPaneId: state.zoomedPaneId === paneId ? null : paneId,
    })),

  setLayoutTree: (tree) => set({ layoutTree: tree }),

  rebuildLayoutForSession: (sessionId) => {
    set((state) => {
      const ptyIds = state.panes
        .filter((p) => p.sessionId === sessionId)
        .map((p) => p.id);
      const guiIds = state.guiPanes
        .filter((v) => v.sessionId === sessionId)
        .map((v) => v.id);

      const allIds = [...guiIds, ...ptyIds];
      if (allIds.length === 0) return { layoutTree: null, focusedPaneId: null };
      if (allIds.length === 1) {
        return {
          layoutTree: { type: 'leaf' as const, paneId: allIds[0] },
          focusedPaneId: ptyIds[0] || allIds[0],
        };
      }

      // Always split evenly in the vertical direction
      const tree: SplitNode = {
        id: crypto.randomUUID(),
        type: 'split',
        direction: 'vertical',
        children: allIds.map((pid) => ({ type: 'leaf' as const, paneId: pid })),
        sizes: allIds.map(() => 100 / allIds.length),
      };
      return {
        layoutTree: tree,
        focusedPaneId: ptyIds[0] || allIds[0],
      };
    });
    const { activeSessionId, layoutTree } = get();
    if (activeSessionId && layoutTree) persistLayout(activeSessionId, layoutTree);
  },

  addGuiPane: (guiPane) =>
    set((state) => ({
      guiPanes: [...state.guiPanes, guiPane],
    })),

  removeGuiPane: (id) =>
    set((state) => ({
      guiPanes: state.guiPanes.filter((gp) => gp.id !== id),
    })),

  updateGuiPane: (id, updates) =>
    set((state) => ({
      guiPanes: state.guiPanes.map((gp) =>
        gp.id === id ? { ...gp, ...updates } : gp,
      ),
    })),

  addSlotToGuiPane: (guiPaneId, slot) =>
    set((state) => ({
      guiPanes: state.guiPanes.map((gp) =>
        gp.id === guiPaneId
          ? { ...gp, slots: [...gp.slots, slot], activeSlotId: slot.id }
          : gp,
      ),
    })),

  removeSlotFromGuiPane: (guiPaneId, slotId) => {
    let newActiveSlotId: string | null = null;
    set((state) => ({
      guiPanes: state.guiPanes.map((gp) => {
        if (gp.id !== guiPaneId) return gp;
        const slots = gp.slots.filter((s) => s.id !== slotId);
        const activeSlotId = gp.activeSlotId === slotId
          ? (slots[0]?.id || '')
          : gp.activeSlotId;
        if (gp.activeSlotId === slotId) newActiveSlotId = activeSlotId;
        return { ...gp, slots, activeSlotId };
      }),
    }));
    if (newActiveSlotId !== null) {
      apiClient.cli(['p', 'slot-activate', newActiveSlotId, guiPaneId]).catch(() => {});
    }
  },

  setActiveSlot: (guiPaneId, slotId) => {
    set((state) => ({
      guiPanes: state.guiPanes.map((gp) =>
        gp.id === guiPaneId ? { ...gp, activeSlotId: slotId } : gp,
      ),
    }));
    apiClient.cli(['p', 'slot-activate', slotId, guiPaneId]).catch(() => {});
  },

  updateSlotData: (guiPaneId, slotId, updates) =>
    set((state) => ({
      guiPanes: state.guiPanes.map((gp) =>
        gp.id === guiPaneId
          ? {
              ...gp,
              slots: gp.slots.map((s) =>
                s.id === slotId ? { ...s, ...updates } : s,
              ),
            }
          : gp,
      ),
    })),
});

// ─── Internal helpers ──────────────────────────────────────

/** Auto-place a new pane in the layoutTree */
function insertIntoTree(
  tree: LayoutNode | null,
  paneId: string,
  focusedPaneId: string | null,
  splitDirection?: 'horizontal' | 'vertical' | null,
): LayoutNode {
  const newLeaf: LeafNode = { type: 'leaf', paneId };
  const direction = splitDirection || 'vertical';

  // If the tree is empty, place the pane alone
  if (!tree) return newLeaf;

  // If focusedPaneId is set, split beside that leaf
  if (focusedPaneId) {
    const newSplit: SplitNode = {
      id: crypto.randomUUID(),
      type: 'split',
      direction,
      children: [
        { type: 'leaf', paneId: focusedPaneId },
        newLeaf,
      ],
      sizes: [50, 50],
    };
    const result = replaceLeaf(tree, focusedPaneId, newSplit);
    if (JSON.stringify(result) === JSON.stringify(tree)) {
      console.warn('[insertIntoTree] ⚠ focusedPaneId=%s not found in layoutTree! replaceLeaf failed', focusedPaneId);
    } else {
      console.log('[insertIntoTree] ✓ created direction=%s split beside focusedPaneId=%s', direction, focusedPaneId);
    }
    return result;
  }

  // If focusedPaneId is absent, append as the last child of the root
  if (tree.type === 'split') {
    console.warn('[insertIntoTree] ⚠ no focusedPaneId → appending to root (ignoring direction=%s, keeping root direction=%s)', direction, tree.direction);
    const childCount = tree.children.length + 1;
    const evenSize = 100 / childCount;
    return {
      ...tree,
      children: [...tree.children, newLeaf],
      sizes: Array(childCount).fill(evenSize),
    };
  }

  // If root is a leaf, split it
  console.log('[insertIntoTree] root is leaf → creating new split (direction=%s)', direction);
  return {
    id: crypto.randomUUID(),
    type: 'split',
    direction,
    children: [tree, newLeaf],
    sizes: [50, 50],
  };
}
