import { existsSync, readFileSync } from "node:fs";
import { FontManager, MemoryFontProvider } from "@truedxf/fonts";
import { describe, expect, it } from "vitest";
import {
  layoutMText,
  layoutText,
  type MTextInput,
  mtextExtents,
  TextFonts,
  type TextInput,
  textFrame,
  unionOutlines,
} from "../src/index.ts";
import { hasArial, hasLato, hasSimplex, style, testFonts } from "./helpers.ts";

const MSYH = "C:/Windows/Fonts/msyh.ttc";

const Z = { x: 0, y: 0, z: 1 };
const text = (t: Partial<TextInput>): TextInput => ({
  text: "A",
  insert: { x: 0, y: 0, z: 0 },
  alignPoint: undefined,
  height: 10,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  style: "S",
  generationFlags: 0,
  halign: 0,
  valign: 0,
  extrusion: Z,
  ...t,
});
const mtext = (t: Partial<MTextInput>): MTextInput => ({
  text: "",
  insert: { x: 0, y: 0, z: 0 },
  height: 10,
  width: 0,
  definedHeight: 0,
  attachment: 1,
  flowDirection: 1,
  style: "S",
  extrusion: Z,
  direction: undefined,
  rotation: 0,
  lineSpacingStyle: 1,
  lineSpacingFactor: 1,
  bgFlags: 0,
  bgColor: 0,
  bgTrueColor: undefined,
  bgScale: 1.5,
  ...t,
});

/** AutoCAD's first alignment point 10 for a TEXT aligned at 11 = (100, 75). */
function insertionPoint(fonts: Awaited<ReturnType<typeof testFonts>>, t: Partial<TextInput>) {
  const f = textFrame(text({ alignPoint: { x: 100, y: 75, z: 0 }, ...t }), fonts)!;
  return f.frame.apply({ x: 0, y: 0 });
}

describe("TEXT layout with the MIT test font (deterministic)", () => {
  it("places left/baseline text at 10 with cap height = h", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutText(text({ text: "H", insert: { x: 5, y: 7, z: 0 } }), fonts);
    expect(l.glyphs).toHaveLength(1);
    const m = l.glyphs[0]!.matrix;
    // font above = 12 units → scale 10/12
    expect(m.a).toBeCloseTo(10 / 12, 12);
    expect(m.d).toBeCloseTo(10 / 12, 12);
    expect([m.e, m.f]).toEqual([5, 7]);
  });
  it("uses the vertical anchors T = h, M = h/2, B = −descent", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    expect(insertionPoint(fonts, { valign: 3 }).y).toBeCloseTo(65, 12);
    expect(insertionPoint(fonts, { valign: 2 }).y).toBeCloseTo(70, 12);
    expect(insertionPoint(fonts, { valign: 1 }).y).toBeCloseTo(75 + (4 / 12) * 10, 12);
  });
  it("mirrors backward text about the anchor and applies oblique after the width factor", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutText(text({ generationFlags: 2, widthFactor: 2, oblique: 45 }), fonts);
    const m = l.glyphs[0]!.matrix;
    expect(m.a).toBeCloseTo((-2 * 10) / 12, 12);
    expect(m.c).toBeCloseTo(-10 / 12, 12);
  });
  it("draws underlines as decoration lines", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutText(text({ text: "%%uAB%%u C" }), fonts);
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0]!.kind).toBe("underline");
  });
  it("suppresses text with a missing bigfont", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx", { bigFont: "missing.shx" })]);
    const l = layoutText(text({}), fonts);
    expect(l.glyphs).toHaveLength(0);
    expect(l.notes).toContain("text-suppressed-missing-bigfont");
  });
  it("draws fully overridden MTEXT despite a missing base bigfont", async () => {
    const inline = { name: "truedxf-test.shx", bold: false, italic: false };
    const fonts = await testFonts([style("S", "truedxf-test.shx", { bigFont: "missing.shx" })], [inline]);
    const input = mtext({ text: "\\Ftruedxf-test.shx;AB" });
    const healthy = await testFonts([style("S", "truedxf-test.shx")], [inline]);
    const actual = layoutMText(input, fonts);
    const expected = layoutMText(input, healthy);
    expect(actual.glyphs.length).toBeGreaterThan(0);
    expect(actual.glyphs).toEqual(expected.glyphs);
    expect(actual.lines).toEqual(expected.lines);
    expect(actual.notes).toEqual([]);
    for (const text of ["AB", "\\Fmissing-inline.shx;AB"])
      expect(layoutMText(mtext({ text }), fonts).notes).toContain("mtext-suppressed-missing-bigfont");
  });
  it("hides only missing-bigfont base runs and retains their advances around inline MTEXT", async () => {
    const inline = { name: "truedxf-test.shx", bold: false, italic: false };
    const fonts = await testFonts([style("S", "truedxf-test.shx", { bigFont: "missing.shx" })], [inline]);
    const healthy = await testFonts([style("S", "truedxf-test.shx")], [inline]);
    const input = mtext({ text: "AB{\\Ftruedxf-test.shx;CD}EF" });
    const actual = layoutMText(input, fonts);
    const expected = layoutMText(input, healthy);
    expect(actual.glyphs).toEqual(expected.glyphs.slice(2, 4));
    expect(actual.notes).toContain("mtext-suppressed-missing-bigfont");
  });
});

