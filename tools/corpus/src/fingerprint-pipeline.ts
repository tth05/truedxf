import { closeSync, existsSync, openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { DxfDocument, loadDxf } from "@truedxf/model";
import { type DisplayList, type PlotRequest, renderPlot } from "@truedxf/render";
import { nodeImageLoader } from "../../../packages/testkit/src/image-files.ts";
import { type RenderParams, ViewerCore } from "../../../packages/viewer/src/protocol.ts";
import { ROOT } from "./common.ts";
import { fingerprint, modelFingerprint, type Shape, shape } from "./fingerprint-hash.ts";

export type Kind = "model" | "plot" | "viewer";
export interface Target {
  id: string;
  path: string;
  meta?: string;
  name: string;
}
export interface Result {
  hash: string;
  error?: string;
  shape?: Shape;
  delta?: number;
}
export interface RecordResult {
  entities?: number;
  ms: number;
  model?: Result;
  plot?: Result;
  viewer?: Result;
}
export interface Task {
  target: Target;
  kinds: Kind[];
  positions?: string;
  saveDetail?: boolean;
  lod?: boolean;
  blockReuse?: boolean;
}

const FONT_DIRS = [
  join(ROOT, "packages", "fonts", "assets"),
  join(ROOT, "apps", "playground", "fonts"),
  "C:/Windows/Fonts",
  "C:/Program Files/Autodesk/AutoCAD 2027/Fonts",
].filter((d) => existsSync(d));
const fontIndex = new Map<string, string>();
for (const d of FONT_DIRS)
  for (const f of readdirSync(d))
    if (!fontIndex.has(f.toLowerCase())) fontIndex.set(f.toLowerCase(), join(d, f));
const fontBytes = new Map<string, Uint8Array | undefined>();
async function loadFont(name: string): Promise<Uint8Array | undefined> {
  const k = name.toLowerCase();
  if (!fontBytes.has(k)) {
    const p = fontIndex.get(k);
    fontBytes.set(k, p ? new Uint8Array(readFileSync(p)) : undefined);
  }
  return fontBytes.get(k);
}
const BASE: Omit<RenderParams, "area"> = {
  layout: "Model",
  canvas: [1600, 1000],
  background: [33, 40, 48],
  layers: {},
  lineweights: true,
  raster: "smooth",
  dpi: 100,
  assets: 0,
};

interface PositionHeader {
  version: 1;
  lists: Partial<
    Record<
      Kind,
      {
        hash: string;
        pixelSize: number;
        shape: Shape;
        batches: { originX: number; originY: number; length: number }[];
      }
    >
  >;
}

/** Length-prefixed JSON metadata, then plot/viewer Float32 bytes in batch order (little endian). */
function savePositions(path: string, lists: Partial<Record<Kind, DisplayList>>, record: RecordResult): void {
  const header: PositionHeader = { version: 1, lists: {} };
  for (const kind of ["plot", "viewer"] as const) {
    const list = lists[kind];
    if (!list) continue;
    header.lists[kind] = {
      hash: record[kind]!.hash,
      pixelSize: list.pixelSize,
      shape: shape(list),
      batches: list.batches.map((b) => ({
        originX: b.originX,
        originY: b.originY,
        length: b.positions.length,
      })),
    };
  }
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  const fd = openSync(path, "w");
  try {
    writeSync(fd, length);
    writeSync(fd, json);
    for (const kind of ["plot", "viewer"] as const)
      for (const batch of lists[kind]?.batches ?? [])
        writeSync(
          fd,
          new Uint8Array(batch.positions.buffer, batch.positions.byteOffset, batch.positions.byteLength),
        );
  } finally {
    closeSync(fd);
  }
}

export function coordinateDelta(
  path: string,
  kind: Kind,
  list: DisplayList,
  oldHash: string,
): number | undefined {
  if (!existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString("utf8", 4, 4 + length)) as PositionHeader;
  const old = header.lists[kind];
  // Stale detail files must never be compared to a newer JSON baseline.
  if (header.version !== 1 || !old || old.hash !== oldHash || old.shape.structure !== shape(list).structure)
    return undefined;
  let offset = 4 + length;
  let delta = 0;
  for (const k of ["plot", "viewer"] as const) {
    const entry = header.lists[k];
    if (!entry) continue;
    for (let i = 0; i < entry.batches.length; i++) {
      const batch = entry.batches[i]!;
      if (k === kind) {
        const current = list.batches[i]!;
        for (let j = 0; j < batch.length; j++) {
          const a = bytes.readFloatLE(offset + j * 4) + (j % 2 ? batch.originY : batch.originX);
          const b = current.positions[j]! + (j % 2 ? current.originY : current.originX);
          const d = Object.is(a, b) ? 0 : Math.abs(b - a) / list.pixelSize;
          if (!Number.isFinite(d)) return undefined;
          delta = Math.max(delta, d);
        }
      }
      offset += batch.length * 4;
    }
  }
  return delta;
}

export interface PipelineReply {
  record: RecordResult;
}
export async function runTask(task: Task, oldHashes?: Partial<Record<Kind, string>>): Promise<PipelineReply> {
  const start = performance.now();
  const record: RecordResult = { ms: 0 };
  const lists: Partial<Record<Kind, DisplayList>> = {};
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(task.target.path));
  } catch (e) {
    for (const kind of task.kinds) record[kind] = errorResult(e);
    record.ms = performance.now() - start;
    return { record };
  }
  for (const kind of task.kinds) {
    try {
      if (kind === "model") {
        const model = modelFingerprint(DxfDocument.load(bytes));
        record.model = { hash: model.hash };
        record.entities = model.entities;
      } else {
        let list: DisplayList;
        let hash: string;
        if (kind === "plot") {
          const meta = JSON.parse(readFileSync(task.target.meta!, "utf8")) as { plot: PlotRequest };
          // Match the harness/CPU suite prologue (note 08 §5.5), retaining case overrides.
          const plot = { ...meta.plot, sysvars: { PLOTTRANSPARENCYOVERRIDE: 0, ...meta.plot.sysvars } };
          const res = await renderPlot(loadDxf(bytes), plot, {
            loadImage: nodeImageLoader(dirname(task.target.path)),
            loadFont,
            rasterEntities: "omit",
          });
          list = res.displayList;
          hash = fingerprint(list, false);
        } else {
          const loadImage = task.target.meta
            ? nodeImageLoader(dirname(task.target.path))
            : async () => undefined;
          const core = new ViewerCore(loadFont, loadImage);
          const info = core.load(bytes, task.target.name);
          const res = await core.render({
            ...BASE,
            lod: task.lod,
            blockReuse: task.blockReuse,
            layout: info.activeLayout,
            area: { type: "extents" },
          });
          list = res.list;
          hash = fingerprint(
            {
              list,
              view: res.view,
              bounds: res.bounds,
              unsupported: res.unsupported,
              warnings: res.warnings.map((w) => w.code),
            },
            false,
          );
        }
        const result: Result = { hash, shape: shape(list) };
        if (task.positions && oldHashes?.[kind])
          result.delta = coordinateDelta(task.positions, kind, list, oldHashes[kind]!);
        record[kind] = result;
        if (task.saveDetail) lists[kind] = list;
      }
    } catch (e) {
      record[kind] = errorResult(e);
    }
  }
  if (task.saveDetail && task.positions) savePositions(task.positions, lists, record);
  record.ms = performance.now() - start;
  return { record };
}

function errorResult(e: unknown): Result {
  const error = e instanceof Error ? e.message : String(e);
  return { hash: fingerprint({ error }), error };
}
