/**
 * Layout selection and paper-space plotting (research/notes/08-layouts-viewports-plotting.md).
 *
 * VERIFIED-BY-ACAD (AutoCAD 2027, layouts suite + calibration, 2026-09-30; note 08 §10.12):
 * - Plot area "layout" on the raster device: 1 device pixel = 1 paper unit (mm or inch, Fit is
 *   ignored), paper-space (0,0) at the lower-left canvas corner (plot offset 0,0); everything at
 *   negative paper coordinates (margins/offsets) is outside (layouts/area-layout-*,
 *   calibration/layout-area-layout).
 * - The overall viewport is the VIEWPORT with id 69 = 1, wherever it is in the entity list; it
 *   draws nothing. Without any id 1 every VIEWPORT is a model viewport (layouts/ids-all-zero,
 *   ids-all-minus1, overall-last, overall-first-looks-like-user).
 * - Viewport content is plotted unless status 68 = 0; 90 bit 0x20000 alone does not switch it off
 *   (layouts/onoff-flag, status-sweep, status-all-zero). Frames are plotted for every viewport
 *   (also with 68 = 0) unless the VIEWPORT's layer is off/frozen/no-plot/Defpoints; the content
 *   is plotted regardless of that layer (layouts/vp-on-off-layer, vp-on-frozen-layer,
 *   frame-noplot, frame-defpoints). PLOTSETTINGS 70 bit 1 has no effect (frame-plotflag-bit1-*).
 * - "Plot paper space first? No" (the answer for 70 bit 512 = DrawViewportsFirst): all viewport
 *   content first, then the paper-space entities on top; "Yes": the reverse (ps-over-vp-*).
 * - Overlapping viewports: the later-created one (higher handle / id) is on top, independent of
 *   entity order and 68 (vp-overlap-*).
 * - PSLTSCALE: the header $PSLTSCALE for the active layout (*Paper_Space), LAYOUT 70 bit 1 for
 *   the others (psltscale-*, psltscale-two-layouts-*).
 */
import { BooleanOp, booleanPolygons, FillRule, Matrix44 } from "@truedxf/geometry";
import type { Block, DxfDocument, Entity, Layout, ViewportEntity } from "@truedxf/model";
import type { Frontend } from "./frontend.ts";
import { fitWindow, type PlotRequest, type View } from "./plot.ts";
import { TOP_LEVEL } from "./props.ts";

export interface LayoutContext {
  /** Layout name as requested ("Model" for model space). */
  readonly name: string;
  readonly isModel: boolean;
  readonly block: Block;
  readonly layout: Layout | undefined;
}

/** Finds the plotted layout (case-insensitive); unknown names fall back to model space. */
export function findLayout(doc: DxfDocument, name: string): LayoutContext {
  const k = name.toUpperCase();
  if (k !== "MODEL") {
    const layout = doc.layouts.find((x) => !x.isModel && x.name.toUpperCase() === k);
    if (layout) return { name: layout.name, isModel: false, block: layout.block, layout };
  }
  const model = doc.layouts.find((x) => x.isModel);
  return { name: "Model", isModel: true, block: doc.modelSpace, layout: model };
}

/** True when the layout's block is the active paper space (*Paper_Space / $PAPER_SPACE). */
export function isActiveLayout(ctx: LayoutContext): boolean {
  const n = ctx.block.name.toUpperCase();
  return n === "*PAPER_SPACE" || n === "$PAPER_SPACE";
}

/** PSLTSCALE in effect when plotting a layout (see module comment). */
export function layoutPsltscale(doc: DxfDocument, ctx: LayoutContext): boolean {
  if (isActiveLayout(ctx) || !ctx.layout?.object) return doc.header.num("$PSLTSCALE", 1) !== 0;
  return (ctx.layout.object.layoutFlags & 1) !== 0;
}

/**
 * View for plot area "layout": the canvas at 1 px per paper unit (explicit scale p:d → d/p units
 * per pixel), paper (0,0) at the lower-left corner.
 */
export function layoutAreaView(request: PlotRequest): View {
  const [w, h] = request.canvas;
  let unitsPerPx = 1;
  if (Array.isArray(request.scale)) {
    const [p, d] = request.scale as readonly [number, number];
    if (p > 0 && d > 0) unitsPerPx = d / p;
  }
  return fitWindow([0, 0], [w * unitsPerPx, h * unitsPerPx], request.canvas);
}

