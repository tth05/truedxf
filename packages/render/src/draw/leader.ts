/**
 * LEADER (research/notes/05-dimensions-leaders.md §11): the stored vertices as straight segments
 * or a fit-point spline, the DIMLDRBLK arrowhead and the unstored extension under MTEXT
 * annotations. Parts are built like dimension block content (dimension/block-builder.ts) and drawn
 * as content of the LEADER, so BYBLOCK resolves to the entity.
 */
import { Matrix44, ocsToWcsMatrix, wcsToOcsMatrix } from "@truedxf/geometry";
import {
    type AttribEntity,
    BY_BLOCK_RAW,
    decodeRawColor,
    type Entity,
    type LeaderEntity,
    type MTextEntity,
    type MultiLeaderEntity,
} from "@truedxf/model";
import { arrowLength } from "../dimension/arrows.ts";
import { BlockBuilder, type Pt } from "../dimension/block-builder.ts";
import { add, DimCtx, len, sub, unit, type Vec } from "../dimension/context.ts";
import { DimStyleVars } from "../dimension/vars.ts";
import { type DrawState, type Frontend, registerDrawer } from "../frontend.ts";
import { annotationFonts, drawGenerated, syntheticBlock } from "./dimension.ts";

function leaderEntities(fe: Frontend, ld: LeaderEntity) {
    const doc = fe.doc;
    const v = new DimStyleVars(doc, ld.dimStyle, ld.overrides);
    const toOcs = wcsToOcsMatrix(ld.normal);
    const pts: Vec[] = ld.vertices.map((p) => {
        const q = toOcs.transformPoint(p);
        return { x: q.x, y: q.y };
    });
    if (pts.length < 2) return undefined;
    const z = toOcs.transformPoint(ld.vertices[0]!).z;
    const w = new BlockBuilder(ld.layer, z, ld.linetypeScale);
    const c = new DimCtx({ doc, fonts: annotationFonts(doc), lineweight: ld.lineweight }, v, w);
    // group 77 is ignored: DIMCLRD BYBLOCK shows the entity colour (VERIFIED-BY-ACAD
    // leaders/leader-77-color-*, Q-0588)
    const props = c.dim;
    const hd = toOcs.transformDirection(ld.horizontalDirection);
    let h = unit({ x: hd.x, y: hd.y });
    if (ld.hookDirection === 1) h = { x: -h.x, y: -h.y };
    const annotation = ld.annotationHandle ? doc.getEntity(ld.annotationHandle) : undefined;
    const mtext =
        ld.creationFlag === 0 && annotation?.type === "MTEXT" ? (annotation as MTextEntity) : undefined;
    // text annotation without a stored hook: AutoCAD adds the hook vertex DIMASZ before the end
    // (VERIFIED-BY-ACAD leaders/leader-hookflag-no-hook-vertex: DXFOUT gains 95,90 and 75 = 1)
    if (mtext && pts.length >= 2) {
        const last = pts[pts.length - 1]!;
        const prev = pts[pts.length - 2]!;
        const seg = unit(sub(last, prev));
        if (Math.abs(seg.x * h.y - seg.y * h.x) > 1e-9) pts.splice(pts.length - 1, 0, add(last, h, -c.asz));
    }
    // extension under the text (not stored): DIMGAP + text width from the last vertex along 211
    // (reversed by 74 = 1) when the text is above the line, even back over a stored hook
    // (VERIFIED-BY-ACAD leaders/leader-hook-211px/mx-74-*; note 05 §11.2 step 4)
    if (mtext && v.num("DIMTAD") !== 0 && ld.textWidth > 0) {
        const last = pts[pts.length - 1]!;
        pts.push(add(last, h, c.gap + ld.textWidth));
    }
    // arrowhead: DIMLDRBLK at vertex 0, omitted when the first segment is shorter than twice the
    // arrow size; the first segment starts at the arrow base
    const arrowName = v.arrow("DIMLDRBLK");
    const first = len(sub(pts[1]!, pts[0]!));
    const drawArrow = ld.arrowhead && first >= 2 * c.asz - 1e-9;
    const dir0 = unit(sub(pts[0]!, pts[1]!));
    const line = [...pts];
    if (drawArrow) line[0] = add(pts[0]!, dir0, -arrowLength(arrowName) * c.asz);
    if (ld.pathType === 1 && line.length > 2) {
        const n = line.length;
        w.splineFit(line, unit(sub(line[1]!, line[0]!)), unit(sub(line[n - 1]!, line[n - 2]!)), props);
    } else {
        for (let k = 0; k + 1 < line.length; k++) w.line(line[k]!, line[k + 1]!, props);
    }
    if (drawArrow) c.arrowNamed(arrowName, pts[0]!, dir0, c.asz);
    return w.build();
}

