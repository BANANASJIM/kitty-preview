// Bundles beautiful-mermaid into renderer/vendor with three fixes, each of which must still apply.
const LAYOUT = /beautiful-mermaid\/src\/layout-engine\.ts$/;
const FIXES = [
  // ELK's default way of breaking a loop moves a diagram's start below what loops back to it.
  [
    `'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',`,
    `'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',`,
  ],
  [
    `'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',\n    'elk.layered.spacing.nodeNodeBetweenLayers'`,
    `'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',\n    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',\n    'elk.layered.spacing.nodeNodeBetweenLayers'`,
  ],
  // Links drawn as one trunk must end alike.
  [
    `  if (mergeEdges) {`,
    `  if (mergeEdges && !(globalThis as { keepLinksApart?: boolean }).keepLinksApart) {`,
  ],
  // ELK places an edge within the group both its ends share, not within the one that lists it.
  [
    `      // Extract points\n      const points: Point[] = []`,
    `      const container = (elkEdge as { container?: string }).container
      const shared = container ? groupOffsets.get(container) : undefined
      const [listedX, listedY] = [offsetX, offsetY]
      if (shared) { offsetX = shared.x; offsetY = shared.y }
      // Extract points\n      const points: Point[] = []`,
  ],
  [
    `      // Store segment\n`,
    `      offsetX = listedX; offsetY = listedY\n      // Store segment\n`,
  ],
  [
    `  collectEdgeSegments(elkNode, segments, 0, 0)\n`,
    `  groupOffsets.clear()\n  placeGroups(elkNode, 0, 0)\n  collectEdgeSegments(elkNode, segments, 0, 0)\n`,
  ],
  [
    `function collectEdgeSegments(`,
    `const groupOffsets = new Map<string, Point>()
function placeGroups(node: ElkNode, x: number, y: number): void {
  groupOffsets.set(node.id, { x, y })
  for (const child of node.children ?? []) placeGroups(child, x + (child.x ?? 0), y + (child.y ?? 0))
}
function collectEdgeSegments(`,
  ],
];

const fixes = {
  name: 'fixes',
  setup(build) {
    build.onLoad({ filter: LAYOUT }, async ({ path }) => {
      let contents = await Bun.file(path).text();
      for (const [find, put] of FIXES) {
        if (contents.split(find).length !== 2) throw new Error(`cannot apply: ${find}`);
        contents = contents.replace(find, () => put);
      }
      return { contents, loader: 'ts' };
    });
  },
};

const result = await Bun.build({
  entrypoints: ['node_modules/beautiful-mermaid/src/index.ts'],
  target: 'node',
  minify: true,
  plugins: [fixes],
});
if (!result.success) throw new AggregateError(result.logs);
await Bun.write('renderer/vendor/beautiful-mermaid.mjs', result.outputs[0]);
