// Bundles beautiful-mermaid into bin/vendor, with one change: a loop back to an earlier node must not
// move the diagram's start, so cycles are broken in the order the nodes are written.
const ORDER = /(["']elk\.layered\.considerModelOrder\.strategy["']\s*:\s*["']NODES_AND_EDGES["'])/g;
const BY_MODEL_ORDER = '$1,"elk.layered.cycleBreaking.strategy":"MODEL_ORDER"';

const result = await Bun.build({
  entrypoints: ['node_modules/beautiful-mermaid'],
  target: 'node',
  minify: true,
});
const code = await result.outputs[0].text();
const found = code.match(ORDER)?.length ?? 0;
if (found !== 1) throw new Error(`expected one layout to change, found ${found}`);
await Bun.write('bin/vendor/beautiful-mermaid.mjs', code.replace(ORDER, BY_MODEL_ORDER));
