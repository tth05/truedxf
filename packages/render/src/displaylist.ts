/**
 * The display list: the renderer-agnostic, transferable output of the frontend.
 * Everything is already tessellated for a target resolution: fills and widened strokes
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
    /**
     * Textured triangle list (3 vertices per triangle): `uvs` per vertex into
     * `DisplayList.images[batch.image]` ((0,0) = top-left corner of the bitmap, nearest sampling);
     * the vertex colour multiplies the texel (white = unchanged; alpha = entity transparency).
     */
    Image: 3,
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
    /** Image batches: texture coordinates per vertex (u, v pairs). */
    readonly uvs?: Float32Array;
    /** Image batches: index into DisplayList.images. */
    readonly image?: number;
    /**
     * Geometry that doesn't count for bounds / fit (infinite XLINE/RAY extensions in viewing
     * mode). Not included in DisplayList.bounds.
     */
    readonly unbounded?: boolean;
}

/** A decoded raster for Image batches: RGBA rows, top row first (not premultiplied). */
export interface RasterImage {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8Array;
    /**
     * Sample with linear filtering (and mipmaps) instead of nearest: content rasterized at another
     * resolution than it is shown at (PDF underlays in interactive lists).
     */
    readonly smooth?: boolean;
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

/** What a snap point is (DisplayAnnotations), like AutoCAD's object snap modes. */
export const SnapKind = {
    /** End of a line, arc, polyline segment, spline. */
    Endpoint: 0,
    /** Middle of a line or arc. */
    Midpoint: 1,
    /** Centre of a circle, arc or ellipse. */
    Center: 2,
    /** A POINT. */
    Node: 3,
    /** 0°/90°/180°/270° point of a circle or ellipse. */
    Quadrant: 4,
} as const;
export type SnapKind = (typeof SnapKind)[keyof typeof SnapKind];

/** A text as drawn (DisplayAnnotations.texts). */
export interface DrawnText {
    /** Plain text: formatting codes removed, paragraphs as "\n". */
    readonly text: string;
    /** The top-level pick entity it was drawn in (the text itself, or e.g. its INSERT). */
    readonly entity: string;
    /** Bounds of its drawn output. */
    readonly bounds: Bounds;
    /** Clip region it was drawn in (index into DisplayList.clips), -1 for none. */
    readonly clip: number;
}

/**
 * What viewers need besides the geometry (RenderEnv.annotations, off by default): the texts and
 * where they were drawn (search), and snap points (measuring), in the list's world coordinates.
 * Nothing here is drawn.
 */
export interface DisplayAnnotations {
    readonly texts: readonly DrawnText[];
    /** Snap points as x, y pairs. */
    readonly snapXY: Float64Array;
    /** SnapKind per snap point. */
    readonly snapKinds: Uint8Array;
    /** Clip region per snap point (-1: none). */
    readonly snapClips: Int32Array;
}

export interface DisplayList {
    /** World units per device pixel the geometry was tessellated / widened for. */
    readonly pixelSize: number;
    /** Background colour RGB (plot paper is white). */
    readonly background: readonly [number, number, number];
    /**
     * Bounds of the bounded geometry; clipped primitives count only within their clip region's
     * bounding box (clipped viewport content does not widen a layout's extents, note 08 §10.16).
     */
    readonly bounds: Bounds;
    readonly batches: readonly Batch[];
    readonly clips: readonly ClipRegion[];
    /** Rasters referenced by Image batches. */
    readonly images: readonly RasterImage[];
    /** Entity identities referenced by pick ranges: handle (or "#id" when the entity has none). */
    readonly entities: readonly string[];
    /** Present when the list was built with annotations (RenderEnv.annotations). */
    readonly annotations?: DisplayAnnotations;
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
        out.push(
            b.positions.buffer as ArrayBuffer,
            b.colors.buffer as ArrayBuffer,
            b.pick.buffer as ArrayBuffer,
        );
        if (b.uvs) out.push(b.uvs.buffer as ArrayBuffer);
    }
    // an image may be shared by several lists (caches): transfer copies only
    for (const im of list.images) if (im.pixels.byteOffset === 0) out.push(im.pixels.buffer as ArrayBuffer);
    const a = list.annotations;
    if (a)
        out.push(
            a.snapXY.buffer as ArrayBuffer,
            a.snapKinds.buffer as ArrayBuffer,
            a.snapClips.buffer as ArrayBuffer,
        );
    return [...new Set(out)];
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

class GrowF64 {
    data = new Float64Array(256);
    length = 0;
    push2(a: number, b: number): void {
        if (this.length + 2 > this.data.length) {
            const d = new Float64Array(this.data.length * 2);
            d.set(this.data.subarray(0, this.length));
            this.data = d;
        }
        this.data[this.length++] = a;
        this.data[this.length++] = b;
    }
    take(): Float64Array {
        return this.data.slice(0, this.length);
    }
}

class GrowI32 {
    data = new Int32Array(256);
    length = 0;
    push(v: number): void {
        if (this.length === this.data.length) {
            const d = new Int32Array(this.data.length * 2);
            d.set(this.data);
            this.data = d;
        }
        this.data[this.length++] = v;
    }
    take(): Int32Array {
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
    /** Bounding box of each clip region (bounds of clipped primitives are limited to it). */
    private readonly clipBoxes: Bounds[] = [];
    private readonly images: RasterImage[] = [];
    private readonly imageIds = new Map<RasterImage, number>();
    private image = -1;
    private uv = new GrowF32();
    private readonly entities: string[] = [];
    private readonly bounds = emptyBounds();
    private kind: PrimitiveKind = PrimitiveKind.Triangles;
    /** Clip of the open batch. */
    private clip = -1;
    /** Requested clips: for areas (triangles, lines, images) and for single-pixel points. */
    private areaClip = -1;
    private pointClip = -1;
    private originX = 0;
    private originY = 0;
    private pos = new GrowF32();
    private col = new GrowU8();
    private pick: number[] = [];
    private vertexCount = 0;
    /** Index of the open entity in `entities` (-1: none, or not yet added). */
    private entity = -1;
    /** The open entity, added to `entities` with its first output (no entries for empty ones). */
    private entityId: string | undefined;
    private entityStart = 0;
    /** Maximum vertices per batch (keeps GPU buffers bounded). */
    readonly maxBatchVertices: number;
    /**
     * Record DisplayAnnotations for viewers: `annotate` the drawn texts, `snapping` the snap
     * points. Off by default: plots and the fidelity tests never pay for it.
     */
    annotate = false;
    snapping = false;
    private readonly drawnTexts: DrawnText[] = [];
    /** The text being drawn (beginText … endText): its output's bounds, else undefined. */
    private textBox: Bounds | undefined;
    private textString = "";
    private textClip = -1;
    private textDepth = 0;
    private readonly snapXY = new GrowF64();
    private readonly snapKinds = new GrowI32();
    private readonly snapClips = new GrowI32();

    constructor(pixelSize: number, maxBatchVertices = 1 << 20) {
        this.pixelSize = pixelSize;
        this.maxBatchVertices = maxBatchVertices;
    }

    /** Starts attributing subsequent primitives to an entity (for picking). */
    beginEntity(id: string): void {
        this.closePick();
        this.entity = -1;
        this.entityId = id;
        this.entityStart = this.vertexCount;
    }

    endEntity(): void {
        this.closePick();
        this.entity = -1;
        this.entityId = undefined;
    }

    private closePick(): void {
        if (this.entityId !== undefined && this.vertexCount > this.entityStart) {
            if (this.entity < 0) {
                this.entity = this.entities.length;
                this.entities.push(this.entityId);
            }
            this.pick.push(this.entityStart, this.vertexCount - this.entityStart, this.entity);
        }
        this.entityStart = this.vertexCount;
    }

    addClip(region: ClipRegion): number {
        this.clips.push(region);
        const box = emptyBounds();
        for (const ring of region.rings) {
            for (let i = 0; i + 1 < ring.length; i += 2) {
                const x = ring[i]!;
                const y = ring[i + 1]!;
                if (x < box.minX) box.minX = x;
                if (x > box.maxX) box.maxX = x;
                if (y < box.minY) box.minY = y;
                if (y > box.maxY) box.maxY = y;
            }
        }
        this.clipBoxes.push(box);
        return this.clips.length - 1;
    }

    /**
     * Clips subsequent primitives (-1 = none). `pointClip` (default `clip`) applies to Points
     * batches: single-pixel output of thin geometry is kept when its pixel touches the region,
     * which needs the region dilated by half a pixel (Frontend.pushClip).
     */
    setClip(clip: number, pointClip = clip): void {
        this.areaClip = clip;
        this.pointClip = pointClip;
    }

    private ensure(kind: PrimitiveKind, vertices: number, x: number, y: number, image = -1): void {
        const clip = kind === PrimitiveKind.Points ? this.pointClip : this.areaClip;
        if (
            kind !== this.kind ||
            image !== this.image ||
            clip !== this.clip ||
            this.vertexCount + vertices > this.maxBatchVertices
        ) {
            this.flush();
            this.kind = kind;
            this.image = image;
            this.clip = clip;
        }
        if (this.vertexCount === 0) {
            this.originX = x;
            this.originY = y;
        }
    }

    private unbounded = false;

    /** Subsequent primitives go into batches excluded from bounds (see Batch.unbounded). */
    setUnbounded(on: boolean): void {
        if (on === this.unbounded) return;
        this.flush();
        this.unbounded = on;
    }

    private vertex(x: number, y: number, c: Rgba): void {
        const t = this.textBox;
        if (t) {
            if (x < t.minX) t.minX = x;
            if (x > t.maxX) t.maxX = x;
            if (y < t.minY) t.minY = y;
            if (y > t.maxY) t.maxY = y;
        }
        this.pos.push2(x - this.originX, y - this.originY);
        this.col.push4(c[0], c[1], c[2], c[3]);
        this.vertexCount++;
    }

    /**
     * Adds the bounding box of one primitive (vertices `first` … `first + count − 1` of `xy`) to the
     * bounds, limited to the bounding box of the open batch's clip region; a primitive entirely
     * outside it does not count.
     */
    private addBounds(xy: ArrayLike<number>, first: number, count: number): void {
        if (this.unbounded) return;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let k = first; k < first + count; k++) {
            const x = xy[k * 2]!;
            const y = xy[k * 2 + 1]!;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const c = this.clip >= 0 ? this.clipBoxes[this.clip] : undefined;
        if (c) {
            if (minX < c.minX) minX = c.minX;
            if (minY < c.minY) minY = c.minY;
            if (maxX > c.maxX) maxX = c.maxX;
            if (maxY > c.maxY) maxY = c.maxY;
            if (minX > maxX || minY > maxY) return;
        }
        const b = this.bounds;
        if (minX < b.minX) b.minX = minX;
        if (maxX > b.maxX) b.maxX = maxX;
        if (minY < b.minY) b.minY = minY;
        if (maxY > b.maxY) b.maxY = maxY;
    }

    /** Ends the current batch (the next primitive starts a new one, e.g. per transparent entity). */
    breakBatch(): void {
        this.flush();
    }

    /** The clip region subsequent area primitives get (-1: none). */
    get currentClip(): number {
        return this.areaClip;
    }

    /**
     * Annotations: the output until the matching endText() is the text `text` (nested calls belong
     * to the outermost one). No-ops unless `annotate`.
     */
    beginText(text: string): void {
        if (!this.annotate || this.textDepth++ > 0) return;
        this.textString = text;
        this.textClip = this.areaClip;
        this.textBox = emptyBounds();
    }

    endText(): void {
        if (!this.annotate || this.textDepth === 0 || --this.textDepth > 0) return;
        const b = this.textBox!;
        this.textBox = undefined;
        if (b.minX <= b.maxX && this.textString.trim() !== "")
            this.drawnTexts.push({
                text: this.textString,
                entity: this.entityId ?? "",
                bounds: b,
                clip: this.textClip,
            });
    }

    /** Annotations: a snap point in the current clip (or `clip`). No-op unless `snapping`. */
    snap(x: number, y: number, kind: SnapKind, clip = this.areaClip): void {
        if (!this.snapping || !Number.isFinite(x) || !Number.isFinite(y)) return;
        this.snapXY.push2(x, y);
        this.snapKinds.push(kind);
        this.snapClips.push(clip);
    }

    /** Adds triangles from a flat [x0,y0,x1,y1,x2,y2,…] array (float64 world coordinates). */
    triangles(xy: ArrayLike<number>, color: Rgba): void {
        const n = xy.length >> 1;
        if (n < 3) return;
        this.ensure(PrimitiveKind.Triangles, n - (n % 3), xy[0]!, xy[1]!);
        for (let i = 0; i + 2 < n; i += 3) {
            for (let k = 0; k < 3; k++) this.vertex(xy[(i + k) * 2]!, xy[(i + k) * 2 + 1]!, color);
            this.addBounds(xy, i, 3);
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
            this.addBounds(xy, i, 2);
        }
        if (closed && n > 2) {
            this.vertex(xy[(n - 1) * 2]!, xy[(n - 1) * 2 + 1]!, color);
            this.vertex(xy[0]!, xy[1]!, color);
        }
    }

    /**
     * Adds textured triangles: `xy` as for {@link triangles}, `uv` one (u, v) pair per vertex with
     * (0,0) = top-left corner of the bitmap; `color` multiplies the texels.
     */
    imageTriangles(xy: ArrayLike<number>, uv: ArrayLike<number>, image: RasterImage, color: Rgba): void {
        const n = xy.length >> 1;
        if (n < 3) return;
        let id = this.imageIds.get(image);
        if (id === undefined) {
            id = this.images.length;
            this.images.push(image);
            this.imageIds.set(image, id);
        }
        this.ensure(PrimitiveKind.Image, n - (n % 3), xy[0]!, xy[1]!, id);
        for (let i = 0; i + 2 < n; i += 3) {
            for (let k = 0; k < 3; k++) {
                this.vertex(xy[(i + k) * 2]!, xy[(i + k) * 2 + 1]!, color);
                this.uv.push2(uv[(i + k) * 2]!, uv[(i + k) * 2 + 1]!);
            }
            this.addBounds(xy, i, 3);
        }
    }

    /** Adds single-pixel points [x0,y0,…]. */
    points(xy: ArrayLike<number>, color: Rgba): void {
        const n = xy.length >> 1;
        if (n < 1) return;
        this.ensure(PrimitiveKind.Points, n, xy[0]!, xy[1]!);
        for (let i = 0; i < n; i++) {
            this.vertex(xy[i * 2]!, xy[i * 2 + 1]!, color);
            this.addBounds(xy, i, 1);
        }
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
                ...(this.unbounded ? { unbounded: true } : {}),
                ...(this.kind === PrimitiveKind.Image ? { uvs: this.uv.take(), image: this.image } : {}),
            });
        }
        this.uv = new GrowF32();
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
            images: this.images,
            entities: this.entities,
            ...(this.annotate || this.snapping
                ? {
                      annotations: {
                          texts: this.drawnTexts,
                          snapXY: this.snapXY.take(),
                          snapKinds: Uint8Array.from(this.snapKinds.take()),
                          snapClips: this.snapClips.take(),
                      },
                  }
                : {}),
        };
    }
}
