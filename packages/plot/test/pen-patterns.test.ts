import { describe, expect, it } from "vitest";
import {
    fillStyleInk,
    fillStyleTileSize,
    PEN_LINETYPES,
    PlotFillStyle,
    penLinetypeDashes,
} from "../src/index.ts";

const IN = 25.4;

/** Dashes as [start, end] in inches, rounded to 1/1000 in. */
function inches(linetype: number, lengthIn: number, adaptive = false): [number, number][] | undefined {
    const r = (v: number) => Math.round((v / IN) * 1000) / 1000;
    return penLinetypeDashes(linetype, lengthIn * IN, adaptive)?.map((d) => [r(d.start), r(d.end)]);
}

describe("pen linetypes (note 06 §6.7)", () => {
    it("has 31 definitions, 0 continuous, ISO types fitted to 0.5 in", () => {
        expect(PEN_LINETYPES).toHaveLength(31);
        expect(penLinetypeDashes(0, 10)).toBeUndefined();
        expect(penLinetypeDashes(31, 10)).toBeUndefined();
        expect(PEN_LINETYPES[1]!.fitLength).toBeCloseTo(0.25);
        expect(PEN_LINETYPES[21]!.fitLength).toBe(0.5);
    });

    it("starts fixed patterns at phase 0 and cuts them at the end", () => {
        expect(inches(1, 1)).toEqual([
            [0, 0.15],
            [0.25, 0.4],
            [0.5, 0.65],
            [0.75, 0.9],
        ]);
        expect(inches(1, 0.12)).toEqual([[0, 0.12]]);
        expect(inches(2, 0.25)).toEqual([
            [0, 0],
            [0.1, 0.1],
            [0.2, 0.2],
        ]);
    });

    it("fits whole periods in adaptive mode, starting mid-dash", () => {
        expect(inches(1, 1, true)).toEqual([
            [0, 0.075],
            [0.175, 0.325],
            [0.425, 0.575],
            [0.675, 0.825],
            [0.925, 1],
        ]);
        // 1.1 in = round(4.4) = 4 periods scaled by 1.1.
        expect(inches(1, 1.1, true)![1]).toEqual([0.193, 0.358]);
        // ISO Dash on 0.12 in: N = 1 of 0.5 in, s = 0.24; not symmetric at the end.
        expect(inches(17, 0.12, true)).toEqual([
            [0, 0.028],
            [0.043, 0.099],
            [0.113, 0.12],
        ]);
    });
});

describe("fill styles (note 06 §6.8)", () => {
    const ink = (style: number) => {
        const rows: string[] = [];
        for (let v = 4; v >= 0; v--) {
            let row = "";
            for (let u = 0; u < 5; u++) row += fillStyleInk(style, u, v) ? "#" : ".";
            rows.push(row);
        }
        return rows;
    };

    it("draws device-pixel tiles", () => {
        expect(ink(PlotFillStyle.Checkerboard)).toEqual(["#####", "#...#", "#...#", "#...#", "#####"]);
        expect(ink(PlotFillStyle.SquareDots)).toEqual([".....", ".....", ".....", "##...", "##..."]);
        expect(ink(PlotFillStyle.SlantRight)).toEqual(["....#", "...#.", "..#..", ".#...", "#...."]);
        expect(fillStyleInk(PlotFillStyle.SlantRight, 23, 3)).toBe(true);
        expect(fillStyleInk(PlotFillStyle.SlantLeft, 17, 3)).toBe(true);
        expect(fillStyleInk(PlotFillStyle.Crosshatch, -10, 7)).toBe(true);
        expect(fillStyleInk(undefined, 3, 3)).toBe(true);
        expect(fillStyleTileSize(PlotFillStyle.Diamonds)).toBe(20);
    });
});
