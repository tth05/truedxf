/**
 * Classification of differential-oracle disagreement patterns (diff-ezdxf.ts). Every residual
 * pattern must be classified; the triage log is tools/corpus/README.md.
 *
 * - `truedxf-bug`: a truedxf defect still open (fixed ones disappear from the report)
 * - `ezdxf`: ezdxf bug, lenience or load-time normalization; truedxf keeps the file's / AutoCAD's
 *   value (with the reason and a note reference)
 * - `ambiguous`: unclear which side matches AutoCAD; the note references the open question
 * - `dump`: artefact of the normalized dump (same meaning, different representation)
 */
export interface Classification {
  readonly kind: "truedxf-bug" | "ezdxf" | "ambiguous" | "dump";
  readonly note: string;
}

type Rule = [RegExp, Classification["kind"], string];

const RULES: Rule[] = [
  // ---- text decoding (not parsing) -----------------------------------------------------------
  [
    / \[escapes\]$/,
    "ezdxf",
    "ezdxf keeps \\U+XXXX / \\M+NXXXX escapes (R2007+ files, names); truedxf decodes them (note 01 §5.3)",
  ],
  [
    / \[codepage\]$/,
    "ezdxf",
    "ezdxf decodes with $DWGCODEPAGE only; truedxf detects UTF-8 in ANSI files, DBCS code pages and \\M+ (note 01 §5.1, §5.5)",
  ],
  [
    / \[encoded name\]$/,
    "ezdxf",
    "same record, key differs by decoding (\\U+ escapes / code page), so it is missing on both sides (note 01 §5.3, §5.5)",
  ],
  [
    /^table layers missing in ezdxf$/,
    "ezdxf",
    "keys like VERMASSUNG: 'ß' decoded by truedxf and upper-cased to 'SS'; ezdxf kept \\U+00DF (note 01 §5.3)",
  ],
  // ---- resources ezdxf creates on load -------------------------------------------------------
  [
    /^table (layers|linetypes|styles|blockRecords) missing in truedxf$/,
    "ezdxf",
    "ezdxf creates required resources on load (layer 0/Defpoints, BYBLOCK/BYLAYER/Continuous, Standard, *Model_Space/*Paper_Space and arrow block records); truedxf models the file as written",
  ],
  [
    /^block missing in truedxf$/,
    "ezdxf",
    "ezdxf upgrades R13/R14 to R2000 and creates all arrow blocks (_CLOSEDFILLED, …) on load (document.py create_all_arrow_blocks)",
  ],
  [
    /^layout missing in truedxf$/,
    "ezdxf",
    "ezdxf always restores Model + Layout1(+Layout2) layouts; truedxf only synthesizes Layout1 when a paper space block has content",
  ],
  [/^header \$ACADVER$/, "ezdxf", "ezdxf upgrades AC1012/AC1014 → AC1015 and < AC1009 → AC1009 on load"],
  [
    /^header \$\w+ missing in ezdxf$/,
    "ezdxf",
    "ezdxf drops header variables it considers invalid for the version / file (e.g. $MEASUREMENT in R12-style files)",
  ],
  [/^header \$(LIMMIN|LIMMAX)$/, "ezdxf", "ezdxf rewrites model space limits from the layout on load"],
  // ---- ezdxf load-time normalizations --------------------------------------------------------
  [
    /\.paperSpace$/,
    "ezdxf",
    "ezdxf sets 67=1 on every entity of a paper space layout block on load; truedxf reports group 67 as written (ownership comes from file position, note 02 §4.2 rule 12)",
  ],
  [
    /^table layers\.plot$/,
    "ezdxf",
    "ezdxf forces plot=0 on DEFPOINTS; truedxf keeps 290 as written and resolve.ts never plots Defpoints (note 02 §2.1.1)",
  ],
  [
    /^table layers\.color$/,
    "ezdxf",
    "invalid layer color 0: truedxf normalizes 0 → 7 at parse time, ezdxf at render time (`_true_layer_color`, note 06 §3.1); the few others are duplicate layer records (several '0' entries): truedxf keeps the first (note 02 §4.2), ezdxf the last (Q-0085)",
  ],
  [
    /^table layers\.transparency$/,
    "ezdxf",
    "ezdxf looks up XDATA APPIDs case-sensitively (file writes ACCMTRANSPARENCY); APPIDs are case-insensitive table names (note 02 §2.1.2)",
  ],
  [
    /^entity LINE\.lineweight$/,
    "ezdxf",
    "ezdxf replaces invalid lineweights (-116, -98) by BYLAYER; truedxf keeps the raw value (Q-0207)",
  ],
  [
    /^entity TEXT\.style$/,
    "ezdxf",
    "ezdxf.recover replaces undefined text style names by Standard (recover01.dxf)",
  ],
  [/^layout\.tabOrder$/, "ezdxf", "ezdxf forces tab order 0 for the Model layout"],
  [
    /^entity MTEXT missing in ezdxf$/,
    "ezdxf",
    "ezdxf merges R2007+ MTEXT column continuation entities into the first MTEXT on load",
  ],
  [
    /^entity SEQEND missing in truedxf$/,
    "ezdxf",
    "ezdxf keeps a SEQEND after an INSERT without ATTRIBs as a stand-alone entity; truedxf attaches it to the INSERT",
  ],
  [
    /^entity (LWPOLYLINE|TEXT|LINE|POLYLINE|DIMENSION|VIEWPORT|INSERT|IMAGE|SPLINE) missing in (ezdxf|truedxf)$/,
    "ezdxf",
    "ezdxf drops entities it cannot bind (IMAGE without IMAGEDEF, DIMENSION/VIEWPORT with broken refs, handle clashes, invalid SPLINE) or keeps only one of duplicate ENTITIES sections (netDxf sample.dxf); remaining pairs are the other side of such a mis-alignment",
  ],
  [
    /^table styles missing in ezdxf$/,
    "ezdxf",
    "ezdxf does not keep nameless shape-file STYLE entries (flag 1, e.g. ltypeshp.shx) in the style table",
  ],
  [
    /^(table blockRecords|block) missing in ezdxf$/,
    "ezdxf",
    "ezdxf drops nameless BLOCKs and unreferenced *Paper_Space0 / *U blocks",
  ],
  [/^layout missing in ezdxf$/, "ezdxf", "ezdxf drops LAYOUTs whose block record is missing (cc_dxflib.dxf)"],
  // ---- files without $ACADVER: ezdxf parses as R12 and ignores subclass data -----------------
  [
    /^entity (SPLINE|LWPOLYLINE|ATTDEF|INSERT\.attribs\[\] ATTRIB)\.\w+$/,
    "ezdxf",
    "files without $ACADVER (gdal autotest, dxf-parser test data): ezdxf assumes R12 and loses subclass data of R13+ entities; truedxf decides per record by its 100 markers",
  ],
  [
    /^entity SPLINE\.layer$/,
    "ezdxf",
    "no $ACADVER: ezdxf R12 mode loses AcDbEntity data (dxf-parser splines.dxf)",
  ],
  [
    /^entity LWPOLYLINE\.layer$/,
    "ezdxf",
    "no $ACADVER: ezdxf R12 mode loses AcDbEntity data (gdal autotest)",
  ],
  // ---- dump artefacts --------------------------------------------------------------------------
  [/^header \$PSTYLEMODE$/, "dump", "bool header value 8192: truedxf normalizes 290 values to 0/1"],
  [
    /^entity INSERT\.columnCount$/,
    "dump",
    "truedxf reads MINSERT count 0 as 1 by design (note 11b); ezdxf keeps 0",
  ],
  // ---- ambiguous: AutoCAD behaviour unknown ----------------------------------------------------
  [
    /^entity POLYLINE\.vertices\[\]\.location$/,
    "ambiguous",
    "duplicate ENTITIES sections (netDxf sample.dxf, 8×): truedxf concatenates (ezdxf.recover merges), ezdxf.readfile keeps one; AutoCAD unknown (note 01 §8.1)",
  ],
  [
    /^entity TEXT\.height$/,
    "ambiguous",
    "TEXT without group 40: truedxf default 1 (ixmilia), ezdxf 2.5; AutoCAD requires 40 — unknown (Q-0406)",
  ],
  [
    /^table styles\.(name|font)$/,
    "ambiguous",
    "duplicate STYLE records differing in case: truedxf keeps the first, ezdxf the last (Q-0085)",
  ],
  [
    /^header \$CLAYER$/,
    "ambiguous",
    "variable written twice in HEADER: truedxf keeps the first, ezdxf the last (note 01 §7.1)",
  ],
  [
    /^entity POINT\.extrusion$/,
    "ambiguous",
    "210 without 220/230: truedxf defaults the missing components to 0 (note 11a §1), ezdxf.recover drops the tag (ezdxf#933)",
  ],
  [
    /^table linetypes missing in ezdxf$/,
    "ambiguous",
    "duplicate TABLES sections (Virtek.dxf): truedxf reads both, ezdxf keeps one; AutoCAD unknown (note 01 §8.1)",
  ],
  [
    /^layout\.block$/,
    "ambiguous",
    "broken LAYOUT↔BLOCK_RECORD links (recover02.dxf): truedxf relinks by tab order, ezdxf.recover by another rule",
  ],
];

export function classify(key: string): Classification | undefined {
  for (const [re, kind, note] of RULES) if (re.test(key)) return { kind, note };
  return undefined;
}
