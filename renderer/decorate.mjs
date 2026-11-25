// Draws onto beautiful-mermaid's SVG what it has no notion of: other arrow ends, links and notes with no
// arrow, choices and bars, the participants' boxes and the title.
const MARKERS = `
  <marker id="end-x" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
    <path d="M2 2 L8 8 M8 2 L2 8" stroke="var(--_arrow)" stroke-width="1.5" fill="none" />
  </marker>
  <marker id="end-o" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
    <circle cx="5" cy="5" r="3" stroke="var(--_arrow)" stroke-width="1.2" fill="var(--bg)" />
  </marker>`;
const HEADING = 24;
const BOX_MARGIN = 10;
const BOX_FONT = 12;
const TITLE_FONT = 14;
const ACTOR_HALF_WIDTH = 30;

export const NOTE_FONT = 11;
// The height of a class with no members holds so many.
export const NOTE_LINES = 3;
const NOTE_LINE = 14;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text) => text.replace(/[&<>"]/g, (c) => ESCAPES[c]);
// Wide characters take the font's size, the others little more than half of it.
export const widthOf = (text, size) =>
  [...text].reduce((width, c) => width + (c > '\u2e7f' ? size : size * 0.6), 0);
const attribute = (tag, name) => Number(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)[1]);

function decorateLinks(svg, marks) {
  const seen = new Map();
  const markOf = (tag) => {
    const key = /data-from="[^"]*" data-to="[^"]*"/.exec(tag)[0];
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return marks.filter(({ from, to }) => key === `data-from="${from}" data-to="${to}"`)[nth];
  };
  return svg.replace(/<polyline class="edge"[^>]*>/g, (tag) => {
    const mark = markOf(tag);
    if (!mark) return tag;
    if (mark.isHidden) return '';
    let out = tag;
    if ('xo'.includes(mark.end || '-'))
      out = out.replace(/marker-end="[^"]*"/, `marker-end="url(#end-${mark.end})"`);
    if ('xo'.includes(mark.start || '-'))
      out = out.replace(/marker-start="[^"]*"/, `marker-start="url(#end-${mark.start})"`);
    if (mark.isNote) out = out.replace(/marker-end="[^"]*"/, 'stroke-dasharray="3 3"');
    return out;
  });
}

function decorateNodes(svg, kinds) {
  return svg.replace(/<g class="node" data-id="([^"]*)"[\s\S]*?<\/g>/g, (node, id) => {
    const kind = kinds.get(id);
    const rect = /<rect[^>]*>/.exec(node)?.[0];
    if (!kind || !rect) return node;
    if (kind === 'note')
      return node.replace(rect, rect.replace(/stroke-width="[^"]*"/, '$& stroke-dasharray="3 3"'));
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => attribute(rect, name));
    const drawn =
      kind === 'choice'
        ? `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="var(--_node-fill)" stroke="var(--_node-stroke)" />`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--_line)" />`;
    return node.replace(/>[\s\S]*<\/g>$/, `>${drawn}</g>`);
  });
}

// The library ends a link at a node's box: bring it on to the choice's slanted side.
function meetChoices(svg, kinds) {
  const sizes = new Map();
  for (const [, id, rect] of svg.matchAll(
    /<g class="node" data-id="([^"]*)"[^>]*>\s*(<rect[^>]*>)/g,
  )) {
    if (kinds.get(id) !== 'choice') continue;
    sizes.set(
      id,
      ['x', 'y', 'width', 'height'].map((name) => attribute(rect, name)),
    );
  }
  const meet = (point, size) => {
    if (!size) return point;
    const [x, y, w, h] = size;
    const [cx, cy] = [x + w / 2, y + h / 2];
    const [px, py] = point.split(',').map(Number);
    const isBeside = Math.abs(px - cx) / w > Math.abs(py - cy) / h;
    return isBeside
      ? `${cx + Math.sign(px - cx) * (w / 2) * (1 - Math.abs(py - cy) / (h / 2))},${py}`
      : `${px},${cy + Math.sign(py - cy) * (h / 2) * (1 - Math.abs(px - cx) / (w / 2))}`;
  };
  return svg.replace(
    /(<polyline class="edge" data-from="([^"]*)" data-to="([^"]*)"[^>]*points=")([^"]*)"/g,
    (_, head, from, to, text) => {
      const points = text.split(' ');
      points[0] = meet(points[0], sizes.get(from));
      points[points.length - 1] = meet(points.at(-1), sizes.get(to));
      return `${head}${points.join(' ')}"`;
    },
  );
}