/** The overall paper-space viewport of a layout block: the first VIEWPORT with id 1. */
export function overallViewport(entities: readonly Entity[]): ViewportEntity | undefined {
  for (const e of entities) if (e.type === "VIEWPORT" && e.id === 1) return e;
  return undefined;
}

function hexKey(h: string): bigint {
  try {
    return BigInt(`0x${h || "0"}`);
  } catch {
    return 0n;
  }
}

/** Model viewports whose content plots, in plot order (ascending handle). */
export function plottedViewports(entities: readonly Entity[]): ViewportEntity[] {
  const overall = overallViewport(entities);
  const out: { vp: ViewportEntity; i: number; k: bigint }[] = [];
  entities.forEach((e, i) => {
    if (e.type !== "VIEWPORT" || e === overall || e.status === 0) return;
    out.push({ vp: e, i, k: hexKey(e.handle) });
  });
  out.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));
  return out.map((x) => x.vp);
}

/** Hooks supplied by draw/viewport.ts (keeps this module free of drawer imports). */
export interface PaperSpaceHooks {
  drawViewportContent(fe: Frontend, vp: ViewportEntity, ctx: LayoutContext): void;
  /** Clip region of a viewport in paper coordinates. */
  viewportClipRings(fe: Frontend, vp: ViewportEntity): Float64Array[];
}

let hooks: PaperSpaceHooks | undefined;

export function setPaperSpaceHooks(h: PaperSpaceHooks): void {
  hooks = h;
}

const PAPER_KEY = "layout:paper";

export interface PaperState {
  /** The overall viewport (draws nothing), if the layout has one. */
  readonly overall: ViewportEntity | undefined;
}

/** Set while a paper-space layout is drawn (VIEWPORT frames draw only then). */
export function currentPaper(fe: Frontend): PaperState | undefined {
  return fe.caches.get(PAPER_KEY) as PaperState | undefined;
}

/** Draws the plotted space: model space as is, or a layout with its viewports. */
export function drawSpace(fe: Frontend, ctx: LayoutContext): void {
  if (ctx.isModel) {
    fe.drawBlock(ctx.block);
    return;
  }
  const entities = fe.drawOrder.entities(ctx.block);
  const state: PaperState = { overall: overallViewport(entities) };
  fe.caches.set(PAPER_KEY, state);
  const viewports = plottedViewports(entities);
  const content = () => {
    if (!hooks) {
      if (viewports.length > 0) fe.note("viewport-content");
      return;
    }
    for (const vp of viewports) hooks.drawViewportContent(fe, vp, ctx);
  };
  const paper = (afterContent: boolean) => {
    const st = { m: Matrix44.identity(), inh: TOP_LEVEL, stack: [ctx.block.name.toUpperCase()] };
    // A paper-space WIPEOUT never masks viewport content, even when paper space is plotted
    // last (VERIFIED-BY-ACAD layouts/wipeout-over-vp-psfirst-n): clip it to outside the viewports.
    const outside = afterContent && hooks ? outsideViewports(fe, viewports) : undefined;
    for (const e of entities) {
      if (outside && e.type === "WIPEOUT") {
        fe.pushClip(outside);
        fe.drawEntities([e], st);
        fe.popClip();
      } else fe.drawEntities([e], st);
    }
  };
  if (fe.request.paperSpaceFirst) {
    paper(false);
    content();
  } else {
    content();
    paper(true);
  }
}

/** The plotted view minus the viewports' clip regions (rings, even-odd). */
function outsideViewports(fe: Frontend, viewports: readonly ViewportEntity[]): Float64Array[] | undefined {
  if (viewports.length === 0 || !hooks) return undefined;
  const v = fe.view;
  const m = (v.maxX - v.minX) * 0.01;
  const all = Float64Array.of(
    v.minX - m,
    v.minY - m,
    v.maxX + m,
    v.minY - m,
    v.maxX + m,
    v.maxY + m,
    v.minX - m,
    v.maxY + m,
  );
  const holes = viewports.flatMap((vp) => hooks!.viewportClipRings(fe, vp));
  return booleanPolygons(BooleanOp.Difference, [all], holes, {
    tolerance: fe.tolerance / 16,
    subjectFillRule: FillRule.EvenOdd,
    clipFillRule: FillRule.NonZero,
  }).flatMap((p) => [p.outer, ...p.holes]);
}
