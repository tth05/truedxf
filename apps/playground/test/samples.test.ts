import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { caseScores, listCases, listSuites, refsDir, samplePath, searchCorpus } from "../server/samples.ts";

const root = mkdtempSync(join(tmpdir(), "truedxf-samples-"));
const write = (rel: string, text: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};
write("generated/lines/a-0001.dxf", "0\nEOF\n");
write(
  "generated/lines/a-0001.json",
  JSON.stringify({ title: "A", tags: ["LINE"], plot: { layout: "Model" } }),
);
write("generated/lines/b-0002.dxf", "0\nEOF\n");
write("refs/acad2027-R26.0/lines/a-0001.png", "png");
write(
  "reports/scoreboard/lines.json",
  JSON.stringify({
    n: 3,
    exact: 1,
    good: 2,
    perSuite: { lines: { f1: 0.99 } },
    cases: {
      "lines/a-0001": { exact: 0, f1: [1, 1, 1] },
      "lines/b-0002": { exact: 12, f1: [0.9, 0.99, 1] },
      "lines/e-0005": { error: "boom" },
    },
  }),
);
// a --quiet log: exact matches are not logged; d-0004 is only in the log (older report)
write(
  "reports/scoreboard/lines.log",
  "lines/b-0002 exact=99 f1=0.100/0.100/0.100\nlines/d-0004 exact=7 f1=0.500/0.800/0.900\n",
);
write(
  "out/visual/results.json",
  JSON.stringify({ results: [{ id: "lines/c-0003", metrics: { exactMismatch: 3, f1: [0.5, 1, 1] } }] }),
);
write(
  "external/manifest.jsonl",
  [
    {
      path: "files/x/plan.dxf",
      size: 10,
      format: "ascii-dxf",
      version: "R2018",
      producer: "AutoCAD-like",
      entities: { LINE: 3 },
    },
    {
      path: "files/y/tree.dxf",
      size: 99,
      format: "binary-dxf",
      version: "R12",
      producer: "QCAD",
      entities: { MTEXT: 1 },
    },
    { path: "files/z/a.dwg", size: 5, format: "dwg" },
  ]
    .map((r) => JSON.stringify(r))
    .join("\n"),
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("samples API (playground dev server)", () => {
  it("lists suites with scoreboard summaries and cases with scores and references", () => {
    expect(listSuites(root)).toEqual([
      {
        name: "lines",
        cases: 2,
        score: { n: 3, exact: 1, good: 2, f1: 0.99 },
        grades: { exact: 1, good: 2, fair: 0, poor: 1, error: 1 },
      },
    ]);
    const cases = listCases("lines", root);
    expect(cases.map((c) => c.id)).toEqual(["lines/a-0001", "lines/b-0002"]);
    expect(cases[0]).toMatchObject({
      title: "A",
      ref: "refs/acad2027-R26.0/lines/a-0001.png",
      score: { exact: 0 },
    });
    expect(cases[1]).toMatchObject({ ref: null, score: { exact: 12, f1: [0.9, 0.99, 1] } });
    expect(listCases("../x", root)).toEqual([]);
  });

  it("reads every case from the JSON reports, the logs only as a fallback", () => {
    const s = caseScores(root);
    expect(s.get("lines/a-0001")).toEqual({ exact: 0, f1: [1, 1, 1], source: "scoreboard" });
    expect(s.get("lines/b-0002")?.exact).toBe(12);
    expect(s.get("lines/d-0004")).toEqual({ exact: 7, f1: [0.5, 0.8, 0.9], source: "scoreboard" });
    expect(s.get("lines/e-0005")).toEqual({ error: "boom", source: "scoreboard" });
  });

  it("merges visual harness results", () => {
    expect(caseScores(root).get("lines/c-0003")).toEqual({ exact: 3, f1: [0.5, 1, 1], source: "visual" });
    expect(refsDir(root)).toBe(join(root, "refs", "acad2027-R26.0"));
  });

  it("serves only files below samples/", () => {
    expect(samplePath("generated/lines/a-0001.dxf", root)).toBeDefined();
    expect(samplePath("../package.json", root)).toBeUndefined();
    expect(samplePath("generated/../../x", root)).toBeUndefined();
    expect(samplePath("generated/missing.dxf", root)).toBeUndefined();
  });

  it("searches the corpus manifest (DXF only)", () => {
    const all = searchCorpus(new URLSearchParams(), root);
    expect(all.total).toBe(2);
    expect(searchCorpus(new URLSearchParams({ type: "mtext" }), root).rows.map((r) => r.path)).toEqual([
      "files/y/tree.dxf",
    ]);
    expect(searchCorpus(new URLSearchParams({ q: "PLAN" }), root).rows[0]).toMatchObject({
      entities: 3,
      types: ["LINE"],
    });
    expect(searchCorpus(new URLSearchParams({ version: "R12" }), root).total).toBe(1);
    expect(searchCorpus(new URLSearchParams({ sort: "size" }), root).rows[0]!.path).toBe("files/y/tree.dxf");
  });
});
