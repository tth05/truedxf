# Open todos

Things left open after Phases 0–5 (2026-09-30), collected from the final reports of all work
streams. Unanswered AutoCAD questions stay in [questions.md](questions.md); this file lists work.
Tick items off (or delete them) when done.

## Environment / harness

- [x] Compare merged proxy tag glyphs with candidate fonts; use the verified TXT default
      for empty UNICODE_TEXT2 font requests through shared resolution (2026-10-03, note 04 §16).
- [x] Q-0740: analyze all 26 `proxy-font-selection` references and implement the verified
      charset/typeface/file/bigfont rules in shared resolution (2026-10-03, note 04 §16.1).
- [ ] Q-0741: other proxy charsets/typefaces/style flags and file-only TrueType face selection
      remain unverified; preserve the tested boundaries rather than request another run.
- [x] Identify native FD and bottom CJK text/style paths in the three arch-cn corpus windows;
      stage 31 deterministic font-resolution probes (2026-10-03, note 04 §15).
- [x] Run all 31 `font-resolution` probes through AutoCAD; answer Q-0736 and fix localized
      SimSun resolution plus unresolved-family Unicode linking (2026-10-03, note 04 §15).
- [x] Analyze the 18 `font-metrics` references and correct large upright SimSun string
      anchors/relative-outline rounding (2026-10-03, note 04 §15.3); preserve smaller text,
      viewers and unprobed fonts/orientations. Near/far AutoCAD references are identical.
- [ ] Q-0737 remainder: curve/edge masks, smaller SimSun grid fitting and SHX/GBCBIG
      precision. Current font task stops at the verified large-text correction; no new batch.
- [x] Missing-bigfont MTEXT: preserve CJK fallback while suppressing primary SHX text
      (`font-resolution/simplex-missing-bigfont`, gh109 native MTEXT 9B0, note 04 §15.1).
- [x] Regenerate all AutoCAD references now that the Liberation fonts are visible to AutoCAD
      (started 2026-10-01; before, most suites were plotted with simplex.shx substitution), then
      re-score without `--hide-fonts` and update the scoreboard in the README.
