import { describe, expect, it } from "vitest";
import { ViewerCore } from "../src/protocol.ts";
import { dxf, SAMPLE } from "./helpers.ts";

const none = async () => undefined;

/** R12 drawing with one model and one paper space LINE (67 = 1) and the given $TILEMODE. */
function drawing(tilemode: number | undefined, paper = true): Uint8Array {
    return dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1009
${tilemode === undefined ? "" : `9 $TILEMODE\n70 ${tilemode}`}
0 ENDSEC
0 SECTION
2 ENTITIES
0 LINE
8 0
10 0
20 0
11 10
21 0
${paper ? "0 LINE\n8 0\n67 1\n10 0\n20 0\n11 5\n21 5" : ""}
0 ENDSEC
0 EOF
`);
}

describe("DocumentInfo.activeLayout", () => {
    const active = (bytes: Uint8Array) => new ViewerCore(none, none).load(bytes, "a.dxf").activeLayout;

    it("is the paper layout with $TILEMODE 0, model space with 1", () => {
        const paper = new ViewerCore(none, none).load(drawing(0), "a.dxf");
        const layout = paper.layouts.find((l) => !l.isModel);
        expect(layout).toBeDefined();
        expect(paper.activeLayout).toBe(layout!.name);
        expect(active(drawing(1))).toBe("Model");
    });

    it("treats a missing $TILEMODE like 0 (note 08 §1.3)", () => {
        expect(active(drawing(undefined))).not.toBe("Model");
    });

    it("falls back to model space when paper space is empty", () => {
        expect(active(drawing(0, false))).toBe("Model");
        expect(active(SAMPLE)).toBe("Model");
    });
});
