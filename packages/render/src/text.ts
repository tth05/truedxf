/**
 * Text → display list: TEXT, ATTRIB, ATTDEF and MTEXT through @truedxf/text layouts
 * (research/notes/04-text-fonts.md §4.5, §7; 07-blocks-inserts-misc.md §4).
 *
 * - SHX glyphs are open polylines, stroked with the entity's lineweight (hairlines at 0), never
 *   filled (note 04 §4.4). Text ignores linetypes.
 * - TrueType glyphs are filled outlines (TEXTFILL = 1, the AutoCAD default), nonzero rule, no
 *   stroke — "TrueType fonts do not take lineweight settings" (note 04 §4.5).
 * - MTEXT background fills are drawn before the text; inline `\C`/`\c` colours override the
 *   entity colour (ByBlock/ByLayer resolved in the entity's context).
 * - ATTRIBs are stored in their final position: drawn after the block content with the INSERT's
 *   parent transform, visibility by flag 1 and $ATTMODE (note 07 §4.2). Constant ATTDEFs draw as
 *   block content; other ATTDEFs only outside blocks, showing their tag (note 07 §4.1).
 * - Glyph flattening/triangulation is cached per (glyph, tolerance bucket) in font units and
 *   reused through affine transforms.
 */
import { codepageToEncoding } from "@truedxf/core";
import {
  FontManager,
  type FontProvider,
  flattenPath,
  flattenStrokes,
  type OutlineGlyph,
  type StrokeGlyph,
} from "@truedxf/fonts";
import { Affine2, FillRule, Matrix44, ocsToWcsMatrix, triangulateFill } from "@truedxf/geometry";
import {
  type AttribEntity,
  type DxfDocument,
  type Entity,
  type InsertEntity,
  type MTextEntity,
  parseEmbeddedMText,
  type TextEntity,
} from "@truedxf/model";
import {
  type BackgroundColor,
  type ColorOverride,
  type InlineFontSpec,
  inlineFonts,
  layoutMText,
  layoutText,
  TextFonts,
  type TextLayout,
} from "@truedxf/text";
import { aciToRgb } from "./aci.ts";
import type { Rgba } from "./displaylist.ts";
import { type Frontend, registerDrawer, registerPreparer, setAttribDrawer } from "./frontend.ts";
import type { Inherited, Resolved } from "./props.ts";

/** Text options of a render environment. */
export interface TextRenderOptions {
  /**
   * Font files to treat as missing (they resolve to FONTALT like in AutoCAD). Mirrors a reference
   * machine whose AutoCAD session did not see some installed fonts (it plots them in simplex.shx).
   */
  unavailableFonts?: RegExp;
  /** FONTALT, default "simplex.shx" (AutoCAD 2027 default). */
  fontAlt?: string;
  /** Fallback TTFs for glyphs missing from a TTF (which ones AutoCAD uses is UNKNOWN, note 04 §4.5). */
  glyphFallbacks?: readonly string[];
}

declare module "./frontend.ts" {
  interface RenderEnv {
    /** Text rendering options (render/text.ts). */
    text?: TextRenderOptions;
  }
}

// ---- font preparation ------------------------------------------------------------------------

/**
 * GDI family → font files (regular, bold, italic, bold italic) for providers that can neither
 * list files nor look up families (the visual harness serves fonts by file name only).
 */
const FAMILY_FILES: Record<string, readonly string[]> = {
  arial: ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"],
  "times new roman": ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"],
  calibri: ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"],
  "courier new": ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"],
  "segoe ui": ["segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"],
  verdana: ["verdana.ttf", "verdanab.ttf", "verdanai.ttf", "verdanaz.ttf"],
  tahoma: ["tahoma.ttf", "tahomabd.ttf", "tahoma.ttf", "tahomabd.ttf"],
  "liberation sans": [
    "LiberationSans-Regular.ttf",
    "LiberationSans-Bold.ttf",
    "LiberationSans-Italic.ttf",
    "LiberationSans-BoldItalic.ttf",
  ],
  lato: ["LatoWeb-Regular.ttf", "LatoWeb-Bold.ttf", "LatoWeb-Italic.ttf", "LatoWeb-BoldItalic.ttf"],
  "cascadia mono": [
    "CascadiaMono.ttf",
    "CascadiaMono.ttf",
    "CascadiaMonoItalic.ttf",
    "CascadiaMonoItalic.ttf",
  ],
  simsun: ["simsun.ttc", "simsun.ttc", "simsun.ttc", "simsun.ttc"],
  isocpeur: ["isocpeur.ttf", "isocpeur.ttf", "isocpeui.ttf", "isocpeui.ttf"],
};

