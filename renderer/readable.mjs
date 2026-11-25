import { NOTE_FONT, NOTE_LINES, nothing, widthOf } from './decorate.mjs';

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
      line(`${SENDER}\\s*(?:-->>|->>|--\\)|-\\)|--x|-x|-->|->)\\s*[+-]?${NAME}\\s*:\\s*.+`),
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
// A box's first word is a color where CSS knows it, else the start of its name.
const COLOR_NAMES = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue
darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray
lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise
palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent
turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/),
);
const COLOR = /^(?:rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|([a-z]+))(?:\s+|$)/i;
function boxTitle(text) {
  const color = COLOR.exec(text);
  const isColor = color && (color[1] === undefined || COLOR_NAMES.has(color[1].toLowerCase()));
  return isColor ? text.slice(color[0].length) : text;
}
const NAME_CHARACTER = 6;
const said = (text) => text.trim().replaceAll('"', '”');

// Lines rewritten into what the library reads, and what is drawn onto its SVG afterwards.
const REWRITES = {
  sequence(lines, extras) {
    const out = [];
    let box;
    let number;
    let hasMessage = false;
    for (const text of lines) {
      const title = /^title\s*:?\s+(.+)$/.exec(text);
      const boxed = /^box(?:\s+(.*))?$/.exec(text);
      const actor = /^(?:participant|actor)\s+(\S+)/.exec(text);
      if (title) extras.title = title[1];
      else if (text === 'autonumber') number = 1;
      else if (boxed) {
        box = { title: boxTitle(boxed[1] ?? ''), actors: [] };
        extras.boxes.push(box);
      } else if (box && text === 'end') {
        if (box.actors.length === 0) throw unreadable('box');
        box = undefined;
      } else if (box && !actor) {
        throw unreadable(text);
      } else {
        if (box) box.actors.push(actor[1]);
        // The library hangs a note on the message before it: the first of a diagram, a block or a branch gets
        // one that is not drawn.
        if (/^(?:loop|alt|opt|par|critical|break|else|and|end)\b/.test(text)) hasMessage = false;
        const note = /^note\s+(?:left of|right of|over)\s+([^\s,:]+)/i.exec(text);
        if (note && !hasMessage) {
          out.push(`${note[1]}->>${note[1]}: note`);
          extras.ends.push('hidden');
          hasMessage = true;
        }
        if (!KINDS.sequence.lines.at(-1).test(text)) {
          out.push(text);
          continue;
        }
        // The library takes the first -x or -) for the arrow.
        if (/^[^:\s]*?-[x)][^:]*-?->/.test(text)) throw unreadable(text);
        hasMessage = true;
        extras.ends.push(/^[^:]*?--?x/.test(text) && !/^[^:]*?>/.test(text) ? 'x' : '');
        out.push(
          number === undefined
            ? text
            : text.replace(MESSAGE, (_, head, words) => `${head}${number++}. ${words}`),
        );
      }
    }
    if (box) throw unreadable('box');
    return out;
  },

  state(lines, extras) {
    const out = [];
    let notes = 0;
    let depth = 0;
    const addNote = (state, words) => {
      const id = `note_${notes++}`;
      extras.kinds.set(id, 'note');
      extras.marks.push({ from: state, to: id, start: '', end: '', isNote: true });
      out.push(`state "${said(words)}" as ${id}`, `${state} --> ${id}`);
    };
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const pseudo = /^state\s+([\p{L}\p{N}_]+)\s+<<(choice|fork|join)>>$/u.exec(text);
      const note = /^note\s+(?:left|right)\s+of\s+([\p{L}\p{N}_]+)\s*(?::\s*(.+))?$/iu.exec(text);
      if (pseudo) {
        extras.kinds.set(pseudo[1], pseudo[2]);
        out.push(`state "?" as ${pseudo[1]}`);
      } else if (note) {
        const end = note[2]
          ? i
          : lines.findIndex((other, at) => at > i && /^end note$/i.test(other));
        if (end < 0) throw unreadable(text);
        addNote(
          note[1],
          note[2] ??
            lines
              .slice(i + 1, end)
              .map(said)
              .join('<br>'),
        );
        i = end;
      } else {
        // Nested composites are laid out wrong.
        depth += text.endsWith('{') ? 1 : text === '}' ? -1 : 0;
        if (depth > 1) throw unreadable(text);
        out.push(text);
      }
    }
    return out;
  },

  class(lines, extras) {
    let namespace;
    let isMember = false;
    return lines.flatMap((text) => {
      if (isMember) {
        isMember = text !== '}';
        return [text];
      }
      const kind = /^<<(\w+)>>\s+([\p{L}\p{N}_.]+)$/u.exec(text);
      const note = /^note\s+(?:for\s+([\p{L}\p{N}_.]+)\s+)?"([^"]+)"$/u.exec(text);
      const opened = /^namespace\s+(\S+)\s*\{$/.exec(text);
      const declared = /^class\s+([\p{L}\p{N}_.-]+)/u.exec(text);
      isMember = KINDS.class.block.test(text);
      if (opened) {
        if (namespace) throw unreadable(text);
        namespace = { title: opened[1], ids: [] };
        extras.namespaces.push(namespace);
        return [];
      }
      if (namespace && text === '}') {
        if (namespace.ids.length === 0) throw unreadable('namespace');
        namespace = undefined;
        return [];
      }
      if (namespace) {
        if (!declared) throw unreadable(text);
        namespace.ids.push(declared[1]);
      }
      if (note) {
        const words = note[2].split(/\\n|<br\s*\/?>/i).map((part) => part.trim());
        if (words.length > NOTE_LINES) throw unreadable(text);
        // A class is as wide as its name.
        const longest = Math.max(...words.map((part) => widthOf(part, NOTE_FONT)));
        const id = `note_${extras.classNotes.size}_${'0'.repeat(Math.ceil(longest / NAME_CHARACTER))}`;
        extras.classNotes.set(id, words);
        return note[1] ? [`class ${id}`, `${note[1]} -- ${id}`] : [`class ${id}`];
      }
      return kind ? [`class ${kind[2]} {`, `<<${kind[1]}>>`, '}'] : [text];
    });
  },
};

// The library reads a left "}o" only the other way around, and a generic in a relation as another class.
function outsideMembers(kind, text) {
  if (kind === KINDS.er) return text.replace(/^(\S+\s+)\}([o|])(?=--|\.\.)/, '$1$2{');
  if (kind === KINDS.class && !text.startsWith('class ')) return text.replace(/~[^~\s]*~/g, '');
  return text;
}

const unreadable = (text) => new Error(`mermaid: cannot read "${text}"`);

export function readable(source) {
  const lines = source
    .split('\n')
    .map((text) => text.trim())
    .filter((text) => text !== '' && !text.startsWith('%%'));
  const [name, kind] = Object.entries(KINDS).find(([, { header }]) => header.test(lines[0])) ?? [];
  if (!kind) throw new Error(`mermaid: "${lines[0]}" is not drawn`);

  const extras = nothing();
  const rewritten = REWRITES[name]?.(lines.slice(1), extras) ?? lines.slice(1);
  let isMember = false;
  const out = rewritten.map((text) => {
    if (isMember) {
      if (text === '}') isMember = false;
      else if (kind.member && !kind.member.test(text)) throw unreadable(text);
      return text;
    }
    if (kind.block?.test(text)) isMember = true;
    else if (!kind.lines.some((pattern) => pattern.test(text))) throw unreadable(text);
    return outsideMembers(kind, text);
  });
  return { drawable: [lines[0], ...out].join('\n'), extras };
}
