/**
 * Text → display list: TEXT, ATTRIB, ATTDEF and MTEXT through @truedxf/text layouts
 * (research/notes/04-text-fonts.md §4.5, §7; 07-blocks-inserts-misc.md §4).
 *
 * - SHX glyphs are open polylines, stroked with the entity's lineweight (hairlines at 0), never
 *   filled (note 04 §4.4).
 * - TrueType glyphs are filled outlines (TEXTFILL = 1, the AutoCAD default), nonzero rule, no
 *   stroke — "TrueType fonts do not take lineweight settings" (note 04 §4.5).
 * - MTEXT background fills are drawn before the text; inline `\C`/`\c` colours override the
 *   entity colour (ByBlock/ByLayer resolved in the entity's context).
 * - Glyph flattening/triangulation is cached per (glyph, tolerance bucket) in font units and
 *   reused through affine transforms.
 */
import { codepageToEncoding } from "@truedxf/core";
import {
  FontManager,
  type FontProvider,
  flattenPath,
  flattenStrokes,
  type Glyph,
  type OutlineGlyph,
  type StrokeGlyph,
} from "@truedxf/fonts";
import { Affine2, FillRule, type Matrix44, strokePolylineInto, triangulateFill } from "@truedxf/geometry";
import {
  type AttribEntity,
  type DxfDocument,
  type Entity,
  type MTextEntity,
  parseEmbeddedMText,
  type TextEntity,
} from "@truedxf/model";
import {
  type ColorOverride,
  type InlineFontSpec,
  inlineFonts,
  layoutMText,
  layoutText,
  TextFonts,
  type TextLayout,
} from "@truedxf/text";
import { aciToRgb } from "./aci.ts";
import type { DisplayListBuilder, Rgba } from "./displaylist.ts";
import type { Inherited, PropertyResolver, Resolved } from "./props.ts";

/** Chord tolerance in device pixels for glyph flattening (same as the frontend's curves). */
const GLYPH_TOLERANCE_PX = 0.1;

