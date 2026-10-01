# truedxf — Project Plan

> A TypeScript DXF library (parser, lossless data model, renderer and demo viewer) whose rendering
> matches **AutoCAD's PLOT output** pixel-for-pixel. AutoCAD is the ground truth.

Status: **Phases 0–5 done** (see the Status section below). This document is the plan of record;
update it when decisions change.

---

## Status (2026-09-30): Phases 0–5 done

| Phase | State |
|---|---|
| 0 Research | Done: knowledge base (research/notes), corpus of 5 542 files, 736-question backlog (docs/questions.md) |
| 1 Core | Done: ASCII/binary tokenizer (~140 MB/s), encodings, lossless tag store, writers; whole corpus tokenizes without exceptions |
| 2 Model | Done: typed parsers for all common entity/object types (182 corpus entities of 14 custom classes remain UNKNOWN), property resolution, DIMSTYLE resolution; 99.77 % attribute agreement with ezdxf over 50.8 M compared attributes, residuals classified |
| 3 References | Done: AutoCAD 2027 harness (tools/acad), calibration (note 08 §10), generator with 3 734 fixtures in 29 suites (tools/gen) |
| 4 Renderer | Done: frontend → display list, three.js renderer, visual harness (Chromium/SwiftShader) + CPU scorer, AutoCAD raster-rule emulation |
| 5 Feature ladder | Done except rung 15 (CTB/STB plot styles: `@truedxf/plot` is still a placeholder) and the ezdxf baseline score (Phase 3.5) |
| 6–8 | Not started |

**Scoreboard** (2026-10-01, CPU scorer = same pixels as the browser renderer in plot mode,
against the references re-plotted with the real fonts): **3 583 cases with references, 3 088
(86 %) at F1(r=1) ≥ 0.99, 885 (25 %) pixel-exact.** The earlier 3 128 / 1 282 were scored
against simplex.shx substitution plots; most of the drop is TrueType text (dimensions, leaders,
fileformat, mtext, linetypes with text); the raster driver's whole-pixel glyph advances
(research/notes/04 §14) recovered 156 cases. See docs/TODO.md.

| Suite | Cases | Exact | F1(r=1) ≥ 0.99 | | Suite | Cases | Exact | F1(r=1) ≥ 0.99 |
|---|---:|---:|---:|---|---|---:|---:|---:|
| calibration | 38 | 5 | 38 | | linetypes | 230 | 64 | 186 |
| lines-curves | 119 | 74 | 114 | | hatches | 279 | 123 | 223 |
| ocs | 91 | 34 | 80 | | text | 294 | 15 | 266 |
| polylines | 99 | 51 | 98 | | text-lato | 23 | 0 | 18 |
| points | 155 | 115 | 153 | | mtext | 250 | 1 | 175 |
| ellipses | 51 | 22 | 51 | | attribs | 65 | 3 | 64 |
| splines | 59 | 0 | 57 | | acad-default-fonts | 113 | 38 | 66 |
| solids | 43 | 38 | 43 | | dimensions | 366 | 1 | 324 |
| colors | 44 | 10 | 44 | | leaders | 128 | 26 | 107 |
| lineweights | 64 | 7 | 64 | | layouts | 169 | 7 | 155 |
| blocks | 88 | 42 | 82 | | xclip | 44 | 0 | 36 |
| transparency | 23 | 2 | 21 | | images | 174 | 137 | 156 |
| draworder | 34 | 26 | 34 | | mline | 54 | 16 | 40 |
| misc | 45 | 20 | 40 | | extents | 18 | 0 | 9 |
| mixed | 37 | 0 | 31 | | fileformat | 386 | 8 | 313 |

Reproduce: `node packages/testkit/src/cpu-suite.ts <suite> --quiet --json
samples/reports/scoreboard/<suite>.json > samples/reports/scoreboard/<suite>.log` (the playground's
Fixtures view reads these reports).

**Known limitations / next steps** (the full list of open todos is [docs/TODO.md](TODO.md); AutoCAD
questions are in docs/questions.md):
- **Fonts:** references are now plotted with the real TrueType fonts; TrueType text layout and
  rasterization is the largest remaining gap (exact matches dropped from 1 282 to 878).
- **accoreconsole limits:** IMAGE/WIPEOUT never plot in the console (implemented, unverified);
  MPOLYGON needs `AcMPolygonObj26.dbx` loaded by the harness; proxy fixtures are rejected on load.
- **Raster:** exact-tie noise at pixel boundaries (not modelled), spline tessellation, hatch
  islands, clipped huge arcs, extents-plot padding.
- **Features:** CTB/STB plot styles, PDF underlay content, wide polylines with linetypes, some
  MULTILEADER variants, vertical text, MTEXT columns breaking, perspective viewports.

---

## 1. Goals, non-goals, success criteria

### Goals
1. **Read every DXF in the wild** — R10…R2018+ (AC1006…AC1032), ASCII and binary, any code page,
   broken files from third-party producers — without crashing, with diagnostics and a recover mode.
2. **Lossless, typed data model** — every tag survives a read/write round trip (including unknown
   entities, unknown tags inside known entities, XDATA, extension dictionaries, 102 groups).
   Typed accessors are *views* over the lossless store. Correct effective-property resolution
   (ByLayer/ByBlock/layer 0/viewport overrides) available without the renderer.
