/**
 * Viewer warnings: why a drawing shows nothing (or looks empty), and render notes such as missing
 * fonts. Part of the public API (`DocumentInfo.warnings`, `RenderResult.warnings`,
 * `DxfViewer.warnings` and its `warnings` event): codes are stable, messages are for people.
 */
import type { Block, DxfDocument, Entity, InsertEntity } from "@truedxf/model";
import type { DisplayList } from "@truedxf/render";

/** Stable warning codes. Render notes (e.g. from the text layer) keep their own codes. */
export const ViewerWarningCode = {
  /** The current layout contains no entities. */
  LayoutEmpty: "layout-empty",
  /** The layout has entities, but every layer carrying them is off or frozen (in the file or by a viewer toggle). */
  LayersHidden: "layers-hidden",
  /**
   * Every layer with content is set not to plot (group 290 = 0, or Defpoints). Document level:
   * a plot of the drawing is empty (the viewer still shows such layers). Render level (plot
   * visibility): the cause of an empty output.
   */
  LayersNoPlot: "layers-no-plot",
  /** The layout has entities on visible layers, but nothing was drawn (invisible / unsupported entities, …). */
  NothingVisible: "nothing-visible",
  /** Everything drawn has (almost) the background colour, e.g. white true colours on white paper. */
  ContentInvisible: "content-invisible",
  /** Fonts not found; text is drawn with a fallback font (render note, @truedxf/render). */
  FontMissing: "font-missing",
  /** Big fonts not found (render note, @truedxf/render). */
  BigFontMissing: "bigfont-missing",
} as const;
export type ViewerWarningCode = (typeof ViewerWarningCode)[keyof typeof ViewerWarningCode];

export interface ViewerWarning {
  /** A ViewerWarningCode, or the code of a render note the viewer does not know. */
  code: ViewerWarningCode | (string & {});
  severity: "info" | "warning";
  /** Human-readable explanation (English). */
  message: string;
  /** Layout the warning applies to (render warnings). */
  layout?: string;
  /** Affected names: layers, fonts, entity types, … */
  items?: string[];
  /** Number of affected things (entities, text styles, …), when meaningful. */
  count?: number;
}

/** A note of the render frontend (`PlotResult.notes`, same shape as @truedxf/render's PlotNote). */
export interface RenderNote {
  code: string;
  message: string;
  severity?: "info" | "warning";
  count?: number;
  items?: string[];
}

const MAX_ITEMS = 50;
/** A colour within this distance (per channel) of the background cannot be told apart from it. */
const INVISIBLE_DISTANCE = 24;

