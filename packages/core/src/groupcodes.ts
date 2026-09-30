/**
 * Group code → value kind. See research/notes/01-file-format.md §1.2 ("Implementation table").
 */

export const ValueKind = {
  String: 0,
  Double: 1,
  Int16: 2,
  Int32: 3,
  Int64: 4,
  /** 290–299. ASCII "0"/"1"; 1 byte in binary DXF. */
  Bool: 5,
  /** 310–319, 1004. Hex string in ASCII; uint8 length + bytes in binary DXF. */
  Binary: 6,
  /** Hex handle string (5, 105, 320–369, 390–399, 480–481, 1005). */
  Handle: 7,
} as const;
export type ValueKind = (typeof ValueKind)[keyof typeof ValueKind];

export const MAX_GROUP_CODE = 1071;

const KIND_TABLE = new Uint8Array(MAX_GROUP_CODE + 1); // default 0 = String

function fill(kind: ValueKind, from: number, to: number): void {
  KIND_TABLE.fill(kind, from, to + 1);
}

fill(ValueKind.Double, 10, 59);
fill(ValueKind.Double, 110, 149);
fill(ValueKind.Double, 210, 239);
fill(ValueKind.Double, 460, 469);
fill(ValueKind.Double, 1010, 1059);
fill(ValueKind.Int16, 60, 79);
fill(ValueKind.Int16, 170, 179);
// 280–289 are 2 bytes in AutoCAD's binary output (note 01 §1.2), so they are int16
fill(ValueKind.Int16, 270, 289);
fill(ValueKind.Int16, 370, 389);
fill(ValueKind.Int16, 400, 409);
fill(ValueKind.Int16, 1060, 1070);
fill(ValueKind.Int32, 90, 99);
fill(ValueKind.Int32, 420, 429);
fill(ValueKind.Int32, 440, 459);
fill(ValueKind.Int32, 1071, 1071);
fill(ValueKind.Int64, 160, 169);
fill(ValueKind.Bool, 290, 299);
fill(ValueKind.Binary, 310, 319);
fill(ValueKind.Binary, 1004, 1004);
fill(ValueKind.Handle, 5, 5);
fill(ValueKind.Handle, 105, 105);
fill(ValueKind.Handle, 320, 369);
fill(ValueKind.Handle, 390, 399);
fill(ValueKind.Handle, 480, 481);
fill(ValueKind.Handle, 1005, 1005);

/** Value kind of a group code. Codes outside 0..1071 are treated as strings. */
export function valueKind(code: number): ValueKind {
  return code >= 0 && code <= MAX_GROUP_CODE ? (KIND_TABLE[code] as ValueKind) : ValueKind.String;
}

/** Codes that start an (x, y[, z]) point; y = code + 10, z = code + 20. */
export function isPointCode(code: number): boolean {
  return (
    (code >= 10 && code <= 18) ||
    (code >= 110 && code <= 112) ||
    (code >= 210 && code <= 213) ||
    (code >= 1010 && code <= 1013)
  );
}

export function isNumericKind(kind: ValueKind): boolean {
  return kind >= ValueKind.Double && kind <= ValueKind.Bool;
}

/** Well-known structural codes. */
export const Code = {
  Structure: 0,
  Text: 1,
  Name: 2,
  Handle: 5,
  Comment: 999,
  SubclassMarker: 100,
  EmbeddedObject: 101,
  AppData: 102,
  DimStyleHandle: 105,
  Owner: 330,
  XDataAppId: 1001,
  XDataControl: 1002,
} as const;
