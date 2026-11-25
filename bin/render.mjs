// One JSON request on stdin, one JSON answer on stdout: { file, columns, rows } or { error }.
// A picture fills its cells exactly, padded on the right and below, so the terminal never stretches it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { text as stdin } from 'node:stream/consumers';

// Rows of text one line of diagram label takes, and the SVG units such a line spans.
const LABEL_LINE_UNITS = 17;
const DIAGRAM_PADDING = 8;
const MUTED_SHARE = '75%';
const PDF_DPI = '110';
const SVG_ZOOM = '2';
const RUN_TIMEOUT_MS = 20_000;
const RUN_MAX_BYTES = 64 << 20;
const HEAD_BYTES = 16;
// A picture shrunk below this share of the text's size is left as source.
const MIN_SCALE = 0.4;
const MAX_INPUT_PIXELS = '16384';

const request = JSON.parse(await stdin(process.stdin));
const outDir = join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'claude-kitty-preview');
mkdirSync(outDir, { recursive: true, mode: 0o700 });

const run = (command, args, input) =>
  execFileSync(command, args, {
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: RUN_MAX_BYTES,
  });
const named = (data, extension = 'png') =>
  join(outDir, `${createHash('sha1').update(data).digest('hex')}.${extension}`);

function box(width, height, { cell, maxColumns, maxRows }) {
  const [cellWidth, cellHeight] = cell;
  const scale = Math.min(1, (maxColumns * cellWidth) / width, (maxRows * cellHeight) / height);
  const columns = Math.max(1, Math.min(maxColumns, Math.ceil((width * scale) / cellWidth)));
  const rows = Math.max(1, Math.min(maxRows, Math.ceil((height * scale) / cellHeight)));
  return {
    columns,
    rows,
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    pageWidth: Math.floor(columns * cellWidth),
    pageHeight: Math.floor(rows * cellHeight),
  };
}

async function mermaid({ source, colors, cell, maxColumns, maxRows }) {
  const { renderMermaidSVG } = await import('./vendor/beautiful-mermaid.mjs');
  const { flatten } = await import('./css.mjs');
  const { normalizeFlowchart, unmask } = await import('./flowchart.mjs');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const isFlowchart = /^(?:%%.*\n\s*)*(graph|flowchart)\b/i.test(body);
  const readable = isFlowchart ? normalizeFlowchart(body) : body;
  const svg = unmask(
    flatten(
      renderMermaidSVG(readable, {
        ...colors,
        border: colors.accent,
        muted: `color-mix(in srgb, ${colors.fg} ${MUTED_SHARE}, ${colors.bg})`,
        transparent: true,
        padding: DIAGRAM_PADDING,
        font: 'sans-serif',
      }),
    ),
  );
  // A word the library could not read is left out of its drawing: then the source is the better view.
  const drawn = svg.replace(/<[^>]*>/g, '');
  const lost = [...readable.replace(/%%.*$/gm, '')].find(
    (c) => /\p{L}/u.test(c) && c > '\u007f' && !drawn.includes(c),
  );
  if (lost) throw new Error(`mermaid: "${lost}" was not drawn`);
  const [, w, h] = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const scale = cell[1] / LABEL_LINE_UNITS;
  const fit = box(w * scale, h * scale, { cell, maxColumns, maxRows });
  if (fit.width / (w * scale) < MIN_SCALE) throw new Error('mermaid: too large to read here');
  const file = named(svg + JSON.stringify(fit));
  if (!existsSync(file)) {
    run(
      'rsvg-convert',
      [
        '-w',
        `${fit.width}`,
        '-h',
        `${fit.height}`,
        '--keep-aspect-ratio',
        '--page-width',
        `${fit.pageWidth}`,
        '--page-height',
        `${fit.pageHeight}`,
        '-o',
        file,
      ],
      svg,
    );
  }
  return { file, columns: fit.columns, rows: fit.rows };
}

// magick picks its decoder by content, Ghostscript among them: name the decoder, from this list alone.
function coderOf(head) {
  const ascii = head.toString('latin1');
  if (ascii.startsWith('\x89PNG')) return 'png';
  if (ascii.startsWith('\xff\xd8\xff')) return 'jpeg';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.startsWith('WEBP', 8)) return 'webp';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('II*\0') || ascii.startsWith('MM\0*')) return 'tiff';
  if (/^....ftypavi[fs]/s.test(ascii)) return 'avif';
  if (/^....ftyp(hei|mif1)/s.test(ascii)) return 'heic';
  throw new Error('image: not a kind that is drawn');
}

function headOf(path) {
  const head = Buffer.alloc(HEAD_BYTES);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  return head;
}

function image({ path, base64, stamp, cell, maxColumns, maxRows }) {
  let source = path;
  if (base64 !== undefined) {
    source = named(base64, 'bin');
    if (!existsSync(source)) writeFileSync(source, Buffer.from(base64, 'base64'));
  } else if (/\.(pdf|svg)$/i.test(path)) {
    source = named(`${path}\0${stamp}`);
    if (!existsSync(source)) {
      if (/\.svg$/i.test(path)) run('rsvg-convert', ['--zoom', SVG_ZOOM, '-o', source, path]);
      else
        run('pdftoppm', [
          '-png',
          '-singlefile',
          '-f',
          '1',
          '-l',
          '1',
          '-r',
          PDF_DPI,
          path,
          source.slice(0, -4),
        ]);
    }
  }
  const input = `${coderOf(headOf(source))}:${source}[0]`;
  const limits = ['-limit', 'width', MAX_INPUT_PIXELS, '-limit', 'height', MAX_INPUT_PIXELS];
  const size = run('magick', [
    ...limits,
    input,
    '-auto-orient',
    '-format',
    '%w %h',
    'info:',
  ]).toString();
  const [w, h] = size.split(' ').map(Number);
  const fit = box(w, h, { cell, maxColumns, maxRows });
  const file = named(JSON.stringify([source, stamp, fit]));
  if (!existsSync(file)) {
    run('magick', [
      ...limits,
      input,
      '-auto-orient',
      '-resize',
      `${fit.width}x${fit.height}`,
      '-background',
      'none',
      '-gravity',
      'northwest',
      '-extent',
      `${fit.pageWidth}x${fit.pageHeight}`,
      `png:${file}`,
    ]);
  }
  return { file, columns: fit.columns, rows: fit.rows };
}

let answer;
try {
  answer = request.kind === 'mermaid' ? await mermaid(request) : image(request);
} catch (error) {
  answer = {
    error: String(error?.stderr?.toString().trim() || error?.message || error).split('\n')[0],
  };
}
process.stdout.write(JSON.stringify(answer));