type LoadFont = (name: string) => Promise<Uint8Array | undefined>;

function providerFor(load: LoadFont, hide: RegExp | undefined): FontProvider {
  const cache = new Map<string, Promise<Uint8Array | undefined>>();
  const get = (name: string): Promise<Uint8Array | undefined> => {
    const k = name.toLowerCase();
    if (hide?.test(name)) return Promise.resolve(undefined);
    let p = cache.get(k);
    if (!p) {
      p = load(k).catch(() => undefined);
      cache.set(k, p);
    }
    return p;
  };
  return {
    getFile: get,
    async findFamily(family, style) {
      const key = family.trim().toLowerCase();
      const idx = (style.bold ? 1 : 0) + (style.italic ? 2 : 0);
      const known = FAMILY_FILES[key];
      const compact = family.replace(/\s+/g, "");
      const suffix = ["Regular", "Bold", "Italic", "BoldItalic"][idx]!;
      const candidates = [
        ...(known ? [known[idx]!, known[0]!] : []),
        `${compact}-${suffix}.ttf`,
        `${compact}.ttf`,
        `${key}.ttf`,
      ];
      for (const c of candidates) if (await get(c)) return c;
      return undefined;
    },
  };
}

const managers = new WeakMap<LoadFont, Map<string, FontManager>>();

/** Resolves every text style and MTEXT inline font of a document. */
export async function prepareTextFonts(
  doc: DxfDocument,
  loadFont: LoadFont | undefined,
  options: TextRenderOptions = {},
): Promise<TextFonts | undefined> {
  if (!loadFont) return undefined;
  const fontAlt = options.fontAlt ?? "simplex.shx";
  const glyphFallbacks = options.glyphFallbacks ?? ["arial.ttf", "seguisym.ttf", "simsun.ttc"];
  const key = `${fontAlt}|${glyphFallbacks.join(",")}|${options.unavailableFonts?.source ?? ""}`;
  let byKey = managers.get(loadFont);
  if (!byKey) {
    byKey = new Map();
    managers.set(loadFont, byKey);
  }
  let manager = byKey.get(key);
  if (!manager) {
    manager = new FontManager(providerFor(loadFont, options.unavailableFonts), {
      fontAlt,
      glyphFallbacks: [...glyphFallbacks],
    });
    byKey.set(key, manager);
  }
  const encoding = codepageToEncoding(doc.header.str("$DWGCODEPAGE", "ANSI_1252")).encoding;
  const styles = [...doc.tables.styles].filter((s) => !s.isShapeFile);
  const fonts = new TextFonts(manager, styles, encoding);
  const inline = new Map<string, InlineFontSpec>();
  const scan = (text: string) => {
    if (text.indexOf("\\f") < 0 && text.indexOf("\\F") < 0) return;
    for (const f of inlineFonts(text)) inline.set(`${f.name}|${f.bold}|${f.italic}`, f);
  };
  const scanAttrib = (a: AttribEntity) => {
    if (!a.isMultiline) return;
    const m = parseEmbeddedMText(a.record);
    if (m) scan(m.text);
  };
  const visit = (entities: readonly Entity[]) => {
    for (const e of entities) {
      if (e.type === "MTEXT") scan((e as MTextEntity).text);
      else if (e.type === "ATTDEF") scanAttrib(e as AttribEntity);
      else if (e.type === "INSERT") for (const a of (e as InsertEntity).attribs) scanAttrib(a);
    }
  };
  for (const b of doc.blocks) visit(b.entities);
  visit(doc.modelSpace.entities);
  await fonts.prepare(inline.values());
  return fonts;
}

/** Prepared fonts per document (set by the preparer, read by the drawers). */
const PREPARED = new WeakMap<DxfDocument, TextFonts | undefined>();

registerPreparer(async (doc, env) => {
  PREPARED.set(doc, await prepareTextFonts(doc, env.loadFont, env.text));
});

