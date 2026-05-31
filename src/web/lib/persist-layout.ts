import { apiClient } from './api-client';
import type { LayoutNode } from '@shared/types';

/** Normalize sizes of all SplitNodes to equal proportions */
function equalizeSizes(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node;
  const count = node.children.length;
  return {
    ...node,
    sizes: Array(count).fill(100 / count),
    children: node.children.map(equalizeSizes),
  };
}

/**
 * Immediately persist the current layoutTree to the server.
 * Sizes are normalized to equal proportions before saving.
 */
export function persistLayout(sessionId: string, layoutTree: LayoutNode) {
  const normalized = equalizeSizes(layoutTree);
  apiClient.cli(['layout', 'save', sessionId], normalized).catch(() => {});
}
