# truedxf

A TypeScript DXF library — parser, lossless data model and a three.js renderer — whose rendering
aims to match AutoCAD's plot output exactly.

**Status:** early development. See [docs/PLAN.md](docs/PLAN.md) for the plan and
[research/notes](research/notes/README.md) for the DXF knowledge base it builds on.

## Packages

| Package | Purpose |
|---|---|
| `@truedxf/core` | Tokenizer (ASCII + binary DXF), encodings, lossless tag store, tag writer |
| `@truedxf/model` | Lossless typed document: header, tables, blocks, entities, objects, property resolution |
| `@truedxf/geometry` | Vectors, OCS, arcs/ellipses/NURBS, flattening, stroking, dashing, hatching, clipping |
| `@truedxf/fonts` | SHX (shape/unifont/bigfont) parser, writer and compiler; TTF/OTF; AutoCAD font resolution |
| `@truedxf/text` | TEXT and MTEXT parsing and layout |
| `@truedxf/render` | Rendering frontend → renderer-agnostic display list, AutoCAD raster plot emulation |
| `@truedxf/three` | three.js renderer for the display list |
| `@truedxf/viewer` | Embeddable viewer: worker pipeline, pan/zoom, LOD, layouts, layers, picking, measure |
| `@truedxf/testkit` | Visual harness (headless Chromium), CPU rasterizer, metrics, suite scorers |
| `@truedxf/plot` | (placeholder) plot styles CTB/STB — not implemented yet |

Apps: `apps/playground` (Vite: open/drag DXF files, layouts, layers, inspector, measure; fixture
compare and corpus browser over the local `samples/`). Run it with `pnpm playground`.

Tools: `tools/gen` (Python/ezdxf fixture generator), `tools/acad` (AutoCAD reference harness),
`tools/corpus` (corpus runners, ezdxf differential oracle).

## Development

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm lint
pnpm playground                        # viewer app on http://localhost:5173
pnpm corpus:tags / corpus:model        # parse the local corpus (samples/external)
pnpm test:visual --suite lines-curves  # three.js in headless Chromium vs AutoCAD references
node packages/testkit/src/cpu-suite.ts <suite> --quiet   # fast CPU scorer
```

Samples, fixtures and AutoCAD references live in `samples/` and are local only.

Contributor and agent conventions: [AGENTS.md](AGENTS.md).

## License

MIT
