# truedxf

A TypeScript DXF library — parser, lossless data model and a three.js renderer — whose rendering
aims to match AutoCAD's plot output exactly.

**Status:** early development. See [docs/PLAN.md](docs/PLAN.md) for the plan and
[research/notes](research/notes/README.md) for the DXF knowledge base it builds on.

## Packages

| Package | Purpose |
|---|---|
| `@truedxf/core` | Tokenizer (ASCII + binary DXF), encodings, lossless tag store, tag writer |

## Development

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm lint
```

Contributor and agent conventions: [AGENTS.md](AGENTS.md).

## License

MIT
