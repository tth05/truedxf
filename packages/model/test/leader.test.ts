import { describe, expect, it } from "vitest";
import {
  BY_BLOCK_RAW,
  decodeRawColor,
  type LeaderEntity,
  type MultiLeaderEntity,
  type ToleranceEntity,
} from "../src/index.ts";
import { errors, loadEntities } from "./snippets.ts";

// AutoCAD 2018 (ACadSharp sample_AC1032_ascii.dxf: LEADER 512, TOLERANCE 822, MULTILEADER 7B8
// without its 310 proxy graphic chunks)
const LEADER = `
  0 LEADER
  5 512
330 1F
100 AcDbEntity
  8 Layer1
100 AcDbLeader
  3 ISO-25
 73 0
 74 0
 75 1
 40 1.844821309997272
 41 16.37400410337938
 76 4
 10 717.8687154323397
 20 2.941179455067986
 30 0.0
 10 729.2681170780972
 20 48.53878603809858
 30 0.0
 10 737.8987500252849
 20 14.07181240225556
 30 0.0
 10 740.3987500252849
 20 14.07181240225556
 30 0.0
340 513
1001 ACAD
1000 DSTYLE
1002 {
1070 41
1040 3.5
1002 }
`;

const TOLERANCE = `
  0 TOLERANCE
  5 822
330 1F
100 AcDbEntity
  8 0
100 AcDbFcf
  3 Standard
 10 214.1752393775127
 20 -4.320437747060623
 30 0.0
  1 {\\Fgdt;j}%%v{\\Fgdt;n}%%v%%v%%v%%v^J{\\Fgdt;d}%%v%%v%%v%%v%%v^J.5^J5
`;

const MLEADER = `
  0 MULTILEADER
  5 7B8
330 1F
100 AcDbEntity
  8 0
160 4
310 01020304
100 AcDbMLeader
270 2
300 CONTEXT_DATA{
 40 1.0
 10 1083.681045165763
 20 23.23924387283501
 30 0.0
 41 0.18
140 0.18
145 0.09
174 1
175 1
176 0
177 0
290 1
304 MLeader text, hello!
 11 0.0
 21 0.0
 31 1.0
340 11
 12 1083.771045165763
 22 23.34704741990185
 32 0.0
 13 1.0
 23 0.0
 33 0.0
 42 0.0
 43 1.447121418826739
 44 0.0
 45 1.0
170 1
 90 -1073741824
171 1
172 5
 91 -1073741824
141 0.0
 92 0
291 0
292 0
173 0
293 0
142 0.0
143 0.0
294 0
295 0
296 0
110 1050.241562773277
120 8.17554702864777
130 0.0
111 1.0
121 0.0
131 0.0
112 0.0
122 1.0
132 0.0
297 0
302 LEADER{
290 1
291 1
 10 1083.321045165764
 20 23.23924387283501
 30 0.0
 11 1.0
 21 0.0
 31 0.0
 90 0
 40 0.36
304 LEADER_LINE{
 10 1050.241562773277
 20 8.17554702864777
 30 0.0
 91 0
305 }
271 0
303 }
272 9
273 9
301 }
340 D8
 90 279552
170 1
 91 -1056964608
341 14
171 -2
290 1
291 1
 41 0.36
 42 0.18
172 2
343 11
173 1
 95 1
174 1
175 0
 92 -1056964608
292 0
 93 -1056964608
 10 1.0
 20 1.0
 30 1.0
 43 0.0
176 0
293 0
294 0
178 0
179 1
 45 1.0
271 0
272 9
273 9
295 0
`;

// block content with attributes, two leader lines with breaks, arrow head overrides
const MLEADER_BLOCK = `
  0 MULTILEADER
  5 900
100 AcDbEntity
  8 0
100 AcDbMLeader
270 2
300 CONTEXT_DATA{
 40 2.0
 10 10
 20 10
 30 0
 41 0.36
140 0.36
145 0.18
290 0
296 1
341 1A
 14 0
 24 0
 34 1
 15 12
 25 10
 35 0
 16 2
 26 2
 36 2
 46 0.5
 93 -1023410171
 47 1
 47 0
110 0
120 0
130 0
111 1
121 0
131 0
112 0
122 1
132 0
297 0
302 LEADER{
290 1
291 0
 10 10
 20 10
 30 0
 11 1
 21 0
 31 0
 12 10.1
 22 10
 32 0
 13 10.2
 23 10
 33 0
 90 0
 40 0.72
304 LEADER_LINE{
 10 0
 20 0
 30 0
 10 5
 20 5
 30 0
 90 0
 11 1
 21 1
 31 0
 12 2
 22 2
 32 0
 91 0
 92 -1056964608
305 }
304 LEADER_LINE{
 10 20
 20 0
 30 0
 91 1
 92 -1023475712
305 }
271 0
303 }
301 }
340 D8
170 2
172 1
344 1A
 94 1
345 2B
330 3C
177 1
 44 0.0
302 VALUE-1
330 3D
177 2
 44 0.0
302 VALUE-2
`;

describe("LEADER", () => {
  it("reads vertices, flags, annotation and DSTYLE overrides", () => {
    const { doc, entities } = loadEntities(LEADER);
    const l = entities[0] as LeaderEntity;
    expect(l.type).toBe("LEADER");
    expect(l.dimStyle).toBe("ISO-25");
    expect(l.arrowhead).toBe(true);
    expect(l.creationFlag).toBe(0);
    expect(l.hookDirection).toBe(0);
    expect(l.hasHook).toBe(true);
    expect(l.textHeight).toBeCloseTo(1.844821309997272);
    expect(l.vertices).toHaveLength(4);
    expect(l.vertices[3]).toEqual({ x: 740.3987500252849, y: 14.07181240225556, z: 0 });
    expect(l.annotationHandle).toBe("513");
    expect(l.horizontalDirection).toEqual({ x: 1, y: 0, z: 0 });
    expect(l.overrides.get(41)).toBe(3.5);
    expect(errors(doc)).toEqual([]);
  });
});

