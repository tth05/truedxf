# tools/corpus

Node runners over the local DXF corpus (`samples/external/manifest.jsonl`, see
`samples/README.md`) and an ezdxf dump script (Python, `tools/gen` venv) for differential tests.
Reports go to `samples/reports/` (not committed); runners take `--filter <regex>` and `--limit <n>`.

| Command | What |
|---|---|
| `pnpm corpus:tags` (`tools/corpus/src/parse-tags.ts`) | tokenize and decode every value (`core-tags.json`) |
| `pnpm corpus:model` (`tools/corpus/src/load-model.ts`) | load into `@truedxf/model`: exceptions, diagnostics, coverage (`model-load.json`) |
| `node tools/corpus/src/diff-ezdxf.ts` | differential oracle vs ezdxf (`diff-ezdxf.json`, `diff-ezdxf.md`) |
| `node tools/corpus/src/dump.ts FILE.dxf` | truedxf's normalized dump of one file (JSON on stdout) |
| `tools/gen/.venv/Scripts/python tools/corpus/ezdxf_dump.py FILE.dxf` | ezdxf's normalized dump of one file |
| `node tools/corpus/src/img-shift.ts OURS.png ACAD.png` | ink bounding boxes and the best whole-pixel shift (±3 px) between two plots |

## Performance regression gate

Use `node tools/corpus/src/bench.ts --runs 3 --parse-only` to measure tokenizer throughput and
model loading without rendering, picking, or zoom work. The model timing includes tokenization.

`node --disable-warning=ExperimentalWarning --expose-gc --max-old-space-size=16000
tools/corpus/src/lod-check.ts [--only regex] [--fixtures 3] [--json report.json]
[--images output-dir]` compares smooth viewer mode with LOD off/on at one explicit window
derived from the off-mode fit. It covers the benchmark set and evenly spaced, sorted fixtures
from hatches/text/mtext/blocks. Fonts/layout/background match the benchmark; fixture images
resolve beside the DXF. JSON rows report vertices, frontend milliseconds and pixels differing
by more than 48 in any RGB channel, divided by the union of off/on ink pixels. Optional PNGs
contain off/on/diff images. The CPU rasterizer has no antialiasing, so this measures pixel-grid
aliasing as well as the approximations; it is not a browser screenshot comparison. `--expose-gc`
releases large fit/off lists between stages; measured frontend intervals exclude explicit GC.

For sub-pixel text density, use the hardware-AA comparison instead:
`node apps/playground/scripts/lod-check.ts [--only regex] [--label name] [--out directory]
[--skip-build]`. It renders both modes at the same LOD-off fit in Chromium on D3D11 (rejects
SwiftShader and disabled AA). The 1600×1000 browser viewport leaves a 1016×924 drawing canvas
with the current playground panels. Reports contain mean absolute RGB difference after 4×4
box downsampling and the percentage of cells differing by more than 24 in any channel, over
all complete cells. The comparison includes all viewer LOD approximations. JSON and mtext/arch-cn
off/on PNGs go to `.codex-out/` by default (`--images-all` saves every selected PNG pair); no
shared sample reports are overwritten. `?lod=0`
disables viewer approximations in the playground; zoom still re-tessellates curves normally.

`pnpm fingerprint --save` saves parser, fixture plot, and viewer fingerprints before behaviour-neutral
performance work; `pnpm fingerprint --check` compares afterwards and exits 1 on any difference.
**Plot mode must stay identical.** This checks exact model values and display-list bytes, including
colours, picking, clips and images; it does not compare rasterized screenshots to AutoCAD.

```sh
pnpm fingerprint --save --set all
pnpm fingerprint --check --set all
pnpm fingerprint --check --set fixtures --only lines-curves
```

