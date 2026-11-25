// beautiful-mermaid's flowchart parser drops what it cannot read without a word: `A-->B`, ids that are not
// ASCII, a label given after a node's first mention. Rewrite a flowchart into the subset it reads, or throw.
const ID = /^[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/u;
const SHAPES = [
  ['(((', ')))'],
  ['([', '])'],
  ['((', '))'],
  ['[[', ']]'],
  ['[(', ')]'],
  ['[/', '/]'],
  ['[/', '\\]'],
  ['[\\', '\\]'],
  ['[\\', '/]'],
  ['{{', '}}'],
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
  ['>', ']'],
];
const ARROW =
  /^(<?)(?:(-{2,})(>)|(={2,})(>)|(-\.+-)(>)|(-{3,})|(={3,})|(-\.+-))(?![xo]\s)\s*(?:\|([^|]*)\|)?/;
const TEXT_ARROW = /^(<?)(--|==|-\.)\s*([^\s>|.=-].*?)\s*(-{2,}>?|={2,}>?|\.+->?)(?!>)/;
const DIRECTIVE = /^(direction|classDef|linkStyle)\b/;

// Stand-ins for the characters a label may not hold, put back once the SVG is drawn.
const MASKED = '()[]{}|/\\';
const MASK_BASE = 0xe000;
const mask = (text) =>
  text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[()[\]{}|/\\]/g, (c) => String.fromCharCode(MASK_BASE + MASKED.indexOf(c)))
    .replace(/\n/g, '<br>');
export const unmask = (svg) =>
  svg.replace(/[\ue000-\ue007]/g, (c) => MASKED[c.charCodeAt(0) - MASK_BASE]);

const label = (text) =>
  mask(
    text
      .trim()
      .replace(/^"([\s\S]*)"$/, '$1')
      .replace(/^`([\s\S]*)`$/, '$1'),
  );

function readShape(text) {
  for (const [open, close] of SHAPES) {
    if (!text.startsWith(open)) continue;
    const quoted = /^\s*"[^"]*"\s*/.exec(text.slice(open.length));
    const end = quoted ? open.length + quoted[0].length : text.indexOf(close, open.length);
    if (end < 0 || !text.startsWith(close, end)) continue;
    const body = label(text.slice(open.length, end));
    if (body !== '') return { drawn: `${open}${body}${close}`, length: end + close.length };
  }
  return undefined;
}

export function normalizeFlowchart(source) {
  const aliases = new Map();
  const idOf = (raw) => {
    if (/^[\w-]+$/.test(raw)) return raw;
    if (!aliases.has(raw)) aliases.set(raw, `alias_${aliases.size}`);
    return aliases.get(raw);
  };
  const shapes = new Map();

  // One statement as [text | { id, raw, suffix }], the nodes still without their shape.
  function statement(line) {
    const out = [];
    let rest = line;
    const take = (n) => {
      rest = rest.slice(n).trimStart();
    };
    for (;;) {
      const raw = ID.exec(rest)?.[0];
      if (raw === undefined) throw new Error(`flowchart: cannot read "${rest}"`);
      rest = rest.slice(raw.length);
      const id = idOf(raw);
      const shape = readShape(rest);
      if (shape) {
        shapes.set(id, shape.drawn);
        rest = rest.slice(shape.length);
      }
      const suffix = /^:::[\w-]+/.exec(rest)?.[0] ?? '';
      take(suffix.length);
      out.push({ id, raw, suffix });
      if (rest === '') return [out];
      if (rest.startsWith(';')) {
        take(1);
        return rest === '' ? [out] : [out, ...statement(rest)];
      }
      if (rest.startsWith('&')) {
        out.push(' & ');
        take(1);
        continue;
      }
      const arrow = ARROW.exec(rest);
      const text = arrow ? undefined : TEXT_ARROW.exec(rest);
      if (!arrow && !text) throw new Error(`flowchart: cannot read "${rest}"`);
      const [start, kind, end, words] = arrow
        ? [
            arrow[1],
            (arrow[2] ?? arrow[8]) ? '-' : (arrow[4] ?? arrow[9]) ? '=' : '.',
            arrow[3] ?? arrow[5] ?? arrow[7],
            arrow[11],
          ]
        : [
            text[1],
            { '--': '-', '==': '=', '-.': '.' }[text[2]],
            text[4].endsWith('>') ? '>' : '',
            text[3],
          ];
      const op = { '-': ['---', '-->'], '=': ['===', '==>'], '.': ['-.-', '-.->'] }[kind][
        end ? 1 : 0
      ];
      const said = words?.trim() ? `|${label(words)}|` : '';
      out.push(` ${start}${op}${said} `);
      take((arrow ?? text)[0].length);
    }
  }

  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('%%'));
  const header = /^(graph|flowchart)(?:\s+(TD|TB|LR|BT|RL))?\s*;?$/i.exec(lines[0]);
  if (!header) throw new Error(`flowchart: cannot read "${lines[0]}"`);
  const statements = [];
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\s*;$/, '');
    if (/^click\b/.test(line)) continue;
    const group = /^subgraph\s+(.+)$/.exec(line);
    const styled = /^(style|class)\s+(\S+)\s+(.*)$/.exec(line);
    if (group) {
      const named = /^([\p{L}\p{N}_.-]+)\s*\[(.+)\]$/u.exec(group[1]);
      const name = named?.[1] ?? group[1].replace(/^"(.*)"$/, '$1');
      statements.push([`subgraph ${idOf(name)} [${label(named?.[2] ?? name)}]`]);
    } else if (styled) {
      statements.push([`${styled[1]} ${styled[2].split(',').map(idOf).join(',')} ${styled[3]}`]);
    } else if (line === 'end' || DIRECTIVE.test(line)) {
      statements.push([line]);
    } else {
      statements.push(...statement(line));
    }
  }
  const drawn = new Set();
  const body = statements.map((parts) =>
    parts
      .map((part) => {
        if (typeof part === 'string') return part;
        const isNew = !drawn.has(part.id);
        drawn.add(part.id);
        const shape = shapes.get(part.id) ?? (part.id === part.raw ? '' : `[${mask(part.raw)}]`);
        return `${part.id}${isNew ? shape : ''}${part.suffix}`;
      })
      .join(''),
  );
  return [`${header[1]} ${header[2] ?? 'TD'}`, ...body].join('\n');
}
