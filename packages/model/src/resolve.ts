/**
 * Property resolution primitives (docs/PLAN.md §5 Phase 2 item 5): effective layer, color,
 * linetype, lineweight, transparency, plot style and visibility of an entity in a context
 * (block-reference nesting stack, paper-space viewport). Pure functions over the model; no
 * renderer state. Rules: research/notes/06 §3–§7, 07 §3, 02 §2.1.
 *
 * Usage (renderer): create one `PropertyResolver` per document (it caches table lookups), then
 *
 *   const r = resolver.resolve(entity, parents, viewport);   // parents: outermost first
 *   if (entity is a block reference && r.expandBlock)
 *     for (child of block) resolver.resolve(child, [...parents, { entity, resolved: r }], viewport)
 *
 * ATTRIBs of an INSERT are resolved with the INSERT as innermost parent (ezdxf semantics, note 07
 * §3.1; UNVERIFIED Q-0279, Q-0496). DIMENSION/LEADER/… blocks use the dimension entity as parent.
 */
import { aciToRgb, nearestAci, type Paper, PLOT_PALETTE } from "./aci.ts";
import type { DxfDocument } from "./document.ts";
import type { EntityBase } from "./entities/common.ts";
import type { DictionaryObject, DxfObject } from "./objects.ts";
import type { LayerEntry, LinetypeEntry } from "./tables.ts";
import { nameKey } from "./types.ts";

/** One level of block-reference nesting. */
export interface InsertContext {
  /** The block reference (INSERT, or the DIMENSION/LEADER/… whose block is expanded). */
  readonly entity: EntityBase;
  /** Its own resolved properties (resolved with the enclosing parents). */
  readonly resolved: ResolvedProperties;
}

/** The paper-space VIEWPORT through which model space is drawn. */
export interface ViewportContext {
  /** VIEWPORT handle: selects per-viewport layer overrides (layer xdict, note 02 §2.1.3). */
  readonly handle?: string;
  /** VIEWPORT frozen layers: LAYER handles (331/341) and/or names (R12 MVIEW 1003). */
  readonly frozenLayers?: Iterable<string>;
}

export interface ResolveOptions {
  /** ACI → RGB table (index = ACI). Default PLOT_PALETTE. */
  readonly palette?: readonly number[];
  /** Paper color: ACI 7 is black on white (default) and white on black. */
  readonly paper?: Paper;
  /**
   * LWDEFAULT in 1/100 mm. It lives in the registry, not in the DXF (note 06 §5.1); default:
   * a non-standard `$LWDEFAULT` header variable if present, else 25.
   */
  readonly lwDefault?: number;
}

export interface ResolvedProperties {
  /** Effective layer name (layer "0" inside a block takes the reference's effective layer). */
  readonly layer: string;
  /** Layer table entry; undefined if the layer is not defined (defaults are used then). */
  readonly layerEntry: LayerEntry | undefined;
  /** Effective ACI 1…255 (CTB pen selection). For true colors: the written 62 or the nearest ACI. */
  readonly aci: number;
  /** 0xRRGGBB when the effective color is a true color. */
  readonly trueColor: number | undefined;
  /** Color-book name (430) of the effective color, if any. */
  readonly colorName: string | undefined;
  /** 0xRRGGBB to draw with: true color, or ACI via the palette (ACI 7 → paper foreground). */
  readonly rgb: number;
  /** Effective linetype name as defined in the LTYPE table; "Continuous" if none/missing. */
  readonly linetype: string;
  /** LTYPE entry (undefined for Continuous when the table lacks it). */
  readonly linetypeEntry: LinetypeEntry | undefined;
  /** Entity 48 × $LTSCALE (INSERT scale / PSLTSCALE are applied by the renderer). */
  readonly linetypeScale: number;
  /** Effective lineweight in 1/100 mm (≥ 0; Default resolved to LWDEFAULT). */
  readonly lineweight: number;
  readonly lineweightMm: number;
  /** Alpha 0…255 (255 = opaque). */
  readonly alpha: number;
  /** Transparency 0…1 (0 = opaque); = 1 − alpha/255. */
  readonly transparency: number;
  /** Effective plot style (ACDBPLACEHOLDER) handle for named plot styles (STB). */
  readonly plotStyleHandle: string | undefined;
  /** Displayed: not invisible (60), effective layer on, not frozen, not VP-frozen, parents expand. */
  readonly visible: boolean;
  /** Plotted: visible, the effective layer plots (290) and is not Defpoints. */
  readonly plottable: boolean;
  /**
   * For block references: whether the block content is traversed. False when the reference is
   * invisible (60) or its effective layer is frozen (globally or in the viewport) — a frozen
   * INSERT layer hides the whole reference, an off one only the content that inherits it
   * (note 07 §3.2, 02 §2.1.1; UNVERIFIED Q-0280, Q-0620).
   */
  readonly expandBlock: boolean;
  /**
   * For block references: whether their content can plot — false below a reference on a
   * no-plot (290 = 0) or Defpoints layer (note 07 §3.2).
   */
  readonly contentPlottable: boolean;
}

