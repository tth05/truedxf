/**
 * Effective entity properties for rendering (colour, lineweight, linetype, visibility) with
 * ByLayer / ByBlock / layer-0 inheritance through nested INSERTs and per-viewport layer state.
 * Delegates to @truedxf/model's `PropertyResolver` (resolve.ts; rules: note 06 §7, note 07 §3,
 * note 02 §2.1) and adapts the result to the renderer's `Resolved` / `Inherited` shapes.
 */
import {
  type DxfDocument,
  type EntityBase,
  type InsertContext,
  type LayerEntry,
  type LayerViewportOverride,
  PropertyResolver as ModelResolver,
  type ResolvedProperties,
  type ViewportContext,
} from "@truedxf/model";

/**
 * Layer state of the paper-space VIEWPORT being drawn: VP-frozen layers (331) and per-viewport
 * layer overrides (layer xdict ADSK_XREC_LAYER_*_OVR keyed by the VIEWPORT handle, note 08 §3.7).
 */
export interface ViewportLayers {
  /** VIEWPORT handle (selects the layer overrides). */
  readonly handle: string;
  /** Upper-case names of the layers frozen in this viewport. */
  readonly frozen: ReadonlySet<string>;
}

/** Properties an INSERT passes down to ByBlock / layer-0 content. */
export interface Inherited {
  /** Effective layer name for layer-0 entities inside the block. */
  readonly layer: string;
  /** Effective ACI or true colour of the INSERT (for ByBlock). */
  readonly aci: number;
  readonly trueColor: number | undefined;
  /** Effective lineweight of the INSERT in 1/100 mm (for ByBlock). */
  readonly lineweight: number;
  /** Effective linetype name of the INSERT (for ByBlock). */
  readonly linetype: string;
  /** Enclosing block references, outermost first (model resolver context). */
  readonly parents: readonly InsertContext[];
}

export const TOP_LEVEL: Inherited = {
  layer: "0",
  aci: 7,
  trueColor: undefined,
  lineweight: -3,
  linetype: "Continuous",
  parents: [],
};

export interface Resolved {
  rgb: [number, number, number];
  aci: number;
  trueColor: number | undefined;
  /** 1/100 mm, ≥ 0 (default resolved). */
  lineweight: number;
  /** Effective layer (layer 0 inside blocks resolved to the insert's layer). */
  layer: string;
  /** Effective linetype name (ByLayer / ByBlock resolved). */
  linetype: string;
  /** Alpha 0…255 (255 = opaque). */
  alpha?: number;
  /** The full model resolution (visibility, plot style, …), when resolved from an entity. */
  props?: ResolvedProperties;
}

const DEFAULT_LAYER: Omit<LayerEntry, "record"> = {
  type: "LAYER",
  name: "0",
  flags: 0,
  handle: "",
  owner: "",
  color: 7,
  trueColor: undefined,
  colorName: undefined,
  off: false,
  frozen: false,
  frozenInNewViewports: false,
  locked: false,
  linetype: "Continuous",
  plot: true,
  lineweight: -3,
  plotStyleHandle: undefined,
  materialHandle: undefined,
  transparency: undefined,
};

export class PropertyResolver {
  private readonly model: ModelResolver;
  readonly lwDefault: number;
  readonly background: [number, number, number];
  /** Set while drawing model space through a paper-space viewport (layout.ts / draw/viewport.ts). */
  viewport: ViewportLayers | undefined;
  /**
   * Extents mode (the bounds pass of an Extents plot): entities count when they are displayed
   * or merely not plotted — off, no-plot and Defpoints layers are included, frozen layers and
   * invisible entities are not. VERIFIED-BY-ACAD (extents/probe-layer-*, probe-invisible-entity).
   */
  extents = false;
  /**
   * Display mode (RenderEnv.visibility "display", viewers): entities count when displayed —
   * no-plot and Defpoints layers are shown like on screen in AutoCAD.
   */
  display = false;
  private readonly vpContexts = new WeakMap<ViewportLayers, ViewportContext>();
  // INSERT inheritance and viewport overrides are part of resolution (note 06 §7). Keep caches
  // local to this resolver so independent renders cannot reuse stale document/layer state.
  private readonly propertiesCache = new WeakMap<
    Inherited,
    Map<ViewportLayers | undefined, WeakMap<EntityBase, ResolvedProperties>>
  >();
  private readonly resolvedCache = new WeakMap<ResolvedProperties, Resolved>();

