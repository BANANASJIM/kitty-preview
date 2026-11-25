# kitty-preview

A lightweight [Claude Code](https://code.claude.com) mod for [kitty](https://sw.kovidgoyal.net/kitty/). It draws through the kitty graphics protocol, with no browser.

- **Mermaid**: a closed `mermaid` block in a reply becomes a picture, in kitty's own colors. Flowchart, sequence, state, class, ER and xychart; any other kind, and a diagram too large or not fully readable, stays source.
- **Images**: local images in replies (`![alt](path)`), images Claude reads, and images pasted into the prompt are drawn inline. PDFs show their first page.
- **Hover previews**: files named in a message, or touched by a Read, Edit or Write call, get a card on hover with the head of the file, the picture, or the directory listing.

## Requirements

Linux, kitty, Claude Code 2.1.331 or later in the fullscreen layout (hover needs it), not inside tmux. `node`, `rsvg-convert` (librsvg) and `magick` (ImageMagick) on `PATH`; `pdftoppm` (poppler) for PDFs.

## Install

At the prompt of a Claude Code session:

```
/plugin install kitty-preview --marketplace BANANASJIM/kitty-preview
```

## How it works

`hooks/register.tsx` draws the rows. `bin/render.mjs` makes the PNGs and keeps them in `$XDG_RUNTIME_DIR/claude-kitty-preview`. `bin/probe.py` asks kitty for its colors and cell size. Nothing is sent over the network.

## Development

```
claude plugin test .
claude --plugin-dir .
npm ci --ignore-scripts && npm run build   # rebuild bin/vendor, needs bun
```

Bundled libraries: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). License: [MIT](LICENSE).
