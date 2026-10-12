/** 3D point / vector as used throughout the model (structurally compatible with @truedxf/geometry). */
export interface Point3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface Point2 {
    readonly x: number;
    readonly y: number;
}

export const ORIGIN: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const Z_AXIS: Point3 = Object.freeze({ x: 0, y: 0, z: 1 });
export const X_AXIS: Point3 = Object.freeze({ x: 1, y: 0, z: 0 });

export function point3(x: number, y: number, z = 0): Point3 {
    return { x, y, z };
}

/** ACI special values (note 01 §1.2). */
export const Aci = {
    ByBlock: 0,
    ByLayer: 256,
    ByEntity: 257,
} as const;

/** Lineweight special values (370). */
export const Lineweight = {
    ByLayer: -1,
    ByBlock: -2,
    Default: -3,
} as const;

/** Case-insensitive key for table names and dictionary keys (note 02 §4.2). */
export function nameKey(name: string): string {
    return name.toUpperCase();
}
