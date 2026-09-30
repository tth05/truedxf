import { readFileSync } from "node:fs";
import { ShxFont } from "@truedxf/fonts";

const font = ShxFont.fromBytes(
  new Uint8Array(readFileSync(`C:/Program Files/Autodesk/AutoCAD 2027/Fonts/simplex.shx`)),
  "simplex",
);
for (const ch of ["1", "2", "3", "A", "B", "C", "\n", "\r", "\t", "?"]) {
  const g = font.glyph(ch.charCodeAt(0));
  console.log(JSON.stringify(ch), g?.advance, g?.advanceY, JSON.stringify(g?.bounds));
}
