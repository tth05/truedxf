import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeProxyGraphics } from "../src/draw/proxy.ts";
import { renderPlot } from "../src/index.ts";
import { modelDoc } from "./helpers.ts";

/** Builds a proxy graphics blob from (opcode, payload writer) commands. */
function blob(cmds: [number, (dv: DataView, o: number) => number][]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [op, write] of cmds) {
    const tmp = new DataView(new ArrayBuffer(4096));
    const n = write(tmp, 8);
    tmp.setUint32(0, n, true);
    tmp.setUint32(4, op, true);
    parts.push(new Uint8Array(tmp.buffer, 0, n));
  }
  const total = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, total, true);
  dv.setUint32(4, cmds.length, true);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const doubles =
  (...v: number[]) =>
  (dv: DataView, o: number) => {
    for (const x of v) {
      dv.setFloat64(o, x, true);
      o += 8;
    }
    return o;
  };

const int32 = (v: number) => (dv: DataView, o: number) => {
  dv.setInt32(o, v, true);
  return o + 4;
};

const traits = {
  color: 256,
  trueColor: undefined,
  layer: "0",
  linetype: "BYLAYER",
  lineweight: -1,
  linetypeScale: 1,
  fill: false,
};

const octets = (...v: number[]) => v.map((n) => n.toString(2).padStart(8, "0")).join("");
const rd = (v: number) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v, true);
  return octets(...new Uint8Array(dv.buffer));
};
const bd = (v: number) => `00${rd(v)}`;
const bl = (v: number) => `01${octets(v)}`;

function lwPayload(flags: number, body: string) {
  const bits = `00${octets(flags & 255, flags >>> 8)}${body}`;
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) bytes[i >>> 3]! |= Number(bits[i]) << (7 - (i & 7));
  return (dv: DataView, o: number) => {
    dv.setUint32(o, bytes.length, true);
    new Uint8Array(dv.buffer).set(bytes, o + 4);
    // Three uninterpreted trailing RC bytes, outside the declared DWG body.
    new Uint8Array(dv.buffer).set([0xab, 0xcd, 0xef], o + 4 + bytes.length);
    return o + 7 + bytes.length;
  };
}

const twoPoints = `${bl(2)}${rd(1)}${rd(2)}11${rd(4)}00`;

function paddedString(dv: DataView, o: number, text: string, unicode: boolean): number {
  for (let i = 0; i <= text.length; i++) {
    if (unicode) dv.setUint16(o, text.charCodeAt(i) || 0, true);
    else dv.setUint8(o, text.charCodeAt(i) || 0);
    o += unicode ? 2 : 1;
  }
  return Math.ceil(o / 4) * 4;
}

function textPayload(
  op: number,
  text = "AB",
  normal = [0, 0, 1],
  direction = [1, 0, 0],
  bigFont = "big.shx",
) {
  return (dv: DataView, o: number) => {
    const unicode = op === 36 || op === 38;
    const extended = op === 11 || op === 38;
    o = doubles(3, 4, 5, ...normal, ...direction)(dv, o);
    if (extended) {
      o = paddedString(dv, o, text, unicode);
      o = int32(-1)(dv, o);
      o = int32(0)(dv, o);
    }
    o = doubles(2, 0.7, Math.PI / 12)(dv, o);
    if (!extended) return paddedString(dv, o, text, unicode);
    o = doubles(1)(dv, o);
    for (const v of [1, 1, 0, 1, 1]) o = int32(v)(dv, o);
    if (unicode) {
      for (const v of [1, 1, 134, 2]) o = int32(v)(dv, o);
      o = paddedString(dv, o, "Test Family", true);
    }
    o = paddedString(dv, o, "txt.shx", unicode);
    return paddedString(dv, o, bigFont, unicode);
  };
}

