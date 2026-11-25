// Bundles beautiful-mermaid into bin/vendor, with one change: ELK's default way of breaking a loop moves a
// diagram's start below what loops back to it, so loops are broken from the start instead.
const DEPTH_FIRST = '$1,"elk.layered.cycleBreaking.strategy":"DEPTH_FIRST"';
const LAYOUTS = [
  /(["']elk\.layered\.considerModelOrder\.strategy["']\s*:\s*["']NODES_AND_EDGES["'])/g,
  /(["']elk\.layered\.nodePlacement\.bk\.fixedAlignment["']\s*:\s*["']BALANCED["'])(?=\s*,\s*["']elk\.layered\.spacing\.nodeNodeBetweenLayers["'])/g,
];

const result = await Bun.build({
  entrypoints: ['node_modules/beautiful-mermaid'],
  target: 'node',
  minify: true,
});
let code = await result.outputs[0].text();
for (const layout of LAYOUTS) {
  const found = code.match(layout)?.length ?? 0;
  if (found !== 1) throw new Error(`expected one layout to change, found ${found}`);
  code = code.replace(layout, DEPTH_FIRST);
}
await Bun.write('bin/vendor/beautiful-mermaid.mjs', code);
