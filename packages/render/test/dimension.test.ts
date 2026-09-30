import type { DimensionEntity, DimValue, Entity, LineEntity, SolidEntity } from "@truedxf/model";
import { describe, expect, it } from "vitest";
import { dimensionText, formatAngle, formatLinear, linearFormat } from "../src/dimension/format.ts";
import { DimStyleVars, generateDimension } from "../src/dimension/index.ts";
import { modelDoc } from "./helpers.ts";

const doc = modelDoc({ entities: "" });
const vars = (o: Record<number, DimValue>) =>
  new DimStyleVars(doc, "Standard", new Map(Object.entries(o).map(([k, v]) => [Number(k), v])));

describe("dimension text formatting (AutoCAD strings from the dimensions suite)", () => {
  const lin = (value: number, o: Record<number, DimValue>) => formatLinear(value, linearFormat(vars(o)));
  it("decimal: rounds half away from zero, DIMZIN 4/8", () => {
    expect(lin(0.5, { 271: 0 })).toBe("1");
    expect(lin(12.0625, { 271: 3 })).toBe("12.063");
    expect(lin(1234.5, { 271: 8 })).toBe("1234.50000000");
    expect(lin(0.25, { 271: 4, 78: 12 })).toBe(".25");
    expect(lin(12, { 271: 4, 78: 8 })).toBe("12");
    expect(lin(12.5, { 271: 2, 78: 8, 278: 44 })).toBe("12,5");
    expect(lin(12.5, { 271: 2, 78: 8, 278: 0 })).toBe("12.5");
  });
  it("scientific, engineering, architectural, fractional, windows", () => {
    expect(lin(1234.5, { 277: 1, 271: 4 })).toBe("1.2345E+03");
    expect(lin(48.36, { 277: 3, 271: 4 })).toBe(`4'-0.3600"`);
    expect(lin(12, { 277: 3, 271: 4 })).toBe(`1'`);
    expect(lin(48.36, { 277: 4, 271: 6 })).toBe(`4'-0{\\H1x;\\S23/64;}"`);
    expect(lin(0.5, { 277: 4, 271: 4, 78: 1 })).toBe(`0'-0{\\H1x;\\S1/2;}"`);
    expect(lin(12.0625, { 277: 4, 271: 4, 276: 2 })).toBe(`1'-0 1/16"`);
    expect(lin(12.0625, { 277: 5, 271: 4 })).toBe("12{\\H1x;\\S1/16;}");
    expect(lin(1234.5, { 277: 6, 271: 4 })).toBe("1.234,5000");
  });
  it("angles", () => {
    const rad = (45.5042 * Math.PI) / 180;
    expect(formatAngle(rad, vars({ 179: 2 }))).toBe("45.50\\U+00B0");
    expect(formatAngle(rad, vars({ 275: 1, 179: 4 }))).toBe(`45\\U+00B030'15"`);
    expect(formatAngle(rad, vars({ 275: 1, 179: 6 }))).toBe(`45\\U+00B030'15.12"`);
    expect(formatAngle(rad, vars({ 275: 2, 179: 2 }))).toBe("50.56g");
  });
  it("overrides, DIMPOST, tolerances, alternate units", () => {
    const iso = { 271: 2, 78: 8, 283: 0, 272: 2, 284: 8 };
    expect(dimensionText(vars(iso), "<> mm <>", 117.35, "linear").content).toBe("117.35 mm <>");
    expect(dimensionText(vars(iso), " ", 117.35, "linear").content).toBe("");
    expect(dimensionText(vars({ ...iso, 3: "mm" }), undefined, 117.35, "linear").content).toBe("117.35mm");
    expect(dimensionText(vars({ ...iso, 3: "X<>" }), "", 45, "linear", "R").content).toBe("X45");
    expect(dimensionText(vars({ ...iso, 71: 1, 47: 0.1, 48: 0.2 }), "", 117.35, "linear").content).toBe(
      "117.35\\S+0.1^ -0.2;",
    );
    expect(dimensionText(vars({ ...iso, 71: 1, 47: 0.1, 48: 0.1 }), "", 117.35, "linear").content).toBe(
      "117.35±0.1",
    );
    expect(
      dimensionText(vars({ ...iso, 170: 1, 143: 25.4, 171: 2 }), "<> ([])", 117.35, "linear").content,
    ).toBe("117.35 ( [2980.69])");
    // imperial DIMTOLJ 1 leads every measured text with \A1;
    expect(dimensionText(vars({}), undefined, 12.345, "linear").content).toBe("\\A1;12.3450");
    expect(dimensionText(vars(iso), "A\\XB", 1, "linear")).toEqual({ content: "A", below: "B" });
  });
});