describe("TOLERANCE", () => {
  it("reads the frame string and placement", () => {
    const t = loadEntities(TOLERANCE).entities[0] as ToleranceEntity;
    expect(t.type).toBe("TOLERANCE");
    expect(t.text).toBe("{\\Fgdt;j}%%v{\\Fgdt;n}%%v%%v%%v%%v^J{\\Fgdt;d}%%v%%v%%v%%v%%v^J.5^J5");
    expect(t.insert).toEqual({ x: 214.1752393775127, y: -4.320437747060623, z: 0 });
    expect(t.direction).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe("MULTILEADER", () => {
  it("reads the CONTEXT_DATA / LEADER / LEADER_LINE structure with MTEXT content", () => {
    const { doc, entities } = loadEntities(MLEADER);
    const m = entities[0] as MultiLeaderEntity;
    expect(m.type).toBe("MULTILEADER");
    expect(m.proxyGraphics).toEqual(new Uint8Array([1, 2, 3, 4]));
    const c = m.context;
    expect(c.scale).toBe(1);
    expect(c.basePoint).toEqual({ x: 1083.681045165763, y: 23.23924387283501, z: 0 });
    expect(c.textHeight).toBe(0.18);
    expect(c.arrowSize).toBe(0.18);
    expect(c.landingGap).toBe(0.09);
    expect(c.block).toBeUndefined();
    expect(c.mtext?.text).toBe("MLeader text, hello!");
    expect(c.mtext?.insert).toEqual({ x: 1083.771045165763, y: 23.34704741990185, z: 0 });
    expect(c.mtext?.width).toBeCloseTo(1.447121418826739);
    expect(c.mtext?.attachment).toBe(1);
    expect(c.mtext?.flowDirection).toBe(5);
    expect(c.mtext?.styleHandle).toBe("11");
    expect(c.planeOrigin).toEqual({ x: 1050.241562773277, y: 8.17554702864777, z: 0 });
    expect(c.leaders).toHaveLength(1);
    const leader = c.leaders[0]!;
    expect(leader.hasLastLeaderLine).toBe(true);
    expect(leader.lastLeaderPoint).toEqual({ x: 1083.321045165764, y: 23.23924387283501, z: 0 });
    expect(leader.doglegLength).toBe(0.36);
    expect(leader.lines).toHaveLength(1);
    expect(leader.lines[0]!.vertices).toEqual([{ x: 1050.241562773277, y: 8.17554702864777, z: 0 }]);
    expect(c.topAttachment).toBe(9);
    expect(m.styleHandle).toBe("D8");
    expect(m.overrideFlags).toBe(279552);
    expect(m.leaderType).toBe(1);
    expect(m.leaderColor).toBe(BY_BLOCK_RAW);
    expect(m.leaderLinetypeHandle).toBe("14");
    expect(m.leaderLineweight).toBe(-2);
    expect(m.doglegLength).toBe(0.36);
    expect(m.arrowSize).toBe(0.18);
    expect(m.contentType).toBe(2);
    expect(m.textStyleHandle).toBe("11");
    expect(m.blockScale).toEqual({ x: 1, y: 1, z: 1 });
    expect(m.textAttachmentPoint).toBe(1);
    expect(errors(doc)).toEqual([]);
  });

  it("reads block content, attributes, breaks and arrow heads", () => {
    const m = loadEntities(MLEADER_BLOCK).entities[0] as MultiLeaderEntity;
    const b = m.context.block!;
    expect(m.context.mtext).toBeUndefined();
    expect(b.blockRecordHandle).toBe("1A");
    expect(b.insert).toEqual({ x: 12, y: 10, z: 0 });
    expect(b.scale).toEqual({ x: 2, y: 2, z: 2 });
    expect(b.rotation).toBe(0.5);
    expect(decodeRawColor(b.color)).toEqual({ method: 0xc3, aci: 5, rgb: undefined });
    expect(b.matrix).toEqual([1, 0]);
    const leader = m.context.leaders[0]!;
    expect(leader.breaks).toEqual([
      { index: undefined, start: { x: 10.1, y: 10, z: 0 }, end: { x: 10.2, y: 10, z: 0 } },
    ]);
    expect(leader.lines).toHaveLength(2);
    expect(leader.lines[0]!.vertices).toHaveLength(2);
    expect(leader.lines[0]!.breaks).toEqual([
      { index: 0, start: { x: 1, y: 1, z: 0 }, end: { x: 2, y: 2, z: 0 } },
    ]);
    expect(decodeRawColor(leader.lines[1]!.color)).toEqual({ method: 0xc2, aci: undefined, rgb: 0xff0000 });
    expect(m.leaderType).toBe(2);
    expect(m.contentType).toBe(1);
    expect(m.blockHandle).toBe("1A");
    expect(m.arrowHeads).toEqual([{ index: 1, handle: "2B" }]);
    expect(m.blockAttributes).toEqual([
      { attdefHandle: "3C", index: 1, width: 0, text: "VALUE-1" },
      { attdefHandle: "3D", index: 2, width: 0, text: "VALUE-2" },
    ]);
  });
});
