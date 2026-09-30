/**
 * Dimension text formatting (note 05 §7). The strings are the MTEXT contents AutoCAD writes into
 * regenerated `*D` blocks — VERIFIED-BY-ACAD against the DXFOUT re-saves of the `dimensions`
 * suite (fmt-*, tol-*, dimalt-*, text-override-*, radius-/diameter-dimpost-*, 2026-09-30).
 */
import type { DimStyleVars } from "./vars.ts";

/** Rounds half away from zero to `dec` decimals (0.5 → 1, 12.0625 → 12.063; fmt-dec-*). */
function roundTo(v: number, dec: number): number {
  const f = 10 ** dec;
  // 14 significant digits absorb binary representation errors of values like 48.36·10^k
  const a = Number((Math.abs(v) * f).toPrecision(14));
  const r = Math.floor(a + 0.5) / f;
  return v < 0 ? -r : r;
}

function fixed(v: number, dec: number): string {
  const r = roundTo(v, dec);
  const s = Math.abs(r).toFixed(Math.max(0, Math.min(dec, 20)));
  return r < 0 && Number(s) !== 0 ? `-${s}` : s;
}

/** DIMZIN bits 4 (leading) / 8 (trailing) on a decimal string with '.' separator. */
function zeroSuppress(s: string, zin: number): string {
  let out = s;
  if (zin & 8 && out.includes(".")) {
    out = out.replace(/0+$/, "");
    if (out.endsWith(".")) out = out.slice(0, -1);
  }
  if (zin & 4) {
    const neg = out.startsWith("-");
    const body = neg ? out.slice(1) : out;
    if (body.startsWith("0.")) out = (neg ? "-" : "") + body.slice(1);
  }
  return out;
}