export interface ResolveContext {
  readonly doc: DxfDocument;
  /** Layer lookup (e.g. a cached one); default: the document's layer table. */
  readonly layerOf?: (name: string) => LayerEntry | undefined;
  /** Enclosing block references, outermost first. */
  readonly parents: readonly InsertContext[];
  readonly viewport?: ViewportContext;
  readonly options?: ResolveOptions;
}

/** Per-viewport layer overrides (layer extension dictionary XRECORDs, note 02 §2.1.3). */
export interface LayerViewportOverride {
  /** Raw AcCmColor (0xC2RRGGBB / 0xC3……AA). */
  readonly color?: number;
  readonly linetypeHandle?: string;
  readonly lineweight?: number;
  /** Raw transparency (0x020000AA). */
  readonly transparency?: number;
}

const OVERRIDE_KEYS: readonly [string, number, keyof LayerViewportOverride][] = [
  ["ADSK_XREC_LAYER_COLOR_OVR", 420, "color"],
  ["ADSK_XREC_LAYER_LINETYPE_OVR", 343, "linetypeHandle"],
  ["ADSK_XREC_LAYER_LINEWT_OVR", 91, "lineweight"],
  ["ADSK_XREC_LAYER_ALPHA_OVR", 440, "transparency"],
];

/** Layer used for names missing from the LAYER table. */
interface LayerProps {
  readonly name: string;
  readonly color: number;
  readonly trueColor: number | undefined;
  readonly colorName: string | undefined;
  readonly off: boolean;
  readonly frozen: boolean;
  readonly plot: boolean;
  readonly linetype: string;
  readonly lineweight: number;
  readonly transparency: number | undefined;
  readonly plotStyleHandle: string | undefined;
}

const CONTINUOUS = "CONTINUOUS";

/**
 * Cached resolution for one document and one set of options. Resolution itself is a handful of
 * map lookups per entity.
 */
export class PropertyResolver {
  readonly doc: DxfDocument;
  readonly palette: readonly number[];
  readonly paper: Paper;
  readonly lwDefault: number;
  private readonly ltscale: number;
  private readonly layers = new Map<string, LayerEntry | null>();
  private readonly linetypes = new Map<string, LinetypeEntry | null>();
  private readonly overrides = new Map<LayerEntry, Map<string, LayerViewportOverride>>();
  private readonly frozenSets = new WeakMap<ViewportContext, ReadonlySet<string>>();
  private readonly ltByHandle = new Map<string, LinetypeEntry>();
  private readonly layerOf: (name: string) => LayerEntry | undefined;
  private plotStyleDefault: string | undefined | null = null;
  private readonly reported = new Set<string>();

  constructor(
    doc: DxfDocument,
    options: ResolveOptions = {},
    layerOf?: (name: string) => LayerEntry | undefined,
  ) {
    this.doc = doc;
    this.palette = options.palette ?? PLOT_PALETTE;
    this.paper = options.paper ?? "white";
    this.lwDefault = options.lwDefault ?? doc.header.num("$LWDEFAULT", 25);
    this.ltscale = doc.header.num("$LTSCALE", 1) || 1;
    this.layerOf = layerOf ?? ((n) => doc.tables.layers.get(n));
    for (const lt of doc.tables.linetypes) if (lt.handle) this.ltByHandle.set(lt.handle, lt);
  }