function decorateMessages(svg, ends) {
  let nth = 0;
  return svg.replace(/<g class="message"[\s\S]*?<\/g>/g, (message) => {
    const end = ends[nth++];
    if (end === 'hidden') return '';
    return end === 'x'
      ? message.replace(/marker-end="[^"]*"/, 'marker-end="url(#end-x)"')
      : message;
  });
}

const CLASS_NODE = /<g class="class-node" data-id="([^"]*)"[^>]*>\s*(<rect[^>]*>)[\s\S]*?<\/g>/g;

function decorateClassNotes(svg, notes) {
  return svg
    .replace(CLASS_NODE, (node, id, rect) => {
      const lines = notes.get(id);
      if (!lines) return node;
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => attribute(rect, name));
      const first = y + h / 2 - ((lines.length - 1) * NOTE_LINE) / 2;
      const text = lines.map(
        (line, i) =>
          `<text x="${x + w / 2}" y="${first + i * NOTE_LINE}" dy="4" text-anchor="middle" font-size="${NOTE_FONT}" fill="var(--_text)">${escape(line)}</text>`,
      );
      return `<g>${rect.replace('/>', 'stroke-dasharray="3 3" />')}${text.join('')}</g>`;
    })
    .replace(/<polyline class="class-relationship"[^>]*>/g, (tag) =>
      notes.has(/data-to="([^"]*)"/.exec(tag)[1])
        ? tag.replace(/marker-end="[^"]*"/, 'stroke-dasharray="3 3"')
        : tag,
    );
}

function decorateNamespaces(svg, namespaces) {
  if (namespaces.length === 0) return svg;
  const nodes = [...svg.matchAll(CLASS_NODE)].map(([, id, rect]) => {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => attribute(rect, name));
    return { id, left: x, top: y, right: x + w, bottom: y + h };
  });
  const meets = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const frames = namespaces.map(({ title, ids }) => {
    const own = nodes.filter(({ id }) => ids.includes(id));
    const left = Math.min(...own.map((node) => node.left));
    const right = Math.max(...own.map((node) => node.right));
    const needed = left + widthOf(title, BOX_FONT);
    const frame = {
      title,
      left: left - BOX_MARGIN,
      right: Math.max(right, needed) + BOX_MARGIN,
      top: Math.min(...own.map((node) => node.top)) - HEADING,
      bottom: Math.max(...own.map((node) => node.bottom)) + BOX_MARGIN,
    };
    if (nodes.some((node) => !ids.includes(node.id) && meets(node, frame)))
      throw new Error(`mermaid: the namespace "${title}" lies around other classes`);
    return frame;
  });
  if (frames.some((a, i) => frames.slice(i + 1).some((b) => meets(a, b))))
    throw new Error('mermaid: namespaces that overlap');
  const drawn = frames.map(
    ({ title, left, right, top, bottom }) =>
      `<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="none" stroke="var(--_line)" /><text x="${left + BOX_MARGIN}" y="${top + HEADING / 2}" dy="4" font-size="${BOX_FONT}" fill="var(--_text-sec)">${escape(title)}</text>`,
  );
  const [whole, x, y, width, height] = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(svg);
  const from = Math.min(Number(x), ...frames.map(({ left }) => left - BOX_MARGIN));
  const to = Math.max(Number(x) + Number(width), ...frames.map(({ right }) => right + BOX_MARGIN));
  const top = Math.min(Number(y), ...frames.map((frame) => frame.top - BOX_MARGIN));
  const bottom = Math.max(
    Number(y) + Number(height),
    ...frames.map((frame) => frame.bottom + BOX_MARGIN),
  );
  return svg
    .replace(whole, `viewBox="${from} ${top} ${to - from} ${bottom - top}"`)
    .replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, '$1')
    .replace('</defs>', () => `</defs>${drawn.join('')}`);
}