// ---- glyph geometry caches ---------------------------------------------------------------------

const strokeCache = new WeakMap<StrokeGlyph, Map<number, Float64Array[]>>();
const fillCache = new WeakMap<OutlineGlyph, Map<number, Float64Array>>();

/** Power-of-two tolerance buckets so that glyphs are flattened once per scale octave. */
function bucketTolerance(tol: number): [number, number] {
  const b = Math.floor(Math.log2(Math.max(tol, 1e-12)));
  return [b, 2 ** b];
}

function glyphPolylines(g: StrokeGlyph, tolFu: number): Float64Array[] {
  const [b, tol] = bucketTolerance(tolFu);
  let m = strokeCache.get(g);
  if (!m) {
    m = new Map();
    strokeCache.set(g, m);
  }
  let pl = m.get(b);
  if (!pl) {
    pl = flattenStrokes(g.strokes, { tolerance: tol }).map((p) => Float64Array.from(p));
    m.set(b, pl);
  }
  return pl;
}

function glyphTriangles(g: OutlineGlyph, tolFu: number): Float64Array {
  const [b, tol] = bucketTolerance(tolFu);
  let m = fillCache.get(g);
  if (!m) {
    m = new Map();
    fillCache.set(g, m);
  }
  let tri = m.get(b);
  if (!tri) {
    const rings = flattenPath(g.path, { tolerance: tol })
      .filter((r) => r.length >= 6)
      .map((r) => Float64Array.from(r));
    tri = rings.length
      ? triangulateFill(rings, { fillRule: FillRule.NonZero, tolerance: tol })
      : new Float64Array(0);
    m.set(b, tri);
  }
  return tri;
}

function affineOf(m: Matrix44): Affine2 {
  // plane (x, y, 0) → target (x, y): a parallel projection drops z
  const a = m.m;
  return new Affine2(a[0]!, a[1]!, a[4]!, a[5]!, a[12]!, a[13]!);
}

// ---- drawing -----------------------------------------------------------------------------------

function fontsOf(fe: Frontend): TextFonts | undefined {
  const f = PREPARED.get(fe.doc);
  if (!f) fe.note("text-no-fonts");
  return f;
}

/** Pre-R2018 linked MTEXT columns: handle → the master's column width (note 04 §3.7). */
function linkedColumnWidths(fe: Frontend): Map<string, number> {
  let m = fe.caches.get("text:linked-columns") as Map<string, number> | undefined;
  if (m) return m;
  m = new Map();
  for (const b of fe.doc.blocks) {
    for (const e of b.entities) {
      if (e.type !== "MTEXT") continue;
      const c = (e as MTextEntity).columns;
      if (c && c.source === "xdata" && c.width > 0)
        for (const h of c.linkedHandles) m.set(h.toUpperCase(), c.width);
    }
  }
  fe.caches.set("text:linked-columns", m);
  return m;
}

function attMode(fe: Frontend): number {
  return fe.doc.header.num("$ATTMODE", 1);
}

function attribVisible(fe: Frontend, a: AttribEntity): boolean {
  const mode = attMode(fe);
  if (mode === 0) return false;
  if (mode === 2) return true;
  return (a.attribFlags & 1) === 0;
}

/** Header-driven layout options ($TEXTSIZE for height 0, $QTEXTMODE boxes). */
function layoutOptions(fe: Frontend): { defaultHeight: number; quickText: boolean } {
  let o = fe.caches.get("text:options") as { defaultHeight: number; quickText: boolean } | undefined;
  if (!o) {
    o = {
      defaultHeight: fe.doc.header.num("$TEXTSIZE", 2.5),
      quickText: fe.doc.header.num("$QTEXTMODE", 0) !== 0,
    };
    fe.caches.set("text:options", o);
  }
  return o;
}

/** Single-line text input: a missing group 71 means "use the STYLE's flags" (VERIFIED-BY-ACAD). */
function singleLine<T extends TextEntity | AttribEntity>(e: T, text: string = e.text) {
  const has71 = e.record.find(71, "AcDbText") >= 0;
  return { ...e, text, generationFlags: has71 ? e.generationFlags : undefined };
}

