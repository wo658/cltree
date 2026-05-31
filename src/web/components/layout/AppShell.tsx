import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useWebSocket } from '@web/hooks/useWebSocket';
import { useKeyboard } from '@web/hooks/useKeyboard';
import { Sidebar } from '@web/components/sidebar/Sidebar';
import { PaneGrid } from '@web/components/layout/PaneGrid';
import { CommandPalette } from '@web/components/CommandPalette';

/**
 * App shell. Horizontal split of Sidebar + PaneGrid.
 * Initializes WebSocket connection + keyboard shortcuts here.
 */
export function AppShell() {
  // WebSocket connection + messages → store dispatch
  useWebSocket();
  // Global keyboard shortcuts
  useKeyboard();

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950">
      <CommandPalette />
      <PanelGroup direction="horizontal" className="h-full">
        {/* Sidebar — session tree + view slots */}
        <Panel defaultSize={15} minSize={10} maxSize={25}>
          <Sidebar />
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-800 hover:bg-zinc-600 transition-colors" />

        {/* Main area — PTY pane grid */}
        <Panel defaultSize={85}>
          <PaneGrid />
        </Panel>
      </PanelGroup>
    </div>
  );
}