3. **AutoCAD-exact rendering** — for a given DXF + page setup the renderer reproduces AutoCAD's plot:
   same geometry (tessellation, dashes, hatch lines, glyphs), same colours, same lineweights, same
   draw order, same clipping. Deterministic across runs and OSes.
4. **Web viewer** — an embeddable, fast viewer (WebGL, workers, instancing) and a playground app to
   inspect files and compare against reference renders.
5. **Writer** (later) — produce DXF files AutoCAD opens without complaint.

### Non-goals (for now)
- DWG reading/writing (the corpus contains 709 DWGs; AutoCAD can convert them to DXF for tests).
- 3D rendering (shaded/hidden-line views). We render what a 2D plot shows (top/plan and
  parallel-projected viewports with wireframe; ACIS bodies via proxy graphics / isolines later).
- Editing UI/CAD features in the viewer (measuring and picking are in; drawing tools are out).

### Success criteria
| Area | Metric |
|---|---|
| Parser robustness | 100 % of the ~4 800 ASCII/binary DXFs in `samples/external` parse without exception; each failure is either fixed or classified as "file is garbage" with a diagnostic. Fuzzing finds no crashes. |
| Parser correctness | Differential test against ezdxf: entity attribute dumps agree for ≥ 99.5 % of entities in the corpus (all disagreements triaged: truedxf bug / ezdxf bug / ambiguous). |
| Round trip | read → write → read is tag-identical for the whole corpus; AutoCAD opens our re-written files (spot checks via accoreconsole). |
| Rendering | Per feature suite: geometry-only fixtures **pixel-exact** vs AutoCAD (aliased), others within the tolerant metric (all ink pixels within r ≤ 1 px of same-colour ink). Scoreboard beats ezdxf's drawing add-on on every suite, measured on identical inputs and plot windows. |
| Performance | Parse ≥ 50 MB/s ASCII in Node; 100 MB DXF loads in the browser viewer without OOM; 60 fps pan/zoom on 1 M segments on a mid-range laptop. |

---

## 2. Where we are (Phase 0 results)

| Artifact | Where | What |
|---|---|---|
| Knowledge base | `research/notes/` (~15 000 lines) | 12 topic notes with group codes, semantics, algorithms, cited sources, CONFLICT/UNKNOWN markers and ~400 test ideas (see [notes index](../research/notes/README.md)). Issue-mining notes 11a–c list ~330 notable corpus files by feature. |
| Reference libraries | `research/repos/` (gitignored; `research/scripts/clone_repos.sh`) | 20 clones: ezdxf, dxf-viewer, dxf-parser, three-dxf, dxf-json, bjnortier/dxf, mlightcad (2), ACadSharp, netDxf, ixmilia (2), tarikjabiri/dxf, libdxfrw, LibreCAD, qcad, libredwg, GDAL (sparse), FreeCAD (sparse), jscad sample files. See `research/repos.md`. |
| Specs | `research/spec/` (gitignored) | AutoCAD 2012 DXF Reference, ODA DWG spec (PDF + pdftotext). |
| Issue knowledge | `research/github/raw/` (gitignored, ~80 MB) | ~10 000 issues/PRs/discussions of 16 repos + DXF-filtered GDAL/FreeCAD/QGIS as grep-able markdown (`research/scripts/dump_github.py`). |
| Sample corpus | `samples/external/` | **5 542 unique files, 3.1 GB** (4 811 ASCII DXF, 22 binary DXF, 709 DWG; R10…R2018) from repos + 1 900 issue attachments. `manifest.jsonl` (source, license, sha256, version, codepage, producer guess, entity/object counts), `COVERAGE.md`. Files gitignored — mixed/unknown licenses, internal testing only. |
| AutoCAD | `C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe` | Installed; `PublishToWeb PNG.pc3` present in the user profile. First console probes already worked (TEXTBOX measurements in note 04). |

### Headline findings that shape the design
(Details and citations in the notes.)