function attributeLayout(fe: Frontend, fonts: TextFonts, a: AttribEntity, text: string): TextLayout {
  const opts = layoutOptions(fe);
  // R2018 attribute type 71 = 1 (single line) draws group 1 even with an embedded MTEXT
  // (VERIFIED-BY-ACAD attribs/multiline-attrib-type1)
  const sub = a.type === "ATTDEF" ? "AcDbAttributeDefinition" : "AcDbAttribute";
  const i71 = a.record.find(71, sub);
  const oneLine = i71 >= 0 && a.record.store.int(i71) === 1;
  if (a.isMultiline && !oneLine) {
    // R2018 multi-line attribute: the embedded MTEXT wins over group 1 (note 04 §2.3)
    const mt = parseEmbeddedMText(a.record);
    if (mt) return layoutMText(text === a.tag && a.type === "ATTDEF" ? { ...mt, text } : mt, fonts, opts);
  }
  return layoutText(singleLine(a, text), fonts, opts);
}

registerDrawer(["TEXT", "MTEXT", "ATTDEF"], (fe, e, st) => {
  const fonts = fontsOf(fe);
  if (!fonts) return;
  if (e.type === "TEXT") {
    drawLayout(fe, layoutText(singleLine(e as TextEntity), fonts, layoutOptions(fe)), e, st.m, st.inh);
  } else if (e.type === "MTEXT") {
    let mt = e as MTextEntity;
    // 11 and 50 both present: the later one wins (VERIFIED-BY-ACAD mtext/rot-both-*)
    if (mt.direction) {
      const i11 = mt.record.find(11, "AcDbMText");
      const i50 = mt.record.find(50, "AcDbMText");
      if (i11 >= 0 && i50 > i11) mt = { ...mt, direction: undefined };
    }
    const wrapWidth = linkedColumnWidths(fe).get(mt.handle.toUpperCase());
    // dimension blocks (*D…): \X wraps at the dimension line
    const dimension = (st.stack[st.stack.length - 1] ?? "").toUpperCase().startsWith("*D");
    const opts = { ...layoutOptions(fe), dimension };
    drawLayout(
      fe,
      layoutMText(mt, fonts, wrapWidth !== undefined ? { ...opts, wrapWidth } : opts),
      e,
      st.m,
      st.inh,
    );
  } else {
    const a = e as AttribEntity;
    if (st.stack.length > 1) {
      // inside a block: only constant ATTDEFs draw (their value) — note 07 §4.1; flag 1 and
      // $ATTMODE are honoured for them too (ASSUMPTION)
      if ((a.attribFlags & 2) === 0 || !attribVisible(fe, a)) return;
      drawLayout(fe, attributeLayout(fe, fonts, a, a.text), e, st.m, st.inh);
    } else {
      // a loose ATTDEF shows its tag (note 04 §2.2)
      drawLayout(fe, attributeLayout(fe, fonts, a, a.tag), e, st.m, st.inh);
    }
  }
});

setAttribDrawer((fe, insert, st) => {
  const fonts = fontsOf(fe);
  if (!fonts) return;
  // ByBlock / layer-0 attributes inherit from their INSERT
  const inh = fe.props.inherit(insert, st.inh);
  const b = fe.builder;
  // MINSERT: the ATTRIBs (stored for cell 0,0) repeat in every cell (VERIFIED-BY-ACAD
  // attribs/minsert-*): translate by the cell offset in the insert's rotated OCS frame
  const cells: Matrix44[] = [];
  const ocs = ocsToWcsMatrix(insert.extrusion);
  const rot = (insert.rotation * Math.PI) / 180;
  for (let row = 0; row < insert.rowCount; row++) {
    for (let col = 0; col < insert.columnCount; col++) {
      const dx = col * insert.columnSpacing;
      const dy = row * insert.rowSpacing;
      const v = ocs.transformDirection({
        x: dx * Math.cos(rot) - dy * Math.sin(rot),
        y: dx * Math.sin(rot) + dy * Math.cos(rot),
        z: 0,
      });
      cells.push(row === 0 && col === 0 ? st.m : st.m.multiply(Matrix44.translation(v.x, v.y, v.z)));
    }
  }
  for (const a of insert.attribs) {
    if (!attribVisible(fe, a) || !fe.props.isPlotted(a, inh)) continue;
    b.beginEntity(a.handle || `#${a.id}`);
    try {
      const layout = attributeLayout(fe, fonts, a, a.text);
      for (const m of cells) drawLayout(fe, layout, a, m, inh);
    } catch (err) {
      fe.note(`error:ATTRIB:${err instanceof Error ? err.message : String(err)}`);
    }
    b.endEntity();
  }
});

