import { readPng } from "../../testkit/src/png.ts";

for (const f of process.argv.slice(2)) {
  const img = readPng(f) as { width: number; height: number; data: Uint8Array };
  const ch = img.data.length / (img.width * img.height);
  const m = new Map<string, number>();
  for (let i = 0; i < img.width * img.height; i++) {
    const k = [img.data[i * ch], img.data[i * ch + 1], img.data[i * ch + 2]].join(",");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  console.log(f.split("/").slice(-1)[0], [...m].sort((a, b) => b[1] - a[1]).slice(0, 6));
}
