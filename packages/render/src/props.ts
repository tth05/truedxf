/**
 * Effective entity properties for rendering (colour, lineweight, visibility) with ByLayer /
 * ByBlock / layer-0 inheritance through nested INSERTs (note 06 §7, note 07 §3).
 *
 * TODO: switch to @truedxf/model's resolve.ts once available; this is the renderer's interim
 * implementation of the same rules.
 */
import type { DxfDocument, EntityBase, LayerEntry } from "@truedxf/model";
import { aciToRgb } from "./aci.ts";

/** Properties an INSERT passes down to ByBlock / layer-0 content. */
export interface Inherited {
  /** Effective layer name for layer-0 entities inside the block. */
  layer: string;
  /** Effective ACI or true colour of the INSERT (for ByBlock). */
  aci: number;
  trueColor: number | undefined;
  /** Effective lineweight of the INSERT in 1/100 mm (for ByBlock). */
  lineweight: number;
}

export const TOP_LEVEL: Inherited = { layer: "0", aci: 7, trueColor: undefined, lineweight: -3 };

export interface Resolved {
  rgb: [number, number, number];
  aci: number;
  trueColor: number | undefined;
  /** 1/100 mm, ≥ 0 (default resolved). */
  lineweight: number;
  /** Effective layer (layer 0 inside blocks resolved to the insert's layer). */
  layer: string;
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
  private readonly doc: DxfDocument;
  readonly lwDefault: number;
  readonly background: [number, number, number];

  constructor(doc: DxfDocument, background: [number, number, number] = [255, 255, 255]) {
    this.doc = doc;
    this.background = background;
    // $LWDEFAULT in 1/100 mm; AutoCAD default 25 (0.25 mm)
    this.lwDefault = doc.header.num("$LWDEFAULT", 25);
  }

  layer(name: string): Omit<LayerEntry, "record"> {
    // Missing layers behave like a new layer with default properties (note 02 §4.2 rule 3)
    return this.doc.tables.layers.get(name) ?? { ...DEFAULT_LAYER, name };
  }

  /** Effective layer of an entity in the given insert context. */
  effectiveLayer(e: EntityBase, inh: Inherited): string {
    return e.layer === "0" ? inh.layer : e.layer;
  }

  /**
   * Visibility of an entity for plotting. A frozen or off *effective* layer hides the entity;
   * the Defpoints layer and layers with plot = false never plot (note 02 §2.1).
   * UNVERIFIED (note 07 §3): frozen INSERT layer hides the whole reference (handled by the caller
   * checking the INSERT itself), off INSERT layer only hides layer-0 content.
   */
  isPlotted(e: EntityBase, inh: Inherited): boolean {
    if (e.invisible) return false;
    const name = this.effectiveLayer(e, inh);
    const l = this.layer(name);
    if (l.off || l.frozen || !l.plot) return false;
    if (name.toUpperCase() === "DEFPOINTS") return false;
    // a frozen entity layer hides it even when the effective layer is the insert's
    if (e.layer !== name) {
      const own = this.layer(e.layer);
      if (own.frozen) return false;
    }
    return true;
  }

  resolve(e: EntityBase, inh: Inherited): Resolved {
    const layerName = this.effectiveLayer(e, inh);
    const layer = this.layer(layerName);
    let aci: number;
    let trueColor: number | undefined;
    if (e.color === 0) {
      aci = inh.aci;
      trueColor = inh.trueColor;
    } else if (e.color === 256 || e.color === 257) {
      aci = layer.color;
      trueColor = layer.trueColor;
    } else {
      aci = e.color;
      trueColor = e.trueColor;
    }
    // a true colour stored together with ByLayer/ByBlock aci is ignored (writer bug, note 11b)
    if (e.color !== 0 && e.color !== 256 && e.trueColor !== undefined) trueColor = e.trueColor;
    let lw = e.lineweight;
    if (lw === -2) lw = inh.lineweight;
    if (lw === -1) lw = layer.lineweight;
    if (lw === -2) lw = inh.lineweight; // layer never is ByBlock, but be safe
    if (lw < 0) lw = this.lwDefault;
    const rgb: [number, number, number] =
      trueColor !== undefined
        ? [(trueColor >> 16) & 255, (trueColor >> 8) & 255, trueColor & 255]
        : aciToRgb(aci, this.background);
    return { rgb, aci, trueColor, lineweight: lw, layer: layerName };
  }

  /** Properties an INSERT passes to its block content. */
  inherit(insert: EntityBase, inh: Inherited): Inherited {
    const r = this.resolve(insert, inh);
    return { layer: r.layer, aci: r.aci, trueColor: r.trueColor, lineweight: r.lineweight };
  }
}
