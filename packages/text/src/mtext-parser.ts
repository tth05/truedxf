/**
 * MTEXT inline code tokenizer (research/notes/04-text-fonts.md §3.3–§3.5).
 *
 * Semantics follow ezdxf's `MTextParser` (whose edge cases were tested in AutoCAD/BricsCAD by its
 * author) plus the note's AutoCAD findings:
 * - `\\ \{ \}` are literal; `{`/`}` push/pop the property context (an unbalanced `}` is ignored);
 * - unknown `\X` commands print backslash + letter verbatim (`\:` renders as-is, ezdxf PR #197);
 * - `\U+XXXX` / `\M+nXXXX` are decoded *inside* the tokenizer, so `\U+005C` is a literal backslash;
 * - carets are decoded here, not as a pre-pass, so that `\S5^6;` stays a stack (ezdxf#889 sample);
 *   `^I` tab, `^J` new paragraph, `^M` ignored, `^ ` literal "^", `^@` ends the text, other control
 *   characters render as "▯" U+25AF (ezdxf mtext.rst);
 * - single-value commands (`\A \C \c \H \W \T \Q`) have an optional `;`, `\f \F \p \S` run to the
 *   next `;` (or the end);
 * - `%%c %%d %%p %%%` are decoded in MTEXT too; `%%nnn`/`%%u` in MTEXT are UNKNOWN and stay literal.
 */
import { caretCode, decodeEscapeAt, type SpecialSymbol } from "./specials.ts";
import type { ColorOverride } from "./types.ts";

export type ParagraphAlign = "default" | "left" | "right" | "center" | "justified" | "distributed";

export interface TabStop {
  /** Position in multiples of the MTEXT char height (40). */
  readonly pos: number;
  readonly kind: "left" | "center" | "right" | "decimal";
}

export interface ParagraphProps {
  /** First-line indent relative to `left`, multiples of the MTEXT char height (40). */
  readonly indent: number;
  readonly left: number;
  readonly right: number;
  readonly align: ParagraphAlign;
  /** Empty = default stops every 4 × h. */
  readonly tabs: readonly TabStop[];
  /** Paragraph spacing before/after (`\pb…,a…;`, units UNKNOWN — note 04 §3.5). */
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  /** Per-paragraph line spacing (`\psa`/`\pse`/`\psm`), undefined = entity setting. */
  readonly lineSpacing:
    | { readonly mode: "atLeast" | "exact" | "multiple"; readonly factor: number }
    | undefined;
}

export const DEFAULT_PARAGRAPH: ParagraphProps = Object.freeze({
  indent: 0,
  left: 0,
  right: 0,
  align: "default",
  tabs: Object.freeze([]) as readonly TabStop[],
  spaceBefore: 0,
  spaceAfter: 0,
  lineSpacing: undefined,
});

/** Inline font request (`\f` / `\F`). */
export interface ContextFont {
  readonly name: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface MTextContext {
  readonly underline: boolean;
  readonly overline: boolean;
  readonly strike: boolean;
  readonly color: ColorOverride | undefined;
  /** `\A`: 0 bottom, 1 center, 2 top. Default bottom (ezdxf; UNKNOWN in AutoCAD, note 04 §8.9). */
  readonly align: 0 | 1 | 2;
  /** Undefined = the style's font. */
  readonly font: ContextFont | undefined;
  /** Absolute cap height. */
  readonly height: number;
  readonly widthFactor: number;
  readonly tracking: number;
  /** Degrees. */
  readonly oblique: number;
  readonly paragraph: ParagraphProps;
}

export interface MTextChar {
  readonly cp: number;
  readonly symbol?: SpecialSymbol | undefined;
  /** A non-printable control character: AutoCAD draws a missing-glyph box (text/caret-codes-mtext). */
  readonly control?: boolean;
}

export type MTextToken =
  | { readonly t: "char"; readonly ch: MTextChar; readonly ctx: MTextContext }
  | { readonly t: "space"; readonly ctx: MTextContext }
  | { readonly t: "nbsp"; readonly ctx: MTextContext }
  | { readonly t: "tab"; readonly ctx: MTextContext }
  | { readonly t: "paragraph"; readonly ctx: MTextContext }
  | { readonly t: "column"; readonly ctx: MTextContext }
  | { readonly t: "dimwrap"; readonly ctx: MTextContext }
  | {
      readonly t: "stack";
      readonly upper: readonly MTextChar[];
      readonly lower: readonly MTextChar[];
      /** "" = no divider (render as plain text). */
      readonly kind: "^" | "/" | "#" | "";
      readonly ctx: MTextContext;
    };

export function defaultContext(height: number, widthFactor = 1, oblique = 0): MTextContext {
  return {
    underline: false,
    overline: false,
    strike: false,
    color: undefined,
    align: 0,
    font: undefined,
    height,
    widthFactor,
    tracking: 1,
    oblique,
    paragraph: DEFAULT_PARAGRAPH,
  };
}

const RE_FLOAT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const RE_INT = /^\d+/;

const SPECIALS: Record<string, [number, SpecialSymbol | undefined]> = {
  c: [0xd8, "diameter"],
  d: [0xb0, "degree"],
  p: [0xb1, "plusminus"],
  "%": [0x25, undefined],
};

/** Tokenizes MTEXT content. */
export function parseMText(content: string, initial: MTextContext): MTextToken[] {
  return new Parser(content, initial).run();
}

class Parser {
  private readonly s: string;
  private i = 0;
  private ctx: MTextContext;
  private readonly stack: MTextContext[] = [];
  private readonly out: MTextToken[] = [];

