# Open todos

Things left open after Phases 0–5 (2026-09-30), collected from the final reports of all work
streams. Unanswered AutoCAD questions stay in [questions.md](questions.md); this file lists work.
Tick items off (or delete them) when done.

## Environment / harness

- [ ] Regenerate all AutoCAD references now that the Liberation fonts are visible to AutoCAD
      (started 2026-10-01; before, most suites were plotted with simplex.shx substitution), then
      re-score without `--hide-fonts` and update the scoreboard in PLAN.md.
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
      centring, `\A1;`/`\A2;` against stacks, column breaking, flow direction 3.
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
- [ ] Phase 7 — viewer package and playground app.
- [ ] Phase 8 — writer, editing API, release.
