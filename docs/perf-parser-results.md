# Parser performance results (2026-10-02)

Node v23.10.0, median of three runs. All commands ran from the `perf/parser` worktree.
Model milliseconds include tokenization. Throughput uses MiB, matching the benchmark runner.
No sample or baseline files were changed. Raw logs, JSON reports, and profiles are under
`.venv/perf-task/` in this worktree (ignored by Git).

```sh
node --disable-warning=ExperimentalWarning --max-old-space-size=16000 tools/corpus/src/bench.ts --runs 3 --parse-only --only "circles|arch-cn|splines|r12|dims|binary|huge"
```

The tooling commit adds `--parse-only`, runs the fingerprint unit tests with their Node test
runner, and gives the existing geometry property tests a 15 s timeout. Benchmarks run after
validation, without overlapping our fingerprint/test jobs. Timings still vary between runs.
The first numbers run slowed unchanged tokenizer and binary stages substantially, so it was
repeated; both measurements are retained below. Small per-step timing changes are inconclusive.
The parse-only command does not exercise fonts; font initialization is measured separately.

## Validation for every retained commit

| Change | Typecheck / test / lint | Vitest tests + Node tests | model-all | fixtures model / plot / viewer | corpus model / viewer |
|---|---|---:|---:|---:|---:|
| Tooling / fresh baseline | PASS / PASS / PASS | 567 + 6 | 4833 identical | 4057 identical each | 315 identical each |
| 1: ASCII scanner | PASS / PASS / PASS | 569 + 6 | 4833 identical | 4057 identical each | 315 identical each |
| 2: exact numbers | PASS / PASS / PASS | 571 + 6 | 4833 identical | 4057 identical each | 315 identical each |
| 3: binary numeric reads | PASS / PASS / PASS | 572 + 6 | 4833 identical | 4057 identical each | 315 identical each |
| 4: model field reading | PASS / PASS / PASS | 576 + 6 | 4833 identical | 4057 identical each | 315 identical each |
| 5: lazy fonts | PASS / PASS / PASS | 577 + 6 | 4833 identical | 4057 identical each | 315 identical each |

Every check reported **0 differences and 0 error records** against the saved `baseline`.
Property tests retain the pre-change tokenizer, number parser, field reader, and record
structure as oracles. They cover malformed inputs, exact numeric bits (including negative
zero and NaN), field-definition identity/order, app-data ranges, coordinate scans/consumption,
lenient/default semantics, recursive scratch-buffer use, and exceptional UNKNOWN fallbacks.
The final suite has 75 Vitest files and 577 tests, plus 6 Node fingerprint tests.

## End-to-end parser comparison

Fresh unmodified parser versus the final implementation. Fonts do not affect these stages.

| File | Tokenize before MB/s | Tokenize after MB/s | Model before ms | Model after ms | Model speedup |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 305 | 534 | 3174 | 1719 | 1.85x |
| huge-blocks-187 | 430 | 778 | 951 | 703 | 1.35x |
| circles-117 | 293 | 583 | 4075 | 2278 | 1.79x |
| splines-82 | 260 | 506 | 2067 | 986 | 2.10x |
| dims-rumah-34 | 271 | 474 | 886 | 599 | 1.48x |
| r12-network-16 | 164 | 342 | 663 | 466 | 1.42x |
| binary-1 | 683 | 645 | 10 | 11 | 0.91x |
| binary-gdal-17 | 413 | 416 | 736 | 366 | 2.01x |

## 1: ASCII scanner

| File | Tokenize before MB/s | Tokenize after MB/s | Model before ms | Model after ms | Model speedup |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 305 | 562 | 3174 | 2946 | 1.08x |
| huge-blocks-187 | 430 | 378 | 951 | 1706 | 0.56x |
| circles-117 | 293 | 481 | 4075 | 4293 | 0.95x |
| splines-82 | 260 | 489 | 2067 | 1904 | 1.09x |
| dims-rumah-34 | 271 | 510 | 886 | 846 | 1.05x |
| r12-network-16 | 164 | 349 | 663 | 590 | 1.12x |
| binary-1 | 683 | 747 | 10 | 11 | 0.91x |
| binary-gdal-17 | 413 | 448 | 736 | 770 | 0.96x |

## 2: exact numbers

| File | Tokenize before MB/s | Tokenize after MB/s | Model before ms | Model after ms | Model speedup |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 562 | 520 | 2946 | 2573 | 1.14x |
| huge-blocks-187 | 378 | 717 | 1706 | 824 | 2.07x |
| circles-117 | 481 | 527 | 4293 | 3779 | 1.14x |
| splines-82 | 489 | 466 | 1904 | 1744 | 1.09x |
| dims-rumah-34 | 510 | 482 | 846 | 794 | 1.07x |
| r12-network-16 | 349 | 262 | 590 | 658 | 0.90x |
| binary-1 | 747 | 705 | 11 | 15 | 0.73x |
| binary-gdal-17 | 448 | 411 | 770 | 822 | 0.94x |

## 3: binary numeric reads

