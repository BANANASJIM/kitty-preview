import type { EngineInterface, Register } from 'claude-code';

import { IMAGE, pathsIn, segmentsOf } from './parse';

const CARD = { maxColumns: 90, textRows: 16, imageRows: 14, readBytes: 8192, dirEntries: 14 };
const INLINE = { maxColumns: 100, maxRows: 24 };
const CHIPS = 6;
const REMEMBERED = 4000;
const REPLY_INDENT = 2;
const FALLBACK_COLUMNS = 80;
const CARD_FRAME = 4;
const CARD_MARGIN = 8;
const CARD_MIN_COLUMNS = 10;
const BULLET = '●';
const DEFAULT_CELL: [number, number] = [1, 2];

const WRITING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const FILE_TOOLS = new Set(['Read', ...WRITING_TOOLS]);

type Picture = { file: string; columns: number; rows: number };
type Preview =
  | { kind: 'text'; path: string; name: string; body: string }
  | { kind: 'image'; path: string; name: string; picture: Picture };
type Terminal = { bg?: string; fg?: string; accent?: string; cell?: [number, number] | null };

// A result asked for while drawing: undefined until the work lands, which redraws.
const landed = new Map<string, unknown>();
const pending = new Set<string>();
// Landed, but its file changed since: still drawn, until the work run again lands.
const stale = new Set<string>();

function once<T>($: EngineInterface, key: string, work: () => Promise<T>): T | undefined {
  if (landed.has(key) && !stale.has(key)) {
    const value = landed.get(key) as T;
    landed.delete(key);
    landed.set(key, value);
    return value;
  }
  stale.delete(key);
  if (!pending.has(key)) {
    pending.add(key);
    void work()
      .catch((error) => {
        $.ui.log(`${key.slice(0, 80)}: ${String(error)}`);
        return undefined as T | undefined;
      })
      .then((value) => {
        landed.set(key, value);
        if (landed.size > REMEMBERED) landed.delete(landed.keys().next().value as string);
        pending.delete(key);
        $.ui.invalidate('ui.render');
      });
  }
  return landed.get(key) as T | undefined;
}

let probing: Promise<Terminal> | undefined;
function terminal($: EngineInterface): Promise<Terminal> {
  probing ??= $.process
    .run(['kitty', '+launch', `${$.plugin.root}/bin/probe.py`])
    .then(({ exitCode, stdout }) => (exitCode === 0 ? (JSON.parse(stdout) as Terminal) : {}))
    .catch(() => ({}));
  return probing;
}

async function render($: EngineInterface, request: Record<string, unknown>): Promise<Picture> {
  const { cell, bg, fg, accent } = await terminal($);
  const { stdout, stderr, exitCode } = await $.process.run(
    ['node', `${$.plugin.root}/bin/render.mjs`],
    {
      stdin: JSON.stringify({ ...request, cell: cell ?? DEFAULT_CELL, colors: { bg, fg, accent } }),
    },
  );
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n').pop());
  const answer = JSON.parse(stdout) as Picture & { error?: string };
  if (answer.error !== undefined) throw new Error(answer.error);
  return answer;
}

async function absolute($: EngineInterface, path: string): Promise<string> {
  if (path.startsWith('/')) return path;
  if (path.startsWith('~/')) return `${(await $.env.get('HOME')) ?? ''}${path.slice(1)}`;
  return `${await $.session.cwd()}/${path.replace(/^\.\//, '')}`;
}

async function pictureOf(
  $: EngineInterface,
  path: string,
  maxColumns: number,
  maxRows: number,
): Promise<Picture> {
  const file = await absolute($, path);
  const { kind, mtimeMs, size } = await $.fs.stat(file);
  if (kind !== 'file') throw new Error(`${file} is not a file`);
  return render($, { kind: 'image', path: file, stamp: `${mtimeMs}-${size}`, maxColumns, maxRows });
}

const printable = (text: string) =>
  text.replace(/\t/g, '  ').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');