function withSeparator(s: string, sep: string): string {
  return sep === "." ? s : s.replace(".", sep);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Stacked fraction per DIMFRAC: 0 horizontal `\Sn/d;`, 1 diagonal `\Sn#d;`, 2 not stacked. */
function fraction(n: number, d: number, frac: number, tfac: number): string {
  if (frac === 2) return `${n}/${d}`;
  return `{\\H${num(tfac)}x;\\S${n}${frac === 1 ? "#" : "/"}${d};}`;
}

function num(v: number): string {
  return String(Math.round(v * 1e8) / 1e8);
}

export interface LinearFormat {
  readonly unit: number;
  readonly dec: number;
  readonly zin: number;
  readonly rnd: number;
  readonly sep: string;
  readonly frac: number;
  readonly tfac: number;
}

export function linearFormat(v: DimStyleVars): LinearFormat {
  const dsep = v.num("DIMDSEP");
  return {
    unit: v.num("DIMLUNIT"),
    dec: Math.max(0, v.num("DIMDEC")),
    zin: v.num("DIMZIN"),
    rnd: v.num("DIMRND"),
    // DIMDSEP 0 → '.' (VERIFIED-BY-ACAD fmt-dsep-0, Q-0515)
    sep: dsep > 0 ? String.fromCharCode(dsep) : ".",
    frac: v.num("DIMFRAC"),
    tfac: v.num("DIMTFAC"),
  };
}

/** Formats a linear value (already × DIMLFAC). */
export function formatLinear(value: number, f: LinearFormat): string {
  let x = value;
  if (f.rnd > 0) x = Math.round(x / f.rnd + 1e-9) * f.rnd;
  const neg = x < 0 && Math.abs(x) > 0;
  const a = Math.abs(x);
  let s: string;
  switch (f.unit) {
    case 1: {
      // scientific: 1.2345E+03 (fmt-lunit-1)
      if (a === 0) s = `${fixed(0, f.dec)}E+00`;
      else {
        let e = Math.floor(Math.log10(a));
        let m = roundTo(a / 10 ** e, f.dec);
        if (m >= 10) {
          m /= 10;
          e++;
        }
        const ms = withSeparator(zeroSuppress(m.toFixed(f.dec), f.zin), f.sep);
        s = `${ms}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
      }
      break;
    }
    case 3:
      s = feetInches(a, f, false);
      break;
    case 4:
      s = feetInches(a, f, true);
      break;
    case 5: {
      // fractional: 12{\H1x;\S1/16;}, 1/2 → fraction only (fmt-lunit-5*)
      const d = 2 ** f.dec;
      const t = Math.floor(a * d + 0.5 + 1e-9);
      const whole = Math.floor(t / d);
      const r = t - whole * d;
      if (r === 0) s = String(whole);
      else {
        const g = gcd(r, d);
        const fr = fraction(r / g, d / g, f.frac, f.tfac);
        s = whole === 0 ? fr : f.frac === 2 ? `${whole} ${fr}` : `${whole}${fr}`;
      }
      break;
    }
    case 6: {
      // Windows desktop: the reference machine's locale (',' decimal, '.' grouping; fmt-lunit-6)
      const body = zeroSuppress(fixed(a, f.dec), f.zin);
      const [ip, fp] = body.split(".");
      const grouped = (ip ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      s = fp !== undefined ? `${grouped},${fp}` : grouped;
      break;
    }
    default:
      s = withSeparator(zeroSuppress(fixed(a, f.dec), f.zin), f.sep);
  }
  return neg ? `-${s}` : s;
}

/**
 * Engineering (3) and architectural (4) feet-inch strings (fmt-lunit-3/4, fmt-arch-*): DIMZIN 0
 * suppresses zero feet and zero inches, 1 keeps both, 2 keeps feet only, 3 keeps inches only.
 * A whole-inch 0 before a fraction is written only together with the feet.
 */
function feetInches(a: number, f: LinearFormat, arch: boolean): string {
  const zin = f.zin & 3;
  const keepFeet = zin === 1 || zin === 2;
  const keepInches = zin === 1 || zin === 3;
  let feet: number;
  let inchText: string;
  let inchZero: boolean;
  if (arch) {
    const d = 2 ** f.dec;
    let t = Math.floor(a * d + 0.5 + 1e-9);
    feet = Math.floor(t / (12 * d));
    t -= feet * 12 * d;
    const whole = Math.floor(t / d);
    const r = t - whole * d;
    inchZero = t === 0;
    const showFeet = feet !== 0 || keepFeet;
    if (r === 0) inchText = String(whole);
    else {
      const g = gcd(r, d);
      const fr = fraction(r / g, d / g, f.frac, f.tfac);
      if (whole === 0 && !showFeet) inchText = fr;
      else inchText = f.frac === 2 ? `${whole} ${fr}` : `${whole}${fr}`;
    }
  } else {
    const dec = f.dec;
    let inches = roundTo(a, dec);
    feet = Math.floor(inches / 12 + 1e-12);
    inches = roundTo(inches - feet * 12, dec);
    if (inches >= 12) {
      feet++;
      inches = 0;
    }
    inchZero = inches === 0;
    inchText = withSeparator(zeroSuppress(inches.toFixed(dec), f.zin & 12), f.sep);
  }
  const showFeet = feet !== 0 || keepFeet;
  const showInches = !inchZero || keepInches || !showFeet;
  if (showFeet && showInches) return `${feet}'-${inchText}"`;
  if (showFeet) return `${feet}'`;
  return `${inchText}"`;
}

/** Angular value (radians) per DIMAUNIT / DIMADEC / DIMAZIN (fmt-aunit-*, fmt-azin-*). */
export function formatAngle(rad: number, v: DimStyleVars): string {
  const unit = v.num("DIMAUNIT");
  // DIMADEC −1 gives 0 decimals, not DIMDEC (VERIFIED-BY-ACAD fmt-adec-m1-dec3-nb)
  const dec = Math.max(0, v.num("DIMADEC"));
  const zin = v.num("DIMAZIN");
  const zs = (s: string) => zeroSuppress(s, (zin & 1 ? 4 : 0) | (zin & 2 ? 8 : 0));
  const deg = (Math.abs(rad) * 180) / Math.PI;
  switch (unit) {
    case 1: {
      // DMS precision classes: 0 d°, 1–2 d°m', 3–4 d°m's", ≥5 seconds with dec−4 decimals
      if (dec === 0) return `${Math.floor(deg + 0.5)}\\U+00B0`;
      if (dec <= 2) {
        const t = Math.floor(deg * 60 + 0.5);
        return `${Math.floor(t / 60)}\\U+00B0${t % 60}'`;
      }
      const sd = Math.max(0, dec - 4);
      const f = 10 ** sd;
      const t = Math.floor(deg * 3600 * f + 0.5) / f;
      const d = Math.floor(t / 3600 + 1e-12);
      const m = Math.floor((t - d * 3600) / 60 + 1e-12);
      const s = t - d * 3600 - m * 60;
      return `${d}\\U+00B0${m}'${zs(s.toFixed(sd))}"`;
    }
    case 2:
      return `${zs(fixed((deg * 400) / 360, dec))}g`;
    case 3:
      return `${zs(fixed(Math.abs(rad), dec))}r`;
    default:
      return `${zs(fixed(deg, dec))}\\U+00B0`;
  }
}

/** Replaces the first `<>` of a DIMPOST-like template, or appends it as a suffix. */
function applyPost(post: string, value: string): string {
  if (post === "") return value;
  const i = post.indexOf("<>");
  if (i < 0) return value + post;
  return post.slice(0, i) + value + post.slice(i + 2);
}

function splitPost(post: string): [string, string] {
  const i = post.indexOf("<>");
  if (i < 0) return ["", post];
  return [post.slice(0, i), post.slice(i + 2)];
}

export interface MeasurementText {
  /** MTEXT content; "" = no text. */
  readonly content: string;
  /** Text after `\X` (below the dimension line), undefined if not split. */
  readonly below?: string;
}

/**
 * Full dimension text: measurement (+ automatic prefix, DIMPOST, tolerances/limits, alternate
 * units) and the text override (group 1): "" / "<>" / absent → measured text, " " → none, text
 * with `<>` → first `<>` replaced, otherwise literal (text-override-*; note 05 §1.5).
 */
export function dimensionText(
  v: DimStyleVars,
  override: string | undefined,
  measurement: number,
  kind: "linear" | "angular",
  autoPrefix = "",
): MeasurementText {
  if (override === " ") return { content: "" };
  const text = measuredText(v, measurement, kind, autoPrefix);
  let content: string;
  // \A<DIMTOLJ>; leads every measured text when DIMTOLJ ≠ 0, with or without tolerances
  // (VERIFIED-BY-ACAD sparse-dimstyle-*: imperial DIMTOLJ 1 → "\A1;12.3450"; tol-unequal-j0/1/2-nb)
  const tolj = v.num("DIMTOLJ");
  const lead = tolj !== 0 ? `\\A${tolj};` : "";
  if (override === undefined || override === "" || override === "<>") content = lead + text.full;
  else if (override.includes("<>")) {
    let alt = text.alt;
    let o = override;
    if (alt && o.includes("[]")) {
      o = o.replace("[]", alt);
      alt = "";
    }
    const i = o.indexOf("<>");
    content = lead + o.slice(0, i) + text.primary + alt + o.slice(i + 2);
  } else content = override;
  // `\X` splits the text: above / below the dimension line (text-override-split-nb)
  const x = content.indexOf("\\X");
  if (x >= 0) return { content: content.slice(0, x), below: content.slice(x + 2) };
  return { content };
}

function measuredText(
  v: DimStyleVars,
  measurement: number,
  kind: "linear" | "angular",
  autoPrefix: string,
): { primary: string; alt: string; full: string } {
  const f = linearFormat(v);
  const post = v.str("DIMPOST");
  const lfac = v.num("DIMLFAC");
  // DIMLFAC < 0 applies (as |DIMLFAC|) only in paper space; model-space dims use 1
  // (VERIFIED-BY-ACAD fmt-lfac-m2-nb, fmt-lfac-m2-paperspace-nb; Q-0577)
  const lf = lfac > 0 ? lfac : v.paperSpace ? -lfac : 1;
  const value = kind === "linear" ? measurement * lf : measurement;
  const main = kind === "linear" ? formatLinear(value, f) : formatAngle(value, v);
  // the automatic R / ∅ prefix is dropped when DIMPOST is set (radius-dimpost-*, diameter-dimpost-*)
  const withPrefix = post === "" ? autoPrefix + main : main;
  const [pre, suf] = splitPost(post);
  let primary: string;
  const tfac = v.num("DIMTFAC");
  const txt = v.scaled("DIMTXT");
  const tolH = (s: string) => (tfac === 1 ? s : `{\\H${num(txt * tfac)};${s}}`);
  if (v.bool("DIMLIM") && kind === "linear") {
    const tp = v.num("DIMTP");
    const tm = v.num("DIMTM");
    const up = formatLinear(value + tp, f);
    const lo = formatLinear(value - tm, f);
    primary = pre + tolH(`\\S${up}^ ${lo};`) + suf;
  } else if (v.bool("DIMTOL")) {
    const tp = v.num("DIMTP");
    const tm = v.num("DIMTM");
    const tf: typeof f = { ...f, dec: Math.max(0, v.num("DIMTDEC")), zin: v.num("DIMTZIN") };
    const fmt = (x: number) =>
      kind === "linear" ? formatLinear(x, tf) : formatAngle(x, v).replace("\\U+00B0", "");
    if (tp === tm) {
      primary = `${pre}${withPrefix}±${fmt(tp)}${suf}`;
    } else {
      const sign = (x: number) => (x > 0 ? "+" : x < 0 ? "-" : "");
      const up = `${sign(tp)}${fmt(Math.abs(tp))}`;
      const lo = `${sign(-tm)}${fmt(Math.abs(tm))}`;
      primary = `${pre}${withPrefix}${tolH(`\\S${up}^ ${lo};`)}${suf}`;
    }
  } else primary = applyPost(post, withPrefix);
  let alt = "";
  if (v.bool("DIMALT") && kind === "linear") {
    let a = value * v.num("DIMALTF");
    const arnd = v.num("DIMALTRND");
    if (arnd > 0) a = Math.round(a / arnd + 1e-9) * arnd;
    const af: LinearFormat = {
      ...f,
      unit: v.num("DIMALTU"),
      dec: Math.max(0, v.num("DIMALTD")),
      zin: v.num("DIMALTZ"),
      rnd: 0,
    };
    const as = formatLinear(a, af);
    const apost = v.str("DIMAPOST");
    const ai = apost.indexOf("[]");
    const body = apost === "" ? as : ai < 0 ? as + apost : apost.slice(0, ai) + as + apost.slice(ai + 2);
    // alternate value in brackets after a space (dimalt-plain-nb: "117.35 [2980.69]")
    alt = ` [${body}]`;
  }
  return { primary, alt, full: primary + alt };
}
