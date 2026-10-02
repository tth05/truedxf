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
  type TextRun,
} from "@truedxf/text";
import { aciToRgb } from "./aci.ts";
import type { Rgba } from "./displaylist.ts";
import {
  type Frontend,
  type PlotNote,
  registerDrawer,
  registerPreparer,
  setAttribDrawer,
} from "./frontend.ts";
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
  /**
   * Text whose font, bigfont or MTEXT `\f`/`\F` font cannot be loaded:
   * - `"autocad"`: AutoCAD 2027's plot behaviour — FONTALT for style fonts and `\F` files, a
   *   missing bigfont suppresses the text, an unknown `\f` family draws nothing (note 04 §4.1).
   * - `"fallback"`: always draw it — with {@link fallbackFont} / {@link fallbackBigFont}.
   * Default: `"fallback"` when `RenderEnv.raster` is `"smooth"` (viewers), else `"autocad"`.
   * Either way the PlotResult gets `font-missing` / `bigfont-missing` notes.
   */
  missingFont?: "autocad" | "fallback";
  /**
   * `"fallback"` mode: font files for missing fonts, the first that loads wins. Default:
   * [FONTALT, "simplex.shx", "txt.shx", "arial.ttf", "LiberationSans-Regular.ttf"].
   */
  fallbackFont?: string | readonly string[];
  /** `"fallback"` mode: bigfont for missing bigfonts (default none: drawn without a bigfont). */
  fallbackBigFont?: string;
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
  // CJK families as styles name them in XDATA, English and localized (text-probes/cjk-*)
  "microsoft yahei": ["msyh.ttc", "msyhbd.ttc", "msyh.ttc", "msyhbd.ttc"],
  微软雅黑: ["msyh.ttc", "msyhbd.ttc", "msyh.ttc", "msyhbd.ttc"],
  "microsoft jhenghei": ["msjh.ttc", "msjhbd.ttc", "msjh.ttc", "msjhbd.ttc"],
  宋体: ["simsun.ttc", "simsun.ttc", "simsun.ttc", "simsun.ttc"],
  simhei: ["simhei.ttf", "simhei.ttf", "simhei.ttf", "simhei.ttf"],
  黑体: ["simhei.ttf", "simhei.ttf", "simhei.ttf", "simhei.ttf"],
  kaiti: ["simkai.ttf", "simkai.ttf", "simkai.ttf", "simkai.ttf"],
  fangsong: ["simfang.ttf", "simfang.ttf", "simfang.ttf", "simfang.ttf"],
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

/** Default `fallbackFont` list after FONTALT (TextRenderOptions). */
const FALLBACK_FONTS = ["simplex.shx", "txt.shx", "arial.ttf", "LiberationSans-Regular.ttf"];

/** Text style names referenced by a document's text entities (for missing-font notes). */
const USED_STYLES = new WeakMap<TextFonts, Set<string>>();

/** Resolves every text style and MTEXT inline font of a document. */
export async function prepareTextFonts(
  doc: DxfDocument,
  loadFont: LoadFont | undefined,
  options: TextRenderOptions = {},
): Promise<TextFonts | undefined> {
  if (!loadFont) return undefined;
  const fontAlt = options.fontAlt ?? "simplex.shx";
  const glyphFallbacks = options.glyphFallbacks ?? ["arial.ttf", "seguisym.ttf", "simsun.ttc"];
  const missingFont = options.missingFont ?? "autocad";
  const fb = options.fallbackFont;
  // an explicit list comes first; FONTALT stays the last resort
  const fallbackFonts = [
    ...new Set(
      fb === undefined ? [fontAlt, ...FALLBACK_FONTS] : [...(typeof fb === "string" ? [fb] : fb), fontAlt],
    ),
  ];
  const fallbackBigFont = options.fallbackBigFont;
  const key = [
    fontAlt,
    glyphFallbacks.join(","),
    options.unavailableFonts?.source ?? "",
    missingFont,
    missingFont === "fallback" ? `${fallbackFonts.join(",")}|${fallbackBigFont ?? ""}` : "",
  ].join("|");
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
      missingFont,
      fallbackFonts,
      ...(fallbackBigFont ? { fallbackBigFont } : {}),
    });
    byKey.set(key, manager);
  }
  const encoding = codepageToEncoding(doc.header.str("$DWGCODEPAGE", "ANSI_1252")).encoding;
  const styles = [...doc.tables.styles].filter((s) => !s.isShapeFile);
  const fonts = new TextFonts(manager, styles, encoding);
  const inline = new Map<string, InlineFontSpec>();
  const used = new Set<string>();
  const scan = (text: string) => {
    if (text.indexOf("\\f") < 0 && text.indexOf("\\F") < 0) return;
    for (const f of inlineFonts(text)) inline.set(`${f.name}|${f.bold}|${f.italic}`, f);
  };
  const scanAttrib = (a: AttribEntity) => {
    used.add(a.style);
    if (!a.isMultiline) return;
    const m = parseEmbeddedMText(a.record);
    if (m) {
      used.add(m.style);
      scan(m.text);
    }
  };
  const visit = (entities: readonly Entity[]) => {
    for (const e of entities) {
      if (e.type === "MTEXT") {
        used.add((e as MTextEntity).style);
        scan((e as MTextEntity).text);
      } else if (e.type === "TEXT") used.add((e as TextEntity).style);
      else if (e.type === "ATTDEF") scanAttrib(e as AttribEntity);
      else if (e.type === "INSERT") for (const a of (e as InsertEntity).attribs) scanAttrib(a);
    }
  };
  for (const b of doc.blocks) visit(b.entities);
  visit(doc.modelSpace.entities);
  await fonts.prepare(inline.values());
  USED_STYLES.set(fonts, used);
  return fonts;
}