// AutoCAD 2027 recomputed 10 in the DXFOUT re-saves of suite `text` (the fixtures' Liberation
// Sans was substituted by simplex.shx on the reference machine) — VERIFIED-BY-ACAD 2026-09-30.
describe.skipIf(!hasSimplex)("TEXT alignment vs AutoCAD (simplex.shx, h = 20)", () => {
  const cases: [string, number, number, number][] = [
    // text, 72, 73, AutoCAD 10.x
    ["A", 1, 0, 92.381],
    ["AA", 1, 0, 81.9048],
    ["CENTER", 1, 0, 46.1905],
    ["iW.", 1, 0, 83.8095],
    ["A", 2, 0, 84.7619],
    ["CENTER", 2, 0, -7.619],
    [" A", 1, 0, 74.2857],
    ["A ", 1, 0, 80.4762],
    [" A ", 1, 0, 71.4286],
    ["A   ", 1, 0, 62.381],
    ["   ", 1, 0, 72.8571],
    [" A ", 2, 0, 42.8571],
    ["A   ", 2, 0, 24.7619],
  ];
  it.each(cases)("%j 72=%i 73=%i → 10.x = %f", async (t, h, v, x) => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    expect(insertionPoint(fonts, { text: t, height: 20, halign: h, valign: v }).x).toBeCloseTo(x, 3);
  });
});

// Vertical TEXT (STYLE flag 4) with a dual-orientation SHX font (VERIFIED-BY-ACAD 2026-10-01
// acad-default-fonts/vertical-*, fileformat/corpus-ezdxf-text-stacked-shx-font DXFOUT, note 04 §11).
// simplex "A"/"B" in vertical mode: ink x ±8/±7, y −21…0, pen advance −31 (h = 21: scale 1).
describe.skipIf(!hasSimplex)("Vertical TEXT (simplex.shx)", () => {
  const vfonts = () => testFonts([style("S", "simplex.shx", { vertical: true })]);
  it("stacks the characters down the column", async () => {
    const l = layoutText(text({ text: "AB", height: 21 }), await vfonts());
    const ys = l.glyphs.map((g) => g.matrix.f);
    expect(ys[0]).toBeCloseTo(0, 9);
    expect(ys[1]).toBeCloseTo(-31, 9);
    for (const g of l.glyphs) expect(g.matrix.e).toBeCloseTo(0, 9);
  });
  it("moves 10 along the column for Center/Right and ignores 73", async () => {
    const fonts = await vfonts();
    // ink column 0 … −52: Center 10 = 11 + 26, Right 11 + 52
    for (const valign of [0, 1, 2, 3]) {
      expect(insertionPoint(fonts, { text: "AB", height: 21, halign: 1, valign }).y).toBeCloseTo(75 + 26, 9);
      expect(insertionPoint(fonts, { text: "AB", height: 21, halign: 2, valign }).y).toBeCloseTo(75 + 52, 9);
      if (valign)
        expect(insertionPoint(fonts, { text: "AB", height: 21, halign: 0, valign }).y).toBeCloseTo(75, 9);
    }
  });
  it("ALIGNED scales the height to the 10 → 11 distance, FIT only the width; rotation + 90°", async () => {
    const fonts = await vfonts();
    const p = { insert: { x: 0, y: 0, z: 0 }, alignPoint: { x: 0, y: -104, z: 0 } };
    const a = textFrame(text({ text: "AB", height: 21, halign: 3, ...p }), fonts)!;
    expect(a.height).toBeCloseTo(42, 9);
    expect(a.rotation).toBeCloseTo(0, 12);
    const f = textFrame(text({ text: "AB", height: 21, halign: 5, ...p }), fonts)!;
    expect(f.height).toBeCloseTo(21, 9);
    expect(f.widthFactor).toBeCloseTo(2, 9);
    const b = textFrame(text({ text: "AB", height: 21, halign: 5, generationFlags: 2, ...p }), fonts)!;
    expect(b.rotation).toBeCloseTo(-Math.PI, 12); // BACKWARD: angle − 90°
  });
  it("lays out flow-direction-3 MTEXT as columns, the first ink at the insertion point", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const l = layoutMText(mtext({ text: "AB\\PC", height: 21, flowDirection: 3 }), fonts);
    const p = l.glyphs.map((g) => ({ x: g.matrix.e, y: g.matrix.f }));
    expect(p[0]!.x).toBeCloseTo(8, 9); // "A" ink ±8: its left edge at the insertion point
    expect(p[0]!.y).toBeCloseTo(0, 9);
    expect(p[1]!.y).toBeCloseTo(-31, 9);
    expect(p[2]!.x).toBeCloseTo(8 + (4 / 3) * 21, 9);
    expect(p[2]!.y).toBeCloseTo(0, 9);
  });
});

