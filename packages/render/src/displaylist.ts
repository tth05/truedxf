/**
 * The display list: the renderer-agnostic, transferable output of the frontend (docs/PLAN.md
 * §4.2a). Everything is already tessellated for a target resolution: fills and widened strokes
 * are triangles, true hairlines are line segments, single-pixel dots are points. Coordinates are
 * float32 relative to a float64 batch origin (precision for large coordinates). Batches are in
 * strict draw order; a renderer must draw them in sequence without depth testing.
 */

export const PrimitiveKind = {
  /** Triangle list (3 vertices per triangle). */
  Triangles: 0,
  /** Line segment list (2 vertices per segment), rendered 1 device pixel wide. */
  Lines: 1,
  /** Points, rendered as single device pixels. */
  Points: 2,
} as const;
export type PrimitiveKind = (typeof PrimitiveKind)[keyof typeof PrimitiveKind];

export interface Batch {
  readonly kind: PrimitiveKind;
  /** Float64 origin; positions are relative to it. */
  readonly originX: number;
  readonly originY: number;
  /** x, y pairs (float32, relative to origin). */
  readonly positions: Float32Array;
  /** RGBA per vertex (0–255). */
  readonly colors: Uint8Array;
  /** Index into DisplayList.clips, or -1 for no clipping. */
  readonly clip: number;
  /**
   * Pick ranges: triples (firstVertex, vertexCount, entityIndex) mapping vertex ranges to
   * DisplayList.entities (entity handles / ids).
   */
  readonly pick: Uint32Array;
}

/** A clip region: polygons (even-odd) in the same world coordinates as the batches. */
export interface ClipRegion {
  /** Rings as flat x, y arrays (float64). */
  readonly rings: readonly Float64Array[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DisplayList {
  /** World units per device pixel the geometry was tessellated / widened for. */
  readonly pixelSize: number;
  /** Background colour RGB (plot paper is white). */
  readonly background: readonly [number, number, number];
  readonly bounds: Bounds;
  readonly batches: readonly Batch[];
  readonly clips: readonly ClipRegion[];
  /** Entity identities referenced by pick ranges: handle (or "#id" when the entity has none). */
  readonly entities: readonly string[];
}

export function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

/** All typed-array buffers, for `postMessage(list, transferables(list))`. */
export function transferables(list: DisplayList): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const b of list.batches) {
    out.push(b.positions.buffer as ArrayBuffer, b.colors.buffer as ArrayBuffer, b.pick.buffer as ArrayBuffer);
  }
  return out;
}

