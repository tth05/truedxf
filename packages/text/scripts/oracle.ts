/**
 * Compares our layout with AutoCAD's own computed values in the DXFOUT re-saves of the reference
 * harness (samples/refs/<build>/<suite>/<case>.dxf): TEXT first alignment point 10 (and FIT 41 /
 * ALIGNED 40), MTEXT extents 42/43 (note 04 §1.4, §3.6.1).
 *
 *   node packages/text/scripts/oracle.ts [--suite text|mtext|attribs] [--case substr] [-v]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codepageToEncoding } from "@truedxf/core";
import { type AttribEntity, type Entity, loadDxf, type MTextEntity, type TextEntity } from "@truedxf/model";
import { inlineFonts, mtextExtents, TextFonts, textFrame } from "../src/index.ts";
import { localFontManager } from "./local-fonts.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const REFS = join(ROOT, "samples", "refs");
const args = process.argv.slice(2);
const suites = args.includes("--suite") ? [args[args.indexOf("--suite") + 1]!] : ["text", "attribs", "mtext"];
const caseFilter = args.includes("--case") ? args[args.indexOf("--case") + 1]! : "";
const verbose = args.includes("-v");

const build = existsSync(REFS) ? readdirSync(REFS).sort().at(-1) : undefined;
if (!build) {
    console.log("no references");
    process.exit(0);
}
const hideArg = args.includes("--hide") ? args[args.indexOf("--hide") + 1]! : "";
const manager = localFontManager(hideArg ? new RegExp(hideArg, "i") : undefined);
let n = 0;
let bad = 0;
const fmt = (v: number) => v.toFixed(4);
for (const suite of suites) {
    const dir = join(REFS, build, suite);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith(".dxf") || !f.includes(caseFilter)) continue;
        const doc = loadDxf(new Uint8Array(readFileSync(join(dir, f))));
        const enc = codepageToEncoding(doc.header.str("$DWGCODEPAGE", "ANSI_1252")).encoding;
        const fonts = new TextFonts(
            manager,
            [...doc.tables.styles].filter((s) => !s.isShapeFile),
            enc,
        );
        const all: Entity[] = [];
        for (const b of doc.blocks) all.push(...b.entities);
        for (const e of all)
            if (e.type === "INSERT") all.push(...(e as unknown as { attribs: AttribEntity[] }).attribs);
        const specs = all
            .filter((e) => e.type === "MTEXT")
            .flatMap((e) => inlineFonts((e as MTextEntity).text));
        await fonts.prepare(specs);
        for (const e of all) {
            if (e.type === "TEXT" || e.type === "ATTRIB" || e.type === "ATTDEF") {
                const t = e as TextEntity;
                if (t.halign === 0 && t.valign === 0) continue;
                const tf = textFrame(t, fonts);
                if (!tf) continue;
                n++;
                const p = tf.frame.apply({ x: 0, y: 0 });
                let err = Math.hypot(p.x - t.insert.x, p.y - t.insert.y) / t.height;
                let extra = "";
                if (t.halign === 5) {
                    err = Math.abs(tf.widthFactor - t.widthFactor) / t.widthFactor; // 10 stays p1 for FIT
                    extra = ` w ours ${fmt(tf.widthFactor)} acad ${fmt(t.widthFactor)}`;
                } else if (t.halign === 3) {
                    err = Math.abs(tf.height - t.height) / t.height;
                    extra = ` h ours ${fmt(tf.height)} acad ${fmt(t.height)}`;
                }
                const ok = err < 1e-3;
                if (!ok) bad++;
                if (!ok || verbose)
                    console.log(
                        `${ok ? "ok " : "BAD"} ${suite}/${f} ${e.type} ${JSON.stringify(t.text)} 72=${t.halign} 73=${t.valign} ` +
                            `10 ours (${fmt(p.x)}, ${fmt(p.y)}) acad (${fmt(t.insert.x)}, ${fmt(t.insert.y)}) err ${err.toExponential(2)} h${extra}`,
                    );
            } else if (e.type === "MTEXT") {
                const m = e as MTextEntity;
                if (m.rectWidth === undefined || m.rectHeight === undefined) continue;
                const x = mtextExtents(m, fonts);
                n++;
                const err =
                    Math.max(Math.abs(x.width - m.rectWidth), Math.abs(x.height - m.rectHeight)) / m.height;
                const ok = err < 1e-3;
                if (!ok) bad++;
                if (!ok || verbose)
                    console.log(
                        `${ok ? "ok " : "BAD"} ${suite}/${f} MTEXT ${JSON.stringify(m.text.slice(0, 60))} ` +
                            `42/43 ours ${fmt(x.width)}/${fmt(x.height)} acad ${fmt(m.rectWidth)}/${fmt(m.rectHeight)} (${x.lines} lines) err ${err.toExponential(2)} h`,
                    );
            }
        }
    }
}
console.log(`${n} checked, ${bad} mismatches (> 1e-3 h)`);