// Flow direction 3 with a TrueType font: one line, paragraphs 0.55·h apart, baseline at the
// insertion point (VERIFIED-BY-ACAD mtext/flow-direction-3; note 04 §11)
describe.skipIf(!hasLato)("Flow-direction-3 MTEXT with TrueType (Lato)", () => {
  it("draws the paragraphs on one line", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    const bb = layoutMText(mtext({ text: "BB", height: 10 }), fonts).glyphs.map((g) => g.matrix.e);
    const l = layoutMText(mtext({ text: "AB\\PC", height: 10, flowDirection: 3 }), fonts);
    const x = l.glyphs.map((g) => g.matrix.e);
    expect(x[2]! - x[1]!).toBeCloseTo(bb[1]! - bb[0]! + 5.5, 9); // B's advance + 0.55 h
    for (const g of l.glyphs) expect(g.matrix.f).toBeCloseTo(0, 9);
  });
});

describe.skipIf(!hasSimplex)("MTEXT extents vs AutoCAD's stored 42/43 (note 04 §3.6.1)", () => {
  const cases: [string, number, number | undefined, number][] = [
    // text, h, 42, 43
    ["X", 100, 66.667, 100],
    ["x", 100, 52.381, 100],
    ["p", 100, undefined, 133.333],
    ["Xxp^Jabc", 100, undefined, 266.667],
    ["a\\Pab\\PXpc\\Pabcdef", 20, undefined, 120],
    ["Xxp\\Pab\\PXpc", 20, undefined, 93.333],
  ];
  it.each(cases)("%j h=%f", async (t, h, w, ht) => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const x = mtextExtents(mtext({ text: t, height: h }), fonts);
    if (w !== undefined) expect(x.width).toBeCloseTo(w, 2);
    expect(x.height).toBeCloseTo(ht, 2);
  });
  it("uses default tab stops every 4 h", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    expect(mtextExtents(mtext({ text: "asasas^I", height: 200 }), fonts).width).toBeCloseTo(1600, 6);
  });
  it("wraps at spaces and keeps overlong words", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    // a leading space that does not fit together with the first word creates an empty first line
    expect(mtextExtents(mtext({ text: " abc\\Pabcd", height: 20, width: 60 }), fonts).lines).toBe(3);
    expect(mtextExtents(mtext({ text: "abcabcabc x", height: 20, width: 60 }), fonts).lines).toBe(2);
  });
  it("keeps a word whose ink fits even when its advance overshoots the width", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    // "H H" at h = 10: the second H's ink ends at 22.5, its advance at 23.33 (note 04 §3.6.2)
    const lines = (width: number) => mtextExtents(mtext({ text: "H H", width }), fonts).lines;
    expect(lines(23)).toBe(1);
    expect(lines(22.4)).toBe(2);
  });
});

