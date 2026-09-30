import { Diagnostics } from "./diagnostics.ts";
import { codepageToEncoding, isNonAsciiUtf8, isUtf8Version } from "./encoding.ts";
import { ValueKind, valueKind } from "./groupcodes.ts";
import type { TagStore } from "./tagstore.ts";
import { type TokenizeOptions, tokenize } from "./tokenizer.ts";

export interface SectionInfo {
  /** Section name, upper-cased (HEADER, CLASSES, TABLES, BLOCKS, ENTITIES, OBJECTS, …). */
  name: string;
  /** Tag index of `(0, SECTION)`. */
  begin: number;
  /** First content tag (after `(2, name)`). */
  start: number;
  /** Tag index of `(0, ENDSEC)`, or of the tag that implicitly closed the section. */
  end: number;
}

/** Finds all sections. Tolerates a missing ENDSEC, content outside sections and duplicates. */
export function scanSections(store: TagStore, diag: Diagnostics): SectionInfo[] {
  const sections: SectionInfo[] = [];
  const n = store.count;
  let current: SectionInfo | undefined;
  let strayReported = false;
  for (let i = 0; i < n; i++) {
    if (store.codes[i] !== 0) continue;
    if (store.valueIs(i, "SECTION")) {
      if (current) {
        diag.warn("missing-endsec", `section ${current.name} not closed by ENDSEC`, { tag: i });
        current.end = i;
        sections.push(current);
      }
      let name = "";
      let start = i + 1;
      if (i + 1 < n && store.codes[i + 1] === 2) {
        name = store
          .str(i + 1)
          .trim()
          .toUpperCase();
        start = i + 2;
      } else {
        diag.error("section-without-name", "SECTION without (2, name)", { tag: i });
      }
      current = { name, begin: i, start, end: n };
    } else if (store.valueIs(i, "ENDSEC")) {
      if (current) {
        current.end = i;
        sections.push(current);
        current = undefined;
      } else {
        diag.warn("stray-endsec", "ENDSEC outside of a section", { tag: i });
      }
    } else if (store.valueIs(i, "EOF")) {
      break;
    } else if (!current && !strayReported) {
      diag.warn("outside-section", "structure tag outside of any section", { tag: i });
      strayReported = true;
    }
  }
  if (current) {
    diag.warn("missing-endsec", `section ${current.name} not closed by ENDSEC`);
    let end = n;
    if (n > 0 && store.codes[n - 1] === 0 && store.valueIs(n - 1, "EOF")) end = n - 1;
    current.end = end;
    sections.push(current);
  }
  const seen = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.name)) diag.warn("duplicate-section", `duplicate section ${s.name}`, { tag: s.begin });
    seen.add(s.name);
  }
  return sections;
}

/** Tag indices of the code-0 tags in `[start, end)`: each starts one record (entity, object, …). */
export function recordStarts(store: TagStore, start: number, end: number): number[] {
  const out: number[] = [];
  const codes = store.codes;
  for (let i = start; i < end; i++) if (codes[i] === 0) out.push(i);
  return out;
}

export interface EncodingInfo {
  acadver: string | undefined;
  dwgcodepage: string | undefined;
  /** Decoder label used for strings. */
  encoding: string;
  /** Per-string fallback when `encoding` is UTF-8 and a string is invalid UTF-8. */
  fallbackEncoding: string | undefined;
  /** How the encoding was chosen. */
  reason: "override" | "utf8-version" | "codepage" | "utf8-heuristic" | "default";
}

/** Value of header variable `name` (the tag after `(9, name)`), searching HEADER first. */
export function findHeaderValueTag(
  store: TagStore,
  sections: SectionInfo[],
  name: string,
): number | undefined {
  const header = sections.find((s) => s.name === "HEADER");
  const ranges: [number, number][] = header ? [[header.start, header.end]] : [];
  ranges.push([0, store.count]); // header vars can appear outside HEADER (ezdxf recover)
  for (const [s, e] of ranges) {
    for (let i = s; i < e - 1; i++) {
      if (store.codes[i] === 9 && store.valueIs(i, name)) return i + 1;
    }
  }
  return undefined;
}