function dimension(fields: Partial<DimensionEntity>): DimensionEntity {
  return {
    subtype: "linear",
    dimStyle: "Standard",
    blockName: "",
    layer: "0",
    linetypeScale: 1,
    lineweight: -1,
    defPoint: { x: 100, y: 80, z: 0 },
    defPoint2: { x: 40, y: 50, z: 0 },
    defPoint3: { x: 157.35, y: 50, z: 0 },
    textMidpoint: undefined,
    extrusion: { x: 0, y: 0, z: 1 },
    angle: 0,
    horizontalDirection: 0,
    textRotation: undefined,
    textOverride: undefined,
    userTextPosition: false,
    flipArrow1: false,
    flipArrow2: false,
    clonePoint: { x: 0, y: 0, z: 0 },
    overrides: new Map<number, DimValue>([
      [41, 4],
      [42, 1],
      [44, 2],
      [147, 1],
      [77, 1],
      [140, 4],
    ]),
    ...fields,
  } as DimensionEntity;
}

const pts = (e: Entity) => {
  if (e.type === "LINE") {
    const l = e as LineEntity;
    return [l.start.x, l.start.y, l.end.x, l.end.y].map((v) => Math.round(v * 1e4) / 1e4);
  }
  const s = e as SolidEntity;
  return [s.v0.x, s.v0.y, s.v1.x, s.v1.y, s.v2.x, s.v2.y].map((v) => Math.round(v * 1e4) / 1e4);
};

describe("dimension block regeneration", () => {
  it("linear: ext lines, dimension line and SOLID arrows like AutoCAD (type-horizontal-nb)", () => {
    const ents = generateDimension({ doc, fonts: undefined }, dimension({}))!;
    const geo = ents.filter((e) => e.type !== "MTEXT");
    expect(geo.map((e) => e.type)).toEqual(["LINE", "LINE", "LINE", "SOLID", "SOLID"]);
    expect(pts(geo[0]!)).toEqual([40, 51, 40, 82]);
    expect(pts(geo[1]!)).toEqual([157.35, 51, 157.35, 82]);
    expect(pts(geo[2]!)).toEqual([44, 80, 153.35, 80]);
    expect(pts(geo[3]!)).toEqual([44, 80.6667, 44, 79.3333, 40, 80]);
    expect(pts(geo[4]!)).toEqual([153.35, 80.6667, 153.35, 79.3333, 157.35, 80]);
  });

  it("ticks (DIMTSZ) and DIMDLE (dimtsz-2-dimdle-2-nb)", () => {
    const d = dimension({});
    const o = new Map(d.overrides);
    o.set(142, 2);
    o.set(46, 2);
    const ents = generateDimension({ doc, fonts: undefined }, { ...d, overrides: o })!;
    const lines = ents.filter((e) => e.type === "LINE").map(pts);
    expect(lines).toContainEqual([38, 80, 159.35, 80]);
    expect(lines).toContainEqual([155.35, 78, 159.35, 82]);
    expect(lines).toContainEqual([38, 78, 42, 82]);
  });
});
