/**
 * Effective DIMSTYLE variables of a DIMENSION / LEADER / TOLERANCE and the resources they name
 * (research/notes/05-dimensions-leaders.md §2–§3): DSTYLE XDATA override > DIMSTYLE record >
 * AutoCAD's imperial defaults. Handles (arrow blocks, text style, linetypes) are resolved to names.
 */
import { type DimValue, type DimVars, type DxfDocument, effectiveDimStyle } from "@truedxf/model";

export class DimStyleVars {
  readonly doc: DxfDocument;
  readonly vars: DimVars;
  /** DIMSCALE (0 → 1: no viewport scale for model-space regeneration, note 05 §14). */
  readonly scale: number;

  constructor(doc: DxfDocument, styleName: string, overrides: ReadonlyMap<number, DimValue> | undefined) {
    this.doc = doc;
    // an undefined style name falls back to Standard (ASSUMPTION, Q-0509)
    const entry = doc.tables.dimstyles.get(styleName) ?? doc.tables.dimstyles.get("Standard");
    this.vars = effectiveDimStyle(entry, overrides);
    const s = this.num("DIMSCALE");
    this.scale = s > 0 ? s : 1;
  }

  num(name: string): number {
    const v = this.vars[name];
    return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0;
  }

  bool(name: string): boolean {
    const v = this.vars[name];
    return typeof v === "boolean" ? v : Number(v) !== 0;
  }

  str(name: string): string {
    const v = this.vars[name];
    return typeof v === "string" ? v : String(v ?? "");
  }

  /** A size variable multiplied by DIMSCALE. */
  scaled(name: string): number {
    return this.num(name) * this.scale;
  }

  /** Name of the table record a handle-valued variable points to ("" = none / default). */
  private recordName(handle: string): string {
    const h = handle.trim().toUpperCase();
    if (h === "" || h === "0") return "";
    const rec = this.doc.byHandle.get(h);
    if (!rec) return "";
    const i = rec.find(2);
    return i >= 0 ? rec.store.str(i).trim() : "";
  }

  /**
   * Arrow block name for DIMBLK / DIMBLK1 / DIMBLK2 / DIMLDRBLK: "" = closed filled. R2000+
   * handles win; R12 files name the block in codes 5/6/7 (note 05 §2.1).
   */
  arrow(which: "DIMBLK" | "DIMBLK1" | "DIMBLK2" | "DIMLDRBLK"): string {
    const h = this.str(which);
    if (h !== "" && h !== "0") {
      const n = this.recordName(h);
      if (n) return n;
    }
    // R2000+ ignore the R12 name codes 5/6/7, also in DSTYLE overrides (VERIFIED-BY-ACAD
    // dimensions/arrow-catalog-r2018-names-nb: closed filled SOLIDs)
    if (which === "DIMLDRBLK" || this.doc.header.str("$ACADVER", "AC1009") > "AC1009") return "";
    return this.str(`${which}_NAME`).trim();
  }

  /** Arrow blocks of the two dimension-line ends (DIMSAH selects DIMBLK1/2). */
  arrows(): [string, string] {
    if (this.bool("DIMSAH")) return [this.arrow("DIMBLK1"), this.arrow("DIMBLK2")];
    const b = this.arrow("DIMBLK");
    return [b, b];
  }

  /** Text style name (DIMTXSTY), "Standard" when absent. */
  textStyle(): string {
    return this.recordName(this.str("DIMTXSTY")) || "Standard";
  }

  /** Linetype name of DIMLTYPE / DIMLTEX1 / DIMLTEX2, undefined = BYBLOCK (the default). */
  linetype(which: "DIMLTYPE" | "DIMLTEX1" | "DIMLTEX2"): string | undefined {
    const n = this.recordName(this.str(which));
    return n || undefined;
  }
}
