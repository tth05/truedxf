# AGENTS.md — working on truedxf

truedxf is a TypeScript DXF library: parser, lossless data model, and a three.js renderer whose
output must match **AutoCAD's PLOT output**. AutoCAD 2027 on this machine is the ground truth.
Read [docs/PLAN.md](docs/PLAN.md) first; it is the plan of record.

## Layout

| Path | What |
|---|---|
| `packages/core` | Tag layer: tokenizer (ASCII + binary), encodings, lossless `TagStore`, writer |
| `packages/*` | Further packages per docs/PLAN.md §4.1 (model, geometry, fonts, text, plot, render, three, viewer, testkit) |
| `apps/playground` | Vite demo/inspection app |
| `tools/gen` | Python (ezdxf) test-file generator |
| `tools/acad` | AutoCAD reference harness (accoreconsole scripts, plot configs) |
| `research/notes` | **Knowledge base** — read the relevant note before implementing a feature |
| `research/scripts` | Corpus / GitHub-dump tooling |
| `samples/` | **Local only, never committed**: external corpus, generated fixtures, AutoCAD references |

## Commands

```bash
pnpm install
pnpm typecheck     # tsc -b (TypeScript 7)
pnpm test          # vitest run
pnpm lint          # biome check .
pnpm format        # biome check --write .
```

Run all three (typecheck, test, lint) before committing.

## Code conventions

- TypeScript `strict`, ESM only. Relative imports use the **`.ts` extension**
  (`import { x } from "./y.ts"`); TS rewrites them on emit and Node runs `.ts` files directly.
- `erasableSyntaxOnly`: no `enum`, no `namespace`, no constructor parameter properties. Use
  `as const` objects + a type alias instead of enums.
- Packages below the renderer are **isomorphic**: no DOM, no `node:*` imports. Web globals they
  may use are declared in `types/web-globals.d.ts`; add declarations there rather than enabling
  the DOM lib.
- Numbers: float64 everywhere on the CPU side. Handles are strings (normalized uppercase hex) or
  `bigint`, never `number` (they are 64-bit).
- Determinism: no `Math.random`, no time-based limits (use count limits), stable iteration order.
- Keep raw data: never drop tags we don't understand. Typed accessors are views over the
  lossless `TagStore`.
- Comments: explain *why*, and cite the note for AutoCAD-specific behaviour, e.g.
  `// DIMSTYLE codes are written sparsely against imperial defaults (note 02 §…)`.
- Tests live in `packages/<pkg>/test/*.test.ts` (vitest). Prefer small inline DXF snippets; corpus
  tests read `samples/external/manifest.jsonl` and must skip gracefully when samples are absent.

## Knowledge base rules

- `research/notes/*.md` is the source of domain knowledge; cite it, and **update it** when you
  learn something new (especially from AutoCAD). Tag verified facts **VERIFIED-BY-ACAD** with
  the case id / date.
- Open questions and conflicts are tracked in `docs/questions.md` (ID → test case → answer).
- Open work items are tracked in `docs/TODO.md`; tick them off or add new ones as you go.
- The official DXF reference is often wrong; AutoCAD output wins.

## Licensing rules (strict)

- truedxf is MIT. Runtime dependencies: MIT/ISC/BSD/Apache-2.0/BSL-1.0 only.
  Bundled fonts may also be SIL OFL 1.1, with their licence next to them (`apps/playground/fonts`).
- GPL code (libredwg, libdxfrw, LibreCAD, QCAD, dxf-json) may be **read for facts**, never copied
  or translated.
- Never commit Autodesk files (fonts, .pat, .lin, .ctb, .pc3, .pmp copied from an install, spec
  PDFs) or anything under `samples/`.

## AutoCAD

- `C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe`. Use it only through the harness in
  `tools/acad` (see its README); never change the user's AutoCAD profile settings outside
  dedicated truedxf plot configs.
- AutoCAD is not part of the fix loop; batch new questions and run the harness.

## Public site

- `pnpm playground:deploy` builds `apps/playground` in `public` mode and deploys it to
  Cloudflare Pages with wrangler (apps/playground/README.md "Public site"). The public build must
  never contain samples, corpus files, AutoCAD or Windows fonts: keep anything that reads
  `samples/` behind `__SAMPLES__` or in dev-server plugins.

## Git

- Remote: `origin` = <https://github.com/tth05/truedxf> (private until release). Pushing
  is fine at any time; deploying the site needs the user's go-ahead. Small, focused commits
  with imperative subject lines.
- Never commit `samples/`, `research/repos`, `research/github/raw`, `research/spec/*.pdf|txt`.