| File | Tokenize before MB/s | Tokenize after MB/s | Model before ms | Model after ms | Model speedup |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 520 | 596 | 2573 | 2148 | 1.20x |
| huge-blocks-187 | 717 | 786 | 824 | 707 | 1.17x |
| circles-117 | 527 | 584 | 3779 | 3207 | 1.18x |
| splines-82 | 466 | 509 | 1744 | 1471 | 1.19x |
| dims-rumah-34 | 482 | 560 | 794 | 705 | 1.13x |
| r12-network-16 | 262 | 353 | 658 | 608 | 1.08x |
| binary-1 | 705 | 861 | 15 | 9 | 1.67x |
| binary-gdal-17 | 411 | 427 | 822 | 697 | 1.18x |

## 4: model field reading

| File | Tokenize before MB/s | Tokenize after MB/s | Model before ms | Model after ms | Model speedup |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 596 | 605 | 2148 | 1563 | 1.37x |
| huge-blocks-187 | 786 | 810 | 707 | 640 | 1.10x |
| circles-117 | 584 | 586 | 3207 | 2189 | 1.47x |
| splines-82 | 509 | 529 | 1471 | 920 | 1.60x |
| dims-rumah-34 | 560 | 547 | 705 | 525 | 1.34x |
| r12-network-16 | 353 | 362 | 608 | 405 | 1.50x |
| binary-1 | 861 | 738 | 9 | 10 | 0.90x |
| binary-gdal-17 | 427 | 409 | 697 | 385 | 1.81x |

Compiled tables use an indexed lookup below code 1072 and a Map otherwise, with reusable
filled flags and direct app-data-aware range iteration. COMMON skips unrelated subclasses;
recovery and proxy reads use cached presence flags. Structural scanning caches subclass and
handle/owner information and appends parts in source order. Record loading needs no starts array.
Simple parsers extend the document-owned, unpublished base; their external copying behavior
and exceptional fallbacks are preserved. The 3DFACE field table is now compiled once.
Entity-key iteration was checked: property insertion order is preserved.

An initial gate caught enumerable cache changes in raw SEQEND records. New caches now use
ECMAScript private fields. Lazy allocation of the original `appRanges` array was discarded
because its enumerable empty array is part of the existing raw-record fingerprint.
The exported tuple helper remains compatible for explicit tag-list callers; the hot field
and recovery paths write values directly. Complex entity parsers retain their existing assembly.
The separate COMMON and type passes remain, with unrelated COMMON parts skipped; they were
not merged into a table that could alter recovery/subclass semantics.

## 5: lazy fonts

| File | Tokenize before MB/s | Tokenize after MB/s | Model before ms | Model after ms | Model speedup |
|---|---:|---:|---:|---:|---:|
| arch-cn-114 | 605 | 534 | 1563 | 1719 | 0.91x |
| huge-blocks-187 | 810 | 778 | 640 | 703 | 0.91x |
| circles-117 | 586 | 583 | 2189 | 2278 | 0.96x |
| splines-82 | 529 | 506 | 920 | 986 | 0.93x |
| dims-rumah-34 | 547 | 474 | 525 | 599 | 0.88x |
| r12-network-16 | 362 | 342 | 405 | 466 | 0.87x |
| binary-1 | 738 | 645 | 10 | 11 | 0.91x |
| binary-gdal-17 | 409 | 416 | 385 | 366 | 1.05x |

### Font initialization

Median of three constructor calls on identical bytes, including names, metrics, and the A
outline used for cap height. Glyph decoding work is deferred until requested; full frontend
speedups were not measured. No GSUB shaping or kerning is applied by our text layout.
Eager/lazy comparison tests cover generated CFF fonts, bundled TrueType fonts, and installed
Arial/Calibri where available: cmap indices, outlines, advances, metrics, GSUB tables, and
kerning pairs. The full plot/viewer fingerprint gate also remains identical.

| Font | Eager ms | Lazy ms | Initialization speedup |
|---|---:|---:|---:|
| LiberationSans-Regular.ttf | 12.26 | 2.77 | 4.43x |
| LiberationSerif-Italic.ttf | 8.78 | 1.68 | 5.23x |
| arial.ttf | 16.2 | 2.94 | 5.51x |
| calibri.ttf | 25.69 | 9.99 | 2.57x |

## Initial numbers measurement (retained for transparency)

| File | Tokenize MB/s | Model ms |
|---|---:|---:|
| arch-cn-114 | 605 | 2212 |
| huge-blocks-187 | 815 | 746 |
| circles-117 | 309 | 6502 |
| splines-82 | 224 | 4112 |
| dims-rumah-34 | 233 | 2063 |
| r12-network-16 | 95 | 1638 |
| binary-1 | 457 | 31 |
| binary-gdal-17 | 385 | 973 |

## Git delivery

The sandbox allows source edits here but denies writes to the worktree Git metadata in the
main checkout. The validated commits are on `perf/parser` in `.venv/perf-task/git`, based on
`ecbc38dfefba7ddaa27e0b3ac44b10b9c74158ad`. The actual worktree branch was not advanced.
A bundle at `.venv/perf-task/parser-perf.bundle` preserves the commit series. To attach it
from this worktree when Git metadata writes are allowed (the working files already contain
the validated changes):

```sh
git fetch .venv/perf-task/parser-perf.bundle perf/parser
git reset --mixed FETCH_HEAD
```

The reset updates the branch and index while retaining working files. Review any later local
changes before running these commands. Commit subjects and hashes are in the bundle/log.