function decorateFrame(svg, { title, boxes }) {
  if (!title && boxes.length === 0) return svg;
  const [whole, x, y, width, height] = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(svg);
  const above = (title ? HEADING : 0) + (boxes.length > 0 ? HEADING : 0) + BOX_MARGIN;
  const top = Number(y) - above;
  const drawn = [];
  if (title) {
    drawn.push(
      `<text x="${Number(x) + width / 2}" y="${top + HEADING / 2}" dy="5" text-anchor="middle" font-size="${TITLE_FONT}" font-weight="600" fill="var(--_text)">${escape(title)}</text>`,
    );
  }
  const centers = new Map(
    [...svg.matchAll(/<line class="lifeline" data-actor="([^"]*)" x1="([^"]*)"/g)].map(
      ([, id, at]) => [id, Number(at)],
    ),
  );
  const extents = [];
  for (const box of boxes) {
    const sides = box.actors.map((id) => {
      const center = centers.get(id);
      if (center === undefined) throw new Error(`mermaid: box names no participant "${id}"`);
      const actor = svg.split(`<g class="actor" data-id="${id}"`)[1].split('</g>')[0];
      const rect = /<rect[^>]*>/.exec(actor)?.[0];
      const half = rect ? attribute(rect, 'width') / 2 : ACTOR_HALF_WIDTH;
      return [center - half, center + half];
    });
    const half = widthOf(box.title, BOX_FONT) / 2;
    const inner = [Math.min(...sides.map(([at]) => at)), Math.max(...sides.map(([, at]) => at))];
    const middle = (inner[0] + inner[1]) / 2;
    const left = Math.min(inner[0] - BOX_MARGIN, middle - half);
    const right = Math.max(inner[1] + BOX_MARGIN, middle + half);
    const isOutsider = ([id, at]) => !box.actors.includes(id) && at >= left && at <= right;
    if ([...centers].some(isOutsider)) throw new Error('mermaid: a box around other participants');
    if (extents.some(([from, to]) => left < to && right > from))
      throw new Error('mermaid: boxes that overlap');
    extents.push([left, right]);
    const boxTop = Number(y) - HEADING;
    drawn.push(
      `<rect x="${left}" y="${boxTop}" width="${right - left}" height="${Number(height) + HEADING}" fill="none" stroke="var(--_inner-stroke)" />`,
      `<text x="${middle}" y="${boxTop + HEADING / 2}" dy="4" text-anchor="middle" font-size="${BOX_FONT}" fill="var(--_text-sec)">${escape(box.title)}</text>`,
    );
  }
  const half = widthOf(title ?? '', TITLE_FONT) / 2;
  const middle = Number(x) + width / 2;
  const from = Math.min(Number(x), middle - half, ...extents.map(([at]) => at)) - BOX_MARGIN;
  const to =
    Math.max(Number(x) + Number(width), middle + half, ...extents.map(([, at]) => at)) + BOX_MARGIN;
  const grown = `viewBox="${from} ${top} ${to - from} ${Number(height) + above}"`;
  return svg
    .replace(whole, grown)
    .replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, '$1')
    .replace('</defs>', () => `</defs>${drawn.join('\n')}`);
}

export const nothing = () => ({
  marks: [],
  kinds: new Map(),
  ends: [],
  title: undefined,
  boxes: [],
  classNotes: new Map(),
  namespaces: [],
});

export function decorate(svg, extras) {
  const marked = svg
    .replace('</defs>', `${MARKERS}\n</defs>`)
    // Drawn pointing back already, the library's start arrow must not be turned again, into its node.
    .replace(/(<marker id="arrowhead-start"[^>]*)orient="auto-start-reverse"/g, '$1orient="auto"');
  const { marks, kinds, ends, title, boxes, classNotes, namespaces } = extras;
  const steps = [
    (text) => decorateLinks(text, marks),
    (text) => meetChoices(text, kinds),
    (text) => decorateNodes(text, kinds),
    (text) => decorateMessages(text, ends),
    // Namespaces are measured on the classes as the library drew them.
    (text) => decorateNamespaces(text, namespaces),
    (text) => decorateClassNotes(text, classNotes),
    (text) => decorateFrame(text, { title, boxes }),
  ];
  return steps.reduce((text, step) => step(text), marked);
}
