import { readFileSync } from "node:fs";
import { ShxFont } from "@truedxf/fonts";

const font = ShxFont.fromBytes(
  new Uint8Array(readFileSync(`C:/Program Files/Autodesk/AutoCAD 2027/Fonts/simplex.shx`)),
  "simplex",
);
for (const ch of ["/", "1", "3", "2", "4", "X", "5"]) {
  const g = font.glyph(ch.charCodeAt(0));
  console.log(
    JSON.stringify(ch),
    g?.advance,
    JSON.stringify(g?.bounds),
    JSON.stringify(g?.strokes.map((s) => s.vertices.map((v) => [v.x, v.y]))),
  );
}