- **Nobody targets AutoCAD's plot output.** No surveyed library compares images against AutoCAD
  (ezdxf's author: it "will never … render like AutoCAD"). Linetype fitting, PLINEGEN, PSLTSCALE,
  complex linetypes, CTB/STB, page-setup semantics, viewport overrides, SHX bigfonts and pixel
  lineweight rules are unsolved everywhere → this is our differentiator and our main workload.
- **Nobody is lossless.** All libraries drop unknown tags inside known entities → build the typed
  model as views over a lossless tag store (note 10 §16.2).
- **The DXF often carries the rendering answer:** HATCH pattern lines are stored final (scaled,
  rotated, origin-shifted) — no `.pat` needed; DIMENSION/ACAD_TABLE geometry is in anonymous
  `*D`/`*T` blocks, which AutoCAD draws *as stored, even if stale*; LTYPE definitions are embedded;
  MLINE vertices contain final miter vectors; INSERT scale already contains unit conversion.
  → Render stored data first; regenerate only when absent.
- **The spec is wrong in many places** (PSLTSCALE polarity, LTYPE/MTEXT rotation units,
  plot window codes, VPORT 40 vs 45, LEADER 74, IMAGEDEF 11/21, …) → the spec is *input*, AutoCAD
  output is *truth*. ACadSharp's `samples/sample_AC10xx_ascii.dxf` are AutoCAD-written and were used
  heavily to settle conflicts.
- **DIMSTYLE records are sparse**: AutoCAD writes only codes differing from built-in *imperial*
  defaults — a missing code means the imperial default, not ezdxf's metric default.
- **Text height = cap height** (TTF scaled so "A" top = height; SHX scaled by height/above), MTEXT
  line pitch = 5/3·h·factor (reproduces AutoCAD's stored MTEXT extents to 4 decimals in ~50 samples).
- **Colours and fonts have context rules:** the ACI palette differs between model space and paper
  space (and PDF output differs again; a CTB entry for ACI 7 overrides the background rule);
  TrueView/AutoCAD apply no TTF kerning and fall back to another font *per missing glyph*
  (e.g. CJK under an Arial style); AutoCAD's standard linetype definitions (measured from 120
  AutoCAD files) differ from ezdxf's table (note 11a).
- **AutoCAD is a strict reader** (note 11c §1: ~60-item writer checklist incl. verbatim errors;
  note 11a adds 21 more rejection causes).
- **Browser performance:** string-splitting parsers die on big files; dxf-viewer's worker +
  transferable buffers + batching/instancing design is the model; rebase float32 to local origins.
- **License traps:** dxf-json and libredwg-web are GPL; three-dxf pulls a GPL MTEXT parser;
  dxf-viewer's/QCAD's/LibreCAD's hatch patterns are GPL-derived; Autodesk fonts/.pat/.lin are
  proprietary. ezdxf (MIT) pattern tables and ixmilia spec XML (MIT) are reusable with attribution.

---

## 3. Principles

1. **AutoCAD output is the truth; everything else is a hypothesis.** Every rendering rule gets a
   fixture that pins it. Unknowns from the notes become test cases (the "question backlog").
2. **Lossless first, typed second.** Parse into tags we never throw away; interpret lazily.
3. **Render stored data before regenerating.** Use `*D` blocks, stored hatch lines, proxy graphics.
4. **Deterministic.** Float64 everywhere, no randomness, no time-based limits (count limits instead),
   explicit pixel-centre conventions, fonts loaded from explicit paths only.
5. **One geometry pipeline, one renderer, an open seam.** The frontend does dashing, hatching,
   text-to-glyphs, stroking (lineweights → triangles at the target resolution) and clipping, and
   emits a renderer-agnostic, transferable **display list**. The only renderer we build is
   **three.js** (`@truedxf/three`); it only uploads and draws. The same renderer, run in headless
   Chromium, is what we compare against AutoCAD. Other consumers (SVG/PDF export, …) remain
   possible later without touching the frontend.
6. **Isomorphic packages** (no DOM, no `node:*`) for everything below the three.js renderer, so
   parsing/scene building runs in Node, in the browser, and in Web Workers.
7. **License hygiene.** Runtime deps MIT/ISC/BSD/Apache/BSL only; GPL code read for facts only;
   no Autodesk assets committed; the external corpus is never redistributed.
8. **Spec as data.** Entity/table/object field definitions live in a neutral machine-readable spec
   from which model code and round-trip tests are generated (committed output).

---

## 4. Architecture

### 4.1 Repository layout
```
truedxf/
  packages/
    core/            @truedxf/core        tag tokenizer (ASCII+binary), encodings, lossless TagList, writer
    spec/            @truedxf/spec        (dev) neutral field spec + codegen → model/src/generated
    model/           @truedxf/model       document, typed views, handles, resolution, audit, recover
    geometry/        @truedxf/geometry    vec/mat, OCS, arcs/bulge, ellipse, NURBS, flattening,
                                          stroker, dash engine, hatch engine, polygon booleans
    fonts/           @truedxf/fonts       SHX (shape/unifont/bigfont), TTF/OTF (opentype.js), resolution
    text/            @truedxf/text        TEXT + MTEXT parser and layout engine
    plot/            @truedxf/plot        CTB/STB, page setup → plot transform, lineweight → device
    render/          @truedxf/render      frontend (layouts, viewports, blocks, properties, draw order)
                                          → renderer-agnostic display list (transferable typed arrays)
    three/           @truedxf/three       three.js renderer: display list → batched BufferGeometry /
                                          InstancedMesh, draw order, picking hooks (three = peer dep)
    viewer/          @truedxf/viewer      embeddable viewer (worker pipeline, camera, layers, layouts)
    testkit/         @truedxf/testkit     visual harness (Playwright + headless Chromium), metrics,
                                          reports, corpus runners (Node only)
  apps/
    playground/      Vite app: open file, layers/layouts, overlay/diff vs reference PNG, suite browser
  tools/
    gen/             test file generator (Python + ezdxf first; TS generator later)
    acad/            AutoCAD reference harness (accoreconsole scripts, PC3/PMP/CTB, runner)
    corpus/          corpus tooling (the research/scripts move here)
  samples/           LOCAL ONLY (gitignored except README): external corpus, generated fixtures,
    external/        AutoCAD references (§7.6)
    generated/
  research/          knowledge base, scripts, clones (gitignored parts)
  docs/              plan, design docs, ADRs
```

### 4.2 Dependency graph
```
core ─┬─> model ─┬─> plot ─────────────┐
      │          └─> render <──────────┤        (all isomorphic; run in a Web Worker)
      │                ^   ^           │
geometry ──────────────┘   │           │
fonts ─> text ─────────────┘           │
render ══ display list (transferable) ══> three (main thread) ─> viewer ─> apps/playground
testkit: drives apps/playground-like harness page in headless Chromium; pixel metrics (Node)
```

### 4.2a The display list (the seam)
The frontend's output, designed for `postMessage` transfer and direct GPU upload:
- **Batches** of already-tessellated geometry in float32 **relative to a batch origin** (float64
  origin kept separately): triangle lists for fills, widened strokes, glyphs and solid hatches;
  line lists only for true hairlines (lineweight 0 → 1 device px rule); points.
- **Style table**: resolved RGB(A) per batch, or per-vertex/per-instance colour where batching
  merges entities; ByBlock-dependent colour as an instance attribute.
- **Symbols + instances** for blocks (local-space geometry built once, instance matrices +
  instance colour) — the renderer decides to instance or flatten.
- **Strict draw-order sequence** (SORTENTS/file order, viewport-first rules) as a batch sequence;
  the renderer disables depth testing and uses `renderOrder`.
- **Clip regions** (viewport and XCLIP boundaries as polygons) → stencil in three.js.
- **Pick map**: per range of primitives the source entity handle (for selection/inspection).
- **Resolution contract**: tessellation tolerance and lineweight widening are computed for a
  target device scale (plot DPI in tests; LOD levels in the viewer → re-request on deep zoom).

### 4.2b Why three.js (and its pitfalls)
Chosen for integrability (users add their own objects/controls), ecosystem, and a WebGPU path
(`WebGPURenderer`). Rules to avoid the known pitfalls (dxf-viewer and mlightcad both hit them):
never one `Object3D` per entity (batch/instance); release CPU copies of attribute arrays after
upload unless needed; float32 origin rebasing; no `lineWidth` reliance (we triangulate strokes);
depth test off + explicit `renderOrder`; no three.js text (our own glyph pipeline — three.js does
not help with SHX or AutoCAD metrics); picking via our own spatial index (flatbush), not the
raycaster; `three` is a peer dependency of `@truedxf/three` only.

### 4.3 Tooling
- **pnpm workspaces** (via `corepack enable`; pnpm is not installed yet), Node ≥ 22 (23.10 installed),
  TypeScript `strict`, ESM only, target ES2022.
- Build: `tsdown`/`tsup` per package; `tsc -b` project references for type checking.
- Tests: **vitest** (unit, golden, corpus), **fast-check** (property tests / fuzzing),
  Playwright (headless Chromium for the visual harness).
- Lint/format: Biome. Changesets for versioning. GitHub Actions CI (unit + golden tests; the
  AutoCAD harness runs only on this Windows machine).
- Python 3.11 venv under `tools/gen/.venv` with ezdxf (generator + differential oracle + baseline renders).

### 4.4 Key third-party libraries (all permissive)
three (peer, renderer only), opentype.js (fonts), earcut (fill triangulation), clipper2 TS port
(clipping, hatch island repair), flatbush (spatial index), fflate or `DecompressionStream` (CTB),
dev only: Playwright (headless Chromium for visual tests), fast-png, pixelmatch, ssim.js,
pdfium wasm + pdf.js (reading AutoCAD PDF plots). Rationale and alternatives: note 10 §16.4.

---

## 5. Phases

Each phase has deliverables and **exit criteria**. Phases 2–3 overlap on purpose: the reference
pipeline needs a working AutoCAD harness early, and AutoCAD time may be limited (see §9).

### Phase 1 — Foundations and the tag layer (`core`)
**Deliverables**
1. Monorepo scaffold, CI, lint, test infra, `AGENTS.md` with project conventions for agents.
2. **Tokenizer**: chunked byte tokenizer over `Uint8Array`/`ReadableStream`; ASCII (CRLF/LF/CR,
   padded codes, BOM) and binary (sentinel, 1-byte R12 codes with 255 escape vs 2-byte R13+ codes,
   detected from byte 23); value typing by group-code range (note 01 §1 table, incl. binary quirks:
   280–289 are 2 bytes, 290–299 1 byte, 1004 binary); byte offsets/line numbers for diagnostics.
3. **Encoding**: sniff `$ACADVER`/`$DWGCODEPAGE`; AC1021+ UTF-8; older via `TextDecoder` code-page
   map; "try strict UTF-8 first, then declared code page" heuristic for lying files; `\U+XXXX` and
   `\M+nXXXX` decoding (after MTEXT chunk join); undecodable bytes kept raw for round trip.
4. **Structure**: sections, objects split at code 0, `TagList` with subclass boundaries, 102 groups,
   XDATA, embedded objects (101) — lossless, lazily typed.
5. **Writer (tag level)**: ASCII + binary emission, AutoCAD-compatible number formatting,
   string chunking, streaming.
6. **Corpus runner**: `pnpm corpus:parse` over `samples/external/manifest.jsonl` → JSON report
   (time, MB/s, diagnostics per file), stored for regression comparison.

**Exit criteria**: whole corpus tokenizes; tag-level round trip is byte-identical (modulo line
endings) for all ASCII files; binary ↔ ASCII conversions agree; fuzzing (mutated corpus files,
random tag streams) finds no crash/hang; ≥ 50 MB/s tokenizing in Node.

### Phase 2 — Data model (`spec`, `model`)
**Deliverables**
1. **Neutral spec** (`@truedxf/spec`): per type → subclasses → fields (code, type, default,
   version range, repeat/struct, pointer kind, enum), header variables with codes/types/defaults,
   table records, objects. Seeded from ixmilia's XML (MIT, attributed) with the subclass partition
   from ACadSharp (MIT), corrected by the notes (every correction cites a note). Group-code audit
   script lists every (type, subclass, code) seen in the corpus that the spec doesn't describe.
2. **Codegen** → typed view classes over `TagList` with dirty tracking (only changed fields
   re-serialize); generated code committed; generated round-trip tests per type.
3. **Hand-written complex types**: HATCH (paths, edges, pattern lines, gradient), MTEXT (chunks,
   columns, embedded object), LWPOLYLINE, POLYLINE/VERTEX/SEQEND, INSERT/ATTRIB/SEQEND, DIMENSION
   subtypes, LTYPE elements, SPLINE, LEADER, MULTILEADER context data, ACAD_TABLE, DICTIONARY,
   XRECORD, LAYOUT/PLOTSETTINGS, VIEWPORT, DIMSTYLE (positional 70s, sparse → imperial defaults).
4. **Document**: header (all vars, typed, with AutoCAD defaults when absent), classes, tables,
   block records ↔ blocks, layouts, entity spaces, objects, thumbnail. Handles as strings/BigInt
   (64-bit!), owner/reactor/xdict graph, two-stage load (bind handles, then resolve), name fallback
   for R12, case-insensitive names.
5. **Property resolution primitives** (pure, no renderer): effective layer/color/linetype/
   lineweight/transparency/plot style for an entity in a context (block nesting stack, viewport),
   layer states (off, frozen, per-VP freeze, plot flag, Defpoints), ACI palette.
6. **Audit & recover**: structural checks with diagnostics; recover mode for broken files
   (ezdxf.recover strategies), both covered by corpus tests.
7. **Differential oracle**: a Python script dumps ezdxf's view of each corpus file (entities with
   attributes, tables, header) to JSON; `pnpm corpus:diff` compares with our dump, classifies
   disagreements. Disagreements are resolved from notes / AutoCAD (`DXFOUT`/LISP dumps), not by
   assuming ezdxf is right.