/** What the text module needs from the frontend. */
export interface TextHost {
  readonly doc: DxfDocument;
  readonly builder: DisplayListBuilder;
  readonly pixelSize: number;
  readonly props: PropertyResolver;
  color(r: Resolved): Rgba;
  /** Lineweight in device pixels, 0 = hairline. */
  widthPx(r: Resolved): number;
  note(what: string): void;
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

function providerFor(load: LoadFont): FontProvider {
  const cache = new Map<string, Promise<Uint8Array | undefined>>();
  const get = (name: string) => {
    const k = name.toLowerCase();
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

const managers = new WeakMap<LoadFont, FontManager>();

/** Font-manager options of the renderer (FONTALT = simplex.shx like AutoCAD 2027). */
export const TEXT_FONT_OPTIONS = {
  fontAlt: "simplex.shx",
  // Which Windows font supplies glyphs missing from a TTF is UNKNOWN (note 04 §4.5).
  glyphFallbacks: ["arial.ttf", "seguisym.ttf", "simsun.ttc"],
} as const;

/** Resolves every text style and MTEXT inline font of a document (call before drawing). */
export async function prepareTextFonts(
  doc: DxfDocument,
  loadFont: LoadFont | undefined,
): Promise<TextFonts | undefined> {
  if (!loadFont) return undefined;
  let manager = managers.get(loadFont);
  if (!manager) {
    manager = new FontManager(providerFor(loadFont), {
      fontAlt: TEXT_FONT_OPTIONS.fontAlt,
      glyphFallbacks: [...TEXT_FONT_OPTIONS.glyphFallbacks],
    });
    managers.set(loadFont, manager);
  }
  const encoding = codepageToEncoding(doc.header.str("$DWGCODEPAGE", "ANSI_1252")).encoding;
  const styles = [...doc.tables.styles].filter((s) => !s.isShapeFile);
  const fonts = new TextFonts(manager, styles, encoding);
  const inline = new Map<string, InlineFontSpec>();
  const scan = (text: string) => {
    if (text.indexOf("\\f") < 0 && text.indexOf("\\F") < 0) return;
    for (const f of inlineFonts(text)) inline.set(`${f.name}|${f.bold}|${f.italic}`, f);
  };
  const visit = (entities: readonly Entity[]) => {
    for (const e of entities) {
      if (e.type === "MTEXT") scan((e as MTextEntity).text);
      else if ((e.type === "ATTDEF" || e.type === "ATTRIB") && (e as AttribEntity).isMultiline) {
        const m = parseEmbeddedMText(e.record);
        if (m) scan(m.text);
      } else if (e.type === "INSERT") {
        for (const a of (e as Entity & { attribs: readonly AttribEntity[] }).attribs) {
          if (!a.isMultiline) continue;
          const m = parseEmbeddedMText(a.record);
          if (m) scan(m.text);
        }
      }
    }
  };
  for (const b of doc.blocks) visit(b.entities);
  visit(doc.modelSpace.entities);
  await fonts.prepare(inline.values());
  return fonts;
}

// ---- glyph geometry caches ---------------------------------------------------------------------

const strokeCache = new WeakMap<StrokeGlyph, Map<number, Float64Array[]>>();
const fillCache = new WeakMap<OutlineGlyph, Map<number, Float64Array>>();

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
  // plane (x, y, 0) → target (x, y): parallel projection drops z
  const a = m.m;
  return new Affine2(a[0]!, a[1]!, a[4]!, a[5]!, a[12]!, a[13]!);
}

// ---- drawing -----------------------------------------------------------------------------------

export class TextDraw {
  private readonly host: TextHost;
  readonly fonts: TextFonts;
  private readonly attMode: number;
  /** Pre-R2018 linked MTEXT columns: handle → the master's column width (note 04 §3.7). */
  private readonly linkedColumnWidth = new Map<string, number>();

  constructor(host: TextHost, fonts: TextFonts) {
    this.host = host;
    this.fonts = fonts;
    this.attMode = host.doc.header.num("$ATTMODE", 1);
    const visit = (entities: readonly Entity[]) => {
      for (const e of entities) {
        if (e.type !== "MTEXT") continue;
        const c = (e as MTextEntity).columns;
        if (c && c.source === "xdata" && c.width > 0)
          for (const h of c.linkedHandles) this.linkedColumnWidth.set(h.toUpperCase(), c.width);
      }
    };
    for (const b of host.doc.blocks) visit(b.entities);
  }

  /** TEXT, MTEXT and ATTDEF entities met while walking a block. `inBlock` = reached through an INSERT. */
  entity(e: Entity, m: Matrix44, inh: Inherited, inBlock: boolean): void {
    if (e.type === "TEXT") {
      this.draw(layoutText(e as TextEntity, this.fonts), e, m, inh);
    } else if (e.type === "MTEXT") {
      const mt = e as MTextEntity;
      const wrapWidth = this.linkedColumnWidth.get(mt.handle.toUpperCase());
      this.draw(layoutMText(mt, this.fonts, wrapWidth !== undefined ? { wrapWidth } : {}), e, m, inh);
    } else if (e.type === "ATTDEF") {
      const a = e as AttribEntity;
      if (inBlock) {
        // constant ATTDEFs draw their value as block content; others are not drawn (note 07 §4.1)
        if ((a.attribFlags & 2) === 0 || !this.attribVisible(a)) return;
        this.attribute(a, m, inh, a.text);
      } else {
        // a loose ATTDEF shows its tag (note 04 §2.2)
        this.attribute(a, m, inh, a.tag);
      }
    }
  }

  private attribVisible(a: AttribEntity): boolean {
    if (this.attMode === 0) return false;
    if (this.attMode === 2) return true;
    return (a.attribFlags & 1) === 0;
  }

  /**
   * ATTRIBs of an INSERT: stored in their final position (not transformed by the insert), drawn
   * after the block content (note 07 §4.2). `m`/`inh` are those of the INSERT's parent context
   * and the INSERT's inherited properties.
   */
  attribs(attribs: readonly AttribEntity[], m: Matrix44, inh: Inherited): void {
    const b = this.host.builder;
    for (const a of attribs) {
      if (!this.attribVisible(a) || !this.host.props.isPlotted(a, inh)) continue;
      b.beginEntity(a.handle || `#${a.id}`);
      try {
        this.attribute(a, m, inh, a.text);
      } catch (err) {
        this.host.note(`error:ATTRIB:${err instanceof Error ? err.message : String(err)}`);
      }
      b.endEntity();
    }
  }

  private attribute(a: AttribEntity, m: Matrix44, inh: Inherited, text: string): void {
    if (a.isMultiline) {
      // R2018 multi-line attribute: the embedded MTEXT wins over group 1 (note 04 §2.3)
      const mt = parseEmbeddedMText(a.record);
      if (mt) {
        this.draw(
          layoutMText({ ...mt, text: text === a.tag && a.type === "ATTDEF" ? a.tag : mt.text }, this.fonts),
          a,
          m,
          inh,
        );
        return;
      }
    }
    this.draw(layoutText({ ...a, text }, this.fonts), a, m, inh);
  }

  private resolveColor(r: Resolved, c: ColorOverride | { kind: "canvas" } | undefined, inh: Inherited): Rgba {
    const host = this.host;
    if (!c) return host.color(r);
    const bg = host.props.background;
    if (c.kind === "canvas") return [bg[0], bg[1], bg[2], 255];
    if (c.kind === "rgb") {
      const rgb: [number, number, number] = [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255];
      return host.color({ ...r, rgb, trueColor: c.rgb });
    }
    let aci = c.aci;
    let tc: number | undefined;
    if (aci === 0) {
      aci = inh.aci;
      tc = inh.trueColor;
    } else if (aci === 256) {
      const l = host.props.layer(r.layer);
      aci = l.color;
      tc = l.trueColor;
    }
    const rgb: [number, number, number] =
      tc !== undefined ? [(tc >> 16) & 255, (tc >> 8) & 255, tc & 255] : aciToRgb(Math.abs(aci), bg);
    return host.color({ ...r, rgb, aci, trueColor: tc });
  }

  private draw(layout: TextLayout, e: Entity, m: Matrix44, inh: Inherited): void {
    const host = this.host;
    for (const n of layout.notes) host.note(n);
    if (layout.glyphs.length === 0 && layout.lines.length === 0 && layout.backgrounds.length === 0) return;
    const r = host.props.resolve(e, inh);
    const toTarget = affineOf(m.multiply(layout.plane));
    const b = host.builder;
    const px = host.pixelSize;
    const tolWorld = px * GLYPH_TOLERANCE_PX;
    const width = host.widthPx(r) * px;
    const stroke = (pts: Float64Array, color: Rgba) => {
      if (pts.length < 2) return;
      if (width === 0) {
        if (pts.length === 2 || (pts.length === 4 && pts[0] === pts[2] && pts[1] === pts[3]))
          b.points([pts[0]!, pts[1]!], color);
        else b.polyline(pts, color);
      } else {
        const out: number[] = [];
        strokePolylineInto(pts, { width, tolerance: tolWorld }, out);
        b.triangles(out, color);
      }
    };
    for (const bg of layout.backgrounds) {
      const c = bg.corners;
      const q = toTarget.applyPoints(Float64Array.from(c));
      b.triangles(
        [q[0]!, q[1]!, q[2]!, q[3]!, q[4]!, q[5]!, q[0]!, q[1]!, q[4]!, q[5]!, q[6]!, q[7]!],
        this.resolveColor(r, bg.color, inh),
      );
    }
    const baseColor = host.color(r);
    for (const g of layout.glyphs) {
      const t = toTarget.multiply(g.matrix);
      const color = g.color ? this.resolveColor(r, g.color, inh) : baseColor;
      const sigma = t.singularValues()[0];
      if (!(sigma > 0)) continue;
      const tolFu = tolWorld / sigma;
      const glyph: Glyph = g.glyph;
      if (glyph.kind === "strokes") {
        for (const pl of glyphPolylines(glyph, tolFu)) stroke(t.applyPoints(pl), color);
      } else {
        const tri = glyphTriangles(glyph, tolFu);
        if (tri.length >= 6) b.triangles(t.applyPoints(tri), color);
      }
    }
    for (const l of layout.lines) {
      const color = l.color ? this.resolveColor(r, l.color, inh) : baseColor;
      const p = toTarget.applyPoints(Float64Array.of(l.x0, l.y0, l.x1, l.y1));
      stroke(p, color);
    }
  }
}
