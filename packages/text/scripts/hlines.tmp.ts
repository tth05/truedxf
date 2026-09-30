import { readPng } from "../../testkit/src/png.ts";

const [file, minRun = "40"] = process.argv.slice(2);
const img = readPng(file!);
const { width, height, data } = img as { width: number; height: number; data: Uint8Array };
const ch = data.length / (width * height);
for (let y = 0; y < height; y++) {
  let run = 0,
    start = 0;
  for (let x = 0; x <= width; x++) {
    const dark = x < width && data[(y * width + x) * ch]! < 128;
    if (dark) {
      if (run === 0) start = x;
      run++;
    } else {
      if (run >= Number(minRun))
        console.log(
          `row ${y} x ${start}..${x - 1} (world y ${(149.95 - (y + 0.5) / 10).toFixed(2)}, x ${(-0.05 + start / 10).toFixed(2)}..${(-0.05 + x / 10).toFixed(2)})`,
        );
      run = 0;
    }
  }
}