**Exit criteria**: corpus parses into the model with no exceptions; round trip through the model
is tag-identical; differential agreement ≥ 99.5 % with every residual classified; AutoCAD opens a
sample of re-written files (accoreconsole open + `DXFOUT` works, no errors in log).

### Phase 3 — Reference pipeline (`tools/gen`, `tools/acad`, `testkit` scaffolding)
Starts in parallel with Phase 2 (harness calibration needs no truedxf code). The AutoCAD licence
runs for a year, so references can be generated incrementally as suites grow.

**3a. AutoCAD harness**
1. Dedicated plot configs checked into `tools/acad/config/`: `truedxf PNG.pc3` (copy of
   PublishToWeb PNG) with custom pixel sizes in `truedxf PNG.pmp`, **zero margins**; a PDF config
   (`DWG To PDF.pc3` copy) for vector references; plot style tables (`monochrome.ctb`, `acad.ctb`;
   our own STB later). Hashes recorded.
2. Runner (Node): per case generate a `.scr` (sysvar prologue from note 08 §7: FILEDIA 0,
   CMDDIA 0, EXPERT 5, BACKGROUNDPLOT 0, LWDEFAULT, FILLMODE, TEXTFILL, SORTENTS, FONTALT, …),
   run `accoreconsole.exe /i case.dxf /s case.scr` with timeout, N parallel workers, crash/hang
   handling, UTF-16LE log decoding, verification (PNG size = canvas; echoed prompt sequence =
   template) → otherwise "harness failure", not "render mismatch".