function nameList(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/** Layer names (original spelling, keyed upper-case) of entities that a layout can show. */
function contentLayers(doc: DxfDocument, roots: readonly Block[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<Block>();
  const add = (name: string) => {
    const k = name.toUpperCase();
    if (!out.has(k)) out.set(k, name);
  };
  const visitBlock = (b: Block) => {
    if (seen.has(b)) return;
    seen.add(b);
    for (const e of b.entities) {
      // layer-0 block content takes the INSERT's layer: only other layers count in blocks
      if (e.layer !== "0") add(e.layer);
      visitInsert(e);
    }
  };
  const visitInsert = (e: Entity) => {
    if (e.type !== "INSERT") return;
    const b = doc.getBlock((e as InsertEntity).blockName);
    if (b) visitBlock(b);
  };
  for (const root of roots)
    for (const e of root.entities) {
      if (e.type === "VIEWPORT") continue;
      add(e.layer);
      visitInsert(e);
    }
  return out;
}

/**
 * Document-level warnings (at load): facts about the file that the viewer's display does not
 * show — every layer with content is set not to plot.
 */
export function documentWarnings(doc: DxfDocument): ViewerWarning[] {
  const roots = [doc.modelSpace, ...doc.layouts.filter((l) => !l.isModel).map((l) => l.block)];
  const layers = contentLayers(doc, roots);
  if (layers.size === 0) return [];
  const noPlot = [...layers].filter(([k]) => !plots(doc, k)).map(([, n]) => n);
  if (noPlot.length < layers.size) return [];
  return [
    {
      code: ViewerWarningCode.LayersNoPlot,
      severity: "info",
      message:
        `Every layer with content is set not to plot (${nameList(noPlot)}), so a plot of this ` +
        "drawing is empty. The viewer shows no-plot layers anyway.",
      items: noPlot.slice(0, MAX_ITEMS),
      count: noPlot.length,
    },
  ];
}

function plots(doc: DxfDocument, key: string): boolean {
  if (key === "DEFPOINTS") return false;
  return doc.tables.layers.get(key)?.plot ?? true;
}

export interface RenderWarningInput {
  layout: string;
  /** Viewer layer toggles by upper-case name. */
  toggles: ReadonlyMap<string, boolean>;
  visibility: "display" | "plot";
  list: Pick<DisplayList, "batches" | "background">;
  unsupported: Readonly<Record<string, number>>;
  notes?: readonly RenderNote[] | undefined;
}

/** Warnings for one render of a layout: why the output is empty or invisible, plus render notes. */
export function renderWarnings(doc: DxfDocument, input: RenderWarningInput): ViewerWarning[] {
  const out: ViewerWarning[] = [];
  const { layout } = input;
  const empty = !input.list.batches.some((b) => b.positions.length > 0);
  if (empty) {
    const why = emptyReason(doc, input);
    if (why) out.push(why);
  } else if (!hasVisibleColor(input.list)) {
    out.push({
      code: ViewerWarningCode.ContentInvisible,
      severity: "warning",
      message:
        "Everything in this layout is drawn in the background colour (e.g. white on white paper), " +
        "so it cannot be seen.",
      layout,
    });
  }
  for (const n of input.notes ?? []) {
    out.push({
      code: n.code,
      severity: n.severity ?? "warning",
      message: n.message,
      layout,
      ...(n.items ? { items: n.items.slice(0, MAX_ITEMS) } : {}),
      ...(n.count !== undefined ? { count: n.count } : {}),
    });
  }
  return out;
}

function emptyReason(doc: DxfDocument, input: RenderWarningInput): ViewerWarning | undefined {
  const { layout } = input;
  const k = layout.toUpperCase();
  const paper = k === "MODEL" ? undefined : doc.layouts.find((l) => !l.isModel && l.name.toUpperCase() === k);
  const own = paper ? paper.block : doc.modelSpace;
  const drawable = own.entities.filter((e) => e.type !== "VIEWPORT");
  const viewports = paper ? own.entities.some((e) => e.type === "VIEWPORT") : false;
  // paper layouts show model space through their viewports
  const roots = viewports && doc.modelSpace.entities.length > 0 ? [own, doc.modelSpace] : [own];
  if (drawable.length === 0 && roots.length === 1) {
    const elsewhere = doc.layouts
      .filter((l) => (l.isModel ? doc.modelSpace : l.block).entities.some((e) => e.type !== "VIEWPORT"))
      .map((l) => (l.isModel ? "Model" : l.name))
      .filter((n) => n.toUpperCase() !== k);
    return {
      code: ViewerWarningCode.LayoutEmpty,
      severity: "info",
      message:
        `Layout "${layout}" contains no entities.` +
        (elsewhere.length ? ` Content is in: ${nameList(elsewhere)}.` : ""),
      layout,
      ...(elsewhere.length ? { items: elsewhere.slice(0, MAX_ITEMS) } : {}),
    };
  }
  const layers = contentLayers(doc, roots);
  const hidden: string[] = [];
  let byViewer = false;
  for (const [key, name] of layers) {
    const t = input.toggles.get(key);
    const l = doc.tables.layers.get(key);
    const off = t === undefined ? (l?.off ?? false) || (l?.frozen ?? false) : !t;
    if (off) hidden.push(name);
    if (t === false) byViewer = true;
  }
  if (layers.size > 0 && hidden.length === layers.size) {
    return {
      code: ViewerWarningCode.LayersHidden,
      severity: "warning",
      message:
        `Every layer with content in "${layout}" is ${byViewer ? "hidden" : "off or frozen"} ` +
        `(${nameList(hidden)}). Turn layers on to see the drawing.`,
      layout,
      items: hidden.slice(0, MAX_ITEMS),
      count: hidden.length,
    };
  }
  if (input.visibility === "plot") {
    const hiddenSet = new Set(hidden.map((n) => n.toUpperCase()));
    const noPlot = [...layers].filter(([key]) => !hiddenSet.has(key) && !plots(doc, key)).map(([, n]) => n);
    if (layers.size > 0 && noPlot.length + hidden.length === layers.size && noPlot.length > 0) {
      return {
        code: ViewerWarningCode.LayersNoPlot,
        severity: "warning",
        message:
          `Every visible layer with content in "${layout}" is set not to plot (${nameList(noPlot)}), ` +
          "so the plot is empty.",
        layout,
        items: noPlot.slice(0, MAX_ITEMS),
        count: noPlot.length,
      };
    }
  }
  const unsupported = Object.keys(input.unsupported);
  const n = drawable.length;
  return {
    code: ViewerWarningCode.NothingVisible,
    severity: "warning",
    message:
      `Layout "${layout}" has ${n} entit${n === 1 ? "y" : "ies"}, but nothing visible was drawn` +
      (unsupported.length
        ? ` (not rendered: ${nameList(unsupported)}).`
        : " (invisible, degenerate or empty entities)."),
    layout,
    count: n,
    ...(unsupported.length ? { items: unsupported.slice(0, MAX_ITEMS) } : {}),
  };
}

/** Whether any vertex colour differs visibly from the background (images always count). */
function hasVisibleColor(list: Pick<DisplayList, "batches" | "background">): boolean {
  const [br, bg, bb] = list.background;
  for (const b of list.batches) {
    if (b.kind === 3 && b.positions.length > 0) return true;
    const c = b.colors;
    for (let i = 0; i + 3 < c.length; i += 4) {
      if (c[i + 3] === 0) continue;
      const d = Math.max(Math.abs(c[i]! - br), Math.abs(c[i + 1]! - bg), Math.abs(c[i + 2]! - bb));
      if (d > INVISIBLE_DISTANCE) return true;
    }
  }
  return false;
}
