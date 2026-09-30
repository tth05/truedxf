/**
 * Linetype patterns for rendering (note 06 §2). The pattern (LTYPE 49 values) is scaled by the
 * entity linetype scale × $LTSCALE and by the uniform scale of the block transform, then walked
 * along the curve in target coordinates.
 *
 * UNVERIFIED (note 06 §2.4): whether INSERT scale scales linetypes (we assume yes, the pattern
 * lives in block space); PSLTSCALE for viewports is handled by the paper-space code path.
 */
import { ComplexRotation, type DashElement, type DashPattern } from "@truedxf/geometry";
import type { DxfDocument, LinetypeEntry } from "@truedxf/model";

export interface LinetypeSpec {
  readonly entry: LinetypeEntry;
  /** Pattern already multiplied by all scale factors (target units). */
  readonly pattern: DashPattern;
  readonly period: number;
}

const CONTINUOUS = new Set(["CONTINUOUS", "BYLAYER", "BYBLOCK", ""]);

export class LinetypeResolver {
  private readonly doc: DxfDocument;
  readonly ltscale: number;
  private readonly cache = new Map<string, LinetypeEntry | null>();

  constructor(doc: DxfDocument) {
    this.doc = doc;
    this.ltscale = doc.header.num("$LTSCALE", 1) || 1;
  }

  entry(name: string): LinetypeEntry | undefined {
    const key = name.toUpperCase();
    if (CONTINUOUS.has(key)) return undefined;
    let e = this.cache.get(key);
    if (e === undefined) {
      const t = this.doc.tables.linetypes.get(name);
      e = t && t.elements.length > 0 && t.elements.some((x) => x.length < 0) ? t : null;
      this.cache.set(key, e);
    }
    return e ?? undefined;
  }

  /**
   * Pattern for a linetype name with the given entity scale and transform scale, or undefined
   * for continuous lines.
   */
  spec(name: string, entityScale: number, transformScale: number): LinetypeSpec | undefined {
    const entry = this.entry(name);
    if (!entry) return undefined;
    const scale = (entityScale || 1) * this.ltscale * transformScale;
    if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
    const elements: DashElement[] = entry.elements.map((el) => {
      const kind = el.flags & 2 ? "text" : el.flags & 4 ? "shape" : undefined;
      if (!kind) return { length: el.length * scale };
      return {
        length: el.length * scale,
        complex: {
          kind,
          rotation: (el.rotation * Math.PI) / 180,
          rotationMode:
            el.flags & 1
              ? ComplexRotation.Absolute
              : el.flags & 8
                ? ComplexRotation.Upright
                : ComplexRotation.Relative,
          offsetX: el.offsetX * scale,
          offsetY: el.offsetY * scale,
          scale: el.scale * scale,
          data: el,
        },
      };
    });
    let period = 0;
    for (const el of elements) period += Math.abs(el.length);
    if (period === 0) return undefined;
    return { entry, pattern: { elements }, period };
  }
}
