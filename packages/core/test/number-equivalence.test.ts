import fc from "fast-check";
import { expect, it } from "vitest";
import { parseAsciiNumber } from "../src/index.ts";
import { parseAsciiNumberOracle } from "./number-oracle.ts";

function check(bytes: Uint8Array, start = 0, end = bytes.length): void {
    expect(Object.is(parseAsciiNumber(bytes, start, end), parseAsciiNumberOracle(bytes, start, end))).toBe(
        true,
    );
}

function latinBytes(text: string): Uint8Array {
    return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

it("matches the old parser bit for bit on random decimal strings", () => {
    const digits = fc
        .array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 20 })
        .map((d) => d.join(""));
    const mantissa = fc.tuple(digits, fc.integer({ min: -1, max: 20 })).map(([d, point]) => {
        if (point < 0) return d;
        const at = Math.min(point, d.length);
        return `${d.slice(0, at)}.${d.slice(at)}`;
    });
    const exponent = fc.oneof(
        fc.constant(""),
        fc.tuple(fc.constantFrom("e", "E"), fc.constantFrom("", "+", "-"), digits).map((p) => p.join("")),
        fc.constantFrom("e+22", "E-22", "e+23", "e-23", "e0", "E 20", "e", "E+", "e-00002"),
    );
    const space = fc.constantFrom("", " ", "\t", " \t ", "\r", "\n", "\v", "\f", "\u00a0");
    fc.assert(
        fc.property(
            space,
            fc.constantFrom("", "+", "-"),
            mantissa,
            exponent,
            fc.constantFrom("", "", "l", ".3", "garbage", " x", ",5"),
            space,
            (lead, sign, mant, exp, garbage, tail) => {
                const b = latinBytes(`xx${lead}${sign}${mant}${exp}${garbage}${tail}yy`);
                check(b, 2, b.length - 2);
            },
        ),
        { numRuns: 20000, seed: 1703 },
    );
});

it("preserves exact-mantissa boundaries, signed zero, and all fallback repairs", () => {
    for (const mant of [
        "0",
        "1",
        "9007199254740991",
        "9007199254740992",
        "9999999999999999",
        "12345678901234567",
    ])
        for (const exp of [-400, -23, -22, -1, 0, 1, 22, 23, 400])
            for (const sign of ["", "+", "-"])
                for (const point of ["", ".0"]) check(latinBytes(`${sign}${mant}${point}e${exp}`));
    for (const text of [
        ".5",
        "5.",
        "-0",
        "-0.0",
        "-0e20",
        "0x10",
        "-0b1",
        "0o10",
        "Infinity",
        "+Infinity",
        "\r0x10",
        "nan.0",
        "1.000000000000000E 20",
        "1.2.3",
        "",
        " ",
        ".",
        "+",
        "-.",
        `0.${"0".repeat(10000)}1e10001`,
        `-${"0".repeat(10000)}`,
        "9".repeat(10000),
    ])
        check(latinBytes(text));
    fc.assert(
        fc.property(fc.uint8Array({ maxLength: 200 }), (b) => check(b)),
        { numRuns: 5000, seed: 1704 },
    );
});
