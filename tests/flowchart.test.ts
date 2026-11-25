import { expect, test } from 'claude-code/testing';

import { normalizeFlowchart, unmask } from '../renderer/flowchart.mjs';

const normal = (body: string) =>
  unmask(normalizeFlowchart(`graph LR\n${body}`).drawable)
    .split('\n')
    .slice(1);

test('arrows need no spaces', () => {
  expect(normal('A-->B;B-->|yes|C[c]')).toEqual(['A', 'B', 'C[c]', 'A --> B', 'B -->|yes| C']);
});

test('a label between the dashes is the edge label', () => {
  expect(normal('A-- no -->B').at(-1)).toBe('A -->|no| B');
});

test('an open link stays open and a long one is one link', () => {
  expect(normal('A---B').at(-1)).toBe('A --- B');
  expect(normal('A ----> B').at(-1)).toBe('A --> B');
  expect(normal('A -.-> B').at(-1)).toBe('A -.-> B');
  expect(normal('A ==> B').at(-1)).toBe('A ==> B');
  expect(normal('A <--> B').at(-1)).toBe('A <--> B');
});

test('ids the library cannot read get an alias and keep their words', () => {
  expect(normal('开始-->a.b')).toEqual(['alias_0[开始]', 'alias_1[a.b]', 'alias_0 --> alias_1']);
});

test('a label given after the first mention is drawn at it', () => {
  expect(normal('A --> B\nB[late]')).toEqual(['A', 'B[late]', 'A --> B']);
});

test('labels keep their brackets, slashes and asterisks', () => {
  expect(normal('A["f(x) [y] C:\\Users a/*.ts"]')).toEqual(['A[f(x) [y] C:\\Users a/*.ts]']);
  expect(normalizeFlowchart('graph LR\nA["<b>x</b><br/>y"]').drawable).toContain(
    'A[<b>x</b><br>y]',
  );
});

test('a node first mentioned outside its group is drawn in it', () => {
  expect(normal('A-->B\nsubgraph S\nB\nend')).toEqual([
    'subgraph S [S]',
    'B',
    'end',
    'A',
    'A --> B',
  ]);
});

test('class names are made readable, and a fill gets a readable text color', () => {
  expect(normal('A:::my-ok\nclassDef my-ok,b fill:#fff3cd')).toEqual([
    'A',
    'A:::my_ok',
    'classDef my_ok fill:#fff3cd,color:#000000',
    'classDef b fill:#fff3cd,color:#000000',
  ]);
});

test('other arrow ends and hidden links are marked', () => {
  const { marks } = normalizeFlowchart('graph LR\nA --x B & C\nC o--o D ~~~ E\nA -- text --x E');
  expect(
    marks.map(({ from, to, start, end, isHidden }) => [from, to, start, end, isHidden]),
  ).toEqual([
    ['A', 'B', '', 'x', false],
    ['A', 'C', '', 'x', false],
    ['C', 'D', 'o', 'o', false],
    ['D', 'E', '', '', true],
    ['A', 'E', '', 'x', false],
  ]);
});

test('links come after the groups, in the order written', () => {
  expect(normal('A-->B\nsubgraph S\nB-->C\nend\nS-->A')).toEqual([
    'subgraph S [S]',
    'B',
    'C',
    'end',
    'A',
    'A --> B',
    'B --> C',
    'S --> A',
  ]);
});

test('a group keeps its direction unless a deep link from outside would be lost', () => {
  expect(normal('subgraph O\ndirection TB\nA-->B\nend\nX-->A')).toContain('direction TB');
  const deep = 'subgraph O\ndirection TB\nsubgraph I\nA\nend\nend\n';
  expect(normal(`${deep}X-->A`)).not.toContain('direction TB');
  expect(normal(`${deep}I-->Y`)).not.toContain('direction TB');
});

const THROWS = [
  'A@{ shape: cyl }',
  'class A, B x',
  'subgraph S\nA\nend\nsubgraph T\nA\nend',
  'S[x]\nsubgraph S\nA\nend',
];
for (const body of THROWS) {
  test(`what cannot be drawn right throws: ${JSON.stringify(body)}`, () => {
    expect(() => normal(body)).toThrow();
  });
}
