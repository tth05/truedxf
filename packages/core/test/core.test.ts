import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AsciiTagWriter,
  BinaryTagWriter,
  Diagnostics,
  decodeCaret,
  decodeUnicodeEscapes,
  formatDouble,
  parseAsciiNumber,
  readTags,
  tokenize,
  writeStore,
} from "../src/index.ts";

const enc = new TextEncoder();

function dxf(lines: string[], eol = "\r\n"): Uint8Array {
  return enc.encode(lines.join(eol) + eol);
}

const MINIMAL = [
  "  0",
  "SECTION",
  "  2",
  "HEADER",
  "  9",
  "$ACADVER",
  "  1",
  "AC1015",
  "  9",
  "$DWGCODEPAGE",
  "  3",
  "ANSI_1252",
  "  0",
  "ENDSEC",
  "  0",
  "SECTION",
  "  2",
  "ENTITIES",
  "  0",
  "LINE",
  "  8",
  "0",
  " 10",
  "1.5",
  " 20",
  "-2",
  " 30",
  "0.0",
  " 11",
  "1e+2",
  " 21",
  ".5",
  " 31",
  "   0",
  "  0",
  "ENDSEC",
  "  0",
  "EOF",
];

describe("ascii tokenizer", () => {
  for (const eol of ["\r\n", "\n", "\r"]) {
    it(`tokenizes with ${JSON.stringify(eol)} line endings`, () => {
      const { store, sections, encoding, diagnostics } = readTags(dxf(MINIMAL, eol));
      expect(diagnostics.items).toEqual([]);
      expect(store.count).toBe(MINIMAL.length / 2);
      expect(sections.map((s) => s.name)).toEqual(["HEADER", "ENTITIES"]);
      expect(encoding.encoding).toBe("windows-1252");
      const line = sections[1]!.start;
      expect(store.str(line)).toBe("LINE");
      expect(store.num(line + 2)).toBe(1.5);
      expect(store.num(line + 3)).toBe(-2);
      expect(store.num(line + 5)).toBe(100);
      expect(store.num(line + 6)).toBe(0.5);
      expect(store.int(line + 7)).toBe(0);
    });
  }

  it("keeps leading spaces of string values and reports line numbers", () => {
    const { store } = readTags(
      dxf(["  0", "SECTION", "  2", "ENTITIES", "  0", "TEXT", "  1", "  two spaces", "  0", "EOF"]),
    );
    expect(store.str(3)).toBe("  two spaces");
    expect(store.lineOf(3)).toBe(7);
  });

  it("resyncs after a garbage line and warns about missing EOF", () => {
    const d = new Diagnostics();
    const store = tokenize(dxf(["  0", "SECTION", "garbage", "  2", "HEADER"]), { diagnostics: d });
    expect(d.summary()).toEqual({ "invalid-group-code": 1, "missing-eof": 1 });
    expect(store.count).toBe(2);
    expect(store.str(1)).toBe("HEADER");
  });

  it("strips a UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...dxf(["  0", "EOF"])]);
    const d = new Diagnostics();
    const store = tokenize(bytes, { diagnostics: d });
    expect(store.count).toBe(1);
    expect(d.summary()).toEqual({ "utf8-bom": 1 });
  });
});

describe("encoding", () => {
  it("uses UTF-8 for AC1021+ with code page fallback for invalid strings", () => {
    const head = [
      "  0",
      "SECTION",
      "  2",
      "HEADER",
      "  9",
      "$ACADVER",
      "  1",
      "AC1021",
      "  9",
      "$DWGCODEPAGE",
      "  3",
      "ANSI_1252",
      "  0",
      "ENDSEC",
    ];
    const body = enc.encode(`${head.join("\r\n")}\r\n  1\r\n`);
    const latin = new Uint8Array([...body, 0xe4, 0x0d, 0x0a, ...enc.encode("  1\r\nä\r\n  0\r\nEOF\r\n")]);
    const { store, encoding } = readTags(latin);
    expect(encoding.encoding).toBe("utf-8");
    const n = store.count;
    expect(store.str(n - 3)).toBe("ä"); // cp1252 fallback
    expect(store.str(n - 2)).toBe("ä"); // valid UTF-8
    expect(store.fallbackDecodes).toBe(1);
  });

  it("detects UTF-8 content in a file declaring a code page", () => {
    const bytes = dxf([
      "  0",
      "SECTION",
      "  2",
      "HEADER",
      "  9",
      "$ACADVER",
      "  1",
      "AC1015",
      "  9",
      "$DWGCODEPAGE",
      "  3",
      "ANSI_949",
      "  0",
      "ENDSEC",
      "  1",
      "한국어",
      "  0",
      "EOF",
    ]);
    const { store, encoding, diagnostics } = readTags(bytes);
    expect(encoding.reason).toBe("utf8-heuristic");
    expect(store.str(store.count - 2)).toBe("한국어");
    expect(diagnostics.summary()["utf8-in-codepage-file"]).toBe(1);
  });

  it("decodes shift_jis for ANSI_932", () => {
    // "表" in Shift-JIS is 0x95 0x5C (trail byte is a backslash)
    const pre = enc.encode(
      "  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$DWGCODEPAGE\r\n  3\r\nANSI_932\r\n  0\r\nENDSEC\r\n  1\r\n",
    );
    const bytes = new Uint8Array([...pre, 0x95, 0x5c, 0x0d, 0x0a, ...enc.encode("  0\r\nEOF\r\n")]);
    const { store } = readTags(bytes);
    expect(store.str(store.count - 2)).toBe("表");
  });

  it("decodes \\U+ and \\M+ escapes", () => {
    expect(decodeUnicodeEscapes("a\\U+00E4b\\U+00e4")).toBe("aäbä");
    expect(decodeUnicodeEscapes("\\U+D83D\\U+DE00")).toBe("😀");
    expect(decodeUnicodeEscapes("\\M+5D7DF")).toBe("走");
    expect(decodeUnicodeEscapes("bad \\U+12")).toBe("bad \\U+12");
  });

  it("decodes caret escapes", () => {
    expect(decodeCaret("a^Jb^Ic^ d")).toBe("a\nb\tc^d");
    expect(decodeCaret("end^")).toBe("end^");
  });
});

