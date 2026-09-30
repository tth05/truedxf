/** Number formatting for the UI. */

export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

/** Coordinates: up to 4 decimals, no trailing zeros, scientific for huge values. */
export function fmtCoord(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e9) return v.toExponential(4);
  return String(Number(v.toFixed(4)));
}
