// beautiful-mermaid's flowchart parser drops what it cannot read without a word, and knows one kind of
// arrow end. Rewrite a flowchart into the subset it draws right, or throw, so the source is shown instead.
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
const ARROW =
  /^([<xo]?)(?:(-{2,})([>xo])|(={2,})([>xo])|(-\.+-)([>xo]?)|(-{3,})|(={3,})|(~{3,}))\s*(?:\|([^|]*)\|)?/;
const TEXT_ARROW =
  /^([<xo]?)(--|==|-\.)\s*([^\s>|.=-].*?)\s*(?:(-{2,}|={2,}|\.+-)([>xo])|(-{3,}|={3,}|\.+-))(?=[\s\p{L}\p{N}_]|$)/u;
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
  if (/(?:^|,)\s*color\s*:/i.test(props)) return props;
  // A named fill's brightness is unknown: the theme's own is readable.
  if (!fill)
    return props.replace(/(^|,)\s*fill\s*:[^,]*/i, '').replace(/^,/, '') || 'stroke-width:1px';
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
        parts.push({});
        take(1);
        continue;
      }
      const arrow = ARROW.exec(rest);
      const text = arrow ? undefined : TEXT_ARROW.exec(rest);
      if (!arrow && !text) throw unreadable(rest);
      const start = (arrow ?? text)[1];
      const body = arrow
        ? (arrow[2] ?? arrow[4] ?? arrow[6] ?? arrow[8] ?? arrow[9] ?? arrow[10])
        : text[2];
      const end = arrow ? (arrow[3] ?? arrow[5] ?? arrow[7] ?? '') : (text[5] ?? '');
      const words = arrow ? arrow[11] : text[3];
      const kind = body.includes('.') ? '.' : body[0] === '=' ? '=' : '-';
      const ops = { '-': ['---', '-->'], '=': ['===', '==>'], '.': ['-.-', '-.->'] }[kind];
      // The library's only end is the arrow: the others are drawn over it.
      if (start !== '' && end === '') throw unreadable(rest);
      parts.push({
        link: ` ${start === '' ? '' : '<'}${ops[end === '' ? 0 : 1]}`,
        label: words?.trim() ? `|${label(words)}|` : '',
        mark: { start, end, isHidden: body[0] === '~' },
      });
      take((arrow ?? text)[0].length);
    }
  }

  const lines = source
    .replace(/^(\s*(?:graph|flowchart)\s+\w+)\s*;[ \t]*(?=\S)/i, '$1\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('%%'));
  const header = HEADER.exec(lines[0]);
  if (!header) throw unreadable(lines[0]);

  const root = { id: undefined, depth: 0, opening: undefined, groups: [], body: [], settings: [] };
  const groups = new Map();
  const styles = [];
  const linkStyles = [];
  const written = [];
  const stack = [root];
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
      const read = statements(line);
      here.body.push(...read);
      written.push(...read);
    }
  }
  if (stack.length !== 1) throw unreadable('a subgraph without its end');

  // A node belongs to the group that mentions it, so groups are declared ahead of what surrounds them. The
  // links come last, in the order written: they may name a group, and linkStyle counts them.
  const owners = new Map();
  const holds = (group, inner) =>
    group === inner || group.groups.some((child) => holds(child, inner));

  function declare(group) {
    const out = [
      ...group.settings,
      ...group.groups.flatMap((inner) => [inner.opening, ...declare(inner), 'end']),
    ];
    for (const part of group.body.flat()) {
      if (part.id === undefined) continue;
      if (groups.has(part.id)) {
        if (shapes.has(part.id)) throw unreadable(part.raw);
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
    return out;
  }

  const around = (id) => owners.get(id) ?? groups.get(id);
  const isLost = (from, to) =>
    around(from) !== around(to) && [from, to].some((id) => (around(id)?.depth ?? 0) > 1);

  function linksOf(parts) {
    const sides = [[]];
    const links = [];
    for (const part of parts) {
      if (part.id !== undefined) sides.at(-1).push(part);
      else if (part.link !== undefined) {
        links.push(part);
        sides.push([]);
      }
    }
    return { sides, links };
  }

  // A group with its own direction is laid out apart, and a link is followed across one border only. Like
  // Mermaid, such a group gives its direction up where what is in it is linked to the outside.
  let declarations = declare(root);
  const isApart = () => root.groups.some((group) => group.settings.length > 0);
  const isInside = (group, id) =>
    owners.has(id) ? holds(group, owners.get(id)) : group.id !== id && holds(group, groups.get(id));
  const pairs = written.flatMap((parts) => {
    const { sides } = linksOf(parts);
    return sides.slice(1).flatMap((to, i) => sides[i].flatMap((a) => to.map((b) => [a.id, b.id])));
  });
  if (isApart() && pairs.some(([from, to]) => isLost(from, to))) {
    for (const group of groups.values()) {
      const isCrossed = pairs.some(([a, b]) => isInside(group, a) !== isInside(group, b));
      if (isCrossed) group.settings = [];
    }
    owners.clear();
    declarations = declare(root);
    const lost = isApart() && pairs.find(([from, to]) => isLost(from, to));
    if (lost) throw unreadable(`${lost[0]} to ${lost[1]}`);
  }

  const marks = [];
  function link(parts) {
    const { sides, links } = linksOf(parts);
    const names = (side) => side.map((part) => `${part.id}${part.suffix}`).join(' & ');
    links.forEach(({ mark }, i) => {
      for (const from of sides[i])
        for (const to of sides[i + 1]) {
          marks.push({ from: from.id, to: to.id, ...mark });
        }
    });
    if (links.length === 0 && sides[0].every((part) => part.suffix === '')) return [];
    return [
      sides.reduce(
        (text, side, i) =>
          text + (i ? `${links[i - 1].link}${links[i - 1].label} ` : '') + names(side),
        '',
      ),
    ];
  }

  const drawable = [
    `${header[1]} ${header[2] ?? 'TD'}`,
    ...declarations,
    ...written.flatMap(link),
    ...styles,
    ...linkStyles,
  ].join('\n');
  return { drawable, marks };
}