describe("proxy graphics", () => {
  it("draws TEXT2 through the ordinary TEXT path with embedded fonts, width, oblique and decorations", async () => {
    const g = blob([[11, textPayload(11, "%%uAB", [0, 0, 1], [1, 0, 0], "")]]);
    const hex = [...g].map((v) => v.toString(16).padStart(2, "0")).join("");
    const common = "5 A\n330 1F\n100 AcDbEntity\n8 0\n62 3\n370 0";
    const proxy = modelDoc({
      entities: `0 ACAD_PROXY_ENTITY\n${common}\n100 AcDbProxyEntity\n90 498\n91 500\n92 ${g.length}\n310 ${hex}`,
    });
    const native = modelDoc({
      entities: `0 TEXT\n${common}\n100 AcDbText\n10 3\n20 4\n30 5\n40 2\n41 0.7\n50 0\n51 15\n71 6\n1 %%u%%o%%%%%%uAB\n7 Standard`,
    });
    const font = new Uint8Array(
      readFileSync(join(import.meta.dirname, "../../fonts/assets/truedxf-test-uni.shx")),
    );
    const env = {
      loadFont: async (name: string) => (["txt.shx", "simplex.shx"].includes(name) ? font : undefined),
    };
    const plot = {
      layout: "Model",
      area: {
        type: "window" as const,
        min: [-10, -10] as [number, number],
        max: [10, 10] as [number, number],
      },
      canvas: [1000, 1000] as [number, number],
      lineweights: false,
    };
    const originalStyles = proxy.tables.styles.entries.slice();
    const a = await renderPlot(proxy, plot, env);
    const b = await renderPlot(native, plot, env);
    expect(a.unsupported).toEqual({});
    expect(a.displayList).toEqual(b.displayList);
    expect(proxy.tables.styles.entries).toEqual(originalStyles);
  });
  it.each([10, 11, 36, 38])("decodes opcode %s text and its independent font/flags", (op) => {
    const text = op >= 36 ? "门😀" : "AB";
    const result = decodeProxyGraphics(blob([[op, textPayload(op, text)]]), traits, {
      layers: [],
      linetypes: [],
    });
    expect(result.unsupported).toEqual([]);
    const p = result.primitives[0]!;
    if (p.kind !== "text") throw new Error("expected text");
    expect(p.text.input.text).toBe(text);
    expect(p.text.input.insert).toEqual({ x: 3, y: 4, z: 5 });
    expect(p.text.input.widthFactor).toBe(0.7);
    expect(p.text.input.oblique).toBeCloseTo(15);
    if (op === 11 || op === 38) {
      expect(p.text.raw).toBe(true);
      expect(p.text.input.generationFlags).toBe(6);
      expect([p.text.underline, p.text.overline]).toEqual([true, true]);
      expect(p.text.style?.font).toBe("txt.shx");
      expect(p.text.style?.bigFont).toBe("big.shx");
      if (op === 38) {
        expect(p.text.style?.ttfFamily).toBe("Test Family");
        expect(p.text.style?.ttfFlags).toBe((1 << 24) | (1 << 25) | 0x8602);
        expect([p.text.charset, p.text.pitch]).toEqual([134, 2]);
      }
    } else expect(p.text.style).toBeUndefined();
  });

  it("converts WCS text origins and directions to the text OCS before model transforms", () => {
    const result = decodeProxyGraphics(
      blob([
        [29, doubles(1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1)],
        [36, textPayload(36, "AB", [0, 1, 0], [-1, 0, 0])],
      ]),
      traits,
      { layers: [], linetypes: [] },
    );
    const p = result.primitives[0]!;
    if (p.kind !== "text") throw new Error("expected text");
    expect(p.text.input.insert).toEqual({ x: -3, y: 5, z: 4 });
    expect(p.text.input.rotation).toBe(0);
    expect(p.transform!.transformPoint({ x: 3, y: 4, z: 5 })).toEqual({ x: 13, y: 24, z: 35 });
  });

  it("rejects unterminated Unicode strings without losing preceding primitives", () => {
    const g = blob([
      [6, (dv, o) => doubles(0, 0, 0, 1, 0, 0)(dv, int32(2)(dv, o))],
      [
        38,
        (dv, o) => {
          o = doubles(0, 0, 0, 0, 0, 1, 1, 0, 0)(dv, o);
          dv.setUint16(o, 65, true);
          return o + 2;
        },
      ],
    ]);
    const result = decodeProxyGraphics(g, traits, { layers: [], linetypes: [] });
    expect(result.primitives).toHaveLength(1);
    expect(result.unsupported).toEqual(["proxy-corrupt"]);
  });

  it("pads strings relative to the payload after an unaligned DWG command", () => {
    const result = decodeProxyGraphics(
      blob([
        [33, lwPayload(0, twoPoints)],
        [38, textPayload(38, "下")],
      ]),
      traits,
      { layers: [], linetypes: [] },
    );
    expect(result.unsupported).toEqual([]);
    const p = result.primitives[1]!;
    if (p.kind !== "text") throw new Error("expected text");
    expect(p.text.input.text).toBe("下");
    expect(p.text.style?.font).toBe("txt.shx");
    expect(p.text.style?.bigFont).toBe("big.shx");
    expect(p.text.style?.ttfFlags).toBe((1 << 24) | (1 << 25) | 0x8602);
  });

  it("fills a SHELL face with its hole and keeps fill enabled for the next polygon", () => {
    const points = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 1, 1, 0, 2, 1, 0, 2, 2, 0, 1, 2, 0];
    const g = blob([
      [20, int32(1)],
      [
        9,
        (dv, o) => {
          o = doubles(...points)(dv, int32(8)(dv, o));
          for (const v of [10, 4, 0, 1, 2, 3, -4, 4, 5, 6, 7]) o = int32(v)(dv, o);
          return o;
        },
      ],
      [7, (dv, o) => doubles(...points.slice(0, 12))(dv, int32(4)(dv, o))],
    ]);
    const { primitives, unsupported } = decodeProxyGraphics(g, traits, { layers: [], linetypes: [] });
    expect(unsupported).toEqual([]);
    const p = primitives[0]!;
    if (p.kind !== "fill") throw new Error("expected fill");
    expect(p.rings).toHaveLength(2);
    expect(p.rings.map((r) => r.length)).toEqual([4, 4]);
    expect(primitives[1]!.kind).toBe("fill");
    expect(primitives[1]!.traits.fill).toBe(true);
  });
  it("keeps FILLON across a POLYLINE and trait commands for the following POLYGON", () => {
    const points = (dv: DataView, o: number) =>
      doubles(0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0)(dv, int32(4)(dv, o));
    const { primitives, unsupported } = decodeProxyGraphics(
      blob([
        [20, int32(1)],
        [6, points],
        [14, int32(8)],
        [7, points],
      ]),
      traits,
      { layers: [], linetypes: [] },
    );
    expect(unsupported).toEqual([]);
    expect(primitives.map((p) => p.kind)).toEqual(["curve", "fill"]);
    expect(primitives[1]!.traits.color).toBe(8);
  });
  it("keeps fill across POLYGON and TEXT until an explicit FILLON clear", () => {
    const points = (dv: DataView, o: number) =>
      doubles(0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0)(dv, int32(4)(dv, o));
    const result = decodeProxyGraphics(
      blob([
        [20, int32(1)],
        [7, points],
        [38, textPayload(38, "AB")],
        [7, points],
        [20, int32(0)],
        [7, points],
      ]),
      traits,
      { layers: [], linetypes: [] },
    );
    expect(result.unsupported).toEqual([]);
    expect(result.primitives.map((p) => p.kind)).toEqual(["fill", "text", "fill", "curve"]);
    expect(result.primitives.map((p) => p.traits.fill)).toEqual([true, true, true, false]);
  });
  it("applies the plot-time FILLMODE override to a proxy SHELL", async () => {
    const g = blob([
      [20, int32(1)],
      [
        9,
        (dv, o) => {
          o = doubles(0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0)(dv, int32(4)(dv, o));
          for (const v of [5, 4, 0, 1, 2, 3]) o = int32(v)(dv, o);
          return o;
        },
      ],
    ]);
    const hex = [...g].map((v) => v.toString(16).padStart(2, "0")).join("");
    const entities = `0 ACAD_PROXY_ENTITY\n5 A\n330 1F\n100 AcDbEntity\n8 0\n370 0\n100 AcDbProxyEntity\n90 498\n91 500\n92 ${g.length}\n310 ${hex}`;
    const plot = {
      layout: "Model",
      area: { type: "window" as const, min: [-1, -1] as [number, number], max: [5, 5] as [number, number] },
      canvas: [100, 100] as [number, number],
      lineweights: false,
    };
    const saved = await renderPlot(modelDoc({ entities, header: "9 $FILLMODE\n70 0" }), plot);
    const overridden = await renderPlot(modelDoc({ entities }), { ...plot, sysvars: { FILLMODE: 0 } });
    const filled = await renderPlot(modelDoc({ entities }), plot);
    expect(overridden.displayList).toEqual(saved.displayList);
    expect(overridden.displayList).not.toEqual(filled.displayList);
  });
  it("decodes a circle, a colour trait and a composed model transform", () => {
    const g = blob([
      [14, int32(1)],
      [29, doubles(1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 0, 0, 0, 0, 1)],
      [2, doubles(1, 2, 0, 5, 0, 0, 1)],
      [31, (_dv, o) => o],
      [6, (dv, o) => doubles(0, 0, 0, 3, 4, 0)(dv, int32(2)(dv, o))],
    ]);
    const { primitives, unsupported } = decodeProxyGraphics(g, traits, { layers: [], linetypes: [] });
    expect(unsupported).toEqual([]);
    expect(primitives).toHaveLength(2);
    const c = primitives[0]!;
    expect(c.kind).toBe("curve");
    expect(c.traits.color).toBe(1);
    if (c.kind === "curve" && c.curve.kind === "ellipticArc") {
      expect(c.curve.center).toEqual({ x: 11, y: 22, z: 0 });
      expect(Math.hypot(c.curve.u.x, c.curve.u.y)).toBeCloseTo(5);
    } else throw new Error("expected an arc");
    const p = primitives[1]!;
    // popped: the polyline is untransformed
    if (p.kind === "curve" && p.curve.kind === "polyline")
      expect([...p.curve.points]).toEqual([0, 0, 0, 3, 4, 0]);
    else throw new Error("expected a polyline");
  });

  it("stops at a corrupt command size", () => {
    const g = blob([[2, doubles(0, 0, 0, 1, 0, 0, 1)]]);
    new DataView(g.buffer).setUint32(8, 4, true); // size < 8
    expect(decodeProxyGraphics(g, traits, { layers: [], linetypes: [] }).primitives).toEqual([]);
  });

  it("decodes all opcode-33 fields in order and snapshots traits and nested transforms", () => {
    const flags = 1 | 2 | 4 | 8 | 16 | 32 | 256 | 512 | 1024;
    const body =
      `${bd(3)}${bd(5)}${bd(-2)}10 01 10 ${bl(2)}${bl(2)}${bl(2)}${bl(2)}${rd(1)}${rd(2)}11${rd(4)}00${bd(0.5)}10${bl(10)}${bl(11)}${bd(6)}${bd(7)}${bd(8)}${bd(9)}`.replaceAll(
        " ",
        "",
      );
    const result = decodeProxyGraphics(
      blob([
        [14, int32(3)],
        [24, doubles(2)],
        [29, doubles(1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 0, 0, 0, 0, 1)],
        [29, doubles(2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)],
        [33, lwPayload(flags, body)],
        [31, (_dv, o) => o],
        [31, (_dv, o) => o],
        [14, int32(4)],
        [33, lwPayload(0, twoPoints)],
      ]),
      traits,
      { layers: [], linetypes: [], dxfversion: "AC1024" },
    );
    expect(result.unsupported).toEqual([]);
    const p = result.primitives[0]!;
    if (p.kind !== "lwpolyline") throw new Error("expected LWPOLYLINE");
    expect(p.vertices).toEqual([
      { x: 1, y: 2, bulge: 0.5, startWidth: 6, endWidth: 7 },
      { x: 4, y: 2, bulge: 0, startWidth: 8, endWidth: 9 },
    ]);
    expect([p.closed, p.plinegen, p.constantWidth, p.elevation, p.thickness]).toEqual([true, true, 3, 5, -2]);
    expect(p.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(p.transform!.transformPoint({ x: 1, y: 2, z: 5 })).toEqual({ x: 12, y: 26, z: 5 });
    expect([p.traits.color, p.traits.linetypeScale]).toEqual([3, 2]);
    const next = result.primitives[1]!;
    if (next.kind !== "lwpolyline") throw new Error("expected LWPOLYLINE");
    expect(next.transform).toBeUndefined();
    expect(next.traits.color).toBe(4);
  });

  it("does not read the R2010 vertex-id count in older streams", () => {
    const result = decodeProxyGraphics(blob([[33, lwPayload(1024, twoPoints)]]), traits, {
      layers: [],
      linetypes: [],
      dxfversion: "AC1021",
    });
    expect(result.unsupported).toEqual([]);
    expect(result.primitives).toHaveLength(1);
  });

  it("accepts empty and sparse optional arrays", () => {
    const result = decodeProxyGraphics(
      blob([
        [33, lwPayload(0, "10")],
        [
          33,
          lwPayload(
            16 | 32,
            `${bl(2)}${bl(1)}${bl(1)}${rd(1)}${rd(2)}00 00 ${bd(0.5)}${bd(3)}${bd(4)}`.replaceAll(" ", ""),
          ),
        ],
      ]),
      traits,
      { layers: [], linetypes: [] },
    );
    expect(result.unsupported).toEqual([]);
    const p = result.primitives[1]!;
    if (p.kind !== "lwpolyline") throw new Error("expected LWPOLYLINE");
    expect(p.vertices).toEqual([
      { x: 1, y: 2, bulge: 0.5, startWidth: 3, endWidth: 4 },
      { x: 1, y: 2 },
    ]);
  });

  it("reports proxy-corrupt for truncated bodies, reserved codes and impossible counts", () => {
    for (const body of ["", bl(255), `${bl(2)}${rd(1)}`, `${bl(2)}${rd(1)}${rd(2)}11`, "11"])
      expect(
        decodeProxyGraphics(blob([[33, lwPayload(0, body)]]), traits, { layers: [], linetypes: [] })
          .unsupported,
      ).toEqual(["proxy-corrupt"]);
    const g = blob([[33, lwPayload(0, twoPoints)]]);
    new DataView(g.buffer).setUint32(16, g.length, true);
    expect(decodeProxyGraphics(g, traits, { layers: [], linetypes: [] }).unsupported).toEqual([
      "proxy-corrupt",
    ]);
  });

  it.each([0, 4, 32])("draws bulges and width flag %s like an ordinary OCS LWPOLYLINE", async (widthFlag) => {
    const flags = widthFlag | 1 | 8 | 16 | 512;
    const header =
      `${widthFlag === 4 ? bd(0.5) : ""}${bd(3)}10 10 ${bd(-1)}${bl(2)}${bl(2)}${widthFlag === 32 ? bl(2) : ""}`.replaceAll(
        " ",
        "",
      );
    const payload = `${header}${rd(1)}${rd(2)}11${rd(4)}00${bd(0.5)}10${widthFlag === 32 ? `${bd(0.5)}${bd(1)}${bd(1)}${bd(0.5)}` : ""}`;
    const g = blob([[33, lwPayload(flags, payload)]]);
    const hex = [...g].map((v) => v.toString(16).padStart(2, "0")).join("");
    const common = "5 A\n330 1F\n100 AcDbEntity\n8 0\n62 3\n370 0\n48 2";
    const proxy = modelDoc({
      entities: `0 ACAD_PROXY_ENTITY\n${common}\n100 AcDbProxyEntity\n90 498\n91 500\n92 ${g.length}\n310 ${hex}`,
    });
    const native = modelDoc({
      entities: `0 LWPOLYLINE\n${common}\n100 AcDbPolyline\n90 2\n70 1\n38 3\n210 0\n220 0\n230 -1\n43 ${widthFlag === 4 ? 0.5 : 0}\n10 1\n20 2\n42 0.5\n40 ${widthFlag === 32 ? 0.5 : 0}\n41 ${widthFlag === 32 ? 1 : 0}\n10 4\n20 2\n40 ${widthFlag === 32 ? 1 : 0}\n41 ${widthFlag === 32 ? 0.5 : 0}`,
    });
    const plot = {
      layout: "Model",
      area: {
        type: "window" as const,
        min: [-10, -10] as [number, number],
        max: [10, 10] as [number, number],
      },
      canvas: [1000, 1000] as [number, number],
      lineweights: false,
    };
    const a = await renderPlot(proxy, plot);
    const b = await renderPlot(native, plot);
    expect(a.unsupported).toEqual({});
    expect(a.displayList).toEqual(b.displayList);
  });
});
