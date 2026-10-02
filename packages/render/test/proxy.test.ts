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

describe("proxy graphics", () => {
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