/** The entity's resolved properties with an inline colour applied. */
function overrideResolved(fe: Frontend, r: Resolved, c: ColorOverride | undefined, inh: Inherited): Resolved {
  if (!c) return r;
  const bg = fe.props.background;
  if (c.kind === "rgb") {
    const rgb: [number, number, number] = [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255];
    return { ...r, rgb, trueColor: c.rgb };
  }
  let aci = c.aci;
  let tc: number | undefined;
  if (aci === 0) {
    aci = inh.aci;
    tc = inh.trueColor;
  } else if (aci === 256) {
    const l = fe.props.layer(r.layer);
    aci = l.color;
    tc = l.trueColor;
  }
  const rgb: [number, number, number] =
    tc !== undefined ? [(tc >> 16) & 255, (tc >> 8) & 255, tc & 255] : aciToRgb(Math.abs(aci), bg);
  return { ...r, rgb, aci, trueColor: tc };
}

function resolveColor(fe: Frontend, r: Resolved, c: BackgroundColor, inh: Inherited): Rgba {
  if (c.kind === "canvas") {
    const bg = fe.props.background;
    return [bg[0], bg[1], bg[2], 255];
  }
  return fe.color(overrideResolved(fe, r, c, inh));
}

/** Emits a text layout: backgrounds, glyphs, decoration lines. */
export function drawLayout(fe: Frontend, layout: TextLayout, e: Entity, m: Matrix44, inh: Inherited): void {
  for (const n of layout.notes) fe.note(n);
  if (layout.glyphs.length === 0 && layout.lines.length === 0 && layout.backgrounds.length === 0) return;
  const r = fe.props.resolve(e, inh);
  const toTarget = affineOf(m.multiply(layout.plane));
  // TrueType cell boxes count for the extents only (note 04 §11.1)
  if (fe.props.extents && layout.extents?.length)
    fe.builder.points(toTarget.applyPoints(Float64Array.from(layout.extents)), fe.color(r));
  const tol = fe.tolerance;
  for (const bg of layout.backgrounds) {
    const q = toTarget.applyPoints(Float64Array.from(bg.corners));
    if (!fe.fillMode) {
      // $FILLMODE 0: the mask is drawn as its outline (VERIFIED-BY-ACAD mtext/bg-fillmode-0)
      const b = fe.props.background;
      const rr: Resolved =
        bg.color.kind === "canvas"
          ? { ...r, rgb: [b[0], b[1], b[2]], trueColor: (b[0] << 16) | (b[1] << 8) | b[2] }
          : overrideResolved(fe, r, bg.color, inh);
      fe.strokeFlat(q, true, rr);
      continue;
    }
    fe.fillTriangles(
      [q[0]!, q[1]!, q[2]!, q[3]!, q[4]!, q[5]!, q[0]!, q[1]!, q[4]!, q[5]!, q[6]!, q[7]!],
      resolveColor(fe, r, bg.color, inh),
    );
  }
  const colored = (c: ColorOverride | undefined): Resolved => overrideResolved(fe, r, c, inh);
  const baseColor = fe.color(r);
  for (const g of layout.glyphs) {
    const t = toTarget.multiply(g.matrix);
    const sigma = t.singularValues()[0];
    if (!(sigma > 0)) continue;
    const tolFu = tol / sigma;
    const glyph = g.glyph;
    if (glyph.kind === "strokes") {
      const rr = colored(g.color);
      for (const pl of glyphPolylines(glyph, tolFu)) fe.strokeFlat(t.applyPoints(pl), false, rr);
    } else {
      const tri = glyphTriangles(glyph, tolFu);
      if (tri.length >= 6)
        fe.fillTriangles(t.applyPoints(tri), g.color ? resolveColor(fe, r, g.color, inh) : baseColor);
    }
  }
  for (const l of layout.lines) {
    fe.strokeFlat(toTarget.applyPoints(Float64Array.of(l.x0, l.y0, l.x1, l.y1)), false, colored(l.color));
  }
}