  constructor(s: string, ctx: MTextContext) {
    this.s = s;
    this.ctx = ctx;
  }

  private emitChar(cp: number, symbol?: SpecialSymbol): void {
    this.out.push({ t: "char", ch: symbol ? { cp, symbol } : { cp }, ctx: this.ctx });
  }

  private emitText(text: string): void {
    for (const c of text) this.emitChar(c.codePointAt(0)!);
  }

  private set(patch: Partial<MTextContext>): void {
    this.ctx = { ...this.ctx, ...patch };
  }

  run(): MTextToken[] {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (c === "\\") {
        this.command();
        continue;
      }
      if (c === "^" && this.i + 1 < s.length) {
        const n = s.charCodeAt(this.i + 1);
        this.i += 2;
        if (n === 32) this.emitChar(0x5e);
        else {
          const code = caretCode(n);
          if (code === 0) {
            this.i = s.length;
            break;
          }
          if (code >= 0x20 && code !== 0x7f) this.emitChar(code);
          else this.control(code);
        }
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        this.i++;
        if (code === 0) {
          this.i = s.length;
          break;
        }
        this.control(code);
        continue;
      }
      if (c === "%" && s[this.i + 1] === "%" && this.i + 2 < s.length) {
        const sp = SPECIALS[s[this.i + 2]!.toLowerCase()];
        if (sp) {
          this.i += 3;
          this.emitChar(sp[0], sp[1]);
          continue;
        }
      }
      if (c === "{") {
        this.i++;
        this.stack.push(this.ctx);
        continue;
      }
      if (c === "}") {
        this.i++;
        const p = this.stack.pop();
        if (p) this.ctx = p;
        continue;
      }
      if (c === " ") {
        this.i++;
        this.out.push({ t: "space", ctx: this.ctx });
        continue;
      }
      const cp = s.codePointAt(this.i)!;
      this.i += cp > 0xffff ? 2 : 1;
      this.emitChar(cp);
    }
    return this.out;
  }

  private control(code: number): void {
    if (code === 9) this.out.push({ t: "tab", ctx: this.ctx });
    else if (code === 10) this.out.push({ t: "paragraph", ctx: this.ctx });
    else if (code === 13) {
      // ^M / CR: ignored (ezdxf docs)
    } else this.out.push({ t: "char", ch: { cp: 0x25af, control: true }, ctx: this.ctx });
  }

