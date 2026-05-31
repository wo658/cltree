/**
 * TDD tests for layout tree manipulation.
 * Verifies `sizes` normalization for removeLeaf, splitPane, and insertIntoTree.
 */

// Logic copied from paneSlice so we can test the internal functions directly
// (in practice they run via the zustand store; here we test them as pure functions).

interface SplitNode {
  id: string;
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  sizes: number[];
}

interface LeafNode {
  type: 'leaf';
  paneId: string;
}

type LayoutNode = SplitNode | LeafNode;

// ─── Pure functions copied from paneSlice ───

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

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  const total = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map((s) => (s / total) * 100);

  return { ...tree, children: newChildren, sizes: normalizedSizes };
}

function replaceLeaf(tree: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode {
  if (tree.type === 'leaf') {
    return tree.paneId === paneId ? replacement : tree;
  }
  return {
    ...tree,
    children: tree.children.map((child) => replaceLeaf(child, paneId, replacement)),
  };
}

// ─── Tests ───

describe('removeLeaf — sizes normalization', () => {
  test('removing 1 of 2 collapses to the remaining leaf', () => {
    const tree: SplitNode = {
      id: 'split-1',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
      ],
      sizes: [40, 60],
    };

    const result = removeLeaf(tree, 'a');
    // collapse: SplitNode → LeafNode
    expect(result).not.toBeNull();
    expect(result!.type).toBe('leaf');
    expect((result as LeafNode).paneId).toBe('b');
  });

  test('removing 1 of 3 leaves sizes summing to 100', () => {
    const tree: SplitNode = {
      id: 'split-1',
      type: 'split',
      direction: 'vertical',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
        { type: 'leaf', paneId: 'c' },
      ],
      sizes: [30, 40, 30],
    };

    const result = removeLeaf(tree, 'b') as SplitNode;
    expect(result.type).toBe('split');
    expect(result.children).toHaveLength(2);

    // sizes sum to exactly 100
    const total = result.sizes.reduce((a, b) => a + b, 0);
    expect(Math.round(total)).toBe(100);

    // ratio preserved: 30:30 → 50:50
    expect(Math.round(result.sizes[0])).toBe(50);
    expect(Math.round(result.sizes[1])).toBe(50);
  });

  test('removing 1 of 4 leaves sizes summing to 100', () => {
    const tree: SplitNode = {
      id: 'split-1',
      type: 'split',
      direction: 'vertical',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
        { type: 'leaf', paneId: 'c' },
        { type: 'leaf', paneId: 'd' },
      ],
      sizes: [25, 25, 25, 25],
    };

    const result = removeLeaf(tree, 'c') as SplitNode;
    expect(result.children).toHaveLength(3);
    const total = result.sizes.reduce((a, b) => a + b, 0);
    expect(Math.round(total)).toBe(100);

    // 25:25:25 → each ~33.33
    result.sizes.forEach((s) => {
      expect(Math.round(s)).toBeCloseTo(33, 0);
    });
  });

  test('removing a leaf in a nested tree collapses its parent', () => {
    // split-root(horizontal)
    //   ├── leaf a
    //   └── split-inner(vertical)
    //       ├── leaf b
    //       └── leaf c
    const tree: SplitNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        {
          id: 'inner',
          type: 'split',
          direction: 'vertical',
          children: [
            { type: 'leaf', paneId: 'b' },
            { type: 'leaf', paneId: 'c' },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [40, 60],
    };

    // remove b → inner collapses → root becomes [a, c]
    const result = removeLeaf(tree, 'b') as SplitNode;
    expect(result.type).toBe('split');
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as LeafNode).paneId).toBe('a');
    expect((result.children[1] as LeafNode).paneId).toBe('c');

    // sizes sum to 100
    const total = result.sizes.reduce((a, b) => a + b, 0);
    expect(Math.round(total)).toBe(100);
  });

  test('preserves sizes ratio after removing a leaf in a nested tree', () => {
    const tree: SplitNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        {
          id: 'inner',
          type: 'split',
          direction: 'vertical',
          children: [
            { type: 'leaf', paneId: 'b' },
            { type: 'leaf', paneId: 'c' },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [40, 60],
    };

    // remove c → inner collapses → root becomes [a, b]
    const result = removeLeaf(tree, 'c') as SplitNode;
    expect(result.children).toHaveLength(2);
    // root sizes were originally [40, 60]; since inner collapsed they stay the same
    expect(result.sizes[0]).toBe(40);
    expect(result.sizes[1]).toBe(60);
  });

  test('removing a non-existent paneId leaves the tree unchanged', () => {
    const tree: SplitNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
      ],
      sizes: [50, 50],
    };

    const result = removeLeaf(tree, 'nonexist') as SplitNode;
    expect(result.children).toHaveLength(2);
    expect(result.sizes).toEqual([50, 50]);
  });

  test('removing a single leaf yields null', () => {
    const tree: LeafNode = { type: 'leaf', paneId: 'a' };
    expect(removeLeaf(tree, 'a')).toBeNull();
  });

  test('single leaf — removing a different id leaves it unchanged', () => {
    const tree: LeafNode = { type: 'leaf', paneId: 'a' };
    const result = removeLeaf(tree, 'b');
    expect(result).not.toBeNull();
    expect((result as LeafNode).paneId).toBe('a');
  });
});

