import { useState } from 'react';
import { useAppStore } from '@web/stores';
import { PaneContainer } from './PaneContainer';
import { GuiPaneContainer } from './GuiPaneContainer';
import { DropZoneOverlay } from './DropZoneOverlay';
import type { DropPosition } from '@shared/types';

/** Render the appropriate component (PTY or View) for a paneId + drop zone */
export function PaneSlot({ paneId }: { paneId: string }) {
  // Subscribe to pane type only — prevents re-renders on status changes
  const paneType = useAppStore((s) =>
    s.panes.some((p) => p.id === paneId) ? 'pty' :
    s.guiPanes.some((p) => p.id === paneId) ? 'gui' : null
  );
  const movePaneToTarget = useAppStore((s) => s.movePaneToTarget);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/pane-id')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Ignore when moving to a child element (check if relatedTarget is inside the current element)
    const container = e.currentTarget as HTMLElement;
    if (container.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/pane-id')) {
      e.preventDefault();
    }
  };

  const handleDrop = (position: DropPosition) => {
    const draggingId = useAppStore.getState().draggingPaneId;
    if (draggingId && draggingId !== paneId) {
      movePaneToTarget(draggingId, paneId, position);
    }
    setIsDragOver(false);
  };

  // Render pane content
  let content: React.ReactNode;
  if (paneType === 'pty') {
    content = <PaneContainer paneId={paneId} />;
  } else if (paneType === 'gui') {
    content = <GuiPaneContainer paneId={paneId} />;
  } else {
    content = (
      <div className="flex h-full items-center justify-center text-zinc-700 text-xs">
        pane not found
      </div>
    );
  }

  return (
    <div
      className="relative h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
    >
      {content}
      {isDragOver && <DropZoneOverlay onDrop={handleDrop} />}
    </div>
  );
}
