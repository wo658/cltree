import { Fragment } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '@web/stores';
import { PaneSlot } from './PaneSlot';
import type { LayoutNode } from '@shared/types';

/** Recursive layout tree renderer */
function LayoutRenderer({ node }: { node: LayoutNode }) {
  const updateSizes = useAppStore((s) => s.updateSizes);

  if (node.type === 'leaf') {
    return <PaneSlot paneId={node.paneId} />;
  }

  // SplitNode → nested PanelGroup
  // Include children count in the key to force remount on tree structure change → reflects sizes
  const groupKey = `${node.id}-${node.children.length}`;

  return (
    <PanelGroup
      key={groupKey}
      id={node.id}
      direction={node.direction}
      onLayout={(sizes) => updateSizes(node.id, sizes)}
    >
      {node.children.map((child, i) => {
        const key = child.type === 'leaf' ? child.paneId : child.id;
        return (
          <Fragment key={key}>
            {i > 0 && (
              <PanelResizeHandle
                className={
                  node.direction === 'horizontal'
                    ? 'w-px bg-zinc-800 hover:bg-zinc-500 transition-colors'
                    : 'h-px bg-zinc-800 hover:bg-zinc-500 transition-colors'
                }
              />
            )}
            <Panel defaultSize={node.sizes[i]} minSize={5}>
              <LayoutRenderer node={child} />
            </Panel>
          </Fragment>
        );
      })}
    </PanelGroup>
  );
}

/** PaneGrid root — recursively renders the layoutTree */
export function PaneGrid() {
  const layoutTree = useAppStore((s) => s.layoutTree);
  const zoomedPaneId = useAppStore((s) => s.zoomedPaneId);

  // Zoom mode: show only a single pane
  if (zoomedPaneId) {
    return (
      <div className="h-full w-full">
        <PaneSlot paneId={zoomedPaneId} />
      </div>
    );
  }

  // Empty state
  if (!layoutTree) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-600 text-sm">
        <div className="text-center">
          <p>No terminals</p>
          <p className="text-xs mt-1 text-zinc-700">
            Press Cmd+\ to create a new terminal
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <LayoutRenderer node={layoutTree} />
    </div>
  );
}
