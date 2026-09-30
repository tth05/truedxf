/**
 * truedxf side of the differential oracle: a normalized JSON view of a DxfDocument with the same
 * schema as tools/corpus/ezdxf_dump.py (see the normalization rules there). Field names are
 * truedxf's model names.
 *
 *   node tools/corpus/src/dump.ts FILE.dxf > out.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AttribEntity,
  DxfDocument,
  type Entity,
  type EntityBase,
  type Point2,
  type Point3,
  type TextProps,
  type VertexEntity,
} from "@truedxf/model";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export const HEADER_VARS = [
  "$ACADVER",
  "$DWGCODEPAGE",
  "$INSBASE",
  "$EXTMIN",
  "$EXTMAX",
  "$LIMMIN",
  "$LIMMAX",
  "$LTSCALE",
  "$PSLTSCALE",
  "$CELTSCALE",
  "$PDMODE",
  "$PDSIZE",
  "$TEXTSIZE",
  "$TEXTSTYLE",
  "$CLAYER",
  "$CELTYPE",
  "$CECOLOR",
  "$MEASUREMENT",
  "$INSUNITS",
  "$LUNITS",
  "$AUNITS",
  "$ANGBASE",
  "$ANGDIR",
  "$MIRRTEXT",
  "$FILLMODE",
  "$TILEMODE",
  "$DIMSTYLE",
  "$DIMSCALE",
  "$PSTYLEMODE",
  "$PLINEGEN",
  "$LWDISPLAY",
];

const LAYOUT_BLOCKS = new Set(["*MODEL_SPACE", "*PAPER_SPACE", "$MODEL_SPACE", "$PAPER_SPACE"]);

/** Types dumped with attributes (the ones ezdxf_dump.py knows too). */
export const PARSED = new Set([
  "LINE",
  "POINT",
  "CIRCLE",
  "ARC",
  "ELLIPSE",
  "SOLID",
  "TRACE",
  "3DFACE",
  "RAY",
  "XLINE",
  "SPLINE",
  "SHAPE",
  "LWPOLYLINE",
  "POLYLINE",
  "TEXT",
  "ATTRIB",
  "ATTDEF",
  "INSERT",
]);

export function num(v: number | boolean | bigint | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (!Number.isFinite(v) || v === 0) return 0;
  return Number(v.toPrecision(12));
}

export function pt(p: Point3 | Point2 | undefined): Json {
  if (!p) return null;
  return [num(p.x), num(p.y), num((p as Point3).z ?? 0)];
}

function handle(h: string): string | null {
  return h ? h : null;
}

function common(e: EntityBase): JsonObject {
  return {
    t: e.dxfType,
    h: handle(e.handle),
    layer: e.layer,
    linetype: e.linetype,
    color: num(e.color),
    trueColor: num(e.trueColor),
    colorName: e.colorName ?? null,
    transparency: num(e.transparency),
    lineweight: num(e.lineweight),
    linetypeScale: num(e.linetypeScale),
    invisible: e.invisible,
    paperSpace: e.paperSpace,
  };
}

function textProps(e: TextProps, out: JsonObject): void {
  Object.assign(out, {
    text: e.text,
    insert: pt(e.insert),
    alignPoint: pt(e.alignPoint),
    height: num(e.height),
    rotation: num(e.rotation),
    widthFactor: num(e.widthFactor),
    oblique: num(e.oblique),
    style: e.style,
    generationFlags: num(e.generationFlags),
    halign: num(e.halign),
    valign: num(e.valign),
    thickness: num(e.thickness),
    extrusion: pt(e.extrusion),
  });
}

function attrib(e: AttribEntity): JsonObject {
  const out = common(e);
  textProps(e, out);
  Object.assign(out, {
    tag: e.tag,
    attribFlags: num(e.attribFlags),
    fieldLength: num(e.fieldLength),
    lockPosition: e.lockPosition,
  });
  if (e.type === "ATTDEF") out.prompt = e.prompt;
  return out;
}

