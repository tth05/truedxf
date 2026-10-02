/**
 * DIMENSION / ARC_DIMENSION / LARGE_RADIAL_DIMENSION (research/notes/05-dimensions-leaders.md
 * §4): the stored `*D` block is drawn as is (AutoCAD shows it even when stale); a missing,
 * or undefined block is regenerated like AutoCAD does on load (dimension/*.ts).
 */
import { Matrix44, ocsToWcsMatrix } from "@truedxf/geometry";
import {
  type Block,
  type DimensionEntity,
  type DxfDocument,
  type Entity,
  isPaperSpaceName,
  type MTextEntity,
  type MultiLeaderEntity,
  type ToleranceEntity,
} from "@truedxf/model";
import { type InlineFontSpec, inlineFonts, layoutMText, type TextFonts } from "@truedxf/text";
import { generateDimension } from "../dimension/index.ts";
import { type DrawState, type Frontend, registerDrawer, registerPreparer } from "../frontend.ts";
import { drawLayout, prepareTextFonts } from "../text.ts";

/** Fonts for measuring and drawing generated dimension / leader / tolerance text, per document. */
const FONTS = new WeakMap<DxfDocument, TextFonts | undefined>();

registerPreparer(async (doc, env) => {
  const fonts = await prepareTextFonts(doc, env.loadFont, env.text);
  if (fonts) {
    // inline fonts of generated text: TOLERANCE frames (gdt), MULTILEADER MTEXT, text overrides
    const specs = new Map<string, InlineFontSpec>();
    const scan = (s: string | undefined) => {
      if (!s || (s.indexOf("\\f") < 0 && s.indexOf("\\F") < 0)) return;
      for (const f of inlineFonts(s)) specs.set(`${f.name}|${f.bold}|${f.italic}`, f);
    };
    const visit = (ents: readonly Entity[]) => {
      for (const e of ents) {
        if (e.type === "TOLERANCE") scan((e as ToleranceEntity).text);
        else if (e.type === "MULTILEADER") scan((e as MultiLeaderEntity).context.mtext?.text);
        else if (e.type === "DIMENSION") scan((e as DimensionEntity).textOverride);
      }
    };
    for (const b of doc.blocks) visit(b.entities);
    visit(doc.modelSpace.entities);
    if (specs.size > 0) await fonts.prepare(specs.values());
  }
  FONTS.set(doc, fonts);
});

/**
 * Draws generated entities as content of `parent` (transform `local`), with MTEXT laid out by
 * the annotation fonts (inline fonts of generated text are prepared only there).
 */
export function drawGenerated(
  fe: Frontend,
  block: Block,
  local: Matrix44,
  parent: Entity,
  st: DrawState,
): void {
  // generated entities have no document handles: they pick as the generating entity (the
  // top-level pick owner while drawn from drawEntity, see Frontend.pickOwner)
  const owner = fe.pickOwner;
  fe.pickOwner ??= parent.handle || `#${parent.id}`;
  try {
    drawGeneratedContent(fe, block, local, parent, st);
  } finally {
    fe.pickOwner = owner;
  }
}

function drawGeneratedContent(
  fe: Frontend,
  block: Block,
  local: Matrix44,
  parent: Entity,
  st: DrawState,
): void {
  const fonts = FONTS.get(fe.doc);
  if (!fonts) {
    fe.drawBlockContent(block, local, parent, st);
    return;
  }
  const inh = fe.props.inherit(parent, st.inh);
  const sub: DrawState = {
    m: st.m.multiply(local),
    inh,
    stack: [...st.stack, block.name.toUpperCase()],
    linetypeScale: st.linetypeScale,
  };
  for (const e of block.entities) {
    try {
      if (e.type !== "MTEXT") {
        fe.drawEntity(e, sub);
        continue;
      }
      if (!fe.props.isPlotted(e, inh)) continue;
      drawLayout(fe, layoutMText(e as MTextEntity, fonts, { dimension: true }), e, sub.m, inh);
    } catch (err) {
      fe.note(`error:${e.type}:${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

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

function generated(fe: Frontend, dim: DimensionEntity, st: DrawState): Block | undefined {
  let cache = fe.caches.get("dimension:generated") as Map<DimensionEntity, Block | undefined> | undefined;
  if (!cache) {
    cache = new Map();
    fe.caches.set("dimension:generated", cache);
  }
  if (cache.has(dim)) return cache.get(dim);
  let block: Block | undefined;
  try {
    const paperSpace = dim.paperSpace || isPaperSpaceName(st.stack[0] ?? "");
    const ents = generateDimension({ doc: fe.doc, fonts: annotationFonts(fe.doc), paperSpace }, dim);
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
  // an existing block is trusted even when empty (VERIFIED-BY-ACAD dimensions/struct-empty-block:
  // nothing plotted); only a missing or undefined block is regenerated
  if (block) {
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
  const gen = generated(fe, dim, st);
  if (gen) drawGenerated(fe, gen, ocsToWcsMatrix(dim.extrusion), e, st);
});
