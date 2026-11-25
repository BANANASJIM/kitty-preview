import { expect, test } from 'claude-code/testing';

const PICTURE = { file: '/run/p.png', columns: 20, rows: 5 };

function host(on: any, files: Record<string, string>) {
  const ran: { argv: readonly string[]; stdin?: string }[] = [];
  on('process.run', (_: unknown, e: any) => {
    ran.push({ argv: e.argv, stdin: e.init?.stdin ?? e.stdin });
    const stdout =
      e.argv[0] === 'kitty'
        ? '{"bg":"#000000","fg":"#ffffff","accent":"#00ffff","cell":[10,20]}'
        : JSON.stringify(PICTURE);
    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on('fs.exists', (_: unknown, e: any) => ({ value: e.path in files }));
  on('fs.stat', () => ({ value: { kind: 'file', size: 9, mtimeMs: 1, isLink: false } }));
  on('fs.read', (_: unknown, e: any) => ({ value: files[e.path] }));
  on('session.cwd', () => ({ value: '/w' }));
  return ran;
}

const reply = (text: string) =>
  ({
    plugin: 'kitty-preview',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 60, rows: 40, isFullscreen: true },
  }) as any;

async function settled(ui: any, query: any) {
  for (let i = 0; i < 50; i++) {
    const found = await ui.find(query);
    if (found) return found;
    await Promise.resolve();
  }
  return undefined;
}

test('a mermaid block becomes a picture', async ($, on) => {
  const ran = host(on, {});
  const ui = await $.ui.mount(reply('hi\n\n```mermaid\ngraph LR\nA-->B\n```\n\nbye'));
  expect(await settled(ui, { type: 'Image' })).toBeDefined();
  expect(ran.some((r) => r.stdin?.includes('"fg":"#ffffff"'))).toBe(true);
  await ui.unmount();
});

test('a named file that exists gets a hover card, one that does not gets none', async ($, on) => {
  host(on, { '/w/a.ts': 'const x = 1\n' });
  const ui = await $.ui.mount(reply('look at `a.ts` and `gone.ts`'));
  expect(await settled(ui, { type: 'Text', text: /const x = 1/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /gone/ })).toBeUndefined();
  await ui.unmount();
});
