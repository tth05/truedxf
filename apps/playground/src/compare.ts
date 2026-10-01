/**
 * Fixture compare view: our plot-mode render (raster "autocad", the case's plot request) vs the
 * AutoCAD reference PNG: side by side, onion skin, or diff (red = only AutoCAD, blue = only
 * truedxf, grey = both).
 */
import { DisplayListRenderer } from "@truedxf/three";
import type { DxfViewer, RenderParams } from "@truedxf/viewer";
import { h, mount } from "./dom.ts";
import { fmtMs, fmtNum } from "./format.ts";

/** Fixture plot contract (samples/generated/<suite>/<case>.json → plot). */
export interface FixturePlot {
  layout: string;
  area: RenderParams["area"];
  canvas: [number, number];
  styleTable?: string;
  lineweights?: boolean;
  scale?: RenderParams["scale"];
  sysvars?: RenderParams["sysvars"];
  paperSpaceFirst?: boolean;
}

export type CompareMode = "live" | "side" | "onion" | "diff";

export interface DiffStats {
  width: number;
  height: number;
  onlyRef: number;
  onlyOurs: number;
  both: number;
  /** Pixels whose RGB differs by more than 8 in any channel. */
  mismatch: number;
}

const INK = 250;

function ink(d: Uint8ClampedArray, i: number): boolean {
  return d[i]! < INK || d[i + 1]! < INK || d[i + 2]! < INK;
}

/** Diff image: white = neither, grey = both, red = only reference, blue = only ours. */
export function diffImage(ours: ImageData, ref: ImageData): { image: ImageData; stats: DiffStats } {
  const w = Math.min(ours.width, ref.width);
  const hgt = Math.min(ours.height, ref.height);
  const out = new ImageData(w, hgt);
  const o = out.data;
  const stats: DiffStats = { width: w, height: hgt, onlyRef: 0, onlyOurs: 0, both: 0, mismatch: 0 };
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const a = (y * ours.width + x) * 4;
      const b = (y * ref.width + x) * 4;
      const k = (y * w + x) * 4;
      const inA = ink(ours.data, a);
      const inB = ink(ref.data, b);
      if (
        Math.abs(ours.data[a]! - ref.data[b]!) > 8 ||
        Math.abs(ours.data[a + 1]! - ref.data[b + 1]!) > 8 ||
        Math.abs(ours.data[a + 2]! - ref.data[b + 2]!) > 8
      )
        stats.mismatch++;
      let c: [number, number, number];
      if (inA && inB) {
        stats.both++;
        c = [150, 150, 150];
      } else if (inB) {
        stats.onlyRef++;
        c = [230, 30, 30];
      } else if (inA) {
        stats.onlyOurs++;
        c = [30, 90, 240];
      } else c = [255, 255, 255];
      o[k] = c[0];
      o[k + 1] = c[1];
      o[k + 2] = c[2];
      o[k + 3] = 255;
    }
  }
  return { image: out, stats };
}

let plotRenderer: DisplayListRenderer | undefined;

/** Renders the loaded document like the visual harness (plot mode, aliased) into ImageData. */
export async function plotImage(
  viewer: DxfViewer,
  plot: FixturePlot,
): Promise<{ image: ImageData; ms: number }> {
  const t0 = performance.now();
  const res = await viewer.renderList({
    layout: plot.layout,
    area: plot.area,
    canvas: plot.canvas,
    background: [255, 255, 255],
    layers: {},
    lineweights: plot.lineweights ?? true,
    raster: "autocad",
    visibility: "plot",
    // accoreconsole (the reference harness) plots neither IMAGE nor WIPEOUT (note 07 §8.4)
    rasterEntities: false,
    ...(plot.styleTable ? { styleTable: plot.styleTable } : {}),
    ...(plot.scale ? { scale: plot.scale } : {}),
    ...(plot.sysvars ? { sysvars: plot.sysvars } : {}),
    ...(plot.paperSpaceFirst !== undefined ? { paperSpaceFirst: plot.paperSpaceFirst } : {}),
  });
  plotRenderer ??= new DisplayListRenderer({
    canvas: document.createElement("canvas"),
    antialias: false,
    preserveDrawingBuffer: true,
  });
  const [w, hgt] = plot.canvas;
  plotRenderer.setSize(w, hgt, false);
  plotRenderer.setDisplayList(res.list);
  plotRenderer.render(res.view);
  const px = plotRenderer.readPixels();
  plotRenderer.clear();
  const image = new ImageData(w, hgt);
  image.data.set(px.data);
  return { image, ms: performance.now() - t0 };
}

export async function loadPng(url: string): Promise<ImageData | undefined> {
  const r = await fetch(url);
  if (!r.ok) return undefined;
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}

function toCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  c.className = "cmp-img";
  return c;
}

