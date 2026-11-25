// beautiful-mermaid's flowchart parser drops what it cannot read without a word, and lays some nesting out
// wrong. Rewrite a flowchart into the subset it draws right, or throw, so the source is shown instead.
const ID = /^[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/u;
const SHAPES = [
  ['(((', [')))']],
  ['([', ['])']],
  ['((', ['))']],
  ['[[', [']]']],
  ['[(', [')]']],
  ['[/', ['/]', '\\]']],
  ['[\\', ['\\]', '/]']],
  ['{{', ['}}']],
  ['[', [']']],
  ['(', [')']],
  ['{', ['}']],
  ['>', [']']],
];
const CROSS_OR_CIRCLE = '(?![xo]\\s)';
const ARROW = new RegExp(
  `^(<?)(?:(-{2,})>|(={2,})>|(-\\.+-)>|(-{3,})|(={3,})|(-\\.+-))${CROSS_OR_CIRCLE}\\s*(?:\\|([^|]*)\\|)?`,
);
const TEXT_ARROW = new RegExp(
  `^(<?)(--|==|-\\.)${CROSS_OR_CIRCLE}\\s*([^\\s>|.=-].*?)\\s*(-{2,}>?|={2,}>?|\\.+->?)(?!>)${CROSS_OR_CIRCLE}`,
);
const HEADER = /^(graph|flowchart)(?:\s+(TD|TB|LR|BT|RL))?\s*;?$/i;
const SUBGRAPH_NAMED = /^([\p{L}\p{N}_.-]+)\s*\[(.+)\]$/u;
const RESERVED = /^(subgraph|style|class|classDef|linkStyle|direction|click|end)(\s|$)/;

// Stand-ins for the characters a label may not hold, put back once the SVG is drawn.
const MASKED = '()[]{}|/\\*';
const MASK_BASE = 0xe000;
const mask = (text) =>
  text.replace(/(?<!<)\/|[()[\]{}|\\*]/g, (c) =>
    String.fromCharCode(MASK_BASE + MASKED.indexOf(c)),
  );
export const unmask = (svg) =>
  svg.replace(/[\ue000-\ue009]/g, (c) => MASKED[c.charCodeAt(0) - MASK_BASE]);

function label(raw) {
  const text = raw.trim().replace(/^"([\s\S]*)"$/, '$1');
  if (/#\w+;/.test(text)) throw new Error(`flowchart: cannot read "${text}"`);
  const markdown = /^`([\s\S]*)`$/.exec(text)?.[1];
  const masked = mask((markdown ?? text).replace(/<br\s*\/?>|\\n/gi, '\n')).replace(/\n/g, '<br>');
  // Only a label in backticks is Markdown; elsewhere an asterisk is itself.
  return markdown === undefined ? masked : masked.replaceAll(maskOf('*'), '*');
}
const maskOf = (c) => String.fromCharCode(MASK_BASE + MASKED.indexOf(c));

function readShape(text) {
  for (const [open, closers] of SHAPES) {
    if (!text.startsWith(open)) continue;
    const quoted = /^\s*"[^"]*"\s*/.exec(text.slice(open.length));
    const ends = closers
      .map((close) => {
        const end = quoted ? open.length + quoted[0].length : text.indexOf(close, open.length);
        return { close, end: end >= 0 && text.startsWith(close, end) ? end : Infinity };
      })
      .sort((a, b) => a.end - b.end);
    const { close, end } = ends[0];
    if (end === Infinity) continue;
    const body = label(text.slice(open.length, end));
    // The library has no parallelogram: a plain box, without the slashes it would draw.
    const isParallelogram =
      open[1] !== undefined && '/\\'.includes(open[1]) && close[0] === open[1];
    const drawn = isParallelogram ? `[${body}]` : `${open}${body}${close}`;
    if (body !== '') return { drawn, length: end + close.length };
  }
  return undefined;
}

const className = (name) => name.replace(/\W/g, '_');

// A fill with no text color keeps the theme's, which may not be readable on it.
function readableProps(props) {
  const fill = /(?:^|,)\s*fill\s*:\s*#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(props)?.[1];
  if (!fill || /(?:^|,)\s*color\s*:/i.test(props)) return props;
  const hex = fill.length === 3 ? [...fill].map((c) => c + c).join('') : fill;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const isLight = 0.299 * r + 0.587 * g + 0.114 * b > 140;
  return `${props},color:${isLight ? '#000000' : '#ffffff'}`;
}

export function normalizeFlowchart(source) {
  const unreadable = (text) => new Error(`flowchart: cannot read "${text}"`);
  const aliases = new Map();
  const idOf = (raw) => {
    if (/^[\w-]+$/.test(raw)) return raw;
    if (!aliases.has(raw)) aliases.set(raw, `alias_${aliases.size}`);
    return aliases.get(raw);
  };
  const shapes = new Map();

  // One statement: nodes joined by " & " and by arrows.
  function statements(line) {
    const parts = [];
    let rest = line;
    const take = (n) => {
      rest = rest.slice(n).trimStart();
    };
    for (;;) {
      const raw = ID.exec(rest)?.[0];
      if (raw === undefined) throw unreadable(rest);
      rest = rest.slice(raw.length);
      const id = idOf(raw);
      const shape = readShape(rest);
      if (shape) {
        shapes.set(id, shape.drawn);
        rest = rest.slice(shape.length);
      }
      const styled = /^:::([\w-]+)/.exec(rest);
      take(styled?.[0].length ?? 0);
      parts.push({ id, raw, suffix: styled ? `:::${className(styled[1])}` : '' });
      if (rest === '') return [parts];
      if (rest.startsWith(';')) {
        take(1);
        return rest === '' ? [parts] : [parts, ...statements(rest)];
      }
      if (rest.startsWith('&')) {
        parts.push(' & ');
        take(1);
        continue;
      }
      const arrow = ARROW.exec(rest);
      const text = arrow ? undefined : TEXT_ARROW.exec(rest);
      if (!arrow && !text) throw unreadable(rest);
      const start = (arrow ?? text)[1];
      const drawn = arrow ? arrow[0].replace(/\|[^|]*\|$/, '').trim() : text[4];
      const kind = arrow
        ? (arrow[2] ?? arrow[5]) !== undefined
          ? '-'
          : (arrow[3] ?? arrow[6]) !== undefined
            ? '='
            : '.'
        : { '--': '-', '==': '=', '-.': '.' }[text[2]];
      const words = arrow ? arrow[8] : text[3];
      const ops = { '-': ['---', '-->'], '=': ['===', '==>'], '.': ['-.-', '-.->'] }[kind];
      const said = words?.trim() ? `|${label(words)}|` : '';
      parts.push(` ${start}${ops[drawn.endsWith('>') ? 1 : 0]}${said} `);
      take((arrow ?? text)[0].length);
    }
  }

  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('%%'));
  const header = HEADER.exec(lines[0]);
  if (!header) throw unreadable(lines[0]);

  const root = { id: undefined, depth: 0, opening: undefined, groups: [], body: [], settings: [] };
  const groups = new Map();
  const styles = [];
  const linkStyles = [];
  const stack = [root];
  let isReordered = false;
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\s*;$/, '');
    const here = stack[stack.length - 1];
    const subgraph = /^subgraph\s+(.+)$/.exec(line);
    const direction = /^direction\s+(?:TD|TB|LR|BT|RL)$/i.exec(line);
    const classDef = /^classDef\s+([\w,-]+)\s+(.+)$/.exec(line);
    const classed = /^class\s+([^\s]+)\s+([\w-]+)$/.exec(line);
    const styled = /^style\s+([^\s]+)\s+(.+)$/.exec(line);
    if (/^click\s/.test(line)) continue;
    if (subgraph) {
      const named = SUBGRAPH_NAMED.exec(subgraph[1]);
      const name = named?.[1] ?? subgraph[1].replace(/^"(.*)"$/, '$1');
      const group = {
        id: idOf(name),
        depth: here.depth + 1,
        opening: `subgraph ${idOf(name)} [${label(named?.[2] ?? name)}]`,
        groups: [],
        body: [],
        settings: [],
      };
      if (groups.has(group.id)) throw unreadable(line);
      groups.set(group.id, group);
      if (here.body.length > 0) isReordered = true;
      here.groups.push(group);
      stack.push(group);
    } else if (line === 'end') {
      if (here === root) throw unreadable(line);
      stack.pop();
    } else if (direction) {
      if (here !== root) here.settings.push(line);
    } else if (classDef) {
      for (const name of classDef[1].split(',')) {
        styles.push(`classDef ${className(name)} ${readableProps(classDef[2])}`);
      }
    } else if (classed) {
      styles.push(`class ${classed[1].split(',').map(idOf).join(',')} ${className(classed[2])}`);
    } else if (styled) {
      styles.push(`style ${styled[1].split(',').map(idOf).join(',')} ${readableProps(styled[2])}`);
    } else if (/^linkStyle\s/.test(line)) {
      linkStyles.push(line);
    } else if (RESERVED.test(line)) {
      throw unreadable(line);
    } else {
      here.body.push(...statements(line));
    }
  }
  if (stack.length !== 1) throw unreadable('a subgraph without its end');

  // A node belongs to the group that mentions it, so groups are written ahead of what surrounds them.
  const isNested = [...groups.values()].some((group) => group.depth > 1);
  const owners = new Map();
  const holds = (group, inner) =>
    group === inner || group.groups.some((child) => holds(child, inner));

  function checkEdges(parts) {
    const sides = [[]];
    for (const part of parts) {
      if (typeof part !== 'string') sides[sides.length - 1].push(part.id);
      else if (part !== ' & ') sides.push([]);
    }
    for (let i = 1; i < sides.length; i++) {
      for (const from of sides[i - 1]) {
        for (const to of sides[i]) {
          const [a, b] = [owners.get(from), owners.get(to)];
          const isDeep = (a?.depth ?? 0) > 1 || (b?.depth ?? 0) > 1;
          if (a !== b && isDeep) throw unreadable(`${from} to ${to}, across nested subgraphs`);
        }
      }
    }
  }

  function write(group) {
    const out = [
      ...group.settings,
      ...group.groups.flatMap((inner) => [inner.opening, ...write(inner), 'end']),
    ];
    for (const parts of group.body) {
      for (const part of parts) {
        if (typeof part === 'string') continue;
        if (groups.has(part.id)) {
          if (group !== root || isNested || shapes.has(part.id)) throw unreadable(part.raw);
          continue;
        }
        const owner = owners.get(part.id);
        if (owner === undefined) {
          owners.set(part.id, group);
          // Declared alone: two shapes on one line can be read as one.
          const shape = shapes.get(part.id) ?? (part.id === part.raw ? '' : `[${mask(part.raw)}]`);
          out.push(`${part.id}${shape}`);
        } else if (!holds(group, owner)) {
          throw unreadable(`${part.raw}, in two subgraphs`);
        }
      }
      checkEdges(parts);
      if (parts.length > 1 || parts[0].suffix !== '') {
        out.push(
          parts
            .map((part) => (typeof part === 'string' ? part : `${part.id}${part.suffix}`))
            .join(''),
        );
      }
    }
    return out;
  }

  const body = write(root);
  return [
    `${header[1]} ${header[2] ?? 'TD'}`,
    ...body,
    ...styles,
    // Links are counted in the order written, which moving the groups changes.
    ...(isReordered ? [] : linkStyles),
  ].join('\n');
}
