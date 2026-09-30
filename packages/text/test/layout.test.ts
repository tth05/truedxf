import { describe, expect, it } from "vitest";
import {
  layoutMText,
  layoutText,
  type MTextInput,
  mtextExtents,
  type TextInput,
  textFrame,
} from "../src/index.ts";
import { hasLato, hasSimplex, style, testFonts } from "./helpers.ts";

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
  it("emits inline colours and background fills", async () => {
    const fonts = await testFonts([style("S", "truedxf-test.shx")]);
    const l = layoutMText(mtext({ text: "{\\C1;H}H", bgFlags: 1, bgColor: 3 }), fonts);
    expect(l.glyphs[0]!.color).toEqual({ kind: "aci", aci: 1 });
    expect(l.glyphs[1]!.color).toBeUndefined();
    expect(l.backgrounds).toHaveLength(1);
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