  private command(): void {
    const s = this.s;
    const esc = decodeEscapeAt(s, this.i);
    if (esc) {
      this.i += esc[1];
      this.emitText(esc[0]);
      return;
    }
    const cmd = s[this.i + 1];
    if (cmd === undefined) {
      // trailing lone backslash: literal
      this.i++;
      this.emitChar(0x5c);
      return;
    }
    const start = this.i;
    this.i += 2;
    switch (cmd) {
      case "\\":
      case "{":
      case "}":
        this.emitChar(cmd.charCodeAt(0));
        return;
      case "P":
        this.out.push({ t: "paragraph", ctx: this.ctx });
        return;
      case "N":
        this.out.push({ t: "column", ctx: this.ctx });
        return;
      case "X":
        this.out.push({ t: "dimwrap", ctx: this.ctx });
        return;
      case "~":
        this.out.push({ t: "nbsp", ctx: this.ctx });
        return;
      case "L":
      case "l":
        this.set({ underline: cmd === "L" });
        return;
      case "O":
      case "o":
        this.set({ overline: cmd === "O" });
        return;
      case "K":
      case "k":
        this.set({ strike: cmd === "K" });
        return;
      case "S":
        this.stackCmd();
        return;
      case "A": {
        const a = s[this.i];
        if (a !== undefined && ((a >= "0" && a <= "9") || a === "-")) {
          this.i++;
          this.set({ align: a === "1" ? 1 : a === "2" ? 2 : 0 });
        }
        this.terminator();
        return;
      }
      case "C": {
        const m = RE_INT.exec(s.slice(this.i));
        if (!m) break; // "\C+5" is printed verbatim (ezdxf mtext.rst)
        this.i += m[0].length;
        const aci = Number(m[0]);
        if (aci <= 256) this.set({ color: { kind: "aci", aci } });
        this.terminator();
        return;
      }
      case "c": {
        const m = RE_INT.exec(s.slice(this.i));
        if (!m) break;
        this.i += m[0].length;
        // n = R + 256·G + 65536·B (ezdxf; note 04 §3.3 CONFLICT with mlightcad's 0xRRGGBB)
        const n = Number(BigInt(m[0]) & 0xffffffn);
        const rgb = ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
        this.set({ color: { kind: "rgb", rgb } });
        this.terminator();
        return;
      }
      case "H":
        this.set({ height: this.floatOrFactor(this.ctx.height) });
        this.terminator();
        return;
      case "W":
        this.set({ widthFactor: this.floatOrFactor(this.ctx.widthFactor) });
        this.terminator();
        return;
      case "T":
        this.set({ tracking: this.floatOrFactor(this.ctx.tracking) });
        this.terminator();
        return;
      case "Q": {
        const m = RE_FLOAT.exec(s.slice(this.i));
        if (m) {
          this.i += m[0].length;
          this.set({ oblique: Number(m[0]) });
        }
        this.terminator();
        return;
      }
      case "f":
      case "F":
        this.fontCmd(this.expression(false));
        return;
      case "p":
        this.paragraphCmd(this.expression(false));
        return;
    }
    // unknown command (or invalid argument): print verbatim
    this.i = start + 2;
    this.emitChar(0x5c);
    this.emitChar(cmd.codePointAt(0)!);
  }

  private terminator(): void {
    if (this.s[this.i] === ";") this.i++;
  }

  private floatOrFactor(current: number): number {
    const m = RE_FLOAT.exec(this.s.slice(this.i));
    if (!m) return current;
    this.i += m[0].length;
    const v = Math.abs(Number(m[0]));
    if (this.s[this.i] === "x") {
      this.i++;
      return current * v;
    }
    return v;
  }

  /** Text up to the next `;` (optionally skipping `\;`), consuming the `;`. */
  private expression(skipEscaped: boolean): string {
    const s = this.s;
    let j = this.i;
    while (j < s.length) {
      if (skipEscaped && s[j] === "\\" && s[j + 1] === ";") {
        j += 2;
        continue;
      }
      if (s[j] === ";") break;
      j++;
    }
    const expr = s.slice(this.i, j);
    this.i = Math.min(s.length, j + 1);
    return expr;
  }

  private fontCmd(expr: string): void {
    const parts = expr.split("|");
    const name = parts[0] ?? "";
    // an empty family name does not change the font (ezdxf)
    if (name.trim() === "") return;
    let bold = false;
    let italic = false;
    for (const p of parts.slice(1)) {
      if (p.startsWith("b")) bold = p === "b1";
      else if (p.startsWith("i")) italic = p === "i1";
    }
    this.set({ font: { name, bold, italic } });
  }