registerDrawer("LEADER", (fe, e, st: DrawState) => {
    const ld = e as LeaderEntity;
    let cache = fe.caches.get("leader:generated") as
        | Map<LeaderEntity, ReturnType<typeof leaderEntities>>
        | undefined;
    if (!cache) {
        cache = new Map();
        fe.caches.set("leader:generated", cache);
    }
    let ents = cache.get(ld);
    if (!cache.has(ld)) {
        ents = leaderEntities(fe, ld);
        cache.set(ld, ents);
    }
    if (!ents || ents.length === 0) return;
    drawGenerated(fe, syntheticBlock(`*L~${ld.handle || ld.id}`, ents), ocsToWcsMatrix(ld.normal), e, st);
});

export type { Pt };

// ---- MULTILEADER ------------------------------------------------------------------------------

function recordName(fe: Frontend, handle: string | undefined): string {
    if (!handle || handle === "0") return "";
    const rec = fe.doc.byHandle.get(handle.toUpperCase());
    const i = rec ? rec.find(2) : -1;
    return rec && i >= 0 ? rec.store.str(i).trim() : "";
}

/** Raw colour → part colour (ACI; true colours as ACI 7 fallback with the RGB kept). */
function rawPart(raw: number): { color: number; trueColor?: number } {
    const d = decodeRawColor(raw);
    if (d.rgb !== undefined) return { color: 7, trueColor: d.rgb };
    return { color: d.aci ?? 0 };
}

/**
 * MULTILEADER from its context data (note 05 §12.5): leader lines to the landing point plus
 * the dogleg, arrows (per-line override, entity 342, closed filled), MTEXT or block content.
 */
function mleaderEntities(fe: Frontend, ml: MultiLeaderEntity) {
    const ctx = ml.context;
    if (!(Math.abs(ctx.scale) > 1e-12)) return undefined;
    const doc = fe.doc;
    const v = new DimStyleVars(doc, "Standard", undefined);
    const w = new BlockBuilder(ml.layer, 0, ml.linetypeScale);
    const c = new DimCtx({ doc, fonts: annotationFonts(doc), lineweight: ml.lineweight }, v, w);
    const lc = rawPart(ml.leaderColor);
    const P = (p: { x: number; y: number }): Pt => ({ x: p.x, y: p.y });
    if (ml.leaderType !== 0) {
        for (const leader of ctx.leaders) {
            if (!leader.hasLastLeaderLine) continue;
            for (const line of leader.lines) {
                const pts = [...line.vertices.map(P), P(leader.lastLeaderPoint)];
                const color = line.color !== BY_BLOCK_RAW ? rawPart(line.color) : lc;
                const props = { color: color.color, lineweight: line.lineweight ?? ml.leaderLineweight };
                const size = line.arrowSize ?? ctx.arrowSize;
                const override = ml.arrowHeads.find((a) => a.index === line.index)?.handle;
                const arrow = recordName(fe, line.arrowHandle ?? override ?? ml.arrowHandle);
                let draw = pts.length >= 2 && size > 0;
                const first = draw ? len(sub(pts[1]!, pts[0]!)) : 0;
                // no arrowhead unless the first segment is longer than twice its size (note 05 §12.5 step 3)
                if (first <= 2 * size) draw = false;
                const dir0 = draw ? unit(sub(pts[0]!, pts[1]!)) : { x: 1, y: 0 };
                const linePts = [...pts];
                if (draw) linePts[0] = add(pts[0]!, dir0, -arrowLength(arrow) * size);
                if (ml.leaderType === 2 && linePts.length > 2) {
                    const n = linePts.length;
                    w.splineFit(
                        linePts,
                        unit(sub(linePts[1]!, linePts[0]!)),
                        unit(sub(linePts[n - 1]!, linePts[n - 2]!)),
                        props,
                    );
                } else
                    for (let k = 0; k + 1 < linePts.length; k++) w.line(linePts[k]!, linePts[k + 1]!, props);
                // arrows take the leader line colour and lineweight
                if (draw) c.arrowNamed(arrow, pts[0]!, dir0, size, { props });
            }
            // dogleg (landing) for straight leaders with horizontal attachment
            if (
                ml.leaderType === 1 &&
                ml.dogleg &&
                leader.hasDoglegVector &&
                leader.doglegLength > 0 &&
                leader.attachmentDirection === 0
            ) {
                const a = P(leader.lastLeaderPoint);
                w.line(a, add(a, P(leader.doglegVector), leader.doglegLength), {
                    color: lc.color,
                    lineweight: ml.leaderLineweight,
                });
            }
        }
    }
    const mt = ctx.mtext;
    if (ml.contentType === 2 && mt) {
        const style = recordName(fe, mt.styleHandle) || "Standard";
        const tc = rawPart(mt.color);
        const ang = Math.atan2(mt.direction.y, mt.direction.x);
        w.mtext(
            P(mt.insert),
            ctx.textHeight,
            mt.text,
            style,
            ang,
            { color: tc.color },
            {
                attachment: mt.attachment,
                width: mt.width,
            },
        );
    }
    return w.build();
}

