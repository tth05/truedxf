/**
 * Raw 32-bit AcCmColor values as used by MULTILEADER / MLEADERSTYLE (90–93 …) and the
 * HATCHBACKGROUNDCOLOR XDATA: high byte = method, low 24 bits = data (note 05 §12, 06 §1.10).
 */

export const RawColorMethod = {
    ByLayer: 0xc0,
    ByBlock: 0xc1,
    Rgb: 0xc2,
    Aci: 0xc3,
    /** "window background" (MTEXT background in MLEADER). */
    WindowBackground: 0xc8,
} as const;

export interface DecodedRawColor {
    /** High byte (0xC0 ByLayer, 0xC1 ByBlock, 0xC2 RGB, 0xC3 ACI, 0xC8 window background, other = unknown). */
    readonly method: number;
    /** ACI: 0 ByBlock, 256 ByLayer, 1..255; undefined for RGB / background / unknown. */
    readonly aci: number | undefined;
    /** 0xRRGGBB for method RGB. */
    readonly rgb: number | undefined;
}

export const BY_LAYER_RAW = -1073741824;
export const BY_BLOCK_RAW = -1056964608;

export function decodeRawColor(raw: number): DecodedRawColor {
    const v = raw >>> 0;
    const method = (v >>> 24) & 0xff;
    switch (method) {
        case RawColorMethod.ByLayer:
            return { method, aci: 256, rgb: undefined };
        case RawColorMethod.ByBlock:
            return { method, aci: 0, rgb: undefined };
        case RawColorMethod.Aci:
            return { method, aci: v & 0xff, rgb: undefined };
        case RawColorMethod.Rgb:
            return { method, aci: undefined, rgb: v & 0xffffff };
        default:
            return { method, aci: undefined, rgb: undefined };
    }
}
