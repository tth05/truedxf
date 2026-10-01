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
- [ ] IMAGE / WIPEOUT plotting rules. Correction (triage 2026-10-01): accoreconsole *does* plot
      WIPEOUT frames and masks (fileformat/corpus-ezdxf-wipeout-door, corpus-gdal-wipeout,
      corpus-gdal-binary-wipeout) and, for an IMAGE whose file is missing, the frame plus the
      file path as text (corpus-libredwg-leader-r14*). Still unknown: why corpus-ezdxf-
      wipeout-random shows neither mask nor frame (WIPEOUTVARIABLES 70 = 0, 290 = 0, two-point
      boundary with 71 = 1); images with a resolvable file are still unverified. The scorer
      omits IMAGE/WIPEOUT (cpu-suite without `--draw-raster`) until those rules are known.
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
- [ ] MTEXT: explicit `\pt` tab stops, TTF stack geometry (second-divider / escaped-`;` stacks
      parse correctly; only their geometry is wrong), `\A1;`/`\A2;` against stacks, flow
      direction 3. (Columns, text frame and mask:
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
- [ ] TrueType control characters draw the font's .notdef box, not "?" (~14: text, text-lato,
      mtext stacks).
- [ ] Bigfont lookup by the bigfont's DBCS code page, not Unicode (10: acad-default-fonts).
- [ ] MLINE: end-cap colours from the second element; element linetypes continuous across
      vertices (10).
- [ ] Linetyped circles that plot continuous use the graphics-system tessellation (f = 1.0);
      zero-length dashed LINEs plot like continuous (13: linetypes, lines-curves).
- [ ] SHAPE entities (8), vertical text (5, also listed above), hatch background colour (4).
- [ ] HATCH: collinear pattern lines on boundary edges are not drawn (7); self-intersecting loops
      need edge-crossing slab levels in `trapezoids()` (5); too-dense patterns plot nothing (5);
      rotated hemispherical/linear gradients (3); ellipse edge 50/51 are angles (3); text-box
      loops stay holes per style (3); HATCH boundary counts for extents (6).
- [ ] MULTILEADER: leader ends at the dogleg end when the dogleg is off / spline (6); text frame,
      underline attachments, per-line arrow override ignored, leader line breaks.
- [ ] `\A1`/`\A2` against stacks (3); paragraph-code scope and line-spacing semantics (7); `\T`
      tracking adds (T − 1)·xAvgCharWidth (2); oblique runs advance h·tan θ (2).
- [ ] `$DWGCODEPAGE` aliases AutoCAD accepts/rejects (5: DOS850 decoded, CP1251/ANSI1251/
      KCS5601/UTF-8 rejected); TrueType family lookup via the group-3 file (2); XCLIP clips
      ATTRIBs; xclip front/back planes for curves; XLINE/RAY clipped to the effective plot area.
- [ ] Which arcs with off-canvas circles use the raster arc rule (note 08 §10.13): dimension and
      polyline arcs do, plain ARCs (splines/rational-quarter-circle, fileformat/version-r12) do
      not; the renderer uses a heuristic. Probe the same arc as ARC, LWPOLYLINE bulge, dimension.
- [ ] SHX arcs ~0.5–1 px too large (inscribed polygon?); SHX subshapes start pen-down (note 04
      §4.3 corrected, code not yet).

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