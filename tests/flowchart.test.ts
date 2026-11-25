import { expect, test } from 'claude-code/testing';

import { normalizeFlowchart, unmask } from '../bin/flowchart.mjs';

const normal = (body: string) =>
  unmask(normalizeFlowchart(`graph LR\n${body}`))
    .split('\n')
    .slice(1);

test('arrows need no spaces', () => {
  expect(normal('A-->B;B-->|yes|C[c]')).toEqual(['A --> B', 'B -->|yes| C[c]']);
});

test('a label between the dashes is the edge label', () => {
  expect(normal('A-- no -->B')).toEqual(['A -->|no| B']);
});

test('an open link stays open and a long one is one link', () => {
  expect(normal('A---B')).toEqual(['A --- B']);
  expect(normal('A ----> B')).toEqual(['A --> B']);
});

test('ids the library cannot read get an alias and keep their words', () => {
  expect(normal('开始-->a.b')).toEqual(['alias_0[开始] --> alias_1[a.b]']);
});

test('a label given after the first mention is drawn at it', () => {
  expect(normal('A --> B\nB[late]')).toEqual(['A --> B[late]', 'B']);
});

test('what cannot be read throws, so the source is shown', () => {
  expect(() => normal('A --x B')).toThrow();
});
