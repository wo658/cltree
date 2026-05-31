import { create } from 'zustand';
import { createSessionSlice, type SessionSlice } from './sessionSlice';
import { createPaneSlice, type PaneSlice } from './paneSlice';

/** Overall app state (slice composition) */
export type AppStore = SessionSlice & PaneSlice;

/**
 * Single zustand store.
 * Reflects data pushed by the server via WebSocket,
 * subscribed to by React components using selectors.
 */
export const useAppStore = create<AppStore>()((...a) => ({
  ...createSessionSlice(...a),
  ...createPaneSlice(...a),
}));