3. Outputs per case: `png` (raster plot), `pdf` (vector plot), `dxf` (`DXFOUT` re-save: AutoCAD's
   computed values — dimension measurements, MTEXT extents, extents, viewport status), optional
   LISP probe output (TEXTBOX, entget dumps; no `vla-*` in the console), `log`, `meta.json`
   (AutoCAD build, config hashes, script).
4. **Calibration first** (note 08 T-PL-1…4 and friends): define the exact `pixel = f(world)` mapping
   (Fit/Center, printable-area inset, pixel-centre and y-flip convention), anti-aliasing yes/no,
   colour depth, lineweight → px rounding at the device DPI (plot all 24 standard lineweights),
   hairline width, default caps/joins, ACI palette on plot (ACI 1–255 swatches; resolves the
   light-vs-dark palette conflict), determinism (plot twice → identical bytes).

**3b. Font & asset strategy for fixtures** (see §6): free TTFs (Liberation/DejaVu/Noto) installed
for AutoCAD and loaded by path by us; our own SHX fonts compiled from permissively licensed stroke
fonts (identical file used by both sides); our own complex-linetype shape file; no Autodesk
fonts/patterns in fixtures (except dedicated "AutoCAD default font" suites that are compared with a
tolerant metric and are not redistributed).

**3c. Generator** (`tools/gen`, Python + ezdxf initially; our own writer takes over in Phase 8)
1. Case = `(feature, variant, seed)` → deterministic DXF + `meta.json` (feature tags, parameters,
   plot window, expected-invariants). Window chosen with the canvas aspect ratio so Fit gives an
   exact, known scale. Each file passes an AutoCAD open check before it's accepted as a fixture.
