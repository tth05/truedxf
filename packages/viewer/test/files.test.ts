import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseName,
  chooseDrawing,
  type FileInput,
  FileStore,
  fileKind,
  isAbsolutePath,
  relativeUrls,
} from "../src/files.ts";
import { type RenderParams, ViewerCore } from "../src/protocol.ts";
import { ViewerWarningCode } from "../src/warnings.ts";
import { dxf } from "./helpers.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const file = (path: string, content = path): FileInput => ({
  name: baseName(path),
  path,
  data: bytes(content),
});

function store(...paths: string[]): FileStore {
  const s = new FileStore();
  s.add(paths.map((p) => file(p)));
  return s;
}

describe("file names", () => {
  it("takes base names of Windows, Unix and UNC paths", () => {
    expect(baseName("C:\\Program Files\\Autodesk\\AutoCAD 2027\\Fonts\\txt.shx")).toBe("txt.shx");
    expect(baseName("..\\images\\photo.jpg")).toBe("photo.jpg");
    expect(baseName("\\\\server\\share\\x.png")).toBe("x.png");
    expect(baseName("/usr/share/fonts/a.ttf")).toBe("a.ttf");
    expect(baseName("romans")).toBe("romans");
  });

  it("classifies files by extension", () => {
    expect(fileKind("A.DXF")).toBe("drawing");
    expect(fileKind("txt.SHX")).toBe("font");
    expect(fileKind("arial.ttf")).toBe("font");
    expect(fileKind("photo.JPG")).toBe("image");
    expect(fileKind("plan.pdf")).toBe("image");
    expect(fileKind("README")).toBe("other");
  });

  it("recognizes absolute paths", () => {
    for (const p of [
      "C:\\a\\b.png",
      "c:x.png",
      "/a/b.png",
      "\\a.png",
      "\\\\srv\\s\\a.png",
      "file:///C:/a.png",
    ])
      expect(isAbsolutePath(p)).toBe(true);
    for (const p of ["a.png", "images\\a.png", "..\\a.png", "./a.png"]) expect(isAbsolutePath(p)).toBe(false);
  });
});

describe("FileStore matching", () => {
  it("matches full paths by base name, case-insensitively", async () => {
    const s = store("TXT.SHX", "photo.jpg");
    expect(s.find("C:\\Program Files\\Autodesk\\AutoCAD 2027\\Fonts\\txt.shx", "font")?.name).toBe("TXT.SHX");
    expect(s.find("\\\\server\\share\\images\\PHOTO.jpg", "image")?.name).toBe("photo.jpg");
    expect(s.find("/home/x/Photo.JPG")?.name).toBe("photo.jpg");
    expect(text(await s.read("..\\images\\photo.jpg", "image"))).toBe("photo.jpg");
    expect(s.find("other.png", "image")).toBeUndefined();
  });

  it("adds font extensions to bare names in resolver order", () => {
    expect(store("txt.ttf", "txt.shx").find("txt", "font")?.name).toBe("txt.shx");
    expect(store("Romans.SHX").find("romans", "font")?.name).toBe("Romans.SHX");
    expect(store("arial.ttf").find("ARIAL", "font")?.name).toBe("arial.ttf");
    // a file stored without extension matches exactly; extensions are only added to the request
    expect(store("txt").find("txt", "font")?.name).toBe("txt");
    expect(store("txt.shx").find("txt.ttf", "font")).toBeUndefined();
    // images try image extensions only
    expect(store("logo.shx", "logo.png").find("logo", "image")?.name).toBe("logo.png");
  });

  it("prefers the file with the longest matching trailing path", () => {
    const s = store(
      "proj/old/fonts/txt.shx",
      "proj/fonts/txt.shx",
      "proj/AutoCAD 2027/Fonts/txt.shx",
      "txt.shx",
    );
    expect(s.find("C:\\Program Files\\Autodesk\\AutoCAD 2027\\Fonts\\txt.shx")?.path).toBe(
      "proj/AutoCAD 2027/Fonts/txt.shx",
    );
    expect(s.find("D:\\x\\old\\fonts\\txt.shx")?.path).toBe("proj/old/fonts/txt.shx");
    // no directory in common: the shallowest path, then the path order
    expect(s.find("txt.shx")?.path).toBe("txt.shx");
    expect(store("b/x.png", "a/x.png").find("x.png")?.path).toBe("a/x.png");
    expect(store("a/x.png", "b/x.png").find("x.png")?.path).toBe("a/x.png");
  });

  it("resolves relative paths against the open drawing's folder", () => {
    const s = store(
      "site/dwg/plan.dxf",
      "site/images/photo.jpg",
      "other/images/photo.jpg",
      "site/dwg/photo.jpg",
    );
    s.setDrawing("site/dwg/plan.dxf");
    expect(s.find("..\\images\\photo.jpg")?.path).toBe("site/images/photo.jpg");
    expect(s.find("photo.jpg")?.path).toBe("site/dwg/photo.jpg");
    // absolute paths: trailing match, then closeness to the drawing
    expect(s.find("C:\\work\\images\\photo.jpg")?.path).toBe("site/images/photo.jpg");
    s.setDrawing(undefined);
    expect(s.find("..\\images\\photo.jpg")?.path).toBe("other/images/photo.jpg");
  });

  it("replaces files with the same path, removes by path or name, counts generations", () => {
    const s = new FileStore();
    expect(s.generation).toBe(0);
    s.add([file("a/x.shx", "1"), file("b/x.shx", "2"), file("y.png")]);
    expect(s.generation).toBe(1);
    s.add([file("A/X.SHX", "3")]);
    expect(s.list().map((f) => f.path)).toEqual(["A/X.SHX", "b/x.shx", "y.png"]);
    expect(s.remove("b/x.shx")).toBe(1);
    expect(s.remove("x.shx")).toBe(1);
    expect(s.remove("nope")).toBe(0);
    expect(s.generation).toBe(4);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.generation).toBe(5);
  });

  it("keeps File objects and reads them on demand", async () => {
    const s = new FileStore();
    const f = new File([bytes("shx bytes")], "TXT.SHX");
    const [entry] = s.add([f]);
    expect(entry).toMatchObject({ name: "TXT.SHX", path: "TXT.SHX", size: 9, kind: "font" });
    expect(s.pathOf(f)).toBe("TXT.SHX");
    expect(text(await s.read("txt", "font"))).toBe("shx bytes");
  });
});