/**
 * User-facing notes about fonts the document's text needs but the font loader could not supply
 * (PlotResult.notes): `font-missing` (style fonts, XDATA families, MTEXT `\f`/`\F` fonts) and
 * `bigfont-missing`, with the missing names in `items`.
 */
export function missingFontNotes(fonts: TextFonts): PlotNote[] {
  const r = fonts.missingFonts(USED_STYLES.get(fonts) ?? []);
  const fallback = fonts.manager.options.missingFont === "fallback";
  const notes: PlotNote[] = [];
  if (r.fonts.length) {
    const subst = r.substitutes.length ? r.substitutes.join(", ") : undefined;
    const how = !subst
      ? "text in them is not drawn"
      : fallback
        ? `drawn with ${subst}`
        : `substituted by ${subst} (FONTALT) as in AutoCAD`;
    notes.push({
      code: "font-missing",
      severity: "warning",
      message: `Fonts not found: ${r.fonts.join(", ")}; ${how}`,
      count: r.fontUsers,
      items: [...r.fonts],
    });
  }
  if (r.bigFonts.length) {
    const how = fallback
      ? r.bigSubstitutes.length
        ? `drawn with ${r.bigSubstitutes.join(", ")}`
        : "text is drawn without them"
      : "text using them is not drawn, as in AutoCAD plots";
    notes.push({
      code: "bigfont-missing",
      severity: "warning",
      message: `Big fonts not found: ${r.bigFonts.join(", ")}; ${how}`,
      count: r.bigFontUsers,
      items: [...r.bigFonts],
    });
  }
  return notes;
}

/** Prepared fonts per document (set by the preparer, read by the drawers). */
const PREPARED = new WeakMap<DxfDocument, TextFonts | undefined>();

