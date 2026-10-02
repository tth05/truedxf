/** Float64 builder calls, before batch rebasing/float32 conversion and pick attribution. */
import { Affine2, Matrix44 } from "@truedxf/geometry";
import { type ClipRegion, DisplayListBuilder, type RasterImage, type Rgba } from "./displaylist.ts";

type Command =
  | { kind: "triangles" | "points"; xy: Float64Array; color: Rgba }
  | { kind: "polyline"; xy: Float64Array; color: Rgba; closed: boolean }
  | { kind: "image"; xy: Float64Array; uv: Float64Array; image: RasterImage; color: Rgba }
  | { kind: "break" }
  | { kind: "unbounded"; on: boolean }
  | { kind: "clip"; clip: number; pointClip: number }
  | { kind: "addClip"; region: ClipRegion; index: number };

export interface BlockStream {
  readonly commands: readonly Command[];
  readonly vertices: number;
  readonly notes: Readonly<Record<string, number>>;
}

/**
 * A recorder is a builder so existing drawers need no alternate emission path. No build() or
 * entity boundaries are used: replay stays inside the destination's current top-level pick.
 */
export class BlockRecorder extends DisplayListBuilder {
  readonly commands: Command[] = [];
  vertices = 0;
  overflow = false;
  unsafe = false;
  private readonly vertexLimit: number;
  private readonly commandLimit: number;
  private clipCount = 0;

  constructor(pixelSize: number, vertexLimit: number, commandLimit: number) {
    super(pixelSize);
    this.vertexLimit = vertexLimit;
    this.commandLimit = commandLimit;
  }

  private reserve(vertices: number): boolean {
    if (this.overflow) return false;
    if (this.vertices + vertices > this.vertexLimit || this.commands.length >= this.commandLimit) {
      this.overflow = true;
      this.commands.length = 0;
      return false;
    }
    this.vertices += vertices;
    return true;
  }

  override triangles(xy: ArrayLike<number>, color: Rgba): void {
    if (this.reserve(xy.length / 2))
      this.commands.push({ kind: "triangles", xy: Float64Array.from(xy), color: [...color] });
  }

  override polyline(xy: ArrayLike<number>, color: Rgba, closed = false): void {
    if (this.reserve(xy.length / 2))
      this.commands.push({ kind: "polyline", xy: Float64Array.from(xy), color: [...color], closed });
  }

  override points(xy: ArrayLike<number>, color: Rgba): void {
    if (this.reserve(xy.length / 2))
      this.commands.push({ kind: "points", xy: Float64Array.from(xy), color: [...color] });
  }

  override imageTriangles(
    xy: ArrayLike<number>,
    uv: ArrayLike<number>,
    image: RasterImage,
    color: Rgba,
  ): void {
    if (this.reserve(xy.length / 2))
      this.commands.push({
        kind: "image",
        xy: Float64Array.from(xy),
        uv: Float64Array.from(uv),
        image,
        color: [...color],
      });
  }

  override breakBatch(): void {
    if (this.reserve(0)) this.commands.push({ kind: "break" });
  }

  override setUnbounded(on: boolean): void {
    if (this.reserve(0)) this.commands.push({ kind: "unbounded", on });
  }

  override addClip(region: ClipRegion): number {
    const index = this.clipCount++;
    const vertices = region.rings.reduce((n, r) => n + r.length / 2, 0);
    if (this.reserve(vertices))
      this.commands.push({ kind: "addClip", index, region: { rings: region.rings.map((r) => r.slice()) } });
    return index;
  }

  override setClip(clip: number, pointClip = clip): void {
    if (this.reserve(0)) this.commands.push({ kind: "clip", clip, pointClip });
  }
}

/** S contains exact scale and parity; R only rotates/translates already widened/dashed output. */
export function splitBlockTransform(
  m: Matrix44,
): { scale: number; mirror: boolean; s: Matrix44; r: Affine2 } | undefined {
  const v = m.m;
  // Reject tilt, z-to-xy projection and perspective even if the projected xy happens to look
  // like a similarity. Flattening 3D entities through such a projection is not reusable.
  if (!m.isAffine() || v[2] !== 0 || v[6] !== 0 || v[8] !== 0 || v[9] !== 0 || !v.every(Number.isFinite))
    return undefined;
  const a = m.planeToAffine2(0);
  const scale = a.similarityScale(8 * Number.EPSILON);
  if (scale === undefined || !Number.isFinite(scale)) return undefined;
  const mirror = a.isMirroring();
  const sy = mirror ? -scale : scale;
  return {
    scale,
    mirror,
    s: Matrix44.scaling(scale, sy, v[10]),
    r: new Affine2(a.a / scale, a.b / scale, a.c / sy, a.d / sy, a.e, a.f),
  };
}

export function replayBlockStream(
  stream: BlockStream,
  out: DisplayListBuilder,
  rigid: Affine2,
  workspace = { xy: new Float64Array(0) },
): void {
  const clips = new Map<number, number>();
  // One scratch allocation per replay, reused by all primitive calls (the builder consumes
  // synchronously). Keep original call boundaries: they affect batching and pick ranges.
  const points = (src: Float64Array): Float64Array => {
    if (workspace.xy.length < src.length) workspace.xy = new Float64Array(src.length);
    return rigid.applyPoints(src, workspace.xy.subarray(0, src.length));
  };
  for (const cmd of stream.commands) {
    switch (cmd.kind) {
      case "triangles":
        out.triangles(points(cmd.xy), cmd.color);
        break;
      case "polyline":
        out.polyline(points(cmd.xy), cmd.color, cmd.closed);
        break;
      case "points":
        out.points(points(cmd.xy), cmd.color);
        break;
      case "image":
        out.imageTriangles(points(cmd.xy), cmd.uv, cmd.image, cmd.color);
        break;
      case "break":
        out.breakBatch();
        break;
      case "unbounded":
        out.setUnbounded(cmd.on);
        break;
      case "addClip":
        clips.set(cmd.index, out.addClip({ rings: cmd.region.rings.map((r) => rigid.applyPoints(r)) }));
        break;
      case "clip":
        out.setClip(clips.get(cmd.clip) ?? cmd.clip, clips.get(cmd.pointClip) ?? cmd.pointClip);
        break;
    }
  }
}