2. **Suites** (ordered roughly like the renderer feature ladder, §5 Phase 5): calibration, lines &
   curves, OCS/extrusion, polylines (bulge, widths, curve/spline fit, meshes), points (all PDMODEs),
   ellipses, splines (control/fit/periodic/rational), solids/traces/3dfaces, colours (ACI/true
   colour/ByLayer/ByBlock/layer off/frozen), lineweights, transparency, linetypes (simple, ISO,
   complex with text/shapes, PLINEGEN, LTSCALE/CELTSCALE/PSLTSCALE, short segments), hatches
   (solid, predefined patterns, user, custom, islands & styles, all edge types, gradients,
   scale/angle/origin), TEXT (alignments × fonts × width/oblique/mirror), MTEXT (every inline code,
   wrapping, stacking, columns, background), ATTRIB/ATTDEF, blocks (nesting, non-uniform & mirror
   scale, MINSERT, ByBlock inheritance, layer 0, frozen/off insert layer), dimensions (every type ×
   dimstyle variables; with and without `*D` blocks), LEADER/MULTILEADER/TOLERANCE, IMAGE/WIPEOUT,
   XCLIP, MLINE, ACAD_TABLE, layouts & viewports (scale, twist, clip, frozen layers, overrides,
   PSLTSCALE, draw order), draw order (SORTENTS), random mixed drawings (crash + integration).
3. Each UNKNOWN / CONFLICT in the notes gets an ID in `docs/questions.md` and at least one case;
   when AutoCAD answers, the note is updated (mark **VERIFIED-BY-ACAD**) and the question closed.
4. **Real-world references**: also plot the external corpus DXFs (plot area Extents + Window around
   `$EXTMIN/$EXTMAX` via `DXFOUT` values) → real-world regression references (tolerant metric).
5. **ezdxf baseline**: render every case with ezdxf's drawing add-on at the same window/size →
   baseline score per suite (the thing we must beat).

**Exit criteria**: calibration answered (f, AA, lineweight rule, palette); harness deterministic;
≥ 1 000 generated cases with references across all suites; ezdxf baseline scored; question backlog
populated.

### Phase 4 — Renderer foundation (`geometry`, `plot`, `render`, `three`, `testkit`)
1. `geometry`: float64 vec/mat, OCS (arbitrary axis algorithm, 1/64 threshold), bulge arcs,
   ellipse param/angle, NURBS (de Boor, knot insertion, Bézier extraction, fit-point → control
   point interpolation), adaptive flattening with tolerance in device units, stroker (caps, joins,
   miter limit), polygon booleans (Clipper2) for clipping.
2. `plot`: page setup → plot transform (plot area types, Fit/Center/offset/rotation, printable area),
   CTB/STB parsing and application by *resolved* ACI, lineweight → device px (Phase 3 rule).
3. `render` frontend: layout walker (model space via window/extents plot; paper space with
   viewports), INSERT expansion with transform stack (display list keeps symbol defs + instances),
   property resolution via `model` primitives, draw order (SORTENTS, then file order), display list
   as specified in §4.2a.
4. `three`: display list → three.js scene (batched `BufferGeometry`, `InstancedMesh`, stencil clip,
   `renderOrder`), orthographic camera set from the plot transform. A **plot mode** renders
   exactly one page at a given pixel size (the mode used by tests and print preview).
5. `testkit` visual harness: a minimal harness page (Vite build) loaded in **headless Chromium via
   Playwright with SwiftShader** (`--use-angle=swiftshader`, `antialias: false`,
   `preserveDrawingBuffer`), renders cases in plot mode, reads pixels back. One page renders many
   cases (context reuse) for throughput. Determinism check: same case twice → identical bytes.
   Metrics: exact pixel mismatch; tolerant distance-transform metric r=0/1/2 per colour; ink
   ratio; SSIM trend; vector Hausdorff of our display list vs AutoCAD PDF paths (renderer-free,
   catches logic bugs early). Diff heat maps, HTML report, JSON scoreboard per suite with history;
   `pnpm test:visual [--suite x] [--case y]`.
   - Fallback if GPU rasterization can't reproduce AutoCAD's rules (e.g. AA or hairline behaviour):
     a small CPU rasterizer consuming the same display list can be added behind the seam.

**Exit criteria**: calibration suite pixel-exact; lines/arcs/circles/LWPOLYLINE (no width)
pixel-exact at lineweight 0 in monochrome.