async function previewOf(
  $: EngineInterface,
  path: string,
  columns: number,
): Promise<Preview | undefined> {
  const file = await absolute($, path);
  if (!(await $.fs.exists(file))) return undefined;
  const { kind, size } = await $.fs.stat(file);
  const name = path.replace(/\/+$/, '').split('/').pop() ?? path;
  if (kind === 'dir') {
    const entries = await $.fs.list(file);
    const shown = entries
      .slice(0, CARD.dirEntries)
      .map((entry) => entry.name + (entry.kind === 'dir' ? '/' : ''));
    const more = entries.length - shown.length;
    const body = [...shown, ...(more > 0 ? [`… +${more}`] : [])].join('\n');
    return { kind: 'text', path: file, name: `${name}/`, body: printable(body) };
  }
  if (kind !== 'file') return undefined;
  if (IMAGE.test(file)) {
    return {
      kind: 'image',
      path: file,
      name,
      picture: await pictureOf($, file, columns, CARD.imageRows),
    };
  }
  const head = await $.fs.read(file, { offset: 0, length: CARD.readBytes });
  const lines = head.includes('\0')
    ? [`${size} bytes, binary`]
    : printable(head).trimEnd().split('\n');
  return { kind: 'text', path: file, name, body: lines.slice(0, CARD.textRows).join('\n') };
}

const filePathOf = (input: unknown): string | undefined => {
  const { file_path, notebook_path } = (input ?? {}) as {
    file_path?: unknown;
    notebook_path?: unknown;
  };
  const path = file_path ?? notebook_path;
  return typeof path === 'string' ? path : undefined;
};

// Images pasted into a prompt, by its text: a message row carries no bytes.
const pasted = new Map<string, string[]>();

async function mediaOf($: EngineInterface, id: string): Promise<string | undefined> {
  let base64 = '';
  for (let offset: number | undefined = 0; offset !== undefined; ) {
    const part = await $.prompt.media({ id, offset });
    if (part.type !== 'image') return undefined;
    base64 += part.base64;
    offset = part.next;
  }
  return base64;
}

// The `ui.render` arguments the drawing helpers need, whichever component is drawn.
type Drawing = { Box: any; Text: any; Image: any; columns: number };

function cardColumns(columns: number): number {
  return Math.max(CARD_MIN_COLUMNS, Math.min(CARD.maxColumns, columns - CARD_MARGIN));
}

// A hover group's name holds at most 64 characters: the site's id and a hash of the path.
function scopeOf(site: string, path: string): string {
  let hash = 0;
  for (const c of path) hash = (Math.imul(hash, 31) + (c.codePointAt(0) ?? 0)) | 0;
  return `${site.slice(-48)}:${(hash >>> 0).toString(36)}`;
}

// Floats above its row: a row below is drawn later and would cover it.
function card({ Box, Text, Image, columns }: Drawing, preview: Preview, scope: string) {
  const width =
    preview.kind === 'image'
      ? Math.min(cardColumns(columns), Math.max(preview.picture.columns, preview.path.length))
      : cardColumns(columns);
  return (
    <Box
      position="absolute"
      bottom={1}
      left={REPLY_INDENT}
      width={width + CARD_FRAME}
      display="none"
      hover={{ display: 'flex', scope }}
      flexDirection="column"
      borderStyle="round"
      borderColor="suggestion"
      backgroundColor="userMessageBackground"
      paddingX={1}
    >
      <Text dimColor wrap="truncate-start">
        {preview.path}
      </Text>
      {preview.kind === 'image' ? (
        <Image
          source={{ file: preview.picture.file, format: 'png' }}
          columns={preview.picture.columns}
          rows={preview.picture.rows}
          alt={preview.name}
        />
      ) : (
        preview.body
          .split('\n')
          .map((line) => <Text wrap="truncate-end">{line === '' ? ' ' : line}</Text>)
      )}
    </Box>
  );
}