  /** Cached layer lookup (case-insensitive); reports a missing layer once. */
  layer(name: string): LayerEntry | undefined {
    const k = nameKey(name);
    let e = this.layers.get(k);
    if (e === undefined) {
      e = this.layerOf(name) ?? null;
      this.layers.set(k, e);
      // AutoCAD creates missing layers on load with defaults (11c §3). UNVERIFIED (Q-0275)
      if (!e) this.report("missing-layer", `layer ${name} is not defined; using defaults`);
    }
    return e ?? undefined;
  }

  /** Cached linetype lookup; undefined (with a diagnostic) if missing. */
  linetype(name: string): LinetypeEntry | undefined {
    const k = nameKey(name);
    let e = this.linetypes.get(k);
    if (e === undefined) {
      e = this.doc.tables.linetypes.get(name) ?? null;
      this.linetypes.set(k, e);
      // missing linetype → Continuous (note 06 §7.1; ASSUMPTION). Continuous itself may be absent
      // from R12 tables and needs no diagnostic.
      if (!e && k !== CONTINUOUS)
        this.report("missing-linetype", `linetype ${name} is not defined; using Continuous`);
    }
    return e ?? undefined;
  }

  /** Per-viewport overrides of a layer, by VIEWPORT handle. */
  layerOverrides(layer: LayerEntry): ReadonlyMap<string, LayerViewportOverride> {
    let m = this.overrides.get(layer);
    if (!m) this.overrides.set(layer, (m = readLayerOverrides(this.doc, layer)));
    return m;
  }

