import { expect, test } from 'claude-code/testing';

import { normalizeFlowchart, unmask } from '../bin/flowchart.mjs';

const normal = (body: string) =>
  unmask(normalizeFlowchart(`graph LR\n${body}`))
    .split('\n')
    .slice(1);

test('arrows need no spaces', () => {
  expect(normal('A-->B;B-->|yes|C[c]')).toEqual(['A', 'B', 'A --> B', 'C[c]', 'B -->|yes| C']);
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
  expect(normalizeFlowchart('graph LR\nA["<b>x</b><br/>y"]')).toContain('A[<b>x</b><br>y]');
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

const THROWS = [
  'A --x B --> C',
  'A --o B',
  'A -- no --x B',
  'A ~~~ B',
  'A@{ shape: cyl }',
  'class A, B x',
  'subgraph O\nsubgraph I\nA\nend\nsubgraph J\nB\nend\nA-->B\nend',
  'subgraph O\nsubgraph I\nA\nend\nsubgraph J\nB\nend\nI-->J\nend',
  'subgraph S\nA\nend\nsubgraph T\nA\nend',
];
for (const body of THROWS) {
  test(`what cannot be drawn right throws: ${JSON.stringify(body)}`, () => {
    expect(() => normal(body)).toThrow();
  });
}
