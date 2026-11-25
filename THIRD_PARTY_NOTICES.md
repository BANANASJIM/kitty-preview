# Third-party notices

`renderer/vendor/beautiful-mermaid.mjs` is built by `npm run build` from the versions pinned in `package-lock.json`. [`scripts/build.mjs`](scripts/build.mjs) changes how beautiful-mermaid's layout breaks loops and places edges between groups; the rest is unmodified:

| Library           | Version | License                                          | Source                                        |
| ----------------- | ------- | ------------------------------------------------ | --------------------------------------------- |
| beautiful-mermaid | 1.1.3   | [MIT](renderer/vendor/LICENSE.beautiful-mermaid) | https://github.com/lukilabs/beautiful-mermaid |
| elkjs             | 0.11.1  | [EPL-2.0](renderer/vendor/LICENSE.elkjs.md)      | https://github.com/kieler/elkjs               |
| entities          | 7.0.1   | [BSD-2-Clause](renderer/vendor/LICENSE.entities) | https://github.com/fb55/entities              |
