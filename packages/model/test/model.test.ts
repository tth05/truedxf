import { describe, expect, it } from "vitest";
import { ENTITY_PARSERS, readBase } from "../src/entities/common.ts";
import {
    DxfDocument,
    type InsertEntity,
    type LineEntity,
    type LwPolylineEntity,
    type PolylineEntity,
    type TextEntity,
} from "../src/index.ts";

const enc = new TextEncoder();

/** Builds a DXF from [code, value] pairs. */
function dxf(...tags: (string | number)[][]): Uint8Array {
    return enc.encode(`${tags.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}`).join("\r\n")}\r\n`);
}

const R2000_HEADER = [
    [0, "SECTION"],
    [2, "HEADER"],
    [9, "$ACADVER"],
    [1, "AC1015"],
    [9, "$INSBASE"],
    [10, 1],
    [20, 2],
    [30, 3],
    [9, "$LTSCALE"],
    [40, 2.5],
    [0, "ENDSEC"],
];

describe("DxfDocument", () => {
    it("preserves external attribute base extras and their absent-default precedence", () => {
        const doc = DxfDocument.load(
            dxf([0, "SECTION"], [2, "ENTITIES"], [0, "ATTDEF"], [2, "tag"], [0, "ENDSEC"], [0, "EOF"]),
        );
        const rec = doc.modelSpace.entities[0]!.record;
        const base = { ...readBase(rec), text: "base text", height: 99, prompt: "ignored", custom: 7 };
        const parsed = ENTITY_PARSERS.get("ATTDEF")!(
            rec,
            base,
            {
                diagnostics: doc.diagnostics,
                acadver: doc.acadver,
            },
            undefined,
        ) as unknown as Record<string, unknown>;
        expect(parsed.text).toBe("base text");
        expect(parsed.height).toBe(99);
        expect(parsed.prompt).toBe("");
        expect(parsed.custom).toBe(7);
        expect(parsed.tag).toBe("tag");
    });

    it("retains first entity registration across lazy lookup and public parsing", () => {
        const load = (handles: string[]) =>
            DxfDocument.load(
                dxf(
                    [0, "SECTION"],
                    [2, "ENTITIES"],
                    ...handles.flatMap((handle, index) => [
                        [0, "LINE"],
                        [5, handle],
                        [10, index],
                        [20, 0],
                        [11, 1],
                        [21, 1],
                    ]),
                    [0, "ENDSEC"],
                    [0, "EOF"],
                ),
            );
        const doc = load(["A", "A", "0"]);
        const first = doc.modelSpace.entities[0]!;
        // The public raw-record index is mutable; entity registration stays independent.
        doc.byHandle.clear();
        const b = load(["B"]).modelSpace.entities[0]!;
        const parsed = doc.parseEntities([b.record])[0]!;
        expect(doc.getEntity("A")).toBe(first);
        expect(doc.getEntity("0")).toBe(doc.modelSpace.entities[2]);
        expect(doc.getEntity("B")).toBe(parsed);
        expect(doc.getEntity("D")).toBeUndefined();
        const c = load(["C"]).modelSpace.entities[0]!;
        const later = doc.parseEntities([c.record])[0]!;
        expect(doc.getEntity("C")).toBe(later);
        const formerlyMissing = load(["D"]).modelSpace.entities[0]!;
        const addedMissing = doc.parseEntities([formerlyMissing.record])[0]!;
        expect(doc.getEntity("D")).toBe(addedMissing);
        const extra = load(Array.from({ length: 12 }, (_, i) => `E${i}`));
        const registered = doc.parseEntities(extra.modelSpace.entities.map((e) => e.record));
        for (const entity of registered) expect(doc.getEntity(entity.handle)).toBe(entity);
        expect(doc.getEntity("A")).toBe(first);
        const afterFullIndex = load(["F"]).modelSpace.entities[0]!;
        const last = doc.parseEntities([afterFullIndex.record])[0]!;
        expect(doc.getEntity("F")).toBe(last);
    });

    it("omits absent optional base fields while retaining explicit zero and false values", () => {
        const doc = DxfDocument.load(
            dxf(
                [0, "SECTION"],
                [2, "ENTITIES"],
                [0, "CIRCLE"],
                [10, 1],
                [20, 2],
                [40, 3],
                [0, "CIRCLE"],
                [420, 0],
                [440, 0],
                [430, ""],
                [410, ""],
                [390, "0"],
                [347, "0"],
                [60, 0],
                [67, 0],
                [10, 4],
                [20, 5],
                [40, 6],
                [0, "ENDSEC"],
                [0, "EOF"],
            ),
        );
        const absent = doc.modelSpace.entities[0]!;
        for (const name of [
            "trueColor",
            "colorName",
            "transparency",
            "layoutName",
            "plotStyleHandle",
            "materialHandle",
            "extensionDictionary",
            "proxyGraphics",
        ])
            expect(Object.hasOwn(absent, name)).toBe(false);
        expect(absent.trueColor).toBeUndefined();
        const explicit = doc.modelSpace.entities[1]!;
        expect(explicit.trueColor).toBe(0);
        expect(explicit.transparency).toBe(0);
        expect(explicit.colorName).toBe("");
        expect(explicit.layoutName).toBe("");
        expect(explicit.plotStyleHandle).toBe("0");
        expect(explicit.materialHandle).toBe("0");
        expect(explicit.invisible).toBe(false);
        expect(explicit.paperSpace).toBe(false);
    });

    it("loads entities into model and paper space", () => {
        const doc = DxfDocument.load(
            dxf(
                ...R2000_HEADER,
                [0, "SECTION"],
                [2, "ENTITIES"],
                [0, "LINE"],
                [5, "1F"],
                [330, "1A"],
                [100, "AcDbEntity"],
                [8, "Walls"],
                [62, 1],
                [100, "AcDbLine"],
                [10, 1],
                [20, 2],
                [30, 0],
                [11, 3],
                [21, 4],
                [31, 0],
                [0, "LINE"],
                [100, "AcDbEntity"],
                [67, 1],
                [8, "0"],
                [100, "AcDbLine"],
                [10, 0],
                [20, 0],
                [11, 1],
                [21, 1],
                [0, "ENDSEC"],
                [0, "EOF"],
            ),
        );
        expect(doc.header.num("$LTSCALE", 1)).toBe(2.5);
        expect(doc.header.point("$INSBASE", { x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 2, z: 3 });
        const line = doc.modelSpace.entities[0] as LineEntity;
        expect(line.type).toBe("LINE");
        expect(line.handle).toBe("1F");
        expect(line.owner).toBe("1A");
        expect(line.layer).toBe("Walls");
        expect(line.color).toBe(1);
        expect(line.linetype).toBe("BYLAYER");
        expect(line.start).toEqual({ x: 1, y: 2, z: 0 });
        expect(line.end).toEqual({ x: 3, y: 4, z: 0 });
        expect(doc.paperSpace?.entities).toHaveLength(1);
        expect(doc.getEntity("1F")).toBe(line);
        expect(doc.layouts.map((l) => l.name)).toEqual(["Model", "Layout1"]);
    });

    it("reads R12 entities without subclass markers", () => {
        const doc = DxfDocument.load(
            dxf(
                [0, "SECTION"],
                [2, "ENTITIES"],
                [0, "TEXT"],
                [8, "T"],
                [10, 5],
                [20, 6],
                [40, 2.5],
                [1, "Hello"],
                [72, 1],
                [11, 7],
                [21, 8],
                [73, 2],
                [0, "POLYLINE"],
                [8, "0"],
                [66, 1],
                [70, 1],
                [0, "VERTEX"],
                [8, "0"],
                [10, 0],
                [20, 0],
                [42, 1],
                [0, "VERTEX"],
                [8, "0"],
                [10, 1],
                [20, 0],
                [0, "SEQEND"],
                [8, "0"],
                [0, "ENDSEC"],
                [0, "EOF"],
            ),
        );
        const [text, poly] = doc.modelSpace.entities as [TextEntity, PolylineEntity];
        expect(doc.acadver).toBe("AC1009");
        expect(text.text).toBe("Hello");
        expect(text.halign).toBe(1);
        expect(text.valign).toBe(2);
        expect(text.alignPoint).toEqual({ x: 7, y: 8, z: 0 });
        expect(poly.closed).toBe(true);
        expect(poly.vertices.map((v) => v.bulge)).toEqual([1, 0]);
        expect(poly.seqend?.type).toBe("SEQEND");
    });

    it("parses LWPOLYLINE vertices with widths and bulges", () => {
        const doc = DxfDocument.load(
            dxf(
                ...R2000_HEADER,
                [0, "SECTION"],
                [2, "ENTITIES"],
                [0, "LWPOLYLINE"],
                [100, "AcDbEntity"],
                [8, "0"],
                [100, "AcDbPolyline"],
                [90, 2],
                [70, 129],
                [43, 0.5],
                [10, 0],
                [20, 0],
                [42, 0.25],
                [10, 2],
                [20, 1],
                [40, 0.1],
                [41, 0.2],
                [0, "ENDSEC"],
                [0, "EOF"],
            ),
        );
        const p = doc.modelSpace.entities[0] as LwPolylineEntity;
        expect(p.closed).toBe(true);
        expect(p.flags & 128).toBe(128);
        expect(p.constantWidth).toBe(0.5);
        expect(p.vertices).toEqual([
            { x: 0, y: 0, startWidth: -1, endWidth: -1, bulge: 0.25, id: undefined },
            { x: 2, y: 1, startWidth: 0.1, endWidth: 0.2, bulge: 0, id: undefined },
        ]);
    });

    it("reads tables, blocks with inserts and attributes, and app-data groups", () => {
        const doc = DxfDocument.load(
            dxf(
                ...R2000_HEADER,
                [0, "SECTION"],
                [2, "TABLES"],
                [0, "TABLE"],
                [2, "LAYER"],
                [5, "2"],
                [100, "AcDbSymbolTable"],
                [70, 1],
                [0, "LAYER"],
                [5, "10"],
                [102, "{ACAD_XDICTIONARY"],
                [360, "11"],
                [102, "}"],
                [330, "2"],
                [100, "AcDbSymbolTableRecord"],
                [100, "AcDbLayerTableRecord"],
                [2, "Walls"],
                [70, 1],
                [62, -3],
                [6, "Dashed"],
                [290, 0],
                [1001, "AcCmTransparency"],
                [1071, 33554559],
                [0, "ENDTAB"],
                [0, "ENDSEC"],
                [0, "SECTION"],
                [2, "BLOCKS"],
                [0, "BLOCK"],
                [5, "20"],
                [100, "AcDbEntity"],
                [8, "0"],
                [100, "AcDbBlockBegin"],
                [2, "Door"],
                [70, 2],
                [10, 1],
                [20, 1],
                [30, 0],
                [0, "LINE"],
                [100, "AcDbEntity"],
                [8, "0"],
                [100, "AcDbLine"],
                [10, 0],
                [20, 0],
                [11, 1],
                [21, 0],
                [0, "ENDBLK"],
                [5, "21"],
                [100, "AcDbEntity"],
                [8, "0"],
                [100, "AcDbBlockEnd"],
                [0, "ENDSEC"],
                [0, "SECTION"],
                [2, "ENTITIES"],
                [0, "INSERT"],
                [100, "AcDbEntity"],
                [8, "0"],
                [100, "AcDbBlockReference"],
                [66, 1],
                [2, "door"],
                [10, 5],
                [20, 5],
                [41, 2],
                [50, 90],
                [0, "ATTRIB"],
                [100, "AcDbEntity"],
                [8, "0"],
                [100, "AcDbText"],
                [10, 5],
                [20, 5],
                [40, 1],
                [1, "D1"],
                [100, "AcDbAttribute"],
                [280, 0],
                [2, "NO"],
                [70, 0],
                [280, 1],
                [0, "SEQEND"],
                [100, "AcDbEntity"],
                [8, "0"],
                [0, "ENDSEC"],
                [0, "EOF"],
            ),
        );
        const layer = doc.tables.layers.get("WALLS")!;
        expect(layer.name).toBe("Walls");
        expect(layer.off).toBe(true);
        expect(layer.frozen).toBe(true);
        expect(layer.color).toBe(3);
        expect(layer.plot).toBe(false);
        expect(layer.linetype).toBe("Dashed");
        expect(layer.transparency).toBe(33554559);
        expect(layer.record.extensionDictionary).toBe("11");
        const block = doc.getBlock("DOOR")!;
        expect(block.basePoint).toEqual({ x: 1, y: 1, z: 0 });
        expect(block.entities).toHaveLength(1);
        const ins = doc.modelSpace.entities[0] as InsertEntity;
        expect(ins.blockName).toBe("door");
        expect(ins.scale).toEqual({ x: 2, y: 1, z: 1 });
        expect(ins.attribs).toHaveLength(1);
        expect(ins.attribs[0]!.tag).toBe("NO");
        expect(ins.attribs[0]!.text).toBe("D1");
        expect(ins.attribs[0]!.lockPosition).toBe(true);
    });

    it("never throws on garbage", () => {
        const doc = DxfDocument.load(enc.encode("hello\nworld\n  0\nLINE\n 10\nabc\n"));
        expect(doc.modelSpace.entities).toHaveLength(0);
        expect(doc.diagnostics.items.length).toBeGreaterThan(0);
    });
});