function chips($: EngineInterface, drawing: Drawing, site: string, paths: readonly string[]) {
  const { Box, Text, columns } = drawing;
  const previews: Preview[] = [];
  for (const path of paths) {
    if (previews.length === CHIPS) break;
    const preview = once($, `preview\0${path}\0${columns}\0${site}`, () =>
      previewOf($, path, cardColumns(columns)),
    );
    if (preview && !previews.some((other) => other.path === preview.path)) previews.push(preview);
  }
  if (previews.length === 0) return undefined;
  return (
    <Box key="chips" paddingLeft={REPLY_INDENT} columnGap={2}>
      {previews.map((preview) => (
        <Text
          dimColor
          wrap="truncate-end"
          hover={{ color: 'suggestion', underline: true, scope: scopeOf(site, preview.path) }}
        >
          ▸ {preview.name}
        </Text>
      ))}
      {previews.map((preview) => card(drawing, preview, scopeOf(site, preview.path)))}
    </Box>
  );
}

function inlineImage(
  $: EngineInterface,
  { Box, Image, columns }: Drawing,
  site: string,
  path: string,
  alt: string,
) {
  const maxColumns = Math.min(INLINE.maxColumns, columns - REPLY_INDENT - 2);
  const picture = once($, `image\0${path}\0${maxColumns}\0${site}`, () =>
    pictureOf($, path, maxColumns, INLINE.maxRows),
  );
  return (
    picture && (
      <Box paddingLeft={REPLY_INDENT}>
        <Image
          source={{ file: picture.file, format: 'png' }}
          columns={picture.columns}
          rows={picture.rows}
          alt={alt}
        />
      </Box>
    )
  );
}