registerDrawer("MULTILEADER", (fe, e, st: DrawState) => {
    const ml = e as MultiLeaderEntity;
    let cache = fe.caches.get("mleader:generated") as
        | Map<MultiLeaderEntity, ReturnType<typeof mleaderEntities>>
        | undefined;
    if (!cache) {
        cache = new Map();
        fe.caches.set("mleader:generated", cache);
    }
    if (!cache.has(ml)) cache.set(ml, mleaderEntities(fe, ml));
    const ents = cache.get(ml);
    if (ents && ents.length > 0)
        drawGenerated(fe, syntheticBlock(`*M~${ml.handle || ml.id}`, ents), Matrix44.identity(), e, st);
    // block content: an INSERT of the context block (WCS location, scale, rotation)
    const blk = ml.context.block;
    if (ml.contentType === 1 && blk) {
        const name = recordName(fe, blk.blockRecordHandle);
        const block = name ? fe.doc.getBlock(name) : undefined;
        if (!block) return;
        const b = block.basePoint;
        const local = Matrix44.product(
            Matrix44.translation(blk.insert.x, blk.insert.y, blk.insert.z),
            Matrix44.rotationZ(blk.rotation),
            Matrix44.scaling(blk.scale.x || 1, blk.scale.y || 1, blk.scale.z || 1),
            Matrix44.translation(-b.x, -b.y, -b.z),
        );
        fe.drawBlockContent(block, local, e, st);
        drawBlockAttributes(fe, ml, local, st);
    }
});

/**
 * MULTILEADER block content: attribute values live in the MULTILEADER (330/302 pairs), not in
 * ATTRIBs, so the block's ATTDEFs are drawn with the stored values, transformed like the block
 * (user/studienleistung: the numbers inside the circled leaders).
 */
function drawBlockAttributes(fe: Frontend, ml: MultiLeaderEntity, local: Matrix44, st: DrawState): void {
    if (ml.blockAttributes.length === 0) return;
    const inh = fe.props.inherit(ml, st.inh);
    const m = st.m.multiply(local);
    for (const a of ml.blockAttributes) {
        const def = fe.doc.getEntity(a.attdefHandle) as AttribEntity | undefined;
        if (def?.type !== "ATTDEF" || def.attribFlags & 1) continue;
        const text = { ...def, type: "TEXT", dxfType: "TEXT", text: a.text } as unknown as Entity;
        fe.drawEntities([text], { m, inh, stack: st.stack });
    }
}
