/**
 * Axis-aligned bounding boxes. Curve-specific exact boxes live next to each curve type
 * (arcs by quadrant crossings, ellipses analytically, Béziers/NURBS by extrema) — note 03 §6.
 *
 * `Bounds2`/`Bounds3` are small mutable accumulators; an empty box has min = +∞, max = −∞.
 */

import type { Vec2, Vec3 } from "./vec.ts";

export class Bounds2 {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;

    static of(points: Iterable<Vec2>): Bounds2 {
        const b = new Bounds2();
        for (const p of points) b.addXY(p.x, p.y);
        return b;
    }

    isEmpty(): boolean {
        return !(this.minX <= this.maxX && this.minY <= this.maxY);
    }

    addXY(x: number, y: number): this {
        if (x < this.minX) this.minX = x;
        if (x > this.maxX) this.maxX = x;
        if (y < this.minY) this.minY = y;
        if (y > this.maxY) this.maxY = y;
        return this;
    }

    addPoint(p: Vec2): this {
        return this.addXY(p.x, p.y);
    }

    /** Add interleaved xy points. */
    addPoints(xy: Float64Array): this {
        for (let i = 0; i + 1 < xy.length; i += 2) this.addXY(xy[i]!, xy[i + 1]!);
        return this;
    }

    addBounds(b: Bounds2): this {
        if (b.isEmpty()) return this;
        this.addXY(b.minX, b.minY);
        return this.addXY(b.maxX, b.maxY);
    }

    containsXY(x: number, y: number, tol = 0): boolean {
        return x >= this.minX - tol && x <= this.maxX + tol && y >= this.minY - tol && y <= this.maxY + tol;
    }

    get width(): number {
        return this.maxX - this.minX;
    }

    get height(): number {
        return this.maxY - this.minY;
    }

    clone(): Bounds2 {
        const b = new Bounds2();
        b.minX = this.minX;
        b.minY = this.minY;
        b.maxX = this.maxX;
        b.maxY = this.maxY;
        return b;
    }
}

export class Bounds3 {
    minX = Infinity;
    minY = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    maxZ = -Infinity;

    static of(points: Iterable<Vec3>): Bounds3 {
        const b = new Bounds3();
        for (const p of points) b.addXYZ(p.x, p.y, p.z);
        return b;
    }

    isEmpty(): boolean {
        return !(this.minX <= this.maxX && this.minY <= this.maxY && this.minZ <= this.maxZ);
    }

    addXYZ(x: number, y: number, z: number): this {
        if (x < this.minX) this.minX = x;
        if (x > this.maxX) this.maxX = x;
        if (y < this.minY) this.minY = y;
        if (y > this.maxY) this.maxY = y;
        if (z < this.minZ) this.minZ = z;
        if (z > this.maxZ) this.maxZ = z;
        return this;
    }

    addPoint(p: Vec3): this {
        return this.addXYZ(p.x, p.y, p.z);
    }

    addBounds(b: Bounds3): this {
        if (b.isEmpty()) return this;
        this.addXYZ(b.minX, b.minY, b.minZ);
        return this.addXYZ(b.maxX, b.maxY, b.maxZ);
    }

    containsXYZ(x: number, y: number, z: number, tol = 0): boolean {
        return (
            x >= this.minX - tol &&
            x <= this.maxX + tol &&
            y >= this.minY - tol &&
            y <= this.maxY + tol &&
            z >= this.minZ - tol &&
            z <= this.maxZ + tol
        );
    }
}