registerPreparer(async (doc, env) => {
  // viewers (smooth raster) draw text with missing fonts; plots follow AutoCAD
  const missingFont = env.text?.missingFont ?? (env.raster === "smooth" ? "fallback" : "autocad");
  const fonts = await prepareTextFonts(doc, env.loadFont, { ...env.text, missingFont });
  PREPARED.set(doc, fonts);
  return fonts ? missingFontNotes(fonts) : undefined;
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

/** Layout is in the entity plane, before any INSERT transform (note 04 §1, §3). */
function cachedLayout(
  fe: Frontend,
  e: Entity,
  fonts: TextFonts,
  inputs: readonly (string | number | boolean | undefined)[],
  build: (opts: ReturnType<typeof layoutOptions>) => TextLayout,
): TextLayout {
  let cache = fe.caches.get("text:layouts") as
    | WeakMap<Entity, WeakMap<TextFonts, Map<string, TextLayout>>>
    | undefined;
  if (!cache) fe.caches.set("text:layouts", (cache = new WeakMap()));
  let byFont = cache.get(e);
  if (!byFont) cache.set(e, (byFont = new WeakMap()));
  let byInput = byFont.get(fonts);
  if (!byInput) byFont.set(fonts, (byInput = new Map()));
  const opts = layoutOptions(fe);
  const key = JSON.stringify([...inputs, opts.defaultHeight, opts.quickText]);
  let layout = byInput.get(key);
  if (!layout) byInput.set(key, (layout = build(opts)));
  return layout;
}

function attributeLayout(fe: Frontend, fonts: TextFonts, a: AttribEntity, text: string): TextLayout {
  return cachedLayout(fe, a, fonts, ["attribute", text], (opts) =>
    uncachedAttributeLayout(fonts, a, text, opts),
  );
}

function uncachedAttributeLayout(
  fonts: TextFonts,
  a: AttribEntity,
  text: string,
  opts: ReturnType<typeof layoutOptions>,
): TextLayout {
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
    const layout = cachedLayout(fe, e, fonts, ["text", (e as TextEntity).text], (opts) =>
      layoutText(singleLine(e as TextEntity), fonts, opts),
    );
    drawLayout(fe, layout, e, st.m, st.inh);
  } else if (e.type === "MTEXT") {
    const mt = e as MTextEntity;
    const wrapWidth = linkedColumnWidths(fe).get(mt.handle.toUpperCase());
    // dimension blocks (*D…): \X wraps at the dimension line
    const dimension = (st.stack[st.stack.length - 1] ?? "").toUpperCase().startsWith("*D");
    const layout = cachedLayout(fe, e, fonts, ["mtext", mt.text, dimension, wrapWidth], (options) => {
      let input = mt;
      // 11 and 50 both present: the later one wins (VERIFIED-BY-ACAD mtext/rot-both-*)
      if (mt.direction) {
        const i11 = mt.record.find(11, "AcDbMText");
        const i50 = mt.record.find(50, "AcDbMText");
        if (i11 >= 0 && i50 > i11) input = { ...mt, direction: undefined };
      }
      const opts = { ...options, dimension };
      return layoutMText(input, fonts, wrapWidth !== undefined ? { ...opts, wrapWidth } : opts);
    });
    drawLayout(fe, layout, e, st.m, st.inh);
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
    // an ATTRIB picks as its block reference (Frontend.pickOwner)
    try {
      const layout = attributeLayout(fe, fonts, a, a.text);
      for (const m of cells) drawLayout(fe, layout, a, m, inh);
    } catch (err) {
      fe.note(`error:ATTRIB:${err instanceof Error ? err.message : String(err)}`);
    }
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

/**
 * AutoCAD's raster plot driver places the glyphs of a TrueType string on whole device pixels
 * (note 04 §14, VERIFIED-BY-ACAD text-probes/ttf-*): every character advances floor(advance px);
 * the E = floor(Σ advance) − Σ floor(advance) missing pixels go one each to every P-th gap from
 * the first, P = floor(gaps / E). The first glyph keeps its exact position, so lines drift up to
 * a few pixels and come back at the end. Returns per character the shift in plane units.
 */
export function pixelRunShifts(
  run: TextRun,
  toTarget: Affine2,
  pixelSize: number,
): { x: number; y: number }[] | undefined {
  const d = toTarget.applyVector({ x: run.dirX, y: run.dirY });
  const k = Math.hypot(d.x, d.y) / pixelSize; // device px per plane unit along the baseline
  const n = run.advances.length;
  if (!(k > 0) || n < 2) return undefined;
  const px = run.advances.map((a) => a * k);
  const floors = px.map((a) => Math.floor(a + 1e-9));
  let total = 0;
  let floorSum = 0;
  for (let i = 0; i < n; i++) {
    total += px[i]!;
    floorSum += floors[i]!;
  }
  const extra = Math.floor(total + 1e-9) - floorSum;
  const gaps = n - 1;
  const period = extra > 0 ? Math.floor(gaps / extra) : 0;
  const out: { x: number; y: number }[] = [];
  let exact = 0;
  let snapped = 0;
  for (let i = 0; i < n; i++) {
    const s = (snapped - exact) / k;
    out.push({ x: s * run.dirX, y: s * run.dirY });
    exact += px[i]!;
    snapped += floors[i]! + (period > 0 && i % period === 0 && i / period < extra ? 1 : 0);
  }
  return out;
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
  const shifts =
    fe.grid && layout.runs
      ? layout.runs.map((run) => pixelRunShifts(run, toTarget, fe.pixelSize))
      : undefined;
  for (const g of layout.glyphs) {
    const sh = g.run && shifts?.[g.run.run]?.[g.run.index];
    const t = toTarget.multiply(sh ? Affine2.translation(sh.x, sh.y).multiply(g.matrix) : g.matrix);
    const sigma = t.singularValues()[0];
    if (!(sigma > 0)) continue;
    const tolFu = tol / sigma;
    const glyph = g.glyph;
    if (fe.lod && g.font.capHeight * sigma < 1.5 * fe.pixelSize) {
      // Cap height is measured in font units (note 04 §4.4–4.5). The largest singular value
      // keeps stretched/sheared glyphs detailed until every direction is sub-pixel.
      if (glyph.bounds) {
        const y = g.font.capHeight / 2;
        fe.builder.polyline(
          t.applyPoints(Float64Array.of(0, y, glyph.advance, y)),
          g.color ? resolveColor(fe, r, g.color, inh) : baseColor,
          false,
        );
      }
      continue;
    }
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
