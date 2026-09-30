/**
 * DIMENSION / ARC_DIMENSION / LARGE_RADIAL_DIMENSION (research/notes/05-dimensions-leaders.md
 * §4): the stored `*D` block is drawn as is (AutoCAD shows it even when stale); a missing,
 * undefined or empty block is regenerated like AutoCAD does on load (dimension/*.ts).
 */
import { Matrix44, ocsToWcsMatrix } from "@truedxf/geometry";
import type { Block, DimensionEntity, DxfDocument, Entity } from "@truedxf/model";
import type { TextFonts } from "@truedxf/text";
import { generateDimension } from "../dimension/index.ts";
import { type DrawState, type Frontend, registerDrawer, registerPreparer } from "../frontend.ts";
import { prepareTextFonts } from "../text.ts";

/** Fonts for measuring generated dimension / leader / tolerance text, per document. */
const FONTS = new WeakMap<DxfDocument, TextFonts | undefined>();

registerPreparer(async (doc, env) => {
  FONTS.set(doc, await prepareTextFonts(doc, env.loadFont, env.text));
});

export function annotationFonts(doc: DxfDocument): TextFonts | undefined {
  return FONTS.get(doc);
}

/** A synthetic block around generated entities (drawn like block content of the entity). */
export function syntheticBlock(name: string, entities: Entity[]): Block {
  return {
    name,
    handle: "",
    flags: 1,
    basePoint: { x: 0, y: 0, z: 0 },
    layer: "0",
    xrefPath: "",
    description: "",
    blockRecord: undefined,
    record: undefined,
    endRecord: undefined,
    entities,
    isLayoutBlock: false,
  };
}

function generated(fe: Frontend, dim: DimensionEntity): Block | undefined {
  let cache = fe.caches.get("dimension:generated") as Map<DimensionEntity, Block | undefined> | undefined;
  if (!cache) {
    cache = new Map();
    fe.caches.set("dimension:generated", cache);
  }
  if (cache.has(dim)) return cache.get(dim);
  let block: Block | undefined;
  try {
    const ents = generateDimension({ doc: fe.doc, fonts: annotationFonts(fe.doc) }, dim);
    if (ents) block = syntheticBlock(`*D~${dim.handle || dim.id}`, ents);
    else fe.note(`dimension-regen-unsupported:${dim.subtype}`);
  } catch (err) {
    fe.note(`error:dimension-regen:${err instanceof Error ? err.message : String(err)}`);
  }
  cache.set(dim, block);
  return block;
}

registerDrawer(["DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION"], (fe, e, st: DrawState) => {
  const dim = e as DimensionEntity;
  // dimensional constraints are not annotation (note 05 §1.8)
  if (dim.isConstraint) return;
  const block = dim.blockName ? fe.doc.getBlock(dim.blockName) : undefined;
  if (block && block.entities.length > 0) {
    // the block is translated by group 12 (OCS), at top level and nested. VERIFIED-BY-ACAD
    // dimensions/struct-group12-ez, struct-group12-nested-ez (Q-0519)
    const c = dim.clonePoint;
    const t =
      c.x !== 0 || c.y !== 0 || c.z !== 0 ? ocsToWcsMatrix(dim.extrusion).transformDirection(c) : undefined;
    fe.drawBlockContent(block, t ? Matrix44.translation(t.x, t.y, t.z) : Matrix44.identity(), e, st);
    return;
  }
  // AutoCAD regenerates missing blocks for dimensions in a layout; inside block definitions only
  // 3-point angular ones (netDxf#98; VERIFIED-BY-ACAD dimensions/struct-in-block-nb,
  // struct-in-block-angular3p-nb, Q-0517)
  if (st.stack.length > 1 && dim.subtype !== "angular3p") return;
  const gen = generated(fe, dim);
  if (gen) fe.drawBlockContent(gen, ocsToWcsMatrix(dim.extrusion), e, st);
});
