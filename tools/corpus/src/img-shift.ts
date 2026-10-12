import { readPng } from "../../../packages/testkit/src/png.ts";

const [a, b] = [readPng(process.argv[2]!), readPng(process.argv[3]!)];
const ink = (img: typeof a, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
    const i = (y * img.width + x) * 4;
    return img.data[i]! < 250 || img.data[i + 1]! < 250 || img.data[i + 2]! < 250;
};
const bbox = (img: typeof a) => {
    let x0 = 1e9,
        y0 = 1e9,
        x1 = -1,
        y1 = -1,
        n = 0;
    for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++)
            if (ink(img, x, y)) {
                n++;
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x);
                y1 = Math.max(y1, y);
            }
    return { x0, y0, x1, y1, n };
};
console.log("ours", bbox(a), "acad", bbox(b));
let best = { dx: 0, dy: 0, s: -1 };
for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
        let s = 0;
        for (let y = 0; y < a.height; y += 1)
            for (let x = 0; x < a.width; x++) if (ink(a, x, y) && ink(b, x + dx, y + dy)) s++;
        if (s > best.s) best = { dx, dy, s };
    }
console.log("best shift acad = ours +", best);