function vertex(v: VertexEntity): JsonObject {
  return {
    layer: v.layer,
    location: pt(v.location),
    startWidth: v.startWidth < 0 ? null : num(v.startWidth),
    endWidth: v.endWidth < 0 ? null : num(v.endWidth),
    bulge: num(v.bulge),
    flags: num(v.flags),
    tangent: num(v.tangent),
    faceIndices: v.faceIndices.map((i) => num(i)),
  };
}

export function dumpEntity(e: Entity): JsonObject {
  if (!PARSED.has(e.type)) return { t: e.dxfType, h: handle(e.handle) };
  const out = common(e);
  switch (e.type) {
    case "LINE":
      Object.assign(out, {
        start: pt(e.start),
        end: pt(e.end),
        thickness: num(e.thickness),
        extrusion: pt(e.extrusion),
      });
      break;
    case "POINT":
      Object.assign(out, {
        location: pt(e.location),
        thickness: num(e.thickness),
        angle: num(e.angle),
        extrusion: pt(e.extrusion),
      });
      break;
    case "CIRCLE":
    case "ARC":
      Object.assign(out, {
        center: pt(e.center),
        radius: num(e.radius),
        thickness: num(e.thickness),
        extrusion: pt(e.extrusion),
      });
      if (e.type === "ARC") Object.assign(out, { startAngle: num(e.startAngle), endAngle: num(e.endAngle) });
      break;
    case "ELLIPSE":
      Object.assign(out, {
        center: pt(e.center),
        majorAxis: pt(e.majorAxis),
        ratio: num(e.ratio),
        startParam: num(e.startParam),
        endParam: num(e.endParam),
        extrusion: pt(e.extrusion),
      });
      break;
    case "SOLID":
    case "TRACE":
      Object.assign(out, {
        v0: pt(e.v0),
        v1: pt(e.v1),
        v2: pt(e.v2),
        v3: pt(e.v3),
        thickness: num(e.thickness),
        extrusion: pt(e.extrusion),
      });
      break;
    case "3DFACE":
      Object.assign(out, {
        v0: pt(e.v0),
        v1: pt(e.v1),
        v2: pt(e.v2),
        v3: pt(e.v3),
        invisibleEdges: num(e.invisibleEdges),
      });
      break;
    case "RAY":
    case "XLINE":
      Object.assign(out, { start: pt(e.start), direction: pt(e.direction) });
      break;
    case "SPLINE":
      Object.assign(out, {
        normal: pt(e.normal),
        flags: num(e.flags),
        degree: num(e.degree),
        knots: e.knots.map((k) => num(k)),
        weights: e.weights.map((w) => num(w)),
        controlPoints: e.controlPoints.map(pt),
        fitPoints: e.fitPoints.map(pt),
        startTangent: pt(e.startTangent),
        endTangent: pt(e.endTangent),
        knotTolerance: num(e.knotTolerance),
        controlPointTolerance: num(e.controlPointTolerance),
        fitTolerance: num(e.fitTolerance),
      });
      break;
    case "SHAPE":
      Object.assign(out, {
        insert: pt(e.insert),
        size: num(e.size),
        name: e.name,
        rotation: num(e.rotation),
        widthFactor: num(e.widthFactor),
        oblique: num(e.oblique),
        thickness: num(e.thickness),
        extrusion: pt(e.extrusion),
      });
      break;
    case "LWPOLYLINE":
      Object.assign(out, {
        flags: num(e.flags),
        constantWidth: num(e.constantWidth),
        elevation: num(e.elevation),
        thickness: num(e.thickness),
        extrusion: pt(e.extrusion),
        // -1 = "not given" in truedxf; ezdxf stores 0
        vertices: e.vertices.map((v) => [
          num(v.x),
          num(v.y),
          num(v.startWidth < 0 ? 0 : v.startWidth),
          num(v.endWidth < 0 ? 0 : v.endWidth),
          num(v.bulge),
        ]),
      });
      break;
    case "POLYLINE":
      Object.assign(out, {
        flags: num(e.flags),
        elevationPoint: pt(e.elevationPoint),
        thickness: num(e.thickness),
        defaultStartWidth: num(e.defaultStartWidth),
        defaultEndWidth: num(e.defaultEndWidth),
        m: num(e.m),
        n: num(e.n),
        mDensity: num(e.mDensity),
        nDensity: num(e.nDensity),
        smoothType: num(e.smoothType),
        extrusion: pt(e.extrusion),
        vertices: e.vertices.map(vertex),
      });
      break;
    case "TEXT":
      textProps(e, out);
      break;
    case "ATTRIB":
    case "ATTDEF":
      return attrib(e);
    case "INSERT":
      Object.assign(out, {
        blockName: e.blockName,
        insert: pt(e.insert),
        scale: [num(e.scale.x), num(e.scale.y), num(e.scale.z)],
        rotation: num(e.rotation),
        columnCount: num(e.columnCount),
        rowCount: num(e.rowCount),
        columnSpacing: num(e.columnSpacing),
        rowSpacing: num(e.rowSpacing),
        extrusion: pt(e.extrusion),
        attribs: e.attribs.map(attrib),
      });
      break;
  }
  return out;
}

