/**
 * Draw order of a block's entities (note 06 §8, note 02 §3.12).
 *
 * VERIFIED-BY-ACAD (draworder suite, 2026-09-30):
 * - Without a SORTENTSTABLE AutoCAD draws in **file order**, not handle order
 *   (draworder/file-vs-handle-*).
 * - With a SORTENTSTABLE (block record xdict `ACAD_SORTENTS`) every entity is keyed by its sort
 *   handle if listed, else by its own handle; ascending numeric (hex) order
 *   (draworder/sortents-hex-compare, sortents-unlisted); equal keys keep file order
 *   (draworder/sortents-duplicate). Sort handle "0" is an ordinary key 0, drawn first
 *   (draworder/sortents-zero-handle). Entries for unknown entities are ignored.
 * - The table is honoured for plotting only when `$SORTENTS` has bit 32 ("plotting")
 *   (draworder/sortents-000, -095 unsorted; -111, -127 sorted). Default 127.
 * - Block definitions honour their own SORTENTSTABLE (draworder/block-sortents).
 */
import type { Block, DxfDocument, Entity, SortEntsObject } from "@truedxf/model";

const SORTENTS_PLOT = 32;

function hexKey(h: string): bigint {
    try {
        return BigInt(`0x${h || "0"}`);
    } catch {
        return 0n;
    }
}

/** SORTENTSTABLEs by block record handle (upper case). */
function sortTables(doc: DxfDocument): Map<string, SortEntsObject> {
    const out = new Map<string, SortEntsObject>();
    for (const o of doc.objects) {
        if (o.type !== "SORTENTSTABLE") continue;
        const t = o as SortEntsObject;
        if (t.blockRecordHandle) out.set(t.blockRecordHandle.toUpperCase(), t);
    }
    return out;
}

export class DrawOrder {
    private readonly tables: Map<string, SortEntsObject>;
    private readonly enabled: boolean;
    private readonly cache = new Map<Block, readonly Entity[]>();

    constructor(doc: DxfDocument) {
        this.enabled = (doc.header.num("$SORTENTS", 127) & SORTENTS_PLOT) !== 0;
        this.tables = this.enabled ? sortTables(doc) : new Map();
    }

    /** The block's entities in plot draw order. */
    entities(block: Block): readonly Entity[] {
        let out = this.cache.get(block);
        if (out) return out;
        out = block.entities;
        const brh = block.blockRecord?.handle?.toUpperCase();
        const table = brh ? this.tables.get(brh) : undefined;
        if (table && table.pairs.length > 0) {
            const map = new Map<string, bigint>();
            for (const [ent, sort] of table.pairs) map.set(ent.toUpperCase(), hexKey(sort));
            const keyed = block.entities.map((e, i) => ({
                e,
                i,
                k: map.get(e.handle.toUpperCase()) ?? hexKey(e.handle),
            }));
            keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));
            out = keyed.map((x) => x.e);
        }
        this.cache.set(block, out);
        return out;
    }
}
