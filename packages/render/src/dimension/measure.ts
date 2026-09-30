/**
 * Text metrics for dimension layout. AutoCAD positions dimension text by its MTEXT frame: the
 * insertion point (attachment 5) is the frame centre, the frame height is the MTEXT extents
 * height (cap/ink top to the last line's ink bottom) and gaps around text use the ink width
 * (note 05 §5.3; VERIFIED-BY-ACAD dimensions/fit-*: offsets DIMGAP + h/2, gaps w/2 + DIMGAP).
 */
import { type MTextInput, mtextExtents, type TextFontSource } from "@truedxf/text";

export interface TextBox {
  /** Ink width of the text (0 for empty text). */
  readonly width: number;
  /** MTEXT frame height. */
  readonly height: number;
}

const Z = { x: 0, y: 0, z: 1 };
const O = { x: 0, y: 0, z: 0 };

export function mtextInput(content: string, height: number, style: string, attachment = 5): MTextInput {
  return {
    text: content,
    insert: O,
    height,
    width: 0,
    definedHeight: 0,
    attachment,
    flowDirection: 1,
    style,
    extrusion: Z,
    direction: undefined,
    rotation: 0,
    lineSpacingStyle: 1,
    lineSpacingFactor: 1,
    bgFlags: 0,
    bgColor: 0,
    bgTrueColor: undefined,
    bgScale: 1,
  };
}

export function measureText(
  fonts: TextFontSource | undefined,
  content: string,
  height: number,
  style: string,
): TextBox {
  if (content === "") return { width: 0, height: 0 };
  if (!fonts) {
    // no fonts: a rough estimate keeps the layout sane (0.8 h per character)
    return { width: content.length * height * 0.8, height };
  }
  const e = mtextExtents(mtextInput(content, height, style), fonts, { dimension: true });
  return { width: e.width, height: e.height };
}
