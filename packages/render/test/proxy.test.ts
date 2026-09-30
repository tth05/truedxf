import { describe, expect, it } from "vitest";
import { decodeProxyGraphics } from "../src/draw/proxy.ts";

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
});