describe("MTEXT layout", () => {
  it("attaches lines at the attachment point and honours the direction vector", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "H", attachment: 7, direction: { x: 0, y: 1, z: 0 } }), fonts);
    const m = l.glyphs[0]!.matrix;
    // rotated 90°: glyph x axis points up
    expect(m.a).toBeCloseTo(0, 12);
    expect(m.b).toBeGreaterThan(0);
  });
  it("hides MTEXT with a zero direction vector", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "H", direction: { x: 0, y: 0, z: 0 } }), fonts);
    expect(l.glyphs).toHaveLength(0);
  });
  it("uses a 5/3·h line pitch", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "H\\PH" }), fonts);
    expect(l.glyphs[0]!.matrix.f - l.glyphs[1]!.matrix.f).toBeCloseTo((5 / 3) * 10, 12);
  });
  it("sets the gap below a paragraph's lines from its own \\ps spacing (mtext/para-spacing-reset)", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "\\pxsm2;H\\P\\ps*;H\\PH" }), fonts);
    const y = l.glyphs.map((g) => g.matrix.f);
    expect(y[0]! - y[1]!).toBeCloseTo(2 * (26 / 15) * 10, 9); // \psm2: 2 × the 26/15·h single gap
    expect(y[1]! - y[2]!).toBeCloseTo((5 / 3) * 10, 9);
  });
  it("draws a stored 44 = 0 like 0.25 (mtext/spacing-defaults-factor-0)", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "H\\PH", lineSpacingFactor: 0 }), fonts);
    expect(l.glyphs[0]!.matrix.f - l.glyphs[1]!.matrix.f).toBeCloseTo((5 / 12) * 10, 9);
  });
  it("does not scope paragraph codes by braces (mtext/para-scope)", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const xs = (t: string) =>
      layoutMText(mtext({ text: t, width: 100 }), fonts).glyphs.map((g) => g.matrix.e);
    const plain = xs("H\\PH\\PH");
    const scoped = xs("{\\pxqc;H\\P}H\\PH");
    for (let i = 0; i < 3; i++) expect(scoped[i]!).toBeGreaterThan(plain[i]! + 40);
  });
  it("emits inline colours and background fills", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "{\\C1;H}H", bgFlags: 1, bgColor: 3 }), fonts);
    expect(l.glyphs[0]!.color).toEqual({ kind: "aci", aci: 1 });
    expect(l.glyphs[1]!.color).toBeUndefined();
    expect(l.backgrounds).toHaveLength(1);
  });
});

// Columns, frame and mask rules (note 04 §3.7.1, VERIFIED-BY-ACAD user/columns-all, text-probes/mtx-*)
describe("MTEXT columns, text frame and mask", () => {
  const cols = (c: Partial<NonNullable<MTextInput["columns"]>>) => ({
    type: 1,
    count: 2,
    width: 20,
    gutter: 5,
    definedHeight: 15,
    heights: [],
    ...c,
  });
  const frameBox = (l: ReturnType<typeof layoutMText>) => {
    const f = l.lines.filter((d) => d.kind === "frame");
    const xs = f.flatMap((d) => [d.x0, d.x1]);
    const ys = f.flatMap((d) => [d.y0, d.y1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  it("keeps static overflow in the last column", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "H\\PH\\PH\\PH", width: 45, columns: cols({}) }), fonts);
    const xs = l.glyphs.map((g) => g.matrix.e);
    expect(xs.filter((x) => x < 20)).toHaveLength(1);
    expect(xs.filter((x) => x > 20)).toHaveLength(3);
  });
  it("aligns every column on its own content for bottom attachments", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "H\\PH\\PH", width: 45, attachment: 7, columns: cols({}) }), fonts);
    // column 1: one line on the bottom; column 2: two lines, the last on the bottom, growing upward
    const ys = l.glyphs.map((g) => g.matrix.f).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0, 9);
    expect(ys[1]).toBeCloseTo(0, 9);
    expect(ys[2]).toBeCloseTo((5 / 3) * 10, 9);
  });
  it("frames the content box grown by (45 − 1)·h, also for the frame-only flag", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const tight = frameBox(layoutMText(mtext({ text: "H", bgFlags: 16, bgScale: 1 }), fonts));
    expect(tight[1]).toBeCloseTo(-10, 9);
    expect(tight[3]).toBeCloseTo(0, 9);
    const wide = frameBox(layoutMText(mtext({ text: "H", bgFlags: 16, bgScale: 1.5 }), fonts));
    expect(wide[1]).toBeCloseTo(-15, 9);
    expect(wide[3]).toBeCloseTo(5, 9);
    expect(wide[0]).toBeCloseTo(tight[0]! - 5, 9);
  });
  it("widens a single-column frame to text wider than the reference width", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "HHHHHH", width: 5, attachment: 3, bgFlags: 16, bgScale: 1 }), fonts);
    const box = frameBox(l);
    expect(box[2]).toBeCloseTo(0, 9); // right-aligned at the insertion point
    expect(box[2]! - box[0]!).toBeGreaterThan(5);
  });
  it("sizes column boxes by max(stored height, content) and merges touching boxes", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(
      mtext({
        text: "H\\PH\\PH",
        width: 40,
        columns: cols({ gutter: 0, definedHeight: 15 }),
        bgFlags: 16,
        bgScale: 1,
      }),
      fonts,
    );
    // column 1 (one line) is 15 high, column 2 (two lines, 26.7) taller: one stepped outline
    expect(l.lines.filter((d) => d.kind === "frame")).toHaveLength(6);
    expect(frameBox(l)[1]).toBeCloseTo(-(10 + (5 / 3) * 10), 9);
  });
  it("traces the union of overlapping boxes", () => {
    const ring = unionOutlines([
      { x0: 0, x1: 10, y0: -4, y1: 4 },
      { x0: 8, x1: 20, y0: -2, y1: 2 },
      { x0: 30, x1: 40, y0: -1, y1: 1 },
    ]);
    expect(ring).toHaveLength(2);
    expect(ring[0]).toHaveLength(8);
    expect(ring[1]).toHaveLength(4);
  });
});

