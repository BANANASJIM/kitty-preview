// The lines beautiful-mermaid reads, by kind: it skips any other without a word, so one means the source is shown.
const NAME = '[\\p{L}\\p{N}_.~-]+';
// Hyphens only inside a name, so an arrow's are its own.
const SENDER = '[\\p{L}\\p{N}_.]+(?:-[\\p{L}\\p{N}_.]+)*';
const line = (pattern) => new RegExp(`^(?:${pattern})$`, 'u');

const KINDS = {
  sequence: {
    header: /^sequenceDiagram$/,
    lines: [
      line(`(?:participant|actor)\\s+${NAME}(?:\\s+as\\s+.+)?`),
      line(`[Nn]ote\\s+(?:left of|right of|over)\\s+${NAME}(?:\\s*,\\s*${NAME})?\\s*:.+`),
      line('(?:loop|alt|opt|par|critical|break)(?:\\s.*)?'),
      line('(?:else|and)(?:\\s.*)?'),
      line('end'),
      line(`(?:activate|deactivate)\\s+${NAME}`),
      line(`${SENDER}\\s*(?:-->>|->>|--\\)|-\\)|-->|->)\\s*[+-]?${NAME}\\s*:\\s*.+`),
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

function rewritten(kind, text, isMember, number) {
  if (number !== undefined)
    return text.replace(MESSAGE, (_, head, said) => `${head}${number}. ${said}`);
  // The library reads a left "}o" only the other way around, and a generic in a relation as another class.
  if (kind === KINDS.er && !isMember) return text.replace(/^(\S+\s+)\}([o|])(?=--|\.\.)/, '$1$2{');
  if (kind === KINDS.class && !isMember && !text.startsWith('class '))
    return text.replace(/~[^~\s]*~/g, '');
  return text;
}

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
  let hasMessage = false;
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
    const isMessage = kind === KINDS.sequence && kind.lines.at(-1).test(text);
    if (isMessage) hasMessage = true;
    // The library hangs a note on the message before it.
    if (kind === KINDS.sequence && /^note\s/i.test(text) && !hasMessage) throw unreadable;
    out.push(
      rewritten(kind, text, isMember, isMessage && number !== undefined ? number++ : undefined),
    );
  }
  return out.join('\n');
}