Sets: `fixtures` covers every generated JSON/DXF pair (model + AutoCAD raster plot + smooth viewer);
`corpus` covers about `--sample 300` unique DXFs below `--max-mb 15`, sampled in SHA order, plus
the benchmark set except arch-cn, dense-hatch and huge-blocks (model + smooth viewer);
`model-all` hashes every unique ASCII/binary corpus DXF. The default is `fixtures,corpus`.
Corpus viewers omit external images like `bench.ts`; fixture viewers resolve images beside the DXF.
Fonts use the benchmark's local font index. Keep inputs and installed fonts fixed between runs.
Model hashes omit the store-backed header and raw record/store/tags fields; they include all tables and their
entries, blocks/entities, layouts, objects, classes, and diagnostic counts.

Baselines are local-only `samples/reports/fingerprint/<name>-<set>.json` (`--name baseline` by default).
Each ID records hashes, entity count (all block entities), list shapes, elapsed milliseconds and
per-stage errors. Identical error messages compare equal; failed stages remain visible in the
record/error counts. Missing/new records differ too. `--only <regex>` filters IDs and benchmark
names; saving with it replaces that set's baseline with the selected subset.

Use `--save --detail` to also save batch origins and Float32 positions in
`<name>-<set>.positions/<sha256-of-id>.bin`. `--check --detail` re-renders same-structure differences
and reports maximum coordinate deltas in device pixels when matching snapshots exist. Without
snapshots it reports "coordinates or colours differ"; zero delta means colours or other metadata
changed. Saving without detail creates no snapshots; stale snapshots are rejected by their hash.

`--jobs n` processes one file per worker (default min(8, cores − 2), at least one). The root script
sets `--max-old-space-size=8192`; this is a **per-worker** heap limit, not a total memory budget.
Reduce jobs on memory-constrained machines. Direct invocations should pass the same heap flag.
The tool prints progress, per-kind comparisons, record/error counts, and wall-clock seconds.
The hashing/snapshot unit checks (`tools/corpus/test/fingerprint.test.ts`) run with `pnpm test`.

`--lod-off` disables viewer approximations while leaving plot/model hashes unchanged.
`--output-dir directory` puts save/check baselines in that directory instead of shared samples;
use a separate `--name` for LOD-off before/after checks. Ordinary checks still default to the
saved `baseline` in `samples/reports/fingerprint/`.

## Differential oracle (docs/PLAN.md §5 Phase 2 item 7)

`ezdxf_dump.py` (ezdxf 1.4.4; `ezdxf.readfile`, falling back to `ezdxf.recover.readfile`) and
`src/dump.ts` write the same normalized JSON: a header-variable subset, LAYER/LTYPE/STYLE/
BLOCK_RECORD tables, layouts, blocks and model/paper space with the attributes of LINE, POINT,
CIRCLE, ARC, ELLIPSE, SOLID, TRACE, 3DFACE, RAY, XLINE, SPLINE, SHAPE, LWPOLYLINE,
POLYLINE+VERTEX, TEXT, ATTRIB, ATTDEF and INSERT (other types: type + handle only, so the entity
lists still align). Field names are truedxf's, absent optional values are `null`, numbers are
rounded to 12 significant digits.

`src/diff-ezdxf.ts` runs both over the corpus and compares with a relative tolerance of 1e-9:

- ezdxf dumps are cached in `samples/reports/ezdxf-cache/<hash of ezdxf_dump.py>/<sha256>.json.gz`
  (changing the script invalidates the cache; old hash directories can be deleted). Python runs
  as `--jobs` parallel `ezdxf_dump.py --serve` workers (default min(8, cores − 2)); a worker that
  exceeds `--timeout` seconds (default 300) is killed and restarted. `--refresh` re-dumps.
- Files above `--max-mb` (default 40) are skipped (ezdxf needs ~20× the file size in RAM).
- `--sample n` picks a deterministic sample (every k-th file in sha256 order).
- Entity lists are paired by index when the type sequences match, else by handle, else by type
  order; unpaired entities count as "missing in …". Each compared leaf attribute counts once.
- Patterns are keyed `context TYPE.field`. String differences that are only decoding get a
  ` [escapes]` / ` [codepage]` suffix, keys that differ only by decoding ` [encoded name]`.
  `src/diff-classes.ts` classifies every pattern (`ezdxf`, `ambiguous`, `dump`, `truedxf-bug`);
  the markdown report lists the top patterns with value pairs and notes.

