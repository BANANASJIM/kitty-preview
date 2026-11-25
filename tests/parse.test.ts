import { expect, test } from 'claude-code/testing';

import { pathsIn, segmentsOf } from '../hooks/parse';

test('a closed mermaid fence is cut out, an open one stays text', () => {
  expect(segmentsOf('a\n```mermaid\ngraph LR\n```\nb').map((s) => s.kind)).toEqual([
    'text',
    'mermaid',
    'text',
  ]);
  expect(segmentsOf('a\n```mermaid\ngraph LR').map((s) => s.kind)).toEqual(['text']);
});

test('a mermaid fence quoted inside another fence stays text', () => {
  expect(segmentsOf('````md\n```mermaid\ngraph LR\n```\n````').map((s) => s.kind)).toEqual([
    'text',
  ]);
});

test('a local image line is an image, a remote one is not', () => {
  expect(segmentsOf('![x](/tmp/a.png)').map((s) => s.kind)).toEqual(['image']);
  expect(segmentsOf('![x](https://e.com/a.png)').map((s) => s.kind)).toEqual(['text']);
});

test('paths come from code, links and @ mentions, without line numbers', () => {
  expect(pathsIn('see `src/a.ts:12` and [b](./b.md), @c.png, `npm run x`, 看 ~/d/e.txt。')).toEqual(
    ['src/a.ts', './b.md', 'c.png', '~/d/e.txt'],
  );
});

test('code fences name no paths', () => {
  expect(pathsIn('```sh\ncat /etc/hosts\n```')).toEqual([]);
});