// Rules measured from AutoCAD 2027 plots (note 04 §11), checked with simplex.shx.
describe.skipIf(!hasSimplex)("MTEXT rules vs AutoCAD plots (simplex.shx)", () => {
  const glyphYs = (l: ReturnType<typeof layoutMText>) => l.glyphs.map((g) => g.matrix.f);
  it("places a fraction: lower part on the baseline, upper at 4/3 h, bar at 7/6 h", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const l = layoutMText(mtext({ text: "\\S1/2;", height: 10, attachment: 7 }), fonts);
    const ys = glyphYs(l);
    expect(ys[1]! - ys[0]!).toBeCloseTo(-40 / 3, 9); // "1" above "2"
    expect(ys[1]).toBeCloseTo(0, 9);
    const bar = l.lines.find((d) => d.kind === "stack-bar")!;
    expect(bar.y0).toBeCloseTo(70 / 6, 9);
    // simplex "2" ink is 14 units wide → bar width 14/21·h
    expect(bar.x1 - bar.x0).toBeCloseTo((14 / 21) * 10, 9);
  });
  it("raises a stack without divider by h/3 and treats ^6 as a caret code", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const l = layoutMText(mtext({ text: "\\S5^6;", height: 10, attachment: 7 }), fonts);
    expect(l.glyphs).toHaveLength(2); // "5" and "?"
    for (const y of glyphYs(l)) expect(y).toBeCloseTo(10 / 3, 9);
  });
  it("clamps tracking to 0.75", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const a = layoutMText(mtext({ text: "{\\T0.5;AB}", height: 21 }), fonts);
    // simplex "A" advance 22 units → 22 · 0.75 at h = 21
    expect(a.glyphs[1]!.matrix.e - a.glyphs[0]!.matrix.e).toBeCloseTo(22 * 0.75, 9);
  });
  it("uses the mixed-height line gap (5/3 f − 1)(H_prev + B_next)/2 + ascent", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const l = layoutMText(mtext({ text: "Ab{\\H2x;Ab}\\PAb", height: 5 }), fonts);
    const ys = glyphYs(l);
    // line 1 has H = 10, line 2 H = 5: pitch 10 (VERIFIED-BY-ACAD mtext/height-style-0)
    expect(ys[0]! - ys[4]!).toBeCloseTo(10, 9);
  });
  it("uses drawing units for \\pb and \\pa", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const ref = glyphYs(layoutMText(mtext({ text: "A\\PB", height: 8 }), fonts));
    const sp = glyphYs(layoutMText(mtext({ text: "\\pb1,a2;A\\PB", height: 8 }), fonts));
    expect(sp[0]! - ref[0]!).toBeCloseTo(-1, 9);
    expect(sp[1]! - ref[1]!).toBeCloseTo(-4, 9);
  });
  it("ignores \\c values of 2^24 and more", async () => {
    const fonts = await testFonts([style("S", "simplex.shx")]);
    const l = layoutMText(mtext({ text: "\\c16777216;A", height: 8 }), fonts);
    expect(l.glyphs[0]!.color).toBeUndefined();
  });
});