- [x] `fileformat` suite harness failures (crash reports locked a worker directory; fixed in the runner).
- [x] Re-score all suites against the regenerated (real-font) references (2026-10-01, README
      scoreboard; reports in samples/reports/scoreboard/*.json list every case).
- [ ] TrueType text against the real-font references: compared with the simplex-substituted
      plots, F1(r=1) ≥ 0.99 fell for mtext (204 → 138), fileformat (317 → 231), text (284 → 260),
      dimensions (348 → 323), leaders (105 → 85), linetypes (215 → 186); pixel-exact fell most in
      dimensions (146 → 1), fileformat (178 → 8) and leaders (80 → 26). 2026-10-01: the raster
      driver's whole-pixel glyph advances (note 04 §14) recovered most of it (mtext 138 → 175,
      fileformat 231 → 313, leaders 85 → 107); what is left is mostly glyph rasterization.
- [ ] TrueType raster positions, open cases (note 04 §14): column MTEXT with a centred
      attachment (text-probes/mtx-cols-dynauto-mc, -dynman-bc) does not follow the whole-pixel
      rule; string splits at tabs and fallback fonts are inferred, not probed.
- [ ] MTEXT positions off before the pixel rule: text after a tab sits a few px right of
      AutoCAD's (mtext/para-indent-*), the second line of a wrapped `\L` paragraph is 7 px right
      (mtext/code-underline-wrap), the CJK fallback font differs from AutoCAD's
      (text/escape-malformed-*, text/fallback-cjk-*).
- [ ] Remove the Liberation workaround from scripts/docs once references are regenerated
      (`--hide-fonts ^liberation`, harness `text.unavailableFonts`).
- [x] IMAGE / WIPEOUT in the console: R2000 and older files plot bitmap, frame and WIPEOUT mask;
      R2004+ files plot none of them (render-probes, 2026-10-01; note 07 §8.4/§8.5). A missing
      image file plots the frame plus the path as text (height = width / 42) (5a79616).
- [ ] IMAGE: AutoCAD smooths bitmaps when plotting (we sample nearest-pixel); the R14 corpus
      file's missing-image text is ~14 % larger than in R2000 probes (cause unknown); whether
      the text uses $TEXTSTYLE or Standard; corpus-ezdxf-wipeout-random (no mask/frame).
- [ ] Load `AcMPolygonObj26.dbx` in the harness so MPOLYGON references aren't empty.
- [ ] Generator: produce valid proxy entities (all `misc/proxy-*` fixtures are rejected by AutoCAD).
- [x] Draw proxy opcode-33 DWG-bitstream LWPOLYLINEs through the ordinary polyline drawer;
      verify real corpus graphics against AutoCAD (`corpus-proxy`, 2026-10-03; note 07 §15.5).
- [x] Proxy graphics: decode TEXT/TEXT2/UNICODE_TEXT/UNICODE_TEXT2 through normal TEXT layout,
      retaining embedded fonts and command-relative padding; restore gh109 labels and filled
      SHELL columns (2026-10-03, note 07 §15.6).
- [x] Proxy POLYLINE preserves FILLON; plot-time FILLMODE overrides the saved header and
      outlines proxy SHELLs at 0; fully overridden MTEXT bypasses missing base bigfont
      (2026-10-03, `fid-proxy-probes`, note 07 §15.7; inline zoom pixel-exact).
- [x] gh109 stair hatch phase/spacing: all 23 PDF lines agree with stored HATCH 5DE;
      PNG F1(r=1)=1.0000. No phase correction (2026-10-03, note 07 §15.7).
- [x] Proxy FILLON persists after SHELL/POLYGON/TEXT; missing base bigfonts hide only base
      MTEXT runs, retaining advances for inline runs (2026-10-03, `fid-proxy-followup`,
      Q-0738–Q-0739, note 07 §15.8; both mixed MTEXT zooms pixel-exact).
- [ ] Proxy graphics: exact raster coverage/ties and the opcode-38 Arial/empty-family
      PNG/PDF font-selection distinction (Q-0758–Q-0759, note 07 §15.8). Wall half-pixel
      zoom is pixel-exact; hatch phase is correct. Shared localized-family resolution is
      handled by the parallel font branch; no proxy-only resolver.
      Non-unit tracking, raw/decoration flags and non-+Z text remain source-based/unit-tested.
- [ ] Proxy graphics: initial layer/linetype/lineweight inheritance, non-+Z OCS,
      nested model transforms in blocks and ordinary linetype-index mapping still need valid
      discriminating AutoCAD fixtures (the corpus verifies initial colour and top-level geometry).
- [ ] Generator: fixtures that need our own test SHX fonts (`plan:` entries in questions.md) —
      install/point AutoCAD at `packages/fonts/assets` and add the suites.
- [ ] Visual harness: the densest hatch fixtures exhaust browser memory; cap or split them.
- [ ] ezdxf baseline score: render every case with ezdxf's drawing add-on and
      score it, so the "beat ezdxf" claim is measured.

## Raster emulation (packages/render/src/raster.ts)

- [ ] Exact pixel ties resolved by AutoCAD's floating-point noise (not modelled; note 08 §10.2).
- [ ] SPLINE tessellation rule in plots.
- [ ] Solid hatches with islands: which island vertices cut the outer edges (4–39 px off).
- [ ] Arcs that leave the canvas (the "fits on the canvas" test) and huge clipped bulge arcs.
- [ ] Regressions to check: tilted-OCS circles, OCS hatches (`ocs/hatch-z`, `ocs/hatch-negz`),
      large angular-dimension arcs one pixel too far out.
- [ ] Extents plots: AutoCAD's unexplained padding (note 03 §6.2; extents suite 7/18).
- [ ] Solid fills stop 1 px short of viewport frames (right/top); a 16×12 in layout with
      margins/offset maps ~1 px off.

## Entities and features

- [x] Plot styles in the renderer (rung 15, 2026-10-12): CTB/STB pens (colour, grayscale,
      screening, lineweight, end/join, pen linetypes, raster fill styles), STB 380/390 resolution,
      stored page setups (`PlotRequest.pageSetup`). CPU scores: plotstyles 69/70 at F1(r=1) ≥ 0.99
      (before: 13), pagesetup 43/62 (rest: PLOTROTMODE 0/1 and detailed-plot cases).
- [ ] Page setups: display / view plot areas (plotted as extents), detailed -PLOT answers that
      `PlotRequest` lacks (offset, centring: `pagesetup/io-*`), device margins of detailed plots
      (`margins-detailed-*`).
      AutoCAD facts are in (2026-10-12): note 06 §6.2–§6.5 (CTB/STB keys, lineweight index,
      colour/policy rules, grayscale/screening formulas, end/join/fill, STB resolution) and note 08
      §2.1/§2.3/§10.17 (page setups plotted as stored: 73, 147 vs 75 vs 142/143, flags 32/64/128,
      offsets); references `plotstyles/*`, `pagesetup/*`, checks `analyze_plotstyles.py`.
- [x] Plot styles measured (2026-10-12): CTB pen linetypes 1–30 + adaptive fitting (note 06 §6.7),
      fill-style tiles (§6.8), colour books and gradients bypass the pens (§6.4, §1.7), acad.ctb =
      no styles; margins x rotation, 46/47 units and axes, 148/149 (note 08 §2.1, §2.5, §10.17);
      checks `analyze_pen_patterns.py`, `analyze_plotstyles.py`. Follow-up (2026-10-12): fill
      tiles anchored to the PNG bottom-left pixel for every rotation/margin/offset (Q-0760, §6.8);
      wide pen-linetype dashes are butt-ended, caps only at curve ends, joins inside dashes, dots =
      discs (Q-0761, §6.7); Window plots apply 46/47 along the paper axes, PLOTROTMODE 0/1 table
      (note 08 §2.1, §10.17).
- [x] `@truedxf/plot`: 46/47 of rotated Window page setups along the paper axes (note 08 §2.1;
      `plotPlacement`, 2026-10-12).
- [x] Renderer, wide pen-linetype lines (Q-0761): butt dash ends with caps only at curve ends,
      joins inside dashes, disc dots (note 06 §6.7; disc outline approximate, lt-wide-508 F1 0.998).
- [x] Apply the measured pen linetypes, fill-style tiles, stored margins (40–43, PNG = printable
      area), 46/47 device-axis offsets and 148/149 layout shift in `@truedxf/plot`
      (`penLinetypeDashes`, `fillStyleInk`, `plotPlacement`; 2026-10-12).
- [ ] Wide polylines with linetypes (`pl-wide-*`, dash phase drift on dashed wide arcs).
- [x] PDF underlay content: PDF.js via `@truedxf/pdf` (`RenderEnv.pdf`), clip, contrast / fade /
      monochrome fitted to AutoCAD (2026-10-03, note 07 §10.3).
- [ ] PDF underlays: AutoCAD fills without antialiasing and keeps sub-pixel strokes faint, PDF.js
      antialiases and widens them to 1 px (Q-0746); CropBox / /Rotate / unpainted areas / missing
      file / page names (Q-0742–Q-0745, Q-0747) need AutoCAD cases; per-underlay OCG layer states
      (Q-0664); viewer: textures of large underlays are copied from the worker on every LOD step;
      the playground does not serve pdfjs-dist's standard_fonts / cmaps / wasm (`pdf.assetsUrl`).
- [ ] Gradients are close but not pixel-exact (AutoCAD dithers its own mesh); shifted
      HEMISPHERICAL/CURVED variants.
- [ ] Hatch background colour, text-box loops, `ellipse-edge-param-closed`, hatch dots with lineweight.
- [ ] MULTILEADER: zero-length/disabled dogleg, spline leaders, text frames, underline
      attachments 5/6/8, breaks, block attributes (~20 cases).
- [ ] LARGE_RADIAL_DIMENSION group 40 text shift; DIMTMOVE 1/2 offsets from a single sample.
- [ ] MTEXT: explicit `\pt` tab stops, TTF stack geometry (second-divider / escaped-`;` stacks
      parse correctly; only their geometry is wrong), `\A1;`/`\A2;` against stacks, flow
      direction 3. (Columns, text frame and mask:
      done 2026-10-01, note 04 §3.7.1; open: frame lines 1 px right/below AutoCAD's in raster
      plots, `user/text-frame4`.)
- [ ] Extents of SHX TEXT/MTEXT: cell box like TrueType (note 03 §6.2) or ink? Unmeasured.
- [x] MTEXT CJK wrapping: breaks between CJK characters, kinsoku (2026-10-02, note 04 §3.6.2).
- [ ] A STYLE naming the font *file* `msyh.ttc` (no family XDATA): AutoCAD did not use YaHei
      (CJK drawn SimSun-like, Latin SHX-like; first run of text-probes/cjk-*), truedxf loads the
      file. TTC by file name unsupported in AutoCAD? Probe and match.
- [ ] TEXT: vertical text (STYLE flag 4), SHX underline −0.15·h shift (cause unknown), synthetic
      italic, complex scripts (Arabic/Thai shaping, bidi), missing-glyph TTF fallback font.
- [ ] MLINE: sharp-mitred / self-overlapping fills, non-90° caps; MESH semi-sharp creases.
- [ ] Unresolved xref placeholder text ("Xref <path>").
- [ ] Perspective viewports; XCLIP front/back clip planes cutting geometry.
- [ ] Fit-tolerance spline approximation (Q-0177); wide-polyline miter limit between 7.2° and 30°.
- [ ] Transparency: a few colours off by one (ACI 30).
- [ ] Hold-out: `mixed` suite at 29/37.

## Model / parser

- [ ] The 14 custom entity classes still UNKNOWN (KS_*, LIGHT, 3DLINE, REPEAT/ENDREP, …) —
      render via proxy graphics where present.
- [ ] ACAD_TABLE cell decoding (only the `*T` block is drawn); MESH override data.
- [ ] LARGE_RADIAL 13/15 and hatch ellipse-edge angle-vs-parameter questions (raw values stored).
- [ ] Model load speed dropped from 64 to ~53 MB/s with the complex parsers — profile.

## Failure triage backlog (2026-10-01)

Root causes found by the triage of all 517 failing cases (F1(r=1) < 0.99) that are not fixed yet,
with the case count each would lift. Done in the same round: linetype text with TrueType, TTF
stacks by ink box, U+2205 as Ø, raster arcs by arc extent, windows-1252 table, LEADER 74
default, FILLMODE for pattern hatches, extents edge tolerance.

- [ ] Extents plot padding (~40 cases: fileformat, text-probes, layouts, points): accoreconsole
      pads the window on a virtual-screen grid that depends on the *Active VPORT; partial model in
      note 08 §10.15, no rule for all view heights yet. Needs more probe sweeps.
- [ ] Tilted/non-uniformly scaled circles (16: ocs, blocks, xclip): near-flat tilts plot with the
      circle rule; ellipse segment count seems based on the largest curvature radius.
- [ ] MTEXT line/tab-start side bearings (~15): glyph after a tab sits with its ink on the stop;
      leading spaces keep the next glyph's lsb; decorations must not cancel ext0; with 41 = 0
      leading tabs don't count.
- [x] Missing-glyph boxes for control/unknown characters, caret codes (X − 64) & 0xFFFF,
      `%%nnn` digit buffer (7b59a45); special.shx `~x` pairs (98f087b).
- [x] Bigfont lookup by the bigfont's own DBCS code page, bigfont space, gbcbig at 1/8 h (c970db3);
      SHX group-3 paths by base name, unknown `\f` family draws nothing, XDATA family via the
      group-3 TTF (41142cf).
- [x] Missing fonts: `text.missingFont` "autocad" | "fallback", `fallbackFont`, `fallbackBigFont`,
      `PlotResult.notes` font-missing / bigfont-missing; viewer option + Diagnostics panel.
- [ ] Missing assigned characters AutoCAD gets via Windows font linking (U+FFED small square,
      mtext/stack-tol-signs-nospace); fonts.ts API for "Arial's .notdef" (replace the
      `fallbackGlyph(0x41).font` workaround in text-layout `missingGlyphBox`); is raw DEL a
      full-advance box; does the `%%nnn` buffer persist across strings.
- [ ] Probe: code page and height of non-AutoCAD bigfonts (hztxt.shx, the most common after
      gbcbig); inline `\F…,bigfont` with a missing bigfont; move the font-probes generator
      (a one-off script, not in the repo) into tools/gen.
- [ ] MLINE: end-cap colours from the second element; element linetypes continuous across
      vertices (10).
- [ ] Linetyped circles that plot continuous use the graphics-system tessellation (f = 1.0)
      (9: linetypes).
- [x] Zero-length dashed LINEs plot like continuous (9046a00).
- [x] Layout extents: clipped content counts only inside its clip; model viewport frames count,
      the overall viewport does not (d9001f2, note 08 §10.16).
- [x] ACAD_TABLE drawn with the INSERT transform of 10/41–43/50/210 (06ef9b9; AutoCAD re-lays
      tables out along 11 on load and writes the block pre-rotated against 50; note 07 §13.1).
- [x] Hangs: (0,0)-(0,0) header extents count as unset, layout probes start from LAYOUT 14/15,
      max 65 536 chords per circle (03affd0); dense dashes on wide polylines (cf75a0c).
- [ ] Performance: ezdxf issue-574/7495047 still ~26 s / 105 M vertices from dense hatches;
      leader-r14 MLEADER proxy "proxy-text" unsupported.
- [x] Viewer visible bounds: reuse pick-index batch boxes to avoid a second vertex scan
      (2026-10-02). `list.bounds` is not equivalent: primitive vs batch clipping and float64
      vs float32 coordinates (note 08 §10.16). Incomplete pick coverage still scans.
- [x] SHAPE entities (2026-10-01, 092dbcf; corpus files lack their .shx files and now report
      `shape-not-found` / `shape-missing-file`).
- [x] Vertical TEXT (STYLE flag 4) and MTEXT flow direction 3 (2acb863, 746652c).
- [ ] Vertical: OS/2 typo descender for TTF ALIGNED/Right (0.7 %); MTEXT flow 3 with other
      attachments, wrapping, stacks, inline fonts (pitch 4/3·h·f and 0.55·h from one sample).
- [ ] Hatch background colour (4).
- [x] ACIS ellipse-curve records read from the wrong token (history id shifted every value) →
      edges millions of units long; tolerant vertices/edges; intcurve B-splines (f793242).
- [ ] ACIS: subtype references (`ref n`) and `parcur` intcurves (78 corpus edges still chords).
- [ ] SHX and TTF TEXT with thickness in a 3D view is not extruded (thickness-text-shape-iso).
- [x] HATCH: collinear pattern lines on boundary edges, edge-crossing slab levels for
      self-intersecting loops, > 100 000 pattern lines plot nothing, hemispherical gradients,
      ellipse edge 50/51 angles, HATCH boundary in the extents, MPOLYGON 11 offset (2026-10-01,
      692398c…80cd939).
- [ ] HATCH: text-box loops stay holes per style (3); MPOLYGON boundary not drawn (Q-0367);
      rotated LINEAR gradient span (gradient-extents-rotated-boundary); fileformat/
      corpus-gdal-additional-entities extents too large (not hatch-related); whether the
      100 000-line limit is HPMAXLINES or a separate plot limit.
- [ ] MULTILEADER: leader ends at the dogleg end when the dogleg is off / spline (6); text frame,
      underline attachments, per-line arrow override ignored, leader line breaks.
- [x] MTEXT paragraph codes unscoped by braces, `\ps` spacing below the paragraph, 44 = 0 as 0.25
      (9d22f09).
- [ ] `\A1`/`\A2` against stacks (3); `\T` tracking adds (T − 1)·xAvgCharWidth (2); oblique
      runs advance h·tan θ (2); probe `\psa`/`\psm` single gap 26/15·h at other heights/fonts.
- [ ] AC1032 TEXT without a 330 owner and without a BLOCK_RECORD table draws nothing.
- [ ] `$DWGCODEPAGE` aliases AutoCAD accepts/rejects (5: DOS850 decoded, CP1251/ANSI1251/
      KCS5601/UTF-8 rejected; our decoding of these now yields C1 boxes); XCLIP clips
      ATTRIBs; xclip front/back planes for curves; XLINE/RAY clipped to the effective plot area.
- [ ] Which arcs with off-canvas circles use the raster arc rule (note 08 §10.13): dimension and
      polyline arcs do, plain ARCs (splines/rational-quarter-circle, fileformat/version-r12) do
      not; the renderer uses a heuristic. Probe the same arc as ARC, LWPOLYLINE bulge, dimension.
- [ ] SHX arcs ~0.5–1 px too large / PLOT facet count (inscribed polygon?; SHAPE and SHX text).
- [x] SHX subshapes start pen-down (07de7b2).

## Later phases (not started)

- [ ] Phase 6 — AI fix loop (docs/agent-loop.md, `fix:next`, regression gate, hold-out seeds).
- [x] Phase 7 — viewer package and playground app (2026-10-01): `@truedxf/viewer` (worker
      pipeline, LOD, layouts, layers, picking, inspector, measure) and `apps/playground` (fixture
      compare, corpus browser). Follow-ups in "Viewer" below.
- [ ] Phase 8: release (docs site, examples, npm publishing).
  - [x] npm-ready package READMEs (install, absolute links, trademark notice), per-package
        versions with `workspace:^`, Release workflow (docs/RELEASING.md), licence review
        (2026-10-05).
  - [ ] npm org `truedxf`, first publish, trusted publisher per package (docs/RELEASING.md).
  - [ ] Make the repository public.
  - [x] Public site: emit a third-party notices file with the JS bundle:
        `licenses.txt` from the bundled packages, linked from the landing footer (2026-10-05).

## Performance

- [x] Bench set, `tools/corpus/src/bench.ts`, baselines and profiles (2026-10-02); `perf:viewer
      --gpu` now really uses the GPU.
- [x] 0: fingerprint gate (model dump + display-list hashes, plot and viewer mode).
- [x] 1: renderer batch merging and shared materials (viewer default), merging, picking and
      highlight geometry in the worker (2026-10-02).
- [x] 2: frontend memoization (properties, text layouts), viewer first render without probe pass
      when stored extents pass the scale check (2026-10-02).
- [x] Repair render regressions: retain one current property entry per inheritance/viewport
      context and skip speculative first fits for grossly stale-large header hints
      (2026-10-02).
- [x] 3: viewer LOD: dense hatch patterns, sub-pixel text, narrow lineweights and view culling
      of zoomed lists (2026-10-02).
- [x] Density-preserving text greeking: cached TTF ink area / SHX stroke length, one opaque
      run quad, explicit viewer LOD switch and hardware-AA 4×4 density comparison (2026-10-02).
- [x] 4: parser (2026-10-02): tokenizer, exact numbers, direct binary reads, compiled fields and lazy TTF parsing; all fingerprint gates identical.
- [x] 5: picking and merging in the worker, model per-entity heap (2026-10-02/03).
- [ ] Compact display list (line strips / indexed segments, per-range colours): deferred — the
      merged upload is ≤ 0.11 s and the main thread keeps ~3 MB after upload; worth it only if
      worker memory or transfer size becomes the limit (arch-cn-114 list ~200 MB).
- [x] Viewer block tessellation reuse (2026-10-02): bounded per-frontend Float64 primitive
      streams at exact scale/inherited properties, rigid replay with current picks; clips,
      viewports and unsupported transforms fall back.
- [x] Block reuse admission (2026-10-02): draw first uses directly, record on the second,
      defer first-definition signatures, bound admission metadata, and skip measured cheap
      single continuous-LINE definitions.
      Recheck isolated render/zoom timings, fixed-view pixels and all fingerprint gates.
- [ ] Make viewer block stroking/triangulation equivariant under rigid replay: mixed direct/
      canonical output still exceeds the 1e-3 px ordered-coordinate bound in huge-blocks,
      viewports and dense-hatch despite identical counts and CPU pixels.
  - [x] Loaded-model heap: circles meet the ≤500 B/entity plan budget through record cache
        release, sparse optional properties, string interning, compact scan metadata and a
        deferred entity index (2026-10-02).
  - [ ] Stretch memory target: circles ≤400 B/entity; the retained implementation uses ~421 B.
        Frozen-default sharing needs a separately approved baseline migration: the existing
        model already shares frozen points, so a value-only frozen walker changes old hashes.
  - [x] Loaded-model performance acceptance for circles/dimensions/splines/architecture/proxy/R12:
        unqualified record lookups no longer rebuild released parts, including app/XDATA ranges.
        Two alternating five-run pairs against rebased master keep all frontend cases below
        master while circles remain ~421 B/entity; smaller model timings vary within noise
        (2026-10-03).

## Viewer (packages/viewer, apps/playground)

- [x] Additional files: `viewer.addFiles` / `openFiles` / `openDrawing`, loose name matching
      (base name, case, implied font/image extensions, longest common folder suffix), re-render
      on change, `image-missing` / `shapefile-missing` warnings; playground multi-file open,
      folder open / drop, Files panel (2026-10-01, 48a3f77, 3c0635e, b704017).
- [ ] render `transferables()` lists cached image pixel buffers (DataCloneError on the next
      render; the viewer copies them as a workaround).
- [ ] Missing complex-linetype shape files reported only for linetypes in use (ltypeshp.shx);
      scan stored TTF name tables so family names resolve;
      xref loading from the file store; optionally show which stored file served a request.
- [x] Frontend view culling: cache complete-list top-level pick bounds in the worker; cull finer
      smooth lists to 3× visible coverage and re-request on pan with the LOD debounce. Retain the
      complete GPU list outside detail coverage with disjoint scissors; coarse fallback is
      display-only for picking. Extents/plots stay identical (2026-10-02).
- [ ] Hairlines while navigating: lineweight-widened strokes scale with the list until the next
      LOD step (up to 2× too thick / thin).
- [x] Publishable worker entry: `scripts/package-dist.ts` rewrites the worker URL to the
      emitted `dist/worker.js` (`pnpm build`).
- [ ] Layers panel: per-layout VP-freeze state, layer colour / linetype overrides; xref layers.
- [ ] Picking inside block references returns the innermost entity; offer "select parent INSERT".
- [x] Measure: object snaps (endpoint, midpoint, centre, quadrant, node) from display-list
      annotations (render `annotations`), Alt suspends them (2026-10-05).
- [ ] Measure: intersection / perpendicular / nearest snaps; a thicker overlay line.
- [x] Text search (`viewer.search`, playground `Ctrl+F`) over the drawn texts of the current layout,
      with a marker (`setMarker`) and counts for other layouts (2026-10-05).
- [x] Batch fragmentation: viewer merges opaque geometry by kind per clip run with global depth
      order (2026-10-02); 89 903 frontend batches → 23 calls, RX 9070 XT frame 701 → 4.4 ms.
      Original plot path remains the default in `@truedxf/three`; `?merge=0` disables viewer merging.
- [x] Move merging, picking and highlight extraction into the viewer backend (2026-10-02).
      DOM-free `@truedxf/three/merge` export; transferred pre-merged buffers are released after
      upload. Original geometry and Flatbush stay in the worker; asynchronous interaction is
      generation-guarded, hover requests coalesce, selected geometry is cached. Plot previews and
      the >4-million-depth-order fallback keep ordinary batches.
- [ ] WebGPU renderer trial.
- [x] Public site (2026-10-01): `vite build --mode public` without samples code / sourcemaps,
      landing content + meta / Open Graph / JSON-LD, robots.txt, sitemap.xml, Cloudflare
      `_headers`, Liberation fallback fonts, remembered fonts folder, "Report a problem" link.
- [x] Public site: CJK fallback font: Noto Sans SC (OTF/CFF parses in ~50 ms), loaded only for
      drawings with CJK text (`cjkFallbackFont`, render `text.cjkFallbacks`) (2026-10-05).
- [ ] Public site: a Hangul fallback (Noto Sans SC has none; e.g. Noto Sans KR / Nanum, OFL);
      subset the CJK fonts; SHX-looking fallback for missing SHX fonts (today they fall back to
      Liberation Sans).
- [ ] Public site: long-tail pages (e.g. "open DXF without AutoCAD", DXF → PNG / PDF export once
      plotting to a file exists in the viewer). Sample drawing done (2026-10-05):
      `tools/gen/showcase.py` → `apps/playground/public/samples/`, "Try the sample drawing".
- [x] Public site (2026-10-05): real 404 page, "new version" notice (version.json), non-DXF /
      DWG messages with a report button, zoom buttons, export (PNG, clipboard, print), keyboard
      shortcuts dialog, recent drawings (file handles, Chromium), PDF.js support files,
      small-screen notice.
- [x] Public site launch: remove the Basic Auth gate (2026-10-13).
- [ ] Public site: privacy policy / legal notice (Datenschutzerklärung, Impressum) before launch;
      custom domain (then set `SITE_URL`).

## 3D wireframe views (model space)

Sample: `samples/external/files/github/LibreDWG__libredwg/issue-1071/18440454_Waschbecken2_extracted/Waschbecken-2018.dxf`
(13 `3DSOLID`s with SAB data in ACDSDATA; AutoCAD opens it in an isometric view).

- [ ] Model space through a view direction: apply the `*ACTIVE` VPORT view direction, target and
      twist like `viewportMatrix` (render/src/draw/viewport.ts), so files open in their saved view
      (resolves Q-0729). Viewer: view presets (Top, Front, Left, Right, Back, Bottom, SW/SE/NE/NW
      Iso); each change re-runs the frontend (no free orbit).
- [ ] ACIS curved edges: flatten `intcurve` and other non-line, non-ellipse edges from their
      stored B-spline approximation instead of drawing the chord (render/src/draw/acis.ts,
      `acis-curve` note).
- [ ] ACIS isolines on curved faces (ISOLINES): cylinders, cones, spheres, tori, then spline
      faces. Placement still to be verified with AutoCAD (Q-0187).
- [ ] Verify against AutoCAD: plot Waschbecken-2018 in its saved iso view (2D wireframe) via
      tools/acad and add it as a local `user/` fixture.