  resolve(
    entity: EntityBase,
    parents: readonly InsertContext[] = [],
    viewport?: ViewportContext,
  ): ResolvedProperties {
    const parent = parents.length > 0 ? parents[parents.length - 1]!.resolved : undefined;

    // ---- layer: "0" inside a block takes the reference's effective layer (note 07 §3.1)
    const layerName = parent && nameKey(entity.layer) === "0" ? parent.layer : entity.layer;
    const layerEntry = parent && layerName === parent.layer ? parent.layerEntry : this.layer(layerName);
    const lp: LayerProps = layerEntry ?? defaultLayer(layerName);
    const ovr =
      viewport?.handle && layerEntry ? this.layerOverrides(layerEntry).get(viewport.handle) : undefined;

    // ---- color
    let aci: number;
    let trueColor: number | undefined;
    let colorName: string | undefined;
    const c = Math.abs(entity.color); // negative entity ACI: abs (note 06 §3.1). UNVERIFIED (Q-0199)
    if (entity.trueColor !== undefined) {
      // 420 overrides 62 (note 06 §3.2). The written 62 is AutoCAD's nearest ACI. UNVERIFIED (Q-0200)
      trueColor = entity.trueColor & 0xffffff;
      colorName = entity.colorName;
      aci = c >= 1 && c <= 255 ? c : nearestAci(trueColor, this.palette);
    } else if (c === 0) {
      // BYBLOCK; at top level ACI 7 (note 07 §3.1). UNVERIFIED (Q-0198, Q-0278)
      if (parent) {
        aci = parent.aci;
        trueColor = parent.trueColor;
        colorName = parent.colorName;
      } else aci = 7;
    } else if (c >= 1 && c <= 255) {
      aci = c;
    } else if (c === 257) {
      aci = 7; // BYOBJECT, never written by AutoCAD (ezdxf maps it to 7, note 06 §3.1)
    } else {
      // BYLAYER (256) and invalid values; VP override first
      // raw AcCmColor: 0xC2RRGGBB true color, 0xC3……AA ACI (note 06 §3.2)
      const raw = ovr?.color === undefined ? 0 : ovr.color >>> 0;
      if (raw >>> 24 === 0xc2) {
        trueColor = raw & 0xffffff;
        aci = nearestAci(trueColor, this.palette);
      } else if (raw >>> 24 === 0xc3 && (raw & 0xff) >= 1) {
        aci = raw & 0xff;
      } else {
        aci = lp.color >= 1 && lp.color <= 255 ? lp.color : 7;
        trueColor = lp.trueColor === undefined ? undefined : lp.trueColor & 0xffffff;
        colorName = lp.colorName;
      }
    }
    const rgb = trueColor ?? aciToRgb(aci, this.palette, this.paper);

    // ---- linetype
    const lt = entity.linetype.trim();
    const ltk = nameKey(lt);
    let linetypeEntry: LinetypeEntry | undefined;
    let linetype: string;
    if (ltk === "BYBLOCK") {
      // top level → Continuous (note 07 §3.1). UNVERIFIED (Q-0198)
      linetypeEntry = parent?.linetypeEntry;
      linetype = parent?.linetype ?? "Continuous";
    } else {
      let name = lt;
      if (ltk === "BYLAYER" || ltk === "") {
        const o = ovr?.linetypeHandle ? this.ltByHandle.get(ovr.linetypeHandle) : undefined;
        name = o?.name ?? lp.linetype;
      }
      linetypeEntry =
        nameKey(name) === "BYLAYER" || nameKey(name) === "BYBLOCK" ? undefined : this.linetype(name);
      linetype = linetypeEntry?.name ?? "Continuous";
    }

    // ---- lineweight (note 06 §5.1, 07 §3.1). UNVERIFIED (Q-0206)
    let lineweight: number;
    if (entity.lineweight === -2) lineweight = parent ? parent.lineweight : this.lwDefault;
    else if (entity.lineweight >= 0) lineweight = entity.lineweight;
    else if (entity.lineweight === -1) {
      const lw = ovr?.lineweight ?? lp.lineweight;
      lineweight = lw >= 0 ? lw : this.lwDefault;
    } else lineweight = this.lwDefault; // -3 Default; invalid negatives (Q-0207)

    // ---- transparency (note 06 §4.1): absent / flag 0 → BYLAYER, 0x01 → BYBLOCK, 0x02 → alpha
    let alpha: number;
    const t = entity.transparency;
    const flag = t === undefined ? 0 : (t >>> 24) & 0xff;
    if (flag === 2) alpha = t! & 0xff;
    else if (flag === 1)
      alpha = parent ? parent.alpha : 255; // top-level BYBLOCK → opaque
    else {
      // UNVERIFIED (Q-0217): 440 = 0 treated as BYLAYER
      const lt2 = ovr?.transparency ?? lp.transparency;
      alpha = lt2 !== undefined && ((lt2 >>> 24) & 0xff) === 2 ? lt2 & 0xff : 255;
    }

    // ---- plot style (named plot styles; note 06 §6.2, §7.1). UNVERIFIED (Q-0229)
    const plotStyleHandle = this.plotStyle(entity, lp, parent);

    // ---- visibility (note 07 §3.2, 02 §2.1.1)
    const frozen = lp.frozen || (viewport !== undefined && this.frozenIn(viewport).has(nameKey(layerName)));
    const parentsExpand = parent === undefined || parent.expandBlock;
    const visible = parentsExpand && !entity.invisible && !lp.off && !frozen;
    // Defpoints never plots (note 02 §2.1.1). UNVERIFIED (Q-0283); 290=0 → no plot (Q-0282).
    // A no-plot reference layer suppresses the whole block content, whatever the children's own
    // layers (unlike off). VERIFIED-BY-ACAD blocks/vis-insert-layer-noplot, vis-layer0-noplot
    // (note 07 §3.2); Defpoints is assumed to act the same (UNVERIFIED).
    const layerPlots = lp.plot && nameKey(layerName) !== "DEFPOINTS";
    const parentsPlot = parent === undefined || parent.contentPlottable;
    const plottable = visible && layerPlots && parentsPlot;
    const expandBlock = parentsExpand && !entity.invisible && !frozen;
    const contentPlottable = parentsPlot && layerPlots;

    return {
      layer: layerName,
      layerEntry,
      aci,
      trueColor,
      colorName,
      rgb,
      linetype,
      linetypeEntry,
      linetypeScale: entity.linetypeScale * this.ltscale,
      lineweight,
      lineweightMm: lineweight / 100,
      alpha,
      transparency: 1 - alpha / 255,
      plotStyleHandle,
      visible,
      plottable,
      expandBlock,
      contentPlottable,
    };
  }

  private plotStyle(
    entity: EntityBase,
    lp: LayerProps,
    parent: ResolvedProperties | undefined,
  ): string | undefined {
    const rec = entity.record;
    const i = rec.find(380);
    const type = i < 0 ? (entity.plotStyleHandle ? 3 : 0) : rec.store.int(i);
    switch (type) {
      case 1:
        return parent ? parent.plotStyleHandle : lp.plotStyleHandle;
      case 2:
        return this.defaultPlotStyle();
      case 3:
        return entity.plotStyleHandle ?? lp.plotStyleHandle;
      default:
        return lp.plotStyleHandle;
    }
  }