function headerValue(v: unknown): Json {
  if (v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return num(v);
  if (typeof v === "object" && v !== null && "x" in v) return pt(v as Point3);
  return String(v);
}

function tables(doc: DxfDocument): JsonObject {
  const layers: JsonObject = {};
  for (const l of doc.tables.layers) {
    const key = l.name.toUpperCase();
    if (key in layers) continue;
    layers[key] = {
      name: l.name,
      color: num(l.color),
      off: l.off,
      frozen: l.frozen,
      locked: l.locked,
      linetype: l.linetype,
      plot: l.plot,
      lineweight: num(l.lineweight),
      trueColor: num(l.trueColor),
      transparency: num(l.transparency),
    };
  }
  const linetypes: JsonObject = {};
  for (const lt of doc.tables.linetypes) {
    const key = lt.name.toUpperCase();
    if (key in linetypes) continue;
    linetypes[key] = {
      name: lt.name,
      description: lt.description,
      patternLength: num(lt.patternLength),
      elements: lt.elements.map((e) => num(e.length)),
    };
  }
  const styles: JsonObject = {};
  for (const st of doc.tables.styles) {
    // nameless shape-file entries (flag 1): key by font file
    const key = st.name.toUpperCase() || `<${st.font.toUpperCase()}>`;
    if (key in styles) continue;
    styles[key] = {
      name: st.name,
      flags: num(st.flags),
      font: st.font,
      bigFont: st.bigFont,
      fixedHeight: num(st.fixedHeight),
      widthFactor: num(st.widthFactor),
      oblique: num(st.oblique),
      generationFlags: num(st.generationFlags),
    };
  }
  const blockRecords = [...new Set(doc.tables.blockRecords.entries.map((b) => b.name.toUpperCase()))].sort();
  return { layers, linetypes, styles, blockRecords };
}

export function dumpDocument(doc: DxfDocument): JsonObject {
  const header: JsonObject = {};
  for (const name of HEADER_VARS) if (doc.header.has(name)) header[name] = headerValue(doc.header.get(name));
  const blocks: JsonObject = {};
  for (const b of doc.blocks) {
    const key = b.name.toUpperCase();
    if (LAYOUT_BLOCKS.has(key) || key in blocks) continue;
    blocks[key] = {
      name: b.name,
      flags: num(b.flags),
      basePoint: pt(b.basePoint),
      entities: b.entities.map(dumpEntity),
    };
  }
  const layouts: JsonObject = {};
  for (const l of doc.layouts) {
    // R12 layout blocks: ezdxf renames $MODEL_SPACE/$PAPER_SPACE to *Model_Space/*Paper_Space
    const block = l.block.name.toUpperCase().replace(/^\$(MODEL|PAPER)_SPACE$/, "*$1_SPACE");
    layouts[l.name.toUpperCase()] = { block, tabOrder: num(l.tabOrder) };
  }
  return {
    header,
    tables: tables(doc),
    layouts,
    blocks,
    modelspace: doc.modelSpace.entities.map(dumpEntity),
    paperspace: (doc.paperSpace?.entities ?? []).map(dumpEntity),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node tools/corpus/src/dump.ts FILE.dxf");
    process.exit(2);
  }
  const doc = DxfDocument.load(new Uint8Array(readFileSync(file)));
  console.log(JSON.stringify(dumpDocument(doc), null, 1));
}