### Phase 5 — Feature ladder (rendering fidelity)
Work suite by suite; each rung is "done" when its suite meets its budget (geometry exact, text
r ≤ 1 until fonts are verified, then exact where possible) and it beats ezdxf. Order (dependencies
first, frequency in the corpus second):

| # | Rung | Notes |
|---|---|---|
| 1 | LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE 2D/3D, POINT (PDMODE/PDSIZE), RAY/XLINE (clip to plot area) | notes 03 |
| 2 | Colours (ACI, true colour, ByLayer/ByBlock, colour 7 on white), layer on/off/frozen/plot/Defpoints | 02, 06 |
| 3 | Lineweights (rule from calibration, caps/joins, LWDEFAULT), wide polylines (miters, taper, FILLMODE) | 03, 06 |
| 4 | ELLIPSE, SPLINE (incl. fit-point-only, periodic), OCS/extrusion incl. (0,0,-1) mirror | 03 |
| 5 | INSERT/MINSERT, nested blocks, ByBlock/layer-0 inheritance, ATTRIB (drawn after block), constant ATTDEF, XCLIP | 07 |
| 6 | SOLID/TRACE/3DFACE, polyface/polygon meshes (wireframe), MESH (wireframe) | 03 |
| 7 | Linetypes: simple, ISO, scaling chain, PLINEGEN, AutoCAD end-dash fitting, short segments, curves; complex (text/shape) | 06 — known hard |
| 8 | HATCH solid (loops by style, even-odd, nesting), stored pattern lines (deterministic clipping), gradients, MPOLYGON | 06 |
| 9 | Fonts: SHX (shape/unifont/bigfont, our test fonts) then TTF (cap-height rule); TEXT alignment/fit/aligned/oblique/mirror | 04 — known hard |
| 10 | MTEXT: inline codes, wrapping, 5/3 line pitch, tabs, stacking, columns, background fill | 04 — known hard |
| 11 | DIMENSION via `*D` blocks (+ DIMSTYLE overrides for text), then regeneration when the block is missing (layout algorithm, arrows) | 05 |
| 12 | LEADER, MULTILEADER, TOLERANCE (gdt symbols) | 05 |
| 13 | Draw order (SORTENTS), WIPEOUT, IMAGE (+clip, fade/contrast, missing image frame), MTEXT background masks | 06, 07 |
| 14 | Paper space: LAYOUT/PLOTSETTINGS, VIEWPORT transform (scale, twist, 3D direction), rect/poly clipping, per-VP frozen layers and overrides, PSLTSCALE, viewport-first order | 08 |
| 15 | Plot styles: CTB (all pen settings), STB (named styles), screening, monochrome | 06 |
| 16 | MLINE, ACAD_TABLE (`*T`), SHAPE, proxy graphics (ACAD_PROXY_ENTITY and proxy graphics on others), ACIS fallback (proxy graphics / isolines), UNDERLAY frame | 07 |
| 17 | Transparency, annotative scales, fields (display of cached value) | 06 |

### Phase 6 — AI fix loop
1. `AGENTS.md` + `docs/agent-loop.md`: how an agent picks a failing case, what it gets (DXF,
   meta, reference PNG/PDF, our PNG, diff heat map, relevant note sections, previous attempts),
   how it verifies (targeted suite + full regression), rules (no per-case hacks, update notes
   when behaviour is learned, never loosen thresholds without a recorded reason).
2. `pnpm fix:next` prints the highest-value failing cluster (group failures by suite and diff
   signature), `pnpm fix:verify` runs the suite + regression gate.
3. **Anti-overfitting**: hold-out seeds per suite that agents never see during fixing; random mixed
   drawings; real-world references as a second gate.
4. Regression gate in CI: scoreboard can't regress; new passes are locked in.
5. AutoCAD stays out of the loop; new questions go to the backlog and are batched into harness runs.

### Phase 7 — Viewer and playground
1. `three` for interaction: LOD re-tessellation on zoom (re-request display-list batches at a
   finer device scale), optional screen-space hairlines while navigating, memory budget
   (release attribute arrays), WebGPU renderer trial.
2. `viewer`: worker pipeline (parse → model → display list in a worker; transferable buffers),
   pan/zoom, layouts, layers panel, picking (flatbush), entity inspector, measure, background
   colour (with ACI 7 inversion), print-preview mode that uses the plot pipeline.
3. `apps/playground`: open/drag file, suite browser, side-by-side / onion-skin / diff vs reference,
   scoreboard view, corpus browser (manifest search by entity type / producer / version).
4. Performance work against large corpus files (budgets in §1).

### Phase 8 — Writer, editing API, release
1. Model-level writer with version conversion, the AutoCAD writer checklist (note 11c §1) as tests,
   accoreconsole open-check in the harness.
2. Builder/editing API; switch the generator from ezdxf to truedxf (keeps ezdxf as cross-check).
3. Docs site, examples, npm publishing, license review (incl. Autodesk EULA question, §9).

---

## 6. Fonts, patterns and other assets

- **Rendering never needs Autodesk pattern/linetype files**: hatch lines and LTYPE definitions are
  in the DXF. We still ship an MIT pattern table (from ezdxf, attributed) for authoring.