Full run (4833 DXF, 7 > 40 MB skipped, 41 that ezdxf cannot load even in recover mode): ~45 s
ezdxf with 10 workers (cold cache) + ~50 s compare.

## Triage log (2026-09-30)

| | compared attributes | disagreements | agreement |
|---|---:|---:|---:|
| before | 50 659 171 | 650 517 | 98.716 % |
| after | 50 759 993 | 114 773 | 99.774 % (all 116 patterns classified: 112 624 ezdxf, 2 147 ambiguous, 2 dump) |

truedxf bugs found and fixed:

1. **Common properties after the subclass marker** (`100 AcDbEntity`, `100 AcDbLine`, `8 …`,
   `62 …`; QCAD/LibreCAD/QGIS): `readBase` recovers 8/6/62/420/430/440/370/48/60/67/390/347
   from other subclasses when absent from AcDbEntity, for types whose own subclasses never use
   those codes (not MTEXT: 48 = column width; ~239 k attributes). Same as ezdxf
   `recover_graphic_attributes`; AutoCAD rejects such files (note 11c §3), so the producing
   program's intent is the only reference.
2. **Entity data before the subclass markers** (VERTEX `10/20/30/70` before `100 AcDbVertex`,
   ACadSharp#421; ~250 k attributes): `fieldTable(defs, { lenient: true })` fills still-missing
   single fields from unconsumed tags of other parts. Used for the simple entities (LINE … SHAPE,
   SPLINE single fields, VERTEX, TEXT, INSERT), not ATTRIB/ATTDEF (ambiguous 73/280).
3. **Interleaved coordinates** `10 11 20 21 30 31` (AC1003 files, old QCAD): Y/Z are searched
   for up to the next X of the same code.
4. **SPLINE (0,0,0) tangents** (LibreDWG/ODA; ~17 k) are dropped (note 03 §3; ezdxf does the same).
5. **Binary DXF bools** (290–299) read as NaN → false in `TagStore.num` (packages/core), e.g.
   `$PSTYLEMODE`, layer 290 in binary files.
6. **Duplicate BLOCKs** are merged like AutoCAD (first name, second base point, both entity
   lists; note 07 §1.1, Q-0608) instead of dropping the second.
7. **SEQEND after an INSERT without 66/ATTRIBs** is attached to the INSERT instead of reported
   as orphan.
8. **LAYOUT ↔ block links** (39 "layout-without-block" files, mostly QGIS exports with stale
   LAYOUT 330 handles copied from a template): relinked via BLOCK_RECORD 340, then the Model
   layout by name, then remaining paper layouts ↔ unused `*Paper_Space*` blocks in order of
   appearance, as ezdxf does (note 08 §2; diagnostic `layout-relinked`). 5 files remain (ezdxf's
   intentionally broken layout test files).

Documented ezdxf differences (truedxf keeps the file's / AutoCAD's value): `\U+`/`\M+` escapes
kept by ezdxf and code-page mojibake (ezdxf trusts `$DWGCODEPAGE`; truedxf detects UTF-8 and
DBCS, note 01 §5); resources ezdxf creates on load (Defpoints/0 layers, BYBLOCK/BYLAYER/
Continuous, Standard, `*Model_Space` records, arrow blocks, Layout1); `$ACADVER` upgrades; 67=1
forced on paper-space block content; Defpoints `plot=0` forced; invalid layer color 0 → 7
(truedxf at parse time); case-sensitive XDATA APPID lookup; lineweight/style repairs of
ezdxf.recover; MTEXT column merging; entities ezdxf drops; files without `$ACADVER` parsed in R12
mode by ezdxf (subclass data lost).

Ambiguous (AutoCAD behaviour unknown): duplicate ENTITIES/TABLES sections (truedxf concatenates),
duplicate table records and header variables (truedxf: first wins; Q-0085), TEXT without 40
(truedxf 1, ezdxf 2.5; Q-0406), `210` without 220/230, relinking order of broken layouts.
