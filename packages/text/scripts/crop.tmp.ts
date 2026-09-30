import { readPng, writePng } from "../../testkit/src/png.ts";

const [file, out, x0, y0, x1, y1] = process.argv.slice(2);
const img = readPng(file!) as { width: number; height: number; data: Uint8Array; channels?: number };
const ch = img.data.length / (img.width * img.height);
const X0 = +x0!,
  Y0 = +y0!,
  W = +x1! - X0,
  H = +y1! - Y0;
const data = new Uint8Array(W * H * ch);
for (let y = 0; y < H; y++)
  data.set(
    img.data.subarray(((Y0 + y) * img.width + X0) * ch, ((Y0 + y) * img.width + X0 + W) * ch),
    y * W * ch,
  );
writePng(out!, { ...img, width: W, height: H, data } as never);
