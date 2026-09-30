export { ByteReader, ByteWriter, FontFormatError, latin1, latin1Bytes, toArrayBuffer } from "./bytes.ts";
export {
  addArc,
  arcSegments,
  type BulgeArc,
  bulgeToArc,
  type FlattenOptions,
  flattenPath,
  flattenStrokes,
  pathBounds,
  strokesBounds,
} from "./geom.ts";
export {
  ChainFontProvider,
  DirectoryFontProvider,
  type FontFileSystem,
  type FontProvider,
  MemoryFontProvider,
} from "./provider.ts";
export {
  FontManager,
  type FontManagerOptions,
  type FontSubstitution,
  type ResolvedGlyph,
  type ResolvedStyle,
  StyleFont,
  type StyleFontSpec,
  type SubstitutionReason,
} from "./resolve.ts";
export {
  assemble,
  type DisassembleResult,
  disassemble,
  octantByte,
  type ShapeOp,
  VECTOR_DIRECTIONS,
} from "./shx/bytecode.ts";
export { ShxFont, type ShxFontOptions } from "./shx/font.ts";
export {
  decodeFontInfo,
  type ShxFile,
  type ShxFontInfo,
  type ShxKind,
  type ShxShape,
  SIGNATURES,
} from "./shx/format.ts";
export {
  type InterpretOptions,
  type InterpretResult,
  interpretBytes,
  interpretOps,
  type PenRounding,
  type ShapeSource,
} from "./shx/interpret.ts";
export { isShx, parseShx } from "./shx/parse.ts";
export {
  type CompileOptions,
  type CompileResult,
  compileShp,
  decompileShx,
  opToShp,
  ShpSyntaxError,
} from "./shx/shp.ts";
export { bigfontSlots, bigfontTableSize, writeShx } from "./shx/write.ts";
export { TtfFont, type TtfFontOptions, type TtfMetrics } from "./ttf/font.ts";
export { extractFace, faceCount, isCollection, isSfnt, readNames, type SfntNames } from "./ttf/sfnt.ts";
export type {
  Bounds,
  Font,
  FontKind,
  Glyph,
  GlyphOptions,
  OutlineGlyph,
  PathCommand,
  Polyline,
  Stroke,
  StrokeGlyph,
  StrokeVertex,
} from "./types.ts";
