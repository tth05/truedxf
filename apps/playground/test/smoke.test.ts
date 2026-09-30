/**
 * End-to-end smoke test: builds the playground, serves it with `vite preview`, opens a small DXF
 * in headless Chromium (SwiftShader WebGL), checks that something is drawn and that clicking an
 * entity selects and inspects it. Skipped when Playwright's Chromium is not installed.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decode } from "fast-png";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP = resolve(import.meta.dirname, "..");
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

function dxf(listing: string): string {
  const out: string[] = [];
  for (const line of listing.trim().split("\n")) {
    const [code, ...rest] = line.trim().split(" ");
    out.push(code!.padStart(3), rest.join(" "));
  }
  return `${out.join("\r\n")}\r\n`;
}

// a red LINE (A1) on layer WALLS and a white SOLID (A2)
const SMOKE = dxf(`
0 SECTION
2 HEADER
9 $ACADVER
1 AC1009
0 ENDSEC
0 SECTION
2 TABLES
0 TABLE
2 LAYER
70 1
0 LAYER
2 WALLS
70 0
62 1
6 CONTINUOUS
0 ENDTAB
0 ENDSEC
0 SECTION
2 ENTITIES
0 LINE
5 A1
8 WALLS
10 0
20 0
11 100
21 100
0 SOLID
5 A2
8 0
10 150
20 0
11 250
21 0
12 150
22 100
13 250
23 100
0 ENDSEC
0 EOF
`);

describe.skipIf(!hasChromium)("playground smoke test (Chromium)", () => {
  let outDir: string;
  let browser: Browser;
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const { build, preview } = await import("vite");
    outDir = mkdtempSync(join(tmpdir(), "truedxf-playground-"));
    const config = { configFile: join(APP, "vite.config.ts"), root: APP, logLevel: "error" as const };
    await build({ ...config, build: { outDir, emptyOutDir: true, sourcemap: false } });
    writeFileSync(join(outDir, "smoke.dxf"), SMOKE);
    const server = await preview({ ...config, build: { outDir }, preview: { port: 0 } });
    url = server.resolvedUrls?.local[0] ?? "";
    close = () => server.close();
    browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await close?.();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("renders a DXF and picks an entity on click", async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}?file=smoke.dxf`);
    await page.waitForFunction(
      () => (window as unknown as { truedxf?: { metrics: unknown[] } }).truedxf?.metrics.length,
      undefined,
      { timeout: 60_000 },
    );
    const metric = await page.evaluate(
      () =>
        (window as unknown as { truedxf: { metrics: { entities: number; backend: string }[] } }).truedxf
          .metrics[0]!,
    );
    expect(metric).toMatchObject({ entities: 2, backend: "worker" });

    // something other than the background is drawn
    const canvas = page.locator(".viewer canvas");
    const box = (await canvas.boundingBox())!;
    const shot = decode(await canvas.screenshot());
    let ink = 0;
    let red = 0;
    const ch = shot.channels;
    for (let i = 0; i < shot.width * shot.height; i++) {
      const r = shot.data[i * ch]!;
      const g = shot.data[i * ch + 1]!;
      const b = shot.data[i * ch + 2]!;
      if (Math.abs(r - 33) + Math.abs(g - 40) + Math.abs(b - 48) > 30) ink++;
      if (r > 150 && g < 80 && b < 80) red++;
    }
    expect(ink).toBeGreaterThan(1000);
    expect(red).toBeGreaterThan(50);

    // click the middle of the line → selection A1, inspector shows LINE
    const [x, y] = (await page.evaluate(() =>
      (
        window as unknown as { truedxf: { viewer: { worldToScreen(x: number, y: number): number[] } } }
      ).truedxf.viewer.worldToScreen(50, 50),
    )) as [number, number];
    await page.mouse.click(box.x + x, box.y + y);
    await page.waitForFunction(() =>
      document.querySelector(".sidebar.right .kv")?.textContent?.includes("LINE"),
    );
    const selection = await page.evaluate(
      () => (window as unknown as { truedxf: { viewer: { selection?: string } } }).truedxf.viewer.selection,
    );
    expect(selection).toBe("A1");
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});