describe.skipIf(!hasLato)("TTF union box (Lato, VERIFIED-BY-ACAD via DXFOUT)", () => {
  it("Middle-center of 'gjpqy' at h=10", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    expect(fonts.style("S").font?.primary.kind).toBe("ttf");
  });
});

// TrueType runs for the raster plot's whole-pixel advances (note 04 §14)
describe.skipIf(!hasLato)("TrueType text runs (Lato)", () => {
  it("makes a TEXT line one run with every character's advance", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    const l = layoutText(text({ text: "ab c", height: 10 }), fonts);
    expect(l.runs).toHaveLength(1);
    expect(l.runs![0]!.advances).toHaveLength(4);
    expect(l.glyphs.map((g) => g.run?.index)).toEqual([0, 1, 3]);
  });
  it("ends MTEXT runs at colour changes and tabs, without trailing spaces", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    const l = layoutMText(mtext({ text: "ab{\\C1;cd}^Ief ", height: 10 }), fonts);
    expect(l.runs!.map((r) => r.advances.length)).toEqual([2, 2, 2]);
    expect(l.glyphs.map((g) => `${g.run?.run}.${g.run?.index}`)).toEqual([
      "0.0",
      "0.1",
      "1.0",
      "1.1",
      "2.0",
      "2.1",
    ]);
  });
  it("has no runs for SHX text", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    expect(layoutText(text({ text: "ab" }), fonts).runs).toBeUndefined();
    expect(layoutMText(mtext({ text: "ab" }), fonts).runs).toBeUndefined();
  });
});

// TrueType stacks are placed by ink box (VERIFIED-BY-ACAD 2026-10-01 text-lato/mtext-stacks: the
// PDF pen positions match to ~1 unit; note 04 §11). Lato: A.yMax 1433, "1" ink 164..1018,
// "2" ink 94..1050 × 0..1449, X advance 1298, "0" side bearing 60.
describe.skipIf(!hasLato)("TrueType stacks (Lato)", () => {
  const s = 10 / 1433;
  const lay = async (t: string) => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    const l = layoutMText(mtext({ text: t, height: 10, attachment: 7 }), fonts);
    const g = l.glyphs.map((x) => ({ x: x.matrix.e, y: x.matrix.f }));
    const start = g[0]!.x + 1298 * s; // pen after the first "X"
    return { l, g, start, y0: g[0]!.y };
  };
  it("centres a fraction on the larger ink width above the lower part's ink height", async () => {
    const { l, g, start, y0 } = await lay("X\\S1/2;X");
    expect(g[1]!.x).toBeCloseTo(start + ((956 - 854) / 2 - 164) * s, 9); // "1"
    expect(g[1]!.y - y0).toBeCloseTo(1449 * s + 10 / 3, 9);
    expect(g[2]!.x).toBeCloseTo(start - 94 * s, 9); // "2": ink at the stack start
    expect(g[2]!.y - y0).toBeCloseTo(0, 9);
    const bar = l.lines.find((d) => d.kind === "stack-bar")!;
    expect(bar.x0).toBeCloseTo(start, 9);
    expect(bar.x1).toBeCloseTo(start + 956 * s, 9);
    expect(bar.y0 - y0).toBeCloseTo(1449 * s + 10 / 6, 9);
    expect(g[3]!.x).toBeCloseTo(start + (956 + 60) * s, 9); // advance: ink width + "0" bearing
  });
  it("left-aligns tolerance parts by ink", async () => {
    const { g, start } = await lay("X\\S1^ 2;X");
    expect(g[1]!.x).toBeCloseTo(start - 164 * s, 9);
    expect(g[2]!.x).toBeCloseTo(start - 94 * s, 9);
    expect(g[3]!.x).toBeCloseTo(start + (956 + 60) * s, 9);
  });
  it("places a diagonal stack's lower part h/3 after the upper ink", async () => {
    const { l, g, start, y0 } = await lay("X\\S1#2;X");
    expect(g[1]!.x).toBeCloseTo(start - 164 * s, 9);
    expect(g[1]!.y - y0).toBeCloseTo(1449 * s, 9); // upper baseline = lower ink height
    const lower = start + 854 * s + 10 / 3;
    expect(g[2]!.x).toBeCloseTo(lower - 94 * s, 9);
    expect(g[3]!.x).toBeCloseTo(lower + (956 + 60) * s, 9);
    const sl = l.lines.find((d) => d.kind === "stack-bar")!;
    expect((sl.x0 + sl.x1) / 2).toBeCloseTo(start + 854 * s + 10 / 6, 9);
    expect((sl.y0 + sl.y1) / 2 - y0).toBeCloseTo(1449 * s, 9);
  });
});

