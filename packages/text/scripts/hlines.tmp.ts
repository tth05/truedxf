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
          `row ${y} x ${start}..${x - 1} (world y ${(Number(process.env.TOP ?? 149.95) - (y + 0.5) / Number(process.env.PPU ?? 10)).toFixed(3)}, x ${(Number(process.env.LEFT ?? -0.05) + start / Number(process.env.PPU ?? 10)).toFixed(3)}..${(Number(process.env.LEFT ?? -0.05) + x / Number(process.env.PPU ?? 10)).toFixed(3)})`,
        );
      run = 0;
    }
  }
}
