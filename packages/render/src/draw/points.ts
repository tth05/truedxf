/**
 * PDMODE point symbols (note 03 §3.1): low 3 bits select the figure (0 dot, 1 nothing, 2 +,
 * 3 ×, 4 short vertical tick), +32 circle, +64 square. Size = PDSIZE in target units.
 * UNVERIFIED (note 03): arm lengths of + and × (ezdxf and dxf-viewer disagree) and whether mode
 * 0 is combined with the circle/square frames as a dot.
 */
import type { Path2, PathSegment, Subpath } from "@truedxf/geometry";

export interface PointSymbol {
  /** Draw a single dot at the point. */
  readonly dot: boolean;
  /** Symbol geometry centred at the origin. */
  readonly paths: Path2;
}

function line(x0: number, y0: number, x1: number, y1: number): Subpath {
  return { segments: [{ kind: "line", p0: { x: x0, y: y0 }, p1: { x: x1, y: y1 } }], closed: false };
}

export function pointSymbol(mode: number, size: number): PointSymbol {
  const fig = mode & 7;
  const h = size / 2;
  const subs: Subpath[] = [];
  let dot = false;
  switch (fig) {
    case 0:
      dot = true;
      break;
    case 1:
      break;
    case 2:
      subs.push(line(-h, 0, h, 0), line(0, -h, 0, h));
      break;
    case 3:
      subs.push(line(-h, -h, h, h), line(-h, h, h, -h));
      break;
    case 4:
      subs.push(line(0, 0, 0, h));
      break;
    default:
      dot = true;
  }
  if (mode & 32) {
    const seg: PathSegment = { kind: "arc", center: { x: 0, y: 0 }, radius: h, start: 0, sweep: Math.PI * 2 };
    subs.push({ segments: [seg], closed: true });
  }
  if (mode & 64) {
    subs.push({
      segments: [
        { kind: "line", p0: { x: -h, y: -h }, p1: { x: h, y: -h } },
        { kind: "line", p0: { x: h, y: -h }, p1: { x: h, y: h } },
        { kind: "line", p0: { x: h, y: h }, p1: { x: -h, y: h } },
        { kind: "line", p0: { x: -h, y: h }, p1: { x: -h, y: -h } },
      ],
      closed: true,
    });
  }
  // mode 0 with a frame draws the dot only when no frame? AutoCAD draws the dot plus frame
  return { dot: dot && (mode & 96) === 0 ? true : dot, paths: { subpaths: subs } };
}