// Missing-glyph boxes with TrueType fonts (VERIFIED-BY-ACAD 2026-10-01, note 04 §11): TEXT control
// characters draw the primary font's .notdef (Lato: advance 1063 of cap 1433), characters no font
// has Arial's .notdef at Arial's cap scale (advance 1536 of cap 1466); MTEXT control characters
// Arial's .notdef advancing 0.575·h (0 for FS/GS/RS/US).
describe.skipIf(!hasLato || !hasArial)("Missing-glyph boxes (Lato, Arial)", () => {
  const xs = (l: { glyphs: readonly { matrix: { e: number } }[] }) => l.glyphs.map((g) => g.matrix.e);
  it("TEXT: control characters draw the primary .notdef, unknown characters Arial's", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    const l = layoutText(text({ text: "A^BB^?C", height: 10 }), fonts);
    expect(l.glyphs).toHaveLength(5);
    expect(l.glyphs[1]!.font).toBe(l.glyphs[0]!.font);
    expect(l.glyphs[3]!.font.capHeight).toBe(1466);
    const x = xs(l);
    expect(x[2]! - x[1]!).toBeCloseTo((1063 / 1433) * 10, 9);
    expect(x[4]! - x[3]!).toBeCloseTo((1536 / 1466) * 10, 9);
  });
  it("TEXT: %%9 is a control character too", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    expect(layoutText(text({ text: "[%%9]", height: 10 }), fonts).glyphs).toHaveLength(3);
  });
  it("MTEXT: control characters draw Arial's .notdef advancing 0.575 h", async () => {
    const fonts = await testFonts([style("S", "LatoWeb-Regular.ttf")]);
    const l = layoutMText(mtext({ text: "a^Bb^\\c", height: 10, attachment: 7 }), fonts);
    expect(l.glyphs).toHaveLength(5);
    expect(l.glyphs[1]!.font.capHeight).toBe(1466);
    const x = xs(l);
    expect(x[2]! - x[1]!).toBeCloseTo(5.75, 9);
    expect(x[4]!).toBeCloseTo(x[3]!, 9); // ^\ (FS) does not advance
  });
});

// CJK line breaking (VERIFIED-BY-ACAD text-probes/cjk-wrap-w40, cjk-open-w40, cjk-mixed-w44;
// Microsoft YaHei h = 5, note 04 §3.6.2)
describe.skipIf(!existsSync(MSYH))("MTEXT wrapping of CJK text (Microsoft YaHei)", () => {
  const lines = async (t: string, width: number) => {
    const p = new MemoryFontProvider();
    p.add("msyh.ttc", new Uint8Array(readFileSync(MSYH)));
    const fonts = new TextFonts(new FontManager(p), [style("S", "msyh.ttc")]);
    await fonts.prepare([]);
    const l = layoutMText(mtext({ text: t, height: 5, width }), fonts);
    const out: string[] = [];
    const chars = [...t.replace(/ /g, "")];
    let i = 0;
    let y: number | undefined;
    for (const g of l.glyphs) {
      if (g.matrix.f !== y) out.push("");
      y = g.matrix.f;
      out[out.length - 1] += chars[i++];
    }
    return out;
  };
  it("breaks between CJK characters; closing marks never start a line", async () => {
    expect(await lines("为甲方知识产权。未经允许，不得泄露", 40)).toEqual([
      "为甲方知识产",
      "权。未经允",
      "许，不得泄露",
    ]);
  });
  it("moves CJK opening marks that would end a line to the next one", async () => {
    expect(await lines("一二三四五（六七", 40)).toEqual(["一二三四五", "（六七"]);
  });
  it("breaks at CJK / Latin boundaries, Latin words only at spaces", async () => {
    expect(await lines("格按国家ABCDEFGHIJKLMN规范", 44)).toEqual(["格按国家", "ABCDEFGHIJKLMN", "规范"]);
  });
});
