import { describe, expect, it } from "vitest";
import { DrawOrder } from "../src/draworder.ts";
import { line, modelDoc } from "./helpers.ts";

function sortTable(pairs: [string, string][]): string {
    return `0 SORTENTSTABLE
5 90
330 91
100 AcDbSortentsTable
330 1F
${pairs.map(([e, s]) => `331 ${e}\n5 ${s}`).join("\n")}`;
}

const order = (doc: ReturnType<typeof modelDoc>) =>
    new DrawOrder(doc).entities(doc.modelSpace).map((e) => e.handle);

describe("DrawOrder", () => {
    const ents = [line("30", 0, 0, 1, 1), line("2F", 0, 0, 1, 1), line("31", 0, 0, 1, 1)].join("\n");

    it("keeps file order without a SORTENTSTABLE", () => {
        expect(order(modelDoc({ entities: ents }))).toEqual(["30", "2F", "31"]);
    });

    it("sorts by sort handle, numeric hex, unlisted entities by own handle", () => {
        const doc = modelDoc({
            entities: ents,
            objects: sortTable([
                ["31", "9"],
                ["2F", "100"],
            ]),
        });
        // 31 → 9, 30 → 30 (own), 2F → 100
        expect(order(doc)).toEqual(["31", "30", "2F"]);
    });

    it("keeps file order for equal keys", () => {
        const doc = modelDoc({
            entities: ents,
            objects: sortTable([
                ["2F", "FFFF"],
                ["30", "FFFF"],
                ["31", "FFFF"],
            ]),
        });
        expect(order(doc)).toEqual(["30", "2F", "31"]);
    });

    it("ignores the table when $SORTENTS lacks the plotting bit", () => {
        const doc = modelDoc({
            entities: ents,
            header: "9 $SORTENTS\n280 95",
            objects: sortTable([["31", "1"]]),
        });
        expect(order(doc)).toEqual(["30", "2F", "31"]);
    });
});
