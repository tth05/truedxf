# Open todos

Things left open after Phases 0–5 (2026-09-30), collected from the final reports of all work
streams. Unanswered AutoCAD questions stay in [questions.md](questions.md); this file lists work.
Tick items off (or delete them) when done.

## Environment / harness

- [x] Regenerate all AutoCAD references now that the Liberation fonts are visible to AutoCAD
      (started 2026-10-01; before, most suites were plotted with simplex.shx substitution), then
      re-score without `--hide-fonts` and update the scoreboard in PLAN.md.
- [x] `fileformat` suite harness failures (crash reports locked a worker directory; fixed in the runner).
- [x] Re-score all suites against the regenerated (real-font) references (2026-10-01, PLAN.md
      scoreboard; reports in samples/reports/scoreboard/*.json list every case).
- [ ] TrueType text against the real-font references: compared with the simplex-substituted
      plots, F1(r=1) ≥ 0.99 fell for mtext (204 → 138), fileformat (317 → 231), text (284 → 260),
      dimensions (348 → 323), leaders (105 → 85), linetypes (215 → 186); pixel-exact fell most in
      dimensions (146 → 1), fileformat (178 → 8) and leaders (80 → 26).
- [ ] Remove the Liberation workaround from scripts/docs once references are regenerated
      (`--hide-fonts ^liberation`, harness `text.unavailableFonts`).
- [ ] Verify IMAGE / WIPEOUT against full AutoCAD (`acad.exe`) plots — accoreconsole never plots
      them (rendering is implemented but unverified). Decision 2026-10-01: stays open for now.
- [ ] Load `AcMPolygonObj26.dbx` in the harness so MPOLYGON references aren't empty.
- [ ] Generator: produce valid proxy entities (all `misc/proxy-*` fixtures are rejected by AutoCAD).
- [ ] Generator: fixtures that need our own test SHX fonts (`plan:` entries in questions.md) —
      install/point AutoCAD at `packages/fonts/assets` and add the suites.
- [ ] Visual harness: the densest hatch fixtures exhaust browser memory; cap or split them.
- [ ] ezdxf baseline score (PLAN Phase 3.5): render every case with ezdxf's drawing add-on and
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

- [ ] Plot styles: CTB/STB parsing and application (`@truedxf/plot` is a placeholder; rung 15).
- [ ] Wide polylines with linetypes (`pl-wide-*`, dash phase drift on dashed wide arcs).
- [ ] PDF underlay content (only the frame is drawn).
- [ ] Gradients are close but not pixel-exact (AutoCAD dithers its own mesh); shifted
      HEMISPHERICAL/CURVED variants.
- [ ] Hatch background colour, text-box loops, `ellipse-edge-param-closed`, hatch dots with lineweight.
- [ ] MULTILEADER: zero-length/disabled dogleg, spline leaders, text frames, underline
      attachments 5/6/8, breaks, block attributes (~20 cases).
- [ ] LARGE_RADIAL_DIMENSION group 40 text shift; DIMTMOVE 1/2 offsets from a single sample.
- [ ] MTEXT: explicit `\pt` tab stops, stacks with a second divider / escaped `;`, TTF stack
      centring, `\A1;`/`\A2;` against stacks, flow direction 3. (Columns, text frame and mask:
      done 2026-10-01, note 04 §3.7.1; open: frame lines 1 px right/below AutoCAD's in raster
      plots, `user/text-frame4`.)
- [ ] Extents of SHX TEXT/MTEXT: cell box like TrueType (note 03 §6.2) or ink? Unmeasured.
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
- [ ] Writer / editing API (Phase 8).

## Later phases (not started)

- [ ] Phase 6 — AI fix loop (docs/agent-loop.md, `fix:next`, regression gate, hold-out seeds).
- [x] Phase 7 — viewer package and playground app (2026-10-01): `@truedxf/viewer` (worker
      pipeline, LOD, layouts, layers, picking, inspector, measure) and `apps/playground` (fixture
      compare, corpus browser). Follow-ups in "Viewer" below.
- [ ] Phase 8 — writer, editing API, release.

## Viewer (packages/viewer, apps/playground)

- [ ] Frontend view culling: every LOD step re-tessellates the whole drawing (a window only sets
      the pixel size), so deep zoom into large files costs a full render each time. Cull entities
      (block references by bounds) outside the requested window + margin and re-request on pan.
- [ ] Hairlines while navigating: lineweight-widened strokes scale with the list until the next
      LOD step (up to 2× too thick / thin).
- [ ] Publishable worker entry: the default worker URL (`./worker.ts`) only works when the
      package is consumed from source; emit a `dist/worker.js` and resolve it in builds.
- [ ] Layers panel: per-layout VP-freeze state, layer colour / linetype overrides; xref layers.
- [ ] Picking inside block references returns the innermost entity; offer "select parent INSERT".
- [ ] Measure: object snaps (endpoint, midpoint, intersection) and a thicker overlay line.
- [ ] Batch fragmentation: the builder starts a new batch at every Lines ↔ Triangles switch, so
      drawings mixing hairlines and widened strokes / fills get thousands of draw calls (1972 and
      3976 batches in two corpus files: 180–240 ms per frame on SwiftShader, ~15 ms on a real
      GPU). Options: hairlines as thin triangles in smooth mode, or reorder when primitives do
      not overlap.
- [ ] WebGPU renderer trial (PLAN Phase 7.1).