  private paragraphCmd(expr: string): void {
    let { indent, left, right, align, tabs, spaceBefore, spaceAfter, lineSpacing } = this.ctx.paragraph;
    const d = DEFAULT_PARAGRAPH;
    let k = 0;
    const num = (): number | undefined => {
      if (expr[k] === "*") {
        k++;
        return undefined;
      }
      const m = RE_FLOAT.exec(expr.slice(k));
      if (!m) return 0;
      k += m[0].length;
      return Number(m[0]);
    };
    const commas = () => {
      while (expr[k] === ",") k++;
    };
    while (k < expr.length) {
      const c = expr[k++]!;
      if (c === "i") indent = num() ?? d.indent;
      else if (c === "l") left = num() ?? d.left;
      else if (c === "r") right = num() ?? d.right;
      else if (c === "b") spaceBefore = num() ?? d.spaceBefore;
      else if (c === "a") spaceAfter = num() ?? d.spaceAfter;
      else if (c === "q") {
        const a = expr[k++];
        align =
          a === "l"
            ? "left"
            : a === "r"
              ? "right"
              : a === "c"
                ? "center"
                : a === "j"
                  ? "justified"
                  : a === "d"
                    ? "distributed"
                    : "default";
      } else if (c === "s") {
        const m = expr[k];
        if (m === "*") {
          k++;
          lineSpacing = undefined;
        } else if (m === "a" || m === "e" || m === "m") {
          k++;
          const f = num();
          lineSpacing =
            f === undefined
              ? undefined
              : { mode: m === "a" ? "atLeast" : m === "e" ? "exact" : "multiple", factor: f };
        }
      } else if (c === "t") {
        const out: TabStop[] = [];
        if (expr[k] === "z") k++; // `tz`: clear tab stops (mlightcad)
        while (k < expr.length) {
          const p = expr[k]!;
          if (p === ",") {
            k++;
            continue;
          }
          let kind: TabStop["kind"] = "left";
          if (p === "r" || p === "c" || p === "d") {
            kind = p === "r" ? "right" : p === "c" ? "center" : "decimal";
            k++;
          }
          const m = RE_FLOAT.exec(expr.slice(k));
          if (!m) {
            // tab list ends at the next letter
            if (/[a-z*]/i.test(expr[k] ?? "")) break;
            k++;
            continue;
          }
          k += m[0].length;
          out.push({ pos: Number(m[0]), kind });
        }
        tabs = out;
      }
      // `x` and unknown letters are skipped
      commas();
    }
    this.set({ paragraph: { indent, left, right, align, tabs, spaceBefore, spaceAfter, lineSpacing } });
  }

  private stackCmd(): void {
    const expr = this.expression(true);
    const upper: MTextChar[] = [];
    const lower: MTextChar[] = [];
    let kind: "^" | "/" | "#" | "" = "";
    for (let k = 0; k < expr.length; k++) {
      let c = expr[k]!;
      let escaped = false;
      if (c === "\\" && k + 1 < expr.length) {
        // backslashes inside stacks are ignored except as an escape (note 04 §3.4)
        escaped = true;
        c = expr[++k]!;
      }
      if (!escaped && c === "^" && k + 1 < expr.length && expr[k + 1] !== " ") {
        // "^X" is a caret code even inside a stack: "\S5^6;" is "5?" without divider
        // (VERIFIED-BY-ACAD mtext/stack-caret-nospace; the ezdxf#889 assumption was wrong)
        const code = caretCode(expr.charCodeAt(++k));
        (kind === "" ? upper : lower).push({ cp: code < 0x20 || code === 0x7f ? 0x3f : code });
        continue;
      }
      if (!escaped && kind === "" && (c === "^" || c === "/" || c === "#")) {
        kind = c;
        // "^ " is the caret-escape form of the divider: the space belongs to the divider
        if (c === "^" && expr[k + 1] === " ") k++;
        continue;
      }
      const code = c.charCodeAt(0);
      const ch = { cp: code < 0x20 ? 0x20 : code };
      (kind === "" ? upper : lower).push(ch);
    }
    this.out.push({ t: "stack", upper, lower, kind, ctx: this.ctx });
  }
}

/** Inline font commands of an MTEXT string (for preloading fonts before layout). */
export function inlineFonts(content: string): ContextFont[] {
  const out: ContextFont[] = [];
  const seen = new Set<string>();
  const ctx = defaultContext(1);
  for (const t of parseMText(content, ctx)) {
    const f = t.ctx.font;
    if (!f) continue;
    const key = `${f.name}|${f.bold}|${f.italic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