- **Fonts are the exception.** Real drawings reference `txt.shx`, `simplex.shx`, `romans.shx`,
  `gdt.shx`, bigfonts, and Windows TTFs. Strategy:
  1. `FontProvider` interface: users can supply their own SHX/TTF files (their licenses, their
     machine). The Node adapter can scan an AutoCAD `Fonts` directory; the browser takes URLs/Files.
  2. Built-in fallbacks: permissively licensed stroke fonts mapped to common SHX names (metrics
     tuned to AutoCAD's cap-height/advance where we can do so without copying Autodesk data), and
     OFL/Apache TTFs (Liberation, DejaVu, Noto incl. CJK) as substitutes.
  3. **Fixtures for exactness** use fonts both sides load from the same file: our own SHX fonts
     (compiled from a permissive stroke font) and free TTFs installed for AutoCAD.
  4. A separate "AutoCAD default fonts" suite measures fallback quality with a tolerant metric.
- Candidate open stroke-font sources to evaluate (license check pending, note 04 §4): Hershey
  fonts (public domain-like), ezdxf strokefonts (check), LibreCAD LFF / QCAD CXF (GPL → no).

---

## 7. Testing strategy

| Level | What | Where |
|---|---|---|
| Unit | Pure functions (tokenizer, codecs, geometry, SHX decoding, MTEXT parser) | `packages/*/test` (vitest) |
| Property/fuzz | Tokenizer/recover never crash; geometry invariants (bbox contains curve, tessellation error bound) | fast-check |
| Spec round-trip | Generated per type: build → write → read → equal | `packages/model/test/generated` |
| Corpus | Parse + round trip + audit over `samples/external`; performance report | `pnpm corpus:*` (local; CI uses an MIT subset) |
| Differential | truedxf vs ezdxf model dumps | `pnpm corpus:diff` |
| Geometry (renderer-free) | Display list vs AutoCAD PDF vector paths (Hausdorff in paper mm) | `pnpm test:geometry` |
| Visual (AutoCAD) | three.js renderer in headless Chromium vs AutoCAD PNG references; scoreboard + regression gate | `pnpm test:visual` |
| Real-world | External corpus vs AutoCAD extents plots (tolerant) | `pnpm test:realworld` |

### 7.6 Where samples and references live
**Everything sample-like stays local** (decision 2026-09-30): the external corpus, generated
fixtures and AutoCAD references live under `samples/` and are gitignored; only READMEs, scripts
and generators are committed. Generated fixtures are reproducible from generator + seed; AutoCAD
references are keyed by case id + AutoCAD build + config hashes. Public CI (later) runs unit tests
plus a small, self-authored, MIT fixture set.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| AutoCAD access ends (licence runs one year) | Generate references continuously as suites grow; before expiry, run a broad harvest (all suites, many seeds, external-corpus extents plots); store everything with build IDs. |
| GPU rasterization can't match AutoCAD's raster rules | We own all triangles (CPU stroker at plot DPI), SwiftShader for determinism, PDF-vector geometry metric independent of rasterization; CPU rasterizer behind the seam as fallback. |
| Autodesk EULA (reverse-engineering clause) | Black-box comparison of plot output only; no disassembly, no Autodesk files shipped. **Get a legal opinion before any commercial release.** |
| Raster plot behaviour is hard to pin (AA, lineweight rounding) | PDF vector references in addition to PNG; calibration suites first; tolerant metrics where exactness is impossible. |
| Font mismatch dominates text diffs | Same-file fonts for exactness suites; separate fallback suites; text metrics verified via TEXTBOX/DXFOUT, not just pixels. |
| MTEXT / dimension layout rules unknown | AutoCAD re-save (`DXFOUT`) gives computed extents/measurements as numeric oracles; many small targeted cases. |
| Overfitting to generated cases | Hold-out seeds, random mixed drawings, real-world references. |
| Scope creep (3D, DWG, editing) | Explicit non-goals; revisit after Phase 5. |
| Corpus licensing | Files gitignored; manifest records licenses; public CI uses the MIT subset only. |

---

## 9. Decisions (2026-09-30)

1. AutoCAD 2027 licence: valid for one year.
2. The repo becomes public later; all samples/fixtures/references stay local only.
3. Licence: MIT. npm scope: `@truedxf/*`.
4. Generator: Python + ezdxf first; our TS writer later.
5. Renderer: three.js only (no raster/SVG/canvas/Node render backends); renderer-agnostic display
   list kept as the seam. Visual tests run the three.js renderer in headless Chromium.
6. Agent instructions live in `AGENTS.md`.

---

## 10. Immediate next steps

1. Scaffold the monorepo (Phase 1.1) and write `AGENTS.md`.
2. AutoCAD harness smoke test: open a DXF in accoreconsole, `-PLOT` to PNG and PDF with the
   dedicated PC3/PMP, `DXFOUT`; confirm prompts and determinism; then the calibration suite.
3. Tokenizer + encoding + corpus runner (Phase 1.2–1.6).
4. Build `docs/questions.md` from all UNKNOWN/CONFLICT markers in the notes (IDs → generator cases).