/** The compare overlay on the stage. */
export class ComparePanel {
  readonly root: HTMLElement;
  private readonly body = h("div", { class: "cmp-body" });
  private readonly info = h("div", { class: "cmp-info" });
  private readonly slider = h("input", {
    type: "range",
    min: "0",
    max: "100",
    value: "50",
    class: "cmp-slider",
  });
  private readonly buttons: Record<CompareMode, HTMLButtonElement>;
  private mode: CompareMode = "side";
  private ours: ImageData | undefined;
  private ref: ImageData | undefined;
  private diff: { image: ImageData; stats: DiffStats } | undefined;
  private seq = 0;
  private actual = false;

  constructor() {
    const btn = (m: CompareMode, label: string) =>
      h("button", { class: "btn", "aria-pressed": "false", onclick: () => this.setMode(m) }, label);
    this.buttons = {
      live: btn("live", "Interactive"),
      side: btn("side", "Side by side"),
      onion: btn("onion", "Onion skin"),
      diff: btn("diff", "Diff"),
    };
    const zoom = h("button", { class: "btn", title: "Toggle 1:1 pixels", "aria-pressed": "false" }, "1:1");
    zoom.addEventListener("click", () => {
      this.actual = !this.actual;
      zoom.setAttribute("aria-pressed", String(this.actual));
      this.root.classList.toggle("actual", this.actual);
    });
    this.slider.addEventListener("input", () => this.applyOnion());
    this.root = h(
      "div",
      { class: "compare" },
      h(
        "div",
        { class: "cmp-bar" },
        h(
          "div",
          { class: "seg" },
          this.buttons.live,
          this.buttons.side,
          this.buttons.onion,
          this.buttons.diff,
        ),
        this.slider,
        zoom,
        this.info,
      ),
      this.body,
    );
    try {
      const saved = localStorage.getItem("truedxf.compare") as CompareMode | null;
      if (saved === "live" || saved === "side" || saved === "onion" || saved === "diff") this.mode = saved;
    } catch {
      // storage unavailable
    }
    this.setMode(this.mode);
  }

  setMode(m: CompareMode): void {
    this.mode = m;
    for (const [k, b] of Object.entries(this.buttons)) b.setAttribute("aria-pressed", String(k === m));
    this.slider.style.display = m === "onion" ? "" : "none";
    this.root.classList.toggle("live", m === "live");
    try {
      localStorage.setItem("truedxf.compare", m);
    } catch {
      // storage unavailable
    }
    this.draw();
  }

  /** Shows a case: renders ours, loads the reference, then draws. */
  async show(viewer: DxfViewer, plot: FixturePlot, refUrl: string | undefined): Promise<void> {
    const seq = ++this.seq;
    this.ours = this.ref = this.diff = undefined;
    mount(this.body, h("div", { class: "cmp-empty" }, h("span", { class: "spinner" }), " Rendering plot…"));
    this.info.textContent = "";
    const [ours, ref] = await Promise.all([
      plotImage(viewer, plot).catch((e: unknown) => {
        console.error(e);
        return undefined;
      }),
      refUrl ? loadPng(refUrl).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    if (seq !== this.seq) return;
    this.ours = ours?.image;
    this.ref = ref;
    if (this.ours && this.ref) this.diff = diffImage(this.ours, this.ref);
    const s = this.diff?.stats;
    this.info.textContent = [
      ours ? `plot ${fmtMs(ours.ms)}` : "plot failed",
      ref ? "" : "no AutoCAD reference",
      s
        ? `${fmtNum(s.mismatch)} px differ · only AutoCAD ${fmtNum(s.onlyRef)} · only truedxf ${fmtNum(s.onlyOurs)}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    this.draw();
  }

  private draw(): void {
    const label = (t: string, el: Node) => h("figure", { class: "cmp-fig" }, el, h("figcaption", {}, t));
    const empty = (t: string) => h("div", { class: "cmp-empty" }, t);
    if (!this.ours && !this.ref) return;
    if (this.mode === "side") {
      mount(
        this.body,
        h(
          "div",
          { class: "cmp-side" },
          label("truedxf (plot mode)", this.ours ? toCanvas(this.ours) : empty("render failed")),
          label("AutoCAD 2027", this.ref ? toCanvas(this.ref) : empty("no reference")),
        ),
      );
    } else if (this.mode === "onion") {
      if (!this.ours || !this.ref) {
        mount(this.body, empty("Onion skin needs both images"));
        return;
      }
      const top = toCanvas(this.ours);
      top.classList.add("cmp-top");
      mount(this.body, h("div", { class: "cmp-stack" }, toCanvas(this.ref), top));
      this.applyOnion();
    } else {
      if (!this.diff) {
        mount(this.body, empty("Diff needs both images"));
        return;
      }
      mount(
        this.body,
        h(
          "div",
          { class: "cmp-stack" },
          toCanvas(this.diff.image),
          h(
            "div",
            { class: "cmp-legend" },
            h("span", { style: "color:#e61e1e" }, "■ only AutoCAD"),
            h("span", { style: "color:#1e5af0" }, "■ only truedxf"),
            h("span", { style: "color:#969696" }, "■ both"),
          ),
        ),
      );
    }
  }

  private applyOnion(): void {
    const top = this.body.querySelector<HTMLCanvasElement>(".cmp-top");
    if (top) top.style.opacity = String(Number(this.slider.value) / 100);
  }
}