class GrowF32 {
  data = new Float32Array(1024);
  length = 0;
  push2(a: number, b: number): void {
    if (this.length + 2 > this.data.length) this.grow(this.length + 2);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }
  private grow(min: number): void {
    const d = new Float32Array(Math.max(min, this.data.length * 2));
    d.set(this.data.subarray(0, this.length));
    this.data = d;
  }
  take(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

class GrowU8 {
  data = new Uint8Array(2048);
  length = 0;
  push4(r: number, g: number, b: number, a: number): void {
    if (this.length + 4 > this.data.length) {
      const d = new Uint8Array(Math.max(this.length + 4, this.data.length * 2));
      d.set(this.data.subarray(0, this.length));
      this.data = d;
    }
    this.data[this.length++] = r;
    this.data[this.length++] = g;
    this.data[this.length++] = b;
    this.data[this.length++] = a;
  }
  take(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

/** RGBA colour, components 0–255. */
export type Rgba = readonly [number, number, number, number];

/**
 * Accumulates primitives in draw order. Consecutive primitives of the same kind and clip are
 * merged into one batch (per-vertex colours keep them distinct), so draw order is preserved with
 * few batches. Large coordinates: each batch uses the first vertex it receives as its origin.
 */
export class DisplayListBuilder {
  readonly pixelSize: number;
  background: [number, number, number] = [255, 255, 255];
  private readonly batches: Batch[] = [];
  private readonly clips: ClipRegion[] = [];
  private readonly entities: string[] = [];
  private readonly bounds = emptyBounds();
  private kind: PrimitiveKind = PrimitiveKind.Triangles;
  private clip = -1;
  private originX = 0;
  private originY = 0;
  private pos = new GrowF32();
  private col = new GrowU8();
  private pick: number[] = [];
  private vertexCount = 0;
  private entity = -1;
  private entityStart = 0;
  /** Maximum vertices per batch (keeps GPU buffers bounded). */
  readonly maxBatchVertices: number;

  constructor(pixelSize: number, maxBatchVertices = 1 << 20) {
    this.pixelSize = pixelSize;
    this.maxBatchVertices = maxBatchVertices;
  }

  /** Starts attributing subsequent primitives to an entity (for picking). */
  beginEntity(id: string): void {
    this.closePick();
    this.entity = this.entities.length;
    this.entities.push(id);
    this.entityStart = this.vertexCount;
  }

  endEntity(): void {
    this.closePick();
    this.entity = -1;
  }

  private closePick(): void {
    if (this.entity >= 0 && this.vertexCount > this.entityStart) {
      this.pick.push(this.entityStart, this.vertexCount - this.entityStart, this.entity);
    }
    this.entityStart = this.vertexCount;
  }

  addClip(region: ClipRegion): number {
    this.clips.push(region);
    return this.clips.length - 1;
  }

  setClip(clip: number): void {
    if (clip !== this.clip) {
      this.flush();
      this.clip = clip;
    }
  }

  private ensure(kind: PrimitiveKind, vertices: number, x: number, y: number): void {
    if (kind !== this.kind || this.vertexCount + vertices > this.maxBatchVertices) {
      this.flush();
      this.kind = kind;
    }
    if (this.vertexCount === 0) {
      this.originX = x;
      this.originY = y;
    }
  }

  private vertex(x: number, y: number, c: Rgba): void {
    this.pos.push2(x - this.originX, y - this.originY);
    this.col.push4(c[0], c[1], c[2], c[3]);
    this.vertexCount++;
    const b = this.bounds;
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }

  /** Adds triangles from a flat [x0,y0,x1,y1,x2,y2,…] array (float64 world coordinates). */
  triangles(xy: ArrayLike<number>, color: Rgba): void {
    const n = xy.length >> 1;
    if (n < 3) return;
    this.ensure(PrimitiveKind.Triangles, n - (n % 3), xy[0]!, xy[1]!);
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) this.vertex(xy[(i + k) * 2]!, xy[(i + k) * 2 + 1]!, color);
    }
  }

  /** Adds hairline segments from a polyline [x0,y0,x1,y1,…]; `closed` adds the closing segment. */
  polyline(xy: ArrayLike<number>, color: Rgba, closed = false): void {
    const n = xy.length >> 1;
    if (n < 2) return;
    this.ensure(PrimitiveKind.Lines, (n - 1 + (closed ? 1 : 0)) * 2, xy[0]!, xy[1]!);
    for (let i = 0; i + 1 < n; i++) {
      this.vertex(xy[i * 2]!, xy[i * 2 + 1]!, color);
      this.vertex(xy[i * 2 + 2]!, xy[i * 2 + 3]!, color);
    }
    if (closed && n > 2) {
      this.vertex(xy[(n - 1) * 2]!, xy[(n - 1) * 2 + 1]!, color);
      this.vertex(xy[0]!, xy[1]!, color);
    }
  }

  /** Adds single-pixel points [x0,y0,…]. */
  points(xy: ArrayLike<number>, color: Rgba): void {
    const n = xy.length >> 1;
    if (n < 1) return;
    this.ensure(PrimitiveKind.Points, n, xy[0]!, xy[1]!);
    for (let i = 0; i < n; i++) this.vertex(xy[i * 2]!, xy[i * 2 + 1]!, color);
  }

  private flush(): void {
    this.closePick();
    if (this.vertexCount > 0) {
      this.batches.push({
        kind: this.kind,
        originX: this.originX,
        originY: this.originY,
        positions: this.pos.take(),
        colors: this.col.take(),
        clip: this.clip,
        pick: Uint32Array.from(this.pick),
      });
    }
    this.pos = new GrowF32();
    this.col = new GrowU8();
    this.pick = [];
    this.vertexCount = 0;
    this.entityStart = 0;
  }

  build(): DisplayList {
    this.flush();
    return {
      pixelSize: this.pixelSize,
      background: this.background,
      bounds: { ...this.bounds },
      batches: this.batches,
      clips: this.clips,
      entities: this.entities,
    };
  }
}
