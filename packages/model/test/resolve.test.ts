import { describe, expect, it } from "vitest";
import {
  ACI_PALETTE_DARK,
  ACI_PALETTE_LIGHT,
  aciToRgb,
  DxfDocument,
  type Entity,
  type InsertContext,
  type InsertEntity,
  nearestAci,
  PLOT_PALETTE,
  PropertyResolver,
  type ResolvedProperties,
  resolveProperties,
} from "../src/index.ts";

const enc = new TextEncoder();
type Tag = [number, string | number];

function dxf(tags: Tag[]): Uint8Array {
  return enc.encode(`${tags.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}`).join("\r\n")}\r\n`);
}

interface LayerSpec {
  name: string;
  color?: number;
  flags?: number;
  linetype?: string;
  lineweight?: number;
  plot?: 0 | 1;
  trueColor?: number;
  transparency?: number;
  handle?: string;
  xdict?: string;
  plotStyle?: string;
}

function layer(l: LayerSpec): Tag[] {
  const t: Tag[] = [[0, "LAYER"]];
  if (l.handle) t.push([5, l.handle]);
  if (l.xdict) t.push([102, "{ACAD_XDICTIONARY"], [360, l.xdict], [102, "}"]);
  t.push(
    [100, "AcDbSymbolTableRecord"],
    [100, "AcDbLayerTableRecord"],
    [2, l.name],
    [70, l.flags ?? 0],
    [62, l.color ?? 7],
    [6, l.linetype ?? "Continuous"],
  );
  if (l.plot !== undefined) t.push([290, l.plot]);
  t.push([370, l.lineweight ?? -3]);
  if (l.plotStyle) t.push([390, l.plotStyle]);
  if (l.trueColor !== undefined) t.push([420, l.trueColor]);
  if (l.transparency !== undefined) t.push([1001, "AcCmTransparency"], [1071, l.transparency]);
  return t;
}

const LTYPES: Tag[] = [
  [0, "TABLE"],
  [2, "LTYPE"],
  [0, "LTYPE"],
  [5, "14"],
  [100, "AcDbSymbolTableRecord"],
  [100, "AcDbLinetypeTableRecord"],
  [2, "Continuous"],
  [70, 0],
  [3, "Solid line"],
  [72, 65],
  [73, 0],
  [40, 0],
  [0, "LTYPE"],
  [5, "15"],
  [100, "AcDbSymbolTableRecord"],
  [100, "AcDbLinetypeTableRecord"],
  [2, "DASHED"],
  [70, 0],
  [3, "__ __"],
  [72, 65],
  [73, 2],
  [40, 0.75],
  [49, 0.5],
  [74, 0],
  [49, -0.25],
  [74, 0],
  [0, "LTYPE"],
  [5, "16"],
  [100, "AcDbSymbolTableRecord"],
  [100, "AcDbLinetypeTableRecord"],
  [2, "HIDDEN"],
  [70, 0],
  [3, "_ _"],
  [72, 65],
  [73, 2],
  [40, 0.375],
  [49, 0.25],
  [74, 0],
  [49, -0.125],
  [74, 0],
  [0, "ENDTAB"],
];

/** Entity tags: [0, TYPE], common props, then geometry. */
function line(props: Tag[] = []): Tag[] {
  return [[0, "LINE"], [100, "AcDbEntity"], ...props, [100, "AcDbLine"], [10, 0], [20, 0], [11, 1], [21, 1]];
}

function insert(block: string, props: Tag[] = []): Tag[] {
  return [
    [0, "INSERT"],
    [100, "AcDbEntity"],
    ...props,
    [100, "AcDbBlockReference"],
    [2, block],
    [10, 0],
    [20, 0],
  ];
}

function block(name: string, content: Tag[]): Tag[] {
  return [
    [0, "BLOCK"],
    [100, "AcDbEntity"],
    [8, "0"],
    [100, "AcDbBlockBegin"],
    [2, name],
    [70, 0],
    [10, 0],
    [20, 0],
    ...content,
    [0, "ENDBLK"],
    [100, "AcDbEntity"],
    [8, "0"],
    [100, "AcDbBlockEnd"],
  ];
}

function makeDoc(opts: {
  layers: LayerSpec[];
  blocks?: Tag[];
  entities: Tag[];
  objects?: Tag[];
  header?: Tag[];
}) {
  const tags: Tag[] = [
    [0, "SECTION"],
    [2, "HEADER"],
    [9, "$ACADVER"],
    [1, "AC1032"],
    ...(opts.header ?? []),
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "TABLES"],
    ...LTYPES,
    [0, "TABLE"],
    [2, "LAYER"],
    ...opts.layers.flatMap(layer),
    [0, "ENDTAB"],
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "BLOCKS"],
    ...(opts.blocks ?? []),
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "ENTITIES"],
    ...opts.entities,
    [0, "ENDSEC"],
  ];
  if (opts.objects) tags.push([0, "SECTION"], [2, "OBJECTS"], ...opts.objects, [0, "ENDSEC"]);
  tags.push([0, "EOF"]);
  return DxfDocument.load(dxf(tags));
}

/** Resolves every entity of a block reference tree; returns results keyed by "path". */
function walk(doc: DxfDocument, r: PropertyResolver): Map<string, ResolvedProperties> {
  const out = new Map<string, ResolvedProperties>();
  const visit = (entities: readonly Entity[], parents: InsertContext[], path: string) => {
    entities.forEach((e, i) => {
      const p = `${path}${i}`;
      const res = r.resolve(e, parents);
      out.set(p, res);
      if (e.type === "INSERT" && res.expandBlock) {
        const ctx = [...parents, { entity: e, resolved: res }];
        visit(doc.getBlock((e as InsertEntity).blockName)?.entities ?? [], ctx, `${p}/`);
        (e as InsertEntity).attribs.forEach((a, k) => {
          out.set(`${p}@${k}`, r.resolve(a, ctx));
        });
      }
    });
  };
  visit(doc.modelSpace.entities, [], "");
  return out;
}

describe("ACI palettes", () => {
  it("has both palette families from note 06 App. A", () => {
    expect(ACI_PALETTE_LIGHT).toHaveLength(256);
    expect(ACI_PALETTE_DARK).toHaveLength(256);
    expect(ACI_PALETTE_LIGHT[1]).toBe(0xff0000);
    expect(ACI_PALETTE_LIGHT[12]).toBe(0xcc0000);
    expect(ACI_PALETTE_DARK[12]).toBe(0xa50000);
    expect(ACI_PALETTE_LIGHT[250]).toBe(0x333333);
    expect(ACI_PALETTE_DARK[250]).toBe(0x000000);
    expect(ACI_PALETTE_LIGHT[255]).toBe(0xffffff);
    expect(PLOT_PALETTE).toBe(ACI_PALETTE_LIGHT);
  });

  it("maps ACI 7 to the paper foreground, other ACIs through the palette", () => {
    expect(aciToRgb(7)).toBe(0x000000);
    expect(aciToRgb(7, PLOT_PALETTE, "black")).toBe(0xffffff);
    expect(aciToRgb(255)).toBe(0xffffff);
    expect(aciToRgb(5)).toBe(0x0000ff);
    expect(aciToRgb(12, ACI_PALETTE_DARK)).toBe(0xa50000);
  });

  it("finds the nearest ACI of an RGB", () => {
    expect(nearestAci(0xff0000)).toBe(1);
    expect(nearestAci(0x0000fe)).toBe(5);
    expect(nearestAci(0x343434)).toBe(250);
  });
});

describe("resolveProperties: top level", () => {
  const doc = makeDoc({
    layers: [
      { name: "0" },
      { name: "RED", color: 1, linetype: "DASHED", lineweight: 50, transparency: 0x0200007f },
      { name: "TC", color: 150, trueColor: 0x123456 },
      { name: "OFF", color: -3 },
      { name: "FROZEN", flags: 1 },
      { name: "NOPLOT", plot: 0 },
      { name: "Defpoints", plot: 1 },
    ],
    entities: [
      ...line([[8, "RED"]]), // 0
      ...line([
        [8, "RED"],
        [62, 0],
        [6, "BYBLOCK"],
        [370, -2],
        [440, 0x01000000],
      ]), // 1: BYBLOCK everything at top level
      ...line([
        [8, "TC"],
        [62, 5],
        [420, 0x00ff8000],
      ]), // 2: entity true color
      ...line([[8, "TC"]]), // 3: layer true color
      ...line([[8, "OFF"]]), // 4
      ...line([[8, "FROZEN"]]), // 5
      ...line([[8, "NOPLOT"]]), // 6
      ...line([[8, "DEFPOINTS"]]), // 7
      ...line([
        [8, "RED"],
        [6, "NOSUCH"],
        [370, -3],
        [440, 0x02000033],
      ]), // 8
      ...line([
        [8, "MISSING"],
        [60, 1],
      ]), // 9
      ...line([
        [8, "RED"],
        [62, 7],
      ]), // 10
    ],
  });
  const at = (i: number) => resolveProperties(doc.modelSpace.entities[i]!, { doc, parents: [] });

  it("resolves BYLAYER color, linetype, lineweight and transparency from the layer", () => {
    const r = at(0);
    expect(r).toMatchObject({ layer: "RED", aci: 1, rgb: 0xff0000, linetype: "DASHED", lineweight: 50 });
    expect(r.lineweightMm).toBe(0.5);
    expect(r.alpha).toBe(0x7f);
    expect(r.linetypeEntry?.elements.map((e) => e.length)).toEqual([0.5, -0.25]);
    expect(r).toMatchObject({ visible: true, plottable: true, expandBlock: true });
  });

  it("resolves top-level BYBLOCK to ACI 7 (black on white), Continuous, LWDEFAULT, opaque", () => {
    const r = at(1);
    expect(r).toMatchObject({ aci: 7, rgb: 0x000000, linetype: "Continuous", lineweight: 25, alpha: 255 });
    expect(r.transparency).toBe(0);
  });

  it("lets 420 override 62 and uses layer true colors for BYLAYER", () => {
    expect(at(2)).toMatchObject({ aci: 5, trueColor: 0xff8000, rgb: 0xff8000 });
    expect(at(3)).toMatchObject({ aci: 150, trueColor: 0x123456, rgb: 0x123456 });
  });

  it("applies layer states: off, frozen, no-plot, Defpoints", () => {
    expect(at(4)).toMatchObject({ visible: false, plottable: false });
    expect(at(5)).toMatchObject({ visible: false, plottable: false, expandBlock: false });
    expect(at(6)).toMatchObject({ visible: true, plottable: false });
    expect(at(7)).toMatchObject({ visible: true, plottable: false });
  });

  it("falls back to Continuous for missing linetypes and defaults for missing layers", () => {
    const r = at(8);
    expect(r.linetype).toBe("Continuous");
    expect(r.linetypeEntry).toBeUndefined();
    expect(r.lineweight).toBe(25);
    expect(r.alpha).toBe(0x33);
    const m = at(9);
    expect(m).toMatchObject({ layerEntry: undefined, aci: 7, linetype: "Continuous", visible: false });
    const d = doc.diagnostics.summary();
    expect(d["missing-linetype"]).toBe(1);
    expect(d["missing-layer"]).toBe(1);
    at(8);
    expect(doc.diagnostics.summary()["missing-linetype"]).toBe(1); // reported once
  });

  it("honours options: paper color, palette and LWDEFAULT", () => {
    const e = doc.modelSpace.entities[10]!;
    expect(resolveProperties(e, { doc, parents: [], options: { paper: "black" } }).rgb).toBe(0xffffff);
    const r = new PropertyResolver(doc, { lwDefault: 35, palette: ACI_PALETTE_DARK });
    expect(r.resolve(doc.modelSpace.entities[1]!).lineweight).toBe(35);
  });

  it("uses a caller-supplied layer lookup", () => {
    let calls = 0;
    const layerOf = (n: string) => {
      calls++;
      return doc.tables.layers.get(n);
    };
    for (let k = 0; k < 3; k++) resolveProperties(doc.modelSpace.entities[0]!, { doc, layerOf, parents: [] });
    expect(calls).toBe(1); // cached per resolver
  });
});

describe("resolveProperties: blocks (note 07 §3)", () => {
  // Block INNER: layer-0 BYLAYER line, layer-0 BYBLOCK line, L1 BYLAYER line, L1 BYBLOCK line
  const inner = block("INNER", [
    ...line([[8, "0"]]),
    ...line([
      [8, "0"],
      [62, 0],
      [6, "BYBLOCK"],
      [370, -2],
      [440, 0x01000000],
    ]),
    ...line([[8, "L1"]]),
    ...line([
      [8, "L1"],
      [62, 0],
    ]),
  ]);
  // Block OUTER: INSERT INNER on layer 0 with BYBLOCK color/linetype
  const outer = block("OUTER", [
    ...insert("INNER", [
      [8, "0"],
      [62, 0],
      [6, "BYBLOCK"],
      [370, -2],
    ]),
  ]);
  const doc = makeDoc({
    layers: [
      { name: "0" },
      { name: "L1", color: 3, linetype: "HIDDEN" },
      { name: "RED", color: 1, linetype: "DASHED", lineweight: 70, transparency: 0x02000040 },
      { name: "OFF", color: -4 },
      { name: "FROZEN", color: 6, flags: 1 },
      { name: "NOPLOT", color: 2, plot: 0 },
    ],
    blocks: [...inner, ...outer],
    entities: [
      ...insert("INNER", [
        [8, "RED"],
        [62, 5],
        [6, "HIDDEN"],
        [370, 35],
        [440, 0x02000080],
      ]), // 0
      ...insert("OUTER", [
        [8, "RED"],
        [62, 4],
        [6, "DASHED"],
        [370, 100],
      ]), // 1: nested through a layer-0 BYBLOCK INSERT
      ...insert("INNER", [[8, "OFF"]]), // 2
      ...insert("INNER", [[8, "FROZEN"]]), // 3
      ...insert("INNER", [[8, "NOPLOT"]]), // 4
      ...insert("INNER", [
        [8, "RED"],
        [60, 1],
      ]), // 5
    ],
  });
  const res = walk(doc, new PropertyResolver(doc));

  it("layer 0 content takes the INSERT's layer; BYBLOCK takes the INSERT's resolved values", () => {
    expect(res.get("0/0")).toMatchObject({
      layer: "RED",
      aci: 1,
      linetype: "DASHED",
      lineweight: 70,
      alpha: 0x40,
    });
    expect(res.get("0/1")).toMatchObject({
      layer: "RED",
      aci: 5,
      linetype: "HIDDEN",
      lineweight: 35,
      alpha: 0x80,
    });
    expect(res.get("0/2")).toMatchObject({ layer: "L1", aci: 3, linetype: "HIDDEN" });
    expect(res.get("0/3")).toMatchObject({ layer: "L1", aci: 5 });
  });

  it("resolves through two levels (a layer-0 BYBLOCK INSERT passes the outer values on)", () => {
    expect(res.get("1/0")).toMatchObject({ layer: "RED", aci: 4, linetype: "DASHED", lineweight: 100 });
    expect(res.get("1/0/0")).toMatchObject({ layer: "RED", aci: 1, linetype: "DASHED", lineweight: 70 });
    expect(res.get("1/0/1")).toMatchObject({ layer: "RED", aci: 4, linetype: "DASHED", lineweight: 100 });
    expect(res.get("1/0/3")).toMatchObject({ layer: "L1", aci: 4 });
  });

  it("off INSERT layer hides only the inheriting (layer 0) content", () => {
    expect(res.get("2")).toMatchObject({ visible: false, expandBlock: true });
    expect(res.get("2/0")!.visible).toBe(false);
    expect(res.get("2/1")!.visible).toBe(false);
    expect(res.get("2/2")!.visible).toBe(true);
    expect(res.get("2/3")!.visible).toBe(true);
  });

  it("frozen INSERT layer and invisible INSERT hide the whole reference", () => {
    expect(res.get("3")).toMatchObject({ visible: false, expandBlock: false });
    expect(res.has("3/2")).toBe(false);
    expect(res.get("5")).toMatchObject({ expandBlock: false });
    // children resolved anyway (e.g. by a caller that ignores expandBlock) are hidden too
    const r = new PropertyResolver(doc);
    const ins = doc.modelSpace.entities[3]!;
    const child = doc.getBlock("INNER")!.entities[2]!;
    expect(r.resolve(child, [{ entity: ins, resolved: r.resolve(ins) }]).visible).toBe(false);
  });

  it("no-plot INSERT layer: all content is displayed but none plots (blocks/vis-insert-layer-noplot)", () => {
    expect(res.get("4")).toMatchObject({ plottable: false, contentPlottable: false, expandBlock: true });
    expect(res.get("4/0")).toMatchObject({ visible: true, plottable: false, aci: 2 });
    expect(res.get("4/2")).toMatchObject({ visible: true, plottable: false });
    expect(res.get("0/2")).toMatchObject({ plottable: true });
  });
});

describe("resolveProperties: viewports", () => {
  const doc = makeDoc({
    layers: [
      { name: "0" },
      { name: "A", handle: "30", color: 1, xdict: "40" },
      { name: "B", handle: "31", color: 2 },
    ],
    entities: [...line([[8, "A"]]), ...line([[8, "B"]])],
    objects: [
      [0, "DICTIONARY"],
      [5, "C"],
      [100, "AcDbDictionary"],
      [0, "DICTIONARY"],
      [5, "40"],
      [330, "30"],
      [100, "AcDbDictionary"],
      [280, 1],
      [281, 1],
      [3, "ADSK_XREC_LAYER_COLOR_OVR"],
      [360, "41"],
      [3, "ADSK_XREC_LAYER_LINEWT_OVR"],
      [360, "42"],
      [0, "XRECORD"],
      [5, "41"],
      [330, "40"],
      [100, "AcDbXrecord"],
      [280, 1],
      [102, "{ADSK_LYR_COLOR_OVERRIDE"],
      [335, "90"],
      [420, 0xc2ff8000 | 0],
      [102, "}"],
      [0, "XRECORD"],
      [5, "42"],
      [330, "40"],
      [100, "AcDbXrecord"],
      [280, 1],
      [102, "{ADSK_LYR_LINEWT_OVERRIDE"],
      [335, "90"],
      [91, 53],
      [102, "}"],
    ],
  });
  const [a, b] = doc.modelSpace.entities as [Entity, Entity];

  it("applies per-viewport layer overrides only in that viewport", () => {
    const r = new PropertyResolver(doc);
    expect(r.resolve(a, [], { handle: "90" })).toMatchObject({
      rgb: 0xff8000,
      trueColor: 0xff8000,
      lineweight: 53,
    });
    expect(r.resolve(a, [], { handle: "91" })).toMatchObject({ aci: 1, rgb: 0xff0000, lineweight: 25 });
    expect(r.resolve(a)).toMatchObject({ aci: 1 });
  });

  it("hides layers frozen in the viewport (by handle or name)", () => {
    const r = new PropertyResolver(doc);
    const vp = { handle: "90", frozenLayers: ["31"] };
    expect(r.resolve(b, [], vp).visible).toBe(false);
    expect(r.resolve(a, [], vp).visible).toBe(true);
    expect(r.resolve(a, [], { frozenLayers: ["a"] }).visible).toBe(false);
    expect(r.resolve(b).visible).toBe(true);
  });
});

describe("resolveProperties: plot styles", () => {
  const doc = makeDoc({
    layers: [{ name: "0", plotStyle: "F" }],
    entities: [
      ...line([[8, "0"]]),
      ...line([
        [8, "0"],
        [380, 3],
        [390, "E1"],
      ]),
      ...line([
        [8, "0"],
        [380, 2],
      ]),
    ],
    objects: [
      [0, "DICTIONARY"],
      [5, "C"],
      [100, "AcDbDictionary"],
      [3, "ACAD_PLOTSTYLENAME"],
      [350, "E"],
      [0, "ACDBDICTIONARYWDFLT"],
      [5, "E"],
      [100, "AcDbDictionary"],
      [3, "Normal"],
      [350, "F"],
      [100, "AcDbDictionaryWithDefault"],
      [340, "F"],
    ],
  });
  it("resolves BYLAYER, object and dictionary-default plot styles", () => {
    const [e0, e1, e2] = doc.modelSpace.entities as [Entity, Entity, Entity];
    expect(resolveProperties(e0, { doc, parents: [] }).plotStyleHandle).toBe("F");
    expect(resolveProperties(e1, { doc, parents: [] }).plotStyleHandle).toBe("E1");
    expect(resolveProperties(e2, { doc, parents: [] }).plotStyleHandle).toBe("F");
  });
});