  private defaultPlotStyle(): string | undefined {
    if (this.plotStyleDefault === null) {
      const d = this.doc.namedObject("ACAD_PLOTSTYLENAME") as DictionaryObject | undefined;
      this.plotStyleDefault = d?.defaultHandle ?? d?.get("Normal");
    }
    return this.plotStyleDefault;
  }

  /** Upper-cased names of the layers frozen in a viewport (handles resolved to names). */
  private frozenIn(vp: ViewportContext): ReadonlySet<string> {
    let s = this.frozenSets.get(vp);
    if (!s) {
      const byHandle = new Map<string, string>();
      for (const l of this.doc.tables.layers) if (l.handle) byHandle.set(l.handle, l.name);
      const set = new Set<string>();
      for (const v of vp.frozenLayers ?? []) set.add(nameKey(byHandle.get(v.toUpperCase()) ?? v));
      this.frozenSets.set(vp, (s = set));
    }
    return s;
  }

  private report(code: string, message: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    this.doc.diagnostics.warn(code, message);
  }
}

function defaultLayer(name: string): LayerProps {
  return {
    name,
    color: 7,
    trueColor: undefined,
    colorName: undefined,
    off: false,
    frozen: false,
    plot: true,
    linetype: "Continuous",
    lineweight: -3,
    transparency: undefined,
    plotStyleHandle: undefined,
  };
}

/** Reads the ADSK_XREC_LAYER_*_OVR XRECORDs of a layer's extension dictionary. */
export function readLayerOverrides(doc: DxfDocument, layer: LayerEntry): Map<string, LayerViewportOverride> {
  const out = new Map<string, Record<string, number | string>>();
  const xd = layer.record.extensionDictionary;
  const dict = xd ? (doc.getObject(xd) as DxfObject | undefined) : undefined;
  if (dict?.type !== "DICTIONARY") return out as Map<string, LayerViewportOverride>;
  for (const [key, code, field] of OVERRIDE_KEYS) {
    const h = (dict as DictionaryObject).get(key);
    const xr = h ? doc.getObject(h) : undefined;
    if (!xr) continue;
    const rec = xr.record;
    const s = rec.store;
    let vp: string | undefined;
    for (const i of rec.dataTags()) {
      const c = s.codes[i]!;
      if (c === 335) vp = s.handle(i);
      else if (c === code && vp) {
        let o = out.get(vp);
        if (!o) out.set(vp, (o = {}));
        o[field] = code === 343 ? s.handle(i) : s.int(i);
        vp = undefined;
      }
    }
  }
  return out as Map<string, LayerViewportOverride>;
}

const resolvers = new WeakMap<DxfDocument, Map<string, PropertyResolver>>();
const byLayerOf = new WeakMap<(name: string) => LayerEntry | undefined, PropertyResolver>();
const paletteIds = new WeakMap<readonly number[], number>();
let nextPaletteId = 1;

/**
 * One-shot form of `PropertyResolver.resolve`. Resolvers are cached per document + options (or
 * per `layerOf` function), so calling this per entity is cheap.
 */
export function resolveProperties(entity: EntityBase, ctx: ResolveContext): ResolvedProperties {
  const o = ctx.options ?? {};
  let r: PropertyResolver | undefined;
  if (ctx.layerOf) {
    r = byLayerOf.get(ctx.layerOf);
    if (!r || r.doc !== ctx.doc)
      byLayerOf.set(ctx.layerOf, (r = new PropertyResolver(ctx.doc, o, ctx.layerOf)));
  } else {
    let byOpts = resolvers.get(ctx.doc);
    if (!byOpts) resolvers.set(ctx.doc, (byOpts = new Map()));
    let pid = 0;
    if (o.palette) {
      pid = paletteIds.get(o.palette) ?? 0;
      if (!pid) paletteIds.set(o.palette, (pid = nextPaletteId++));
    }
    const key = `${o.paper ?? ""}|${o.lwDefault ?? ""}|${pid}`;
    r = byOpts.get(key);
    if (!r) byOpts.set(key, (r = new PropertyResolver(ctx.doc, o)));
  }
  return r.resolve(entity, ctx.parents, ctx.viewport);
}
