import { readPng } from "../../testkit/src/png.ts";

const [file, y0s, y1s, minRun = "30"] = process.argv.slice(2);
const img = readPng(file!) as { width: number; height: number; data: Uint8Array };
const ch = img.data.length / (img.width * img.height);
const y0 = +y0s!,
  y1 = +y1s!;
const cols: number[] = [];
for (let x = 0; x < img.width; x++) {
  let run = 0,
    best = 0;
  for (let y = y0; y < y1; y++) {
    if (img.data[(y * img.width + x) * ch]! < 128 || img.data[(y * img.width + x) * ch + 1]! < 128) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  if (best >= +minRun) cols.push(x);
}
console.log(cols.join(" "));
