// librsvg reads neither var() nor color-mix(), which beautiful-mermaid's SVG is colored with: resolve both.
const HEX = /^#([0-9a-f]{6})$/i;
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(HEX.exec(hex)[1].slice(i, i + 2), 16));
const toHex = (channels) =>
  '#' + channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

// `name(...)` at `start`: its arguments split at top-level commas, and where it ends.
function call(text, start) {
  const args = [];
  let depth = 0;
  let from = text.indexOf('(', start) + 1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')' && depth-- === 0)
      return { args: [...args, text.slice(from, i)], end: i + 1 };
    else if (c === ',' && depth === 0) {
      args.push(text.slice(from, i));
      from = i + 1;
    }
  }
  throw new Error('unbalanced CSS function');
}

function evaluate(value, vars) {
  let out = value.trim();
  for (let m; (m = /var\(|color-mix\(/.exec(out));) {
    const { args, end } = call(out, m.index);
    let replacement;
    if (m[0] === 'var(') {
      const name = args[0].trim();
      const next = vars.get(name) ?? args.slice(1).join(',');
      replacement = next === '' ? 'none' : evaluate(next, vars);
    } else {
      const [a, share] = /^(.*?)\s+([\d.]+)%$/.exec(args[1].trim()).slice(1);
      const first = rgb(evaluate(a, vars));
      const second = rgb(evaluate(args[2].trim().replace(/\s+[\d.]+%$/, ''), vars));
      replacement = toHex(first.map((c, i) => c * (share / 100) + second[i] * (1 - share / 100)));
    }
    out = out.slice(0, m.index) + replacement + out.slice(end);
  }
  return out;
}

const DIAMOND_REF_X = 12;

export function flatten(svg) {
  const vars = new Map();
  const root = /<svg[^>]*\sstyle="([^"]*)"/.exec(svg)?.[1] ?? '';
  const style = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  for (const m of `${style.replace(/\/\*[\s\S]*?\*\//g, '')};${root}`.matchAll(
    /(--[\w-]+)\s*:\s*([^;}]+)/g,
  ))
    vars.set(m[1], m[2]);
  const css = (text) =>
    evaluate(
      text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@import[^;]*\)\s*;/g, '')
        .replace(/(--[\w-]+)\s*:\s*[^;}]+;?/g, ''),
      vars,
    );
  return (
    svg
      .replace(/<style>([\s\S]*?)<\/style>/g, (_, text) => `<style>${css(text)}</style>`)
      .replace(
        /\s(fill|stroke|stop-color|style)="([^"]*)"/g,
        (_, name, value) => ` ${name}="${css(value)}"`,
      )
      // The library anchors these two at the box's edge, where the box covers them.
      .replace(
        /(<marker id="cls-(?:composition|aggregation)"[^>]*?refX=")0"/g,
        (_, head) => `${head}${DIAMOND_REF_X}"`,
      )
  );
}
