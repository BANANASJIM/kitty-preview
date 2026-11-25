import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RENDER = fileURLToPath(new URL('../../bin/render.mjs', import.meta.url));
const FRAME = { cell: [10, 22], maxColumns: 60, maxRows: 40 };
const COLORS = { bg: '#101010', fg: '#e0e0e0', accent: '#80d0d0' };
const scratch = mkdtempSync(join(tmpdir(), 'kitty-preview-'));

function render(request) {
  const { stdout } = spawnSync('node', [RENDER], {
    input: JSON.stringify({ ...FRAME, colors: COLORS, ...request }),
    env: { ...process.env, XDG_RUNTIME_DIR: scratch },
  });
  return JSON.parse(stdout);
}
const diagram = (source) => render({ kind: 'mermaid', source });

const DRAWN = {
  flowchart: 'graph TD;\n开始-->判断{通过?}\n判断-- 否 -->开始\n判断-->|是|结束',
  sequence: 'sequenceDiagram\nparticipant U as 用户\nU->>S: 请求 --verbose: yes var(--x)',
  state: 'stateDiagram-v2\n[*] --> 空闲\n空闲 --> 运行 : 启动',
  class: 'classDiagram\nCar *-- Wheel',
  er: 'erDiagram\nUSER ||--o{ ORDER : "下单"',
  xychart: 'xychart-beta\nx-axis [一月, 二月]\ny-axis "数" 0 --> 10\nbar [3, 8]',
};

for (const [kind, source] of Object.entries(DRAWN)) {
  test(`${kind} is drawn within its frame`, () => {
    const { file, columns, rows, error } = diagram(source);
    assert.equal(error, undefined);
    assert.ok(columns <= FRAME.maxColumns && rows <= FRAME.maxRows);
    const png = readFileSync(file);
    assert.equal(png.readUInt32BE(16), columns * FRAME.cell[0]);
    assert.equal(png.readUInt32BE(20), rows * FRAME.cell[1]);
  });
}

test('a kind that is not drawn, and a diagram too large, are errors', () => {
  assert.ok(diagram('gantt\ntitle x').error);
  const chain = Array.from({ length: 60 }, (_, i) => `n${i}-->n${i + 1}`).join('\n');
  assert.match(diagram(`graph LR\n${chain}`).error, /too large/);
});

const NOT_READ = [
  'stateDiagram-v2\nA --> B\nnote right of A : waits',
  'stateDiagram-v2\nstate A {\nstate B {\nC --> D\n}\n}',
  'classDiagram\nnote for A "x"\nA --> B',
  'classDiagram\nclass A["Label"]',
  'erDiagram\n"Order Detail" ||--o{ ITEM : has',
  'sequenceDiagram\nbox Blue\nparticipant A\nend\nA->>B: x',
];
for (const source of NOT_READ) {
  test(`a line that would be dropped is an error: ${JSON.stringify(source)}`, () => {
    assert.match(diagram(source).error, /cannot read/);
  });
}

test('PostScript named as a picture is refused', () => {
  const path = join(scratch, 'ps.png');
  writeFileSync(path, '%!PS\n{} loop\n');
  assert.match(render({ kind: 'image', path, stamp: '1' }).error, /not a kind/);
});