  /**
   * `lwDefault`: the LWDEFAULT system variable (registry; default: $LWDEFAULT or 25).
   * `forceVisible`: viewer layer toggles (RenderEnv.layerVisibility); layers mapped to true are
   * treated as on and thawed.
   */
  constructor(
    doc: DxfDocument,
    background: [number, number, number] = [255, 255, 255],
    lwDefault?: number,
    forceVisible?: ReadonlyMap<string, boolean>,
  ) {
    this.background = background;
    const dark = background[0] + background[1] + background[2] < 384;
    const layerOf =
      forceVisible && [...forceVisible.values()].some((v) => v)
        ? (name: string): LayerEntry | undefined => {
            const l = doc.tables.layers.get(name);
            return l && forceVisible.get(name.toUpperCase()) === true && (l.off || l.frozen)
              ? { ...l, off: false, frozen: false }
              : l;
          }
        : undefined;
    this.model = new ModelResolver(
      doc,
      {
        paper: dark ? "black" : "white",
        ...(lwDefault === undefined ? {} : { lwDefault }),
      },
      layerOf,
    );
    this.lwDefault = this.model.lwDefault;
  }

  layer(name: string): Omit<LayerEntry, "record"> {
    // Missing layers behave like a new layer with default properties (note 02 §4.2 rule 3)
    return this.model.layer(name) ?? { ...DEFAULT_LAYER, name };
  }

  /** True if the layer is frozen globally or in the current viewport. */
  frozen(name: string): boolean {
    if (this.layer(name).frozen) return true;
    return this.viewport?.frozen.has(name.toUpperCase()) === true;
  }

  /** Override of a layer in the current viewport, if any. */
  override(name: string): LayerViewportOverride | undefined {
    const vp = this.viewport;
    const entry = vp ? this.model.layer(name) : undefined;
    return vp && entry ? this.model.layerOverrides(entry).get(vp.handle) : undefined;
  }

  /** Effective layer of an entity in the given insert context. */
  effectiveLayer(e: EntityBase, inh: Inherited): string {
    return inh.parents.length > 0 && e.layer.trim() === "0" ? inh.layer : e.layer;
  }

  private viewportContext(): ViewportContext | undefined {
    const vp = this.viewport;
    if (!vp) return undefined;
    let c = this.vpContexts.get(vp);
    if (!c) this.vpContexts.set(vp, (c = { handle: vp.handle, frozenLayers: vp.frozen }));
    return c;
  }

  /** Full model resolution of an entity in an insert context. */
  properties(e: EntityBase, inh: Inherited): ResolvedProperties {
    let contexts = this.propertiesCache.get(inh);
    if (!contexts) this.propertiesCache.set(inh, (contexts = new Map()));
    let entities = contexts.get(this.viewport);
    if (!entities) contexts.set(this.viewport, (entities = new WeakMap()));
    let p = entities.get(e);
    if (!p) {
      p = this.model.resolve(e, inh.parents, this.viewportContext());
      entities.set(e, p);
    }
    return p;
  }

  /**
   * Visibility of an entity for plotting (note 02 §2.1, note 07 §3): not invisible, effective
   * layer on, not frozen (globally / in the viewport), plottable (290) and not Defpoints.
   */
  isPlotted(e: EntityBase, inh: Inherited): boolean {
    const p = this.properties(e, inh);
    return this.extents ? p.expandBlock : this.display ? p.visible : p.plottable;
  }

  /** Whether a block reference's content is traversed (frozen reference layer hides it all). */
  expands(e: EntityBase, inh: Inherited): boolean {
    return this.properties(e, inh).expandBlock;
  }

  resolve(e: EntityBase, inh: Inherited): Resolved {
    const p = this.properties(e, inh);
    let r = this.resolvedCache.get(p);
    if (!r) this.resolvedCache.set(p, (r = toResolved(p)));
    return r;
  }

  /** Properties an INSERT passes to its block content. */
  inherit(insert: EntityBase, inh: Inherited): Inherited {
    const p = this.properties(insert, inh);
    return {
      layer: p.layer,
      aci: p.aci,
      trueColor: p.trueColor,
      lineweight: p.lineweight,
      linetype: p.linetype,
      parents: [...inh.parents, { entity: insert, resolved: p }],
    };
  }
}

function toResolved(p: ResolvedProperties): Resolved {
  return {
    rgb: [(p.rgb >> 16) & 255, (p.rgb >> 8) & 255, p.rgb & 255],
    aci: p.aci,
    trueColor: p.trueColor,
    lineweight: p.lineweight,
    layer: p.layer,
    linetype: p.linetype,
    alpha: p.alpha,
    props: p,
  };
}

/**
 * AutoCAD 2027 skips entities whose code-0 type is not written exactly (upper case, no padding)
 * in R13+ files, while R12 files accept lower-case types. VERIFIED-BY-ACAD
 * (fileformat/lowercase-entities-r2018, trailing-space-types-r2018 plot nothing;
 * lowercase-entities-r12 plots normally; Q-0004, Q-0006). Intermediate versions UNVERIFIED.
 */
export function droppedOnLoad(doc: DxfDocument, e: EntityBase): boolean {
  if (doc.acadver <= "AC1009") return false;
  const rec = e.record;
  const raw = rec.store.str(rec.start);
  return raw !== rec.type;
}