describe("openFiles drawing choice", () => {
  it("opens the first drawing among the added files, or the named one", () => {
    const s = new FileStore();
    const added = s.add([file("fonts/txt.shx"), file("B.dxf"), file("sub/A.DXF")]);
    expect(chooseDrawing(s, added)?.path).toBe("B.dxf");
    expect(chooseDrawing(s, added, "a")?.path).toBe("sub/A.DXF");
    expect(chooseDrawing(s, added, "C:\\any\\sub\\a.dxf")?.path).toBe("sub/A.DXF");
    expect(chooseDrawing(s, added, false)).toBeUndefined();
    expect(chooseDrawing(s, added, "txt.shx")).toBeUndefined();
    expect(chooseDrawing(s, s.add([file("img.png")]))).toBeUndefined();
  });
});

describe("relative URLs", () => {
  it("resolves relative paths and the base name against the drawing URL", () => {
    const base = "http://host/files/dwg/plan.dxf";
    expect(relativeUrls(base, "..\\images\\my photo.jpg")).toEqual([
      "http://host/files/images/my%20photo.jpg",
      "http://host/files/dwg/my%20photo.jpg",
    ]);
    expect(relativeUrls(base, "C:\\work\\photo.jpg")).toEqual(["http://host/files/dwg/photo.jpg"]);
    expect(relativeUrls(base, "photo.jpg")).toEqual(["http://host/files/dwg/photo.jpg"]);
  });
});

describe("asset generations", () => {
  const assets = join(import.meta.dirname, "..", "..", "fonts", "assets");
  const params = (over: Partial<RenderParams> = {}): RenderParams => ({
    layout: "Model",
    area: { type: "extents" },
    canvas: [400, 300],
    background: [255, 255, 255],
    layers: {},
    lineweights: true,
    raster: "smooth",
    fallbackFont: "fb.shx",
    ...over,
  });
  const drawing = dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1032
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 STYLE
0 STYLE
2 Standard
70 0
40 0
41 1
50 0
71 0
42 2.5
3 C:\\Fonts\\romans.shx
4
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
0 TEXT
5 T1
8 0
10 0
20 0
30 0
40 5
1 AB
7 Standard
0 ENDSEC
0 EOF
`);

  it("looks fonts up again after files are added (new generation)", async () => {
    const s = new FileStore();
    const fb = new Uint8Array(readFileSync(join(assets, "truedxf-test-uni.shx")));
    s.add([{ name: "fb.shx", data: fb }]);
    const requests: string[] = [];
    const loadFont = async (name: string) => {
      requests.push(name);
      return s.read(name, "font");
    };
    const core = new ViewerCore(loadFont, async () => undefined);
    core.load(drawing, "fonts.dxf");
    const missing = (r: { warnings: { code: string; items?: string[] }[] }) =>
      r.warnings.find((w) => w.code === ViewerWarningCode.FontMissing)?.items ?? [];

    expect(missing(await core.render(params({ assets: s.generation })))).toContain("romans.shx");
    // the user adds the font: same generation → cached miss; new generation → found
    s.add([{ name: "ROMANS.SHX", path: "fonts/ROMANS.SHX", data: fb }]);
    requests.length = 0;
    expect(missing(await core.render(params({ assets: s.generation - 1 })))).toContain("romans.shx");
    expect(requests).toEqual([]);
    expect(missing(await core.render(params({ assets: s.generation })))).toEqual([]);
    expect(requests).toContain("romans.shx");
  });
});
