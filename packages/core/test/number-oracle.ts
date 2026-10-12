// Pre-optimization number parser, retained as an exact differential oracle.
export function parseAsciiNumberOracle(b: Uint8Array, s: number, e: number): number {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    while (e > s && (b[e - 1] === 32 || b[e - 1] === 9 || b[e - 1] === 13)) e--;
    if (s >= e) return Number.NaN;
    // integer fast path
    let i = s;
    let neg = false;
    if (b[i] === 45) {
        neg = true;
        i++;
    } else if (b[i] === 43) i++;
    let v = 0;
    const digitsStart = i;
    while (i < e) {
        const c = b[i]! - 48;
        if (c < 0 || c > 9) break;
        v = v * 10 + c;
        i++;
    }
    const digits = i - digitsStart;
    if (i === e)
        return digits > 0 && digits < 16 ? (neg ? -v : v) : digits > 0 ? Number(latin1(b, s, e)) : Number.NaN;
    // decimal fast path (Clinger): mantissa of ≤ 15 digits is exact, 10^k is exact, and one IEEE
    // division is correctly rounded, so the result equals Number(str).
    if (b[i] === 46) {
        let j = i + 1;
        let mant = v;
        let scale = 1;
        while (j < e) {
            const c = b[j]! - 48;
            if (c < 0 || c > 9) break;
            mant = mant * 10 + c;
            scale *= 10;
            j++;
        }
        const fracDigits = j - i - 1;
        if (j === e && digits + fracDigits <= 15 && digits + fracDigits > 0) {
            const r = mant / scale;
            return neg ? -r : r;
        }
    }
    return parseNumberString(latin1(b, s, e));
}

const STRTOD_PREFIX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * Number() for well-formed values, else C `strtod` semantics after removing inner whitespace
 * (seen in the wild: "0.0l", "1.000000000000000E 20"; note 01 §1.4). Hex/binary literals and
 * "Infinity", which Number() would accept, are not DXF numbers.
 */
function parseNumberString(str: string): number {
    if (!/^[+-]?(?:0[xXbBoO]|Infinity)/.test(str)) {
        const n = Number(str);
        if (!Number.isNaN(n)) return n;
    }
    const m = STRTOD_PREFIX.exec(str.replace(/\s+/g, ""));
    return m ? Number(m[0]) : Number.NaN;
}

function latin1(b: Uint8Array, s: number, e: number): string {
    let out = "";
    for (let k = s; k < e; k++) out += String.fromCharCode(b[k]!);
    return out;
}
