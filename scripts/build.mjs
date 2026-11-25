// Bundles beautiful-mermaid into bin/vendor, with one change: how a loop is broken. ELK's default moves a
// diagram's start below what loops back to it. A group's inside starts where its edges come in, the whole as
// bin/render.mjs chooses.
const PATCHES = [
  {
    find: /(["']elk\.layered\.considerModelOrder\.strategy["']\s*:\s*["']NODES_AND_EDGES["'])/g,
    add: '"elk.layered.cycleBreaking.strategy":globalThis.cycleBreaking',
  },
  {
    find: /(["']elk\.layered\.nodePlacement\.bk\.fixedAlignment["']\s*:\s*["']BALANCED["'])(?=\s*,\s*["']elk\.layered\.spacing\.nodeNodeBetweenLayers["'])/g,
    add: '"elk.layered.cycleBreaking.strategy":"DEPTH_FIRST"',
  },
];

const result = await Bun.build({
  entrypoints: ['node_modules/beautiful-mermaid'],
  target: 'node',
  minify: true,
});
let code = await result.outputs[0].text();
for (const { find, add } of PATCHES) {
  const found = code.match(find)?.length ?? 0;
  if (found !== 1) throw new Error(`expected one layout to change, found ${found}`);
  code = code.replace(find, `$1,${add}`);
}
await Bun.write('bin/vendor/beautiful-mermaid.mjs', code);