/**
 * Chooses the string encoding (note 01 §5): user override > $ACADVER ≥ AC1021 → UTF-8 (with
 * code page fallback for invalid strings) > $DWGCODEPAGE, unless every non-ASCII string is
 * valid UTF-8 (mislabelled file) > windows-1252.
 */
export function detectEncoding(
  store: TagStore,
  sections: SectionInfo[],
  diag: Diagnostics,
  override?: string,
): EncodingInfo {
  const verTag = findHeaderValueTag(store, sections, "$ACADVER");
  const cpTag = findHeaderValueTag(store, sections, "$DWGCODEPAGE");
  const acadver = verTag !== undefined ? store.str(verTag).trim().toUpperCase() : undefined;
  const dwgcodepage = cpTag !== undefined ? store.str(cpTag).trim() : undefined;
  const cp = codepageToEncoding(dwgcodepage);
  if (dwgcodepage && !cp.known) {
    diag.warn("unknown-codepage", `unknown $DWGCODEPAGE ${dwgcodepage}, using ${cp.encoding}`);
  }
  if (override) {
    return { acadver, dwgcodepage, encoding: override, fallbackEncoding: undefined, reason: "override" };
  }
  if (isUtf8Version(acadver)) {
    return { acadver, dwgcodepage, encoding: "utf-8", fallbackEncoding: cp.encoding, reason: "utf8-version" };
  }
  // pre-R2007: check whether the non-ASCII strings are all valid UTF-8
  let nonAscii = 0;
  let validUtf8 = 0;
  const b = store.bytes;
  for (let i = 0; i < store.count; i++) {
    const kind = valueKind(store.codes[i]!);
    if (kind !== ValueKind.String) continue;
    const s = store.valueStarts[i]!;
    const e = store.valueEnds[i]!;
    let hasHigh = false;
    for (let k = s; k < e; k++) {
      if (b[k]! >= 0x80) {
        hasHigh = true;
        break;
      }
    }
    if (!hasHigh) continue;
    nonAscii++;
    if (isNonAsciiUtf8(b, s, e)) validUtf8++;
    else break;
  }
  if (nonAscii > 0 && validUtf8 === nonAscii && cp.encoding !== "utf-8") {
    diag.warn(
      "utf8-in-codepage-file",
      `file declares ${dwgcodepage ?? "no code page"} (${acadver ?? "no version"}) but all non-ASCII strings are valid UTF-8; decoding as UTF-8`,
    );
    return {
      acadver,
      dwgcodepage,
      encoding: "utf-8",
      fallbackEncoding: cp.encoding,
      reason: "utf8-heuristic",
    };
  }
  return {
    acadver,
    dwgcodepage,
    encoding: cp.encoding,
    fallbackEncoding: undefined,
    reason: dwgcodepage ? "codepage" : "default",
  };
}

export interface ReadTagsOptions extends TokenizeOptions {
  /** Force a string encoding (WHATWG label), bypassing detection. */
  encoding?: string;
}

export interface DxfTags {
  store: TagStore;
  sections: SectionInfo[];
  encoding: EncodingInfo;
  diagnostics: Diagnostics;
}

/** Tokenizes, finds sections and configures the string encoding. */
export function readTags(bytes: Uint8Array, options: ReadTagsOptions = {}): DxfTags {
  const diagnostics = options.diagnostics ?? new Diagnostics();
  const store = tokenize(bytes, { diagnostics });
  const sections = scanSections(store, diagnostics);
  const encoding = detectEncoding(store, sections, diagnostics, options.encoding);
  store.encoding = encoding.encoding;
  store.fallbackEncoding = encoding.fallbackEncoding;
  return { store, sections, encoding, diagnostics };
}
