export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'mermaid'; text: string; source: string }
  | { kind: 'image'; text: string; path: string; alt: string };

export const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|avif|heic|pdf)$/i;

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*(\S*)/;
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)\s*$/;
const REMOTE = /^(?!file:)[a-z][\w+.-]+:/i;

export function localPath(href: string): string {
  if (!href.startsWith('file://')) return href;
  try {
    return decodeURIComponent(href.slice('file://'.length));
  } catch {
    return href.slice('file://'.length);
  }
}

// A reply cut into text and the top-level blocks drawn as pictures. An unclosed fence stays text.
export function segmentsOf(reply: string): Segment[] {
  const segments: Segment[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.join('').trim() !== '')
      segments.push({ kind: 'text', text: text.join('\n').replace(/^\n+|\n+$/g, '') });
    text = [];
  };
  const lines = reply.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2] ?? '';
      const closing = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !closing.test(lines[end] ?? '')) end++;
      const block = lines.slice(i, end + 1);
      if (fence[3]?.toLowerCase() === 'mermaid' && end < lines.length) {
        flush();
        segments.push({
          kind: 'mermaid',
          text: block.join('\n'),
          source: block.slice(1, -1).join('\n'),
        });
      } else {
        text.push(...block);
      }
      i = end;
      continue;
    }
    const image = IMAGE_LINE.exec(line);
    const href = image?.[2] ?? image?.[3] ?? '';
    if (image && !REMOTE.test(href) && IMAGE.test(href)) {
      flush();
      segments.push({ kind: 'image', text: line, path: localPath(href), alt: image[1] || href });
    } else {
      text.push(line);
    }
  }
  flush();
  return segments;
}

// Paths a message names in inline code, in a link or after an @, each once, without a :line suffix.
export function pathsIn(text: string): string[] {
  const prose = text.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1\s*$/gm, '');
  const found = new Set<string>();
  for (const m of prose.matchAll(
    /`([^`\n]+)`|\]\(<?([^)>\s]+)>?\)|(?:^|\s)@([^\s`]+)|(?:^|[\s(（：:])((?:~|\.{0,2})\/[^\s`)）,，;；。"']+)/gm,
  )) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    const path = localPath(raw.replace(/[,.;:，。；：]+$/, '')).replace(
      /(:\d+(-\d+)?)+$|#L\d+.*$/,
      '',
    );
    if (path === '' || /\s{2,}|[*?<>|$]/.test(path) || REMOTE.test(path)) continue;
    if (path.includes('/') || /\.\w{1,8}$/.test(path)) found.add(path);
  }
  return [...found];
}