describe("numbers", () => {
  it("matches Number() for decimal strings", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        for (const s of [String(x), x.toFixed(6), x.toPrecision(15)]) {
          const b = enc.encode(`  ${s} `);
          const got = parseAsciiNumber(b, 0, b.length);
          expect(Object.is(got, Number(s)) || (got === 0 && Number(s) === 0)).toBe(true);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it("rejects empty and invalid values", () => {
    for (const s of ["", "  ", "abc", "1.2.3", "."]) {
      const b = enc.encode(s);
      expect(parseAsciiNumber(b, 0, b.length)).toBeNaN();
    }
  });

  it("formats doubles like AutoCAD", () => {
    expect(formatDouble(0)).toBe("0.0");
    expect(formatDouble(-0)).toBe("0.0");
    expect(formatDouble(12)).toBe("12.0");
    expect(formatDouble(1.570796326794896)).toBe("1.570796326794896");
    expect(formatDouble(1e20)).toBe("100000000000000000000.0");
    expect(formatDouble(1e21)).toBe("1e+21");
  });
});

describe("writer round trips", () => {
  const tags: [number, string | number | boolean | bigint | Uint8Array][] = [
    [0, "SECTION"],
    [2, "ENTITIES"],
    [0, "LWPOLYLINE"],
    [5, "1A2B"],
    [8, "Layer ä"],
    [90, 123456],
    [70, 1],
    [10, 1.25],
    [20, -7.5],
    [290, true],
    [160, 9007199254740993n],
    [310, new Uint8Array([0, 1, 254, 255])],
    [1001, "ACAD"],
    [1070, -3],
    [1071, 2147483647],
    [1004, new Uint8Array(300).map((_, i) => i & 0xff)],
    [0, "ENDSEC"],
    [0, "EOF"],
  ];

  function check(bytes: Uint8Array) {
    const store = tokenize(bytes);
    store.encoding = "utf-8";
    const values: unknown[] = [];
    for (let i = 0; i < store.count; i++) values.push([store.code(i), store.value(i)]);
    return { store, values };
  }

  it("ascii → tokenize → ascii is identical", () => {
    const w = new AsciiTagWriter();
    for (const [c, v] of tags) w.write(c, v);
    const bytes = w.toBytes();
    const { store, values } = check(bytes);
    expect(values).toContainEqual([160, 9007199254740993n]);
    expect(values).toContainEqual([8, "Layer ä"]);
    const w2 = new AsciiTagWriter();
    writeStore(store, w2);
    expect(new TextDecoder().decode(w2.toBytes())).toBe(new TextDecoder().decode(bytes));
  });

  it("binary (2-byte codes) round trips values", () => {
    const w = new BinaryTagWriter(2);
    for (const [c, v] of tags) w.write(c, v);
    const store = tokenize(w.toBytes());
    store.encoding = "utf-8";
    expect(store.format).toBe("binary");
    expect(store.binaryCodeSize).toBe(2);
    expect(store.value(4)).toBe("Layer ä");
    expect(store.value(7)).toBe(1.25);
    expect(store.value(9)).toBe(true);
    expect(store.value(10)).toBe(9007199254740993n);
    expect(store.handle(3)).toBe("1A2B");
    // 300-byte chunk becomes 3 tags of ≤ 127 bytes
    const chunks = [...Array(store.count).keys()].filter((i) => store.code(i) === 1004);
    expect(chunks.map((i) => store.raw(i).length)).toEqual([127, 127, 46]);
  });

  it("binary (R12 1-byte codes with 0xFF escape) is detected", () => {
    const w = new BinaryTagWriter(1);
    w.write(0, "SECTION");
    w.write(2, "ENTITIES");
    w.write(1001, "ACAD");
    w.write(1070, 7);
    w.write(0, "ENDSEC");
    w.write(0, "EOF");
    const store = tokenize(w.toBytes());
    expect(store.binaryCodeSize).toBe(1);
    expect(store.code(2)).toBe(1001);
    expect(store.value(3)).toBe(7);
    expect(store.count).toBe(6);
  });
});
