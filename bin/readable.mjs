// The lines beautiful-mermaid reads, by kind: it skips any other without a word, so one means the source is shown.
const NAME = '[\\p{L}\\p{N}_.~-]+';
const line = (pattern) => new RegExp(`^(?:${pattern})$`, 'u');

const KINDS = {
  sequence: {
    header: /^sequenceDiagram$/,
    lines: [
      line(`(?:participant|actor)\\s+${NAME}(?:\\s+as\\s+.+)?`),
      line(`[Nn]ote\\s+(?:left of|right of|over)\\s+${NAME}(?:\\s*,\\s*${NAME})?\\s*:.+`),
      line('(?:loop|alt|opt|par|critical|break|rect)(?:\\s.*)?'),
      line('(?:else|and)(?:\\s.*)?'),
      line('end'),
      line(`(?:activate|deactivate)\\s+${NAME}`),
      line(`[\\p{L}\\p{N}_.]+\\s*(?:-->>|->>|--\\)|-\\)|--x|-x|-->|->)\\s*[+-]?${NAME}\\s*:\\s*.+`),
    ],
  },
  state: {
    header: /^stateDiagram(?:-v2)?$/,
    lines: [
      line('direction\\s+(?:TD|TB|LR|BT|RL)'),
      line(
        '(?:\\[\\*\\]|[\\p{L}\\p{N}_-]+)\\s*-->\\s*(?:\\[\\*\\]|[\\p{L}\\p{N}_-]+)(?:\\s*:\\s*.+)?',
      ),
      line('state\\s+(?:"[^"]+"\\s+as\\s+)?[\\p{L}\\p{N}_]+\\s*\\{'),
      line('state\\s+"[^"]+"\\s+as\\s+[\\p{L}\\p{N}_]+'),
      line('(?!state\\b)[\\p{L}\\p{N}_-]+\\s*:\\s*.+'),
      line('\\}'),
    ],
  },
  class: {
    header: /^classDiagram(?:-v2)?$/,
    lines: [
      line('direction\\s+(?:TD|TB|LR|BT|RL)'),
      line(`namespace\\s+${NAME}\\s*\\{`),
      line(`class\\s+${NAME}`),
      line(`class\\s+${NAME}\\s*\\{\\s*<<\\w+>>\\s*\\}`),
      line(`${NAME}\\s*:\\s*.+`),
      line(
        `${NAME}\\s+(?:"[^"]*"\\s+)?(?:<\\|--|<\\|\\.\\.|\\*--|o--|-->|--\\*|--o|--\\|>|\\.\\.>|\\.\\.\\|>|<--|<\\.\\.|--)\\s+(?:"[^"]*"\\s+)?${NAME}(?:\\s*:\\s*.+)?`,
      ),
      line('\\}'),
    ],
    block: line(`class\\s+${NAME}\\s*\\{`),
  },
  er: {
    header: /^erDiagram$/,
    lines: [line(`${NAME}\\s+[|o}{]+(?:--|\\.\\.)[|o}{]+\\s+${NAME}\\s*:\\s*.+`)],
    block: line(`${NAME}\\s*\\{`),
    member: line('\\S+\\s+\\S+(?:\\s+.+)?'),
  },
  xychart: {
    header: /^xychart(?:-beta)?(?:\s+horizontal)?$/,
    lines: [
      line('title\\s+"[^"]+"'),
      line('x-axis\\s+(?:"[^"]*"\\s*)?\\[[^\\]]+\\]'),
      line('[xy]-axis\\s+(?:"[^"]*"\\s+)?-?\\d+(?:\\.\\d+)?\\s*-->\\s*-?\\d+(?:\\.\\d+)?'),
      line('y-axis\\s+"[^"]+"'),
      line('(?:bar|line)\\s+\\[[^\\]]+\\]'),
    ],
  },
};

const MESSAGE = /^([^:]*?(?:>>|\)|x|>)\s*[+-]?[^:]*:\s*)(.+)$/;

export function readable(source) {
  const lines = source
    .split('\n')
    .map((text) => text.trim())
    .filter((text) => text !== '' && !text.startsWith('%%'));
  const kind = Object.values(KINDS).find(({ header }) => header.test(lines[0]));
  if (!kind) throw new Error(`mermaid: "${lines[0]}" is not drawn`);

  const out = [lines[0]];
  let isMember = false;
  let depth = 0;
  let number;
  for (const text of lines.slice(1)) {
    const unreadable = new Error(`mermaid: cannot read "${text}"`);
    if (isMember) {
      if (text === '}') isMember = false;
      else if (kind.member && !kind.member.test(text)) throw unreadable;
    } else if (kind === KINDS.sequence && text === 'autonumber') {
      number = 1;
      continue;
    } else if (kind.block?.test(text)) {
      isMember = true;
    } else if (!kind.lines.some((pattern) => pattern.test(text))) {
      throw unreadable;
    } else if (kind === KINDS.state) {
      // Nested composites are laid out wrong.
      depth += text.endsWith('{') ? 1 : text === '}' ? -1 : 0;
      if (depth > 1) throw unreadable;
    }
    const isMessage = number !== undefined && kind.lines.at(-1).test(text);
    out.push(
      isMessage ? text.replace(MESSAGE, (_, head, said) => `${head}${number++}. ${said}`) : text,
    );
  }
  return out.join('\n');
}