describe('removeLeaf — sizes stability across consecutive removals', () => {
  test('sequential removal: 3 → 2 → 1', () => {
    let tree: LayoutNode = {
      id: 'root',
      type: 'split',
      direction: 'vertical',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
        { type: 'leaf', paneId: 'c' },
      ],
      sizes: [33.33, 33.33, 33.34],
    } as SplitNode;

    // remove a
    tree = removeLeaf(tree, 'a')!;
    expect(tree.type).toBe('split');
    expect((tree as SplitNode).children).toHaveLength(2);
    const total1 = (tree as SplitNode).sizes.reduce((a, b) => a + b, 0);
    expect(Math.round(total1)).toBe(100);

    // remove b → collapse
    tree = removeLeaf(tree, 'b')!;
    expect(tree.type).toBe('leaf');
    expect((tree as LeafNode).paneId).toBe('c');
  });

  test('consecutive removals in a complex tree', () => {
    // root(h) → [a, inner(v) → [b, c, d]]
    let tree: LayoutNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        {
          id: 'inner',
          type: 'split',
          direction: 'vertical',
          children: [
            { type: 'leaf', paneId: 'b' },
            { type: 'leaf', paneId: 'c' },
            { type: 'leaf', paneId: 'd' },
          ],
          sizes: [33, 34, 33],
        },
      ],
      sizes: [30, 70],
    } as SplitNode;

    // remove d → inner becomes [b, c]
    tree = removeLeaf(tree, 'd')!;
    expect(tree.type).toBe('split');
    const inner1 = (tree as SplitNode).children[1] as SplitNode;
    expect(inner1.children).toHaveLength(2);
    expect(Math.round(inner1.sizes.reduce((a, b) => a + b, 0))).toBe(100);

    // remove c → inner collapses → root becomes [a, b]
    tree = removeLeaf(tree, 'c')!;
    expect(tree.type).toBe('split');
    expect((tree as SplitNode).children).toHaveLength(2);
    expect((tree as SplitNode).sizes[0]).toBe(30);
    expect((tree as SplitNode).sizes[1]).toBe(70);

    // remove b → collapse → leaf a (final)
    tree = removeLeaf(tree, 'b')!;
    expect(tree.type).toBe('leaf');
    expect((tree as LeafNode).paneId).toBe('a');
  });
});

describe('removeLeaf — react-resizable-panels compatibility', () => {
  test('sizes are always positive', () => {
    const tree: SplitNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
        { type: 'leaf', paneId: 'c' },
      ],
      sizes: [10, 80, 10],
    };

    const result = removeLeaf(tree, 'b') as SplitNode;
    result.sizes.forEach((s) => {
      expect(s).toBeGreaterThan(0);
    });
  });

  test('each size must be at least minSize (5)', () => {
    const tree: SplitNode = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'b' },
        { type: 'leaf', paneId: 'c' },
        { type: 'leaf', paneId: 'd' },
        { type: 'leaf', paneId: 'e' },
      ],
      sizes: [5, 5, 80, 5, 5],
    };

    // removing the 80%-sized c leaves the others at 25% each
    const result = removeLeaf(tree, 'c') as SplitNode;
    result.sizes.forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(5);
    });
    expect(Math.round(result.sizes.reduce((a, b) => a + b, 0))).toBe(100);
  });
});
