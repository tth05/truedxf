/** Integer partitions share edges: no overlapping coarse pixels and no uncovered strips. */
export interface Box {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export type Scissor = [x: number, y: number, width: number, height: number];
export function coverageScissors(
    view: Box,
    covered: Box,
    width: number,
    height: number,
): {
    inside: Scissor;
    outside: Scissor[];
} {
    const px = (x: number) =>
        Math.max(0, Math.min(width, Math.round(((x - view.minX) / (view.maxX - view.minX)) * width)));
    const py = (y: number) =>
        Math.max(0, Math.min(height, Math.round(((y - view.minY) / (view.maxY - view.minY)) * height)));
    const x0 = px(covered.minX),
        x1 = px(covered.maxX);
    const y0 = py(covered.minY),
        y1 = py(covered.maxY);
    return {
        inside: [x0, y0, x1 - x0, y1 - y0],
        outside: [
            [0, 0, width, y0],
            [0, y1, width, height - y1],
            [0, y0, x0, y1 - y0],
            [x1, y0, width - x1, y1 - y0],
        ].filter((r) => r[2]! > 0 && r[3]! > 0) as Scissor[],
    };
}