export const register: Register = (on) => {
  on('session.start', ($, e, next) => {
    void terminal($);
    return next(e);
  });

  on('prompt.submit', async ($, e, next) => {
    const ids = (e.attachments ?? []).flatMap(({ type, id }) =>
      type === 'image' && id !== undefined ? [id] : [],
    );
    if (ids.length > 0) {
      const images = await Promise.all(ids.map((id) => mediaOf($, id).catch(() => undefined)));
      pasted.set(
        e.text,
        images.filter((image) => image !== undefined),
      );
    }
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    const result = await next(e);
    const path = WRITING_TOOLS.has(e.tool) ? filePathOf(e) : undefined;
    if (path !== undefined) {
      const file = await absolute($, path);
      for (const [key, value] of landed) {
        if ((value as Preview | undefined)?.path === file || key.split('\0')[1] === path)
          stale.add(key);
      }
      $.ui.invalidate('ui.render');
    }
    return result;
  });

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e);
    const { Box, Text, Image, Markdown } = $.ui.resolve(e);
    const columns = e.viewport?.columns ?? FALLBACK_COLUMNS;
    const drawing: Drawing = { Box, Text, Image, columns };
    const maxColumns = Math.min(INLINE.maxColumns, columns - REPLY_INDENT - 2);

    const parts = segmentsOf(e.props.text).map((segment) => {
      const picture =
        segment.kind === 'mermaid'
          ? once($, `mermaid\0${segment.source}\0${maxColumns}`, () =>
              render($, {
                kind: 'mermaid',
                source: segment.source,
                maxColumns,
                maxRows: INLINE.maxRows * 2,
              }),
            )
          : segment.kind === 'image'
            ? once($, `image\0${segment.path}\0${maxColumns}\0${e.requestId}`, () =>
                pictureOf($, segment.path, maxColumns, INLINE.maxRows),
              )
            : undefined;
      return {
        text: segment.text,
        alt: segment.kind === 'image' ? segment.alt : 'mermaid',
        picture,
      };
    });
    const footer = chips($, drawing, e.requestId, pathsIn(e.props.text));
    if (!parts.some((part) => part.picture)) {
      const own = await next(e);
      return footer ? (
        <Box flexDirection="column">
          {own}
          {footer}
        </Box>
      ) : (
        own
      );
    }

    const opening = parts[0]?.picture ? undefined : parts.shift();
    const first = opening && (await next({ ...e, props: { ...e.props, text: opening.text } }));
    return (
      <Box flexDirection="column">
        {first ?? (
          <Box marginTop={1}>
            <Text>{e.props.isFirstOfReply ? BULLET : ' '}</Text>
          </Box>
        )}
        {parts.map(({ text, alt, picture }) => (
          <Box paddingLeft={REPLY_INDENT} marginTop={1}>
            {picture ? (
              <Image
                source={{ file: picture.file, format: 'png' }}
                columns={picture.columns}
                rows={picture.rows}
                alt={alt}
              />
            ) : (
              <Markdown text={text} />
            )}
          </Box>
        ))}
        {footer}
      </Box>
    );
  });

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind === 'task-notification') return next(e);
    const { Box, Text, Image } = $.ui.resolve(e);
    const drawing: Drawing = { Box, Text, Image, columns: e.viewport?.columns ?? FALLBACK_COLUMNS };
    const maxColumns = Math.min(INLINE.maxColumns, drawing.columns - REPLY_INDENT - 2);
    const pictures = (pasted.get(e.props.text) ?? []).flatMap((base64) => {
      const picture = once($, `pasted\0${base64.length}\0${base64.slice(-64)}\0${maxColumns}`, () =>
        render($, { kind: 'image', base64, maxColumns, maxRows: CARD.imageRows }),
      );
      return picture ? [picture] : [];
    });
    const footer = chips($, drawing, e.requestId, pathsIn(e.props.text));
    if (pictures.length === 0 && !footer) return next(e);
    return (
      <Box flexDirection="column">
        {await next(e)}
        {pictures.map(({ file, columns, rows }) => (
          <Box paddingLeft={REPLY_INDENT}>
            <Image
              source={{ file, format: 'png' }}
              columns={columns}
              rows={rows}
              alt="pasted image"
            />
          </Box>
        ))}
        {footer}
      </Box>
    );
  });

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const path = FILE_TOOLS.has(e.props.tool) ? filePathOf(e.props.input) : undefined;
    if (
      e.surface !== 'terminal' ||
      path === undefined ||
      e.props.output === undefined ||
      e.props.isErrored
    )
      return next(e);
    const { Box, Text, Image } = $.ui.resolve(e);
    const drawing: Drawing = { Box, Text, Image, columns: e.viewport?.columns ?? FALLBACK_COLUMNS };
    const preview = once($, `preview\0${path}\0${drawing.columns}\0${e.requestId}`, () =>
      previewOf($, path, cardColumns(drawing.columns)),
    );
    const picture =
      e.props.tool !== 'Edit' && IMAGE.test(path)
        ? inlineImage($, drawing, e.requestId, path, path)
        : undefined;
    if (!preview && !picture) return next(e);
    const scope = scopeOf(e.requestId, path);
    return (
      <Box flexDirection="column">
        <Box key="row" flexDirection="column" hover={{ scope }}>
          {await next(e)}
          {preview && !picture ? card(drawing, preview, scope) : undefined}
        </Box>
        {picture}
      </Box>
    );
  });

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.isActive) return next(e);
    const { Box, Text, Image } = $.ui.resolve(e);
    const drawing: Drawing = { Box, Text, Image, columns: e.viewport?.columns ?? FALLBACK_COLUMNS };
    const paths = e.props.calls.flatMap((call) =>
      FILE_TOOLS.has(call.tool) && !call.isErrored ? (filePathOf(call.input) ?? []) : [],
    );
    const unique = [...new Set(paths)];
    const pictures = unique
      .filter((path) => IMAGE.test(path))
      .flatMap((path) => inlineImage($, drawing, e.requestId, path, path) ?? []);
    const footer = chips(
      $,
      drawing,
      e.requestId,
      unique.filter((path) => !IMAGE.test(path)),
    );
    if (pictures.length === 0 && !footer) return next(e);
    return (
      <Box flexDirection="column">
        {await next(e)}
        {footer}
        {pictures}
      </Box>
    );
  });
};
