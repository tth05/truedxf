/**
 * Renders the public site's images into apps/playground/public (committed):
 * - og.png (1200 × 630): link preview (Open Graph / Twitter card);
 * - apple-touch-icon.png (180 × 180).
 *
 *   node apps/playground/scripts/site-images.ts
 *
 * Needs Playwright's Chromium (`pnpm exec playwright install chromium`). Re-run after changing
 * the branding below.
 */
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const OUT = resolve(import.meta.dirname, "..", "public");

const MARK =
    '<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2f81f7"/>' +
    '<path d="M8 23 L16 9 L24 23 Z" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';

/** A small floor plan with a dimension, in the viewer's dark-background colours. */
const PLAN = `<svg viewBox="0 0 520 420" width="520" height="420" fill="none" stroke-linecap="square">
  <g stroke="#e6edf3" stroke-width="5">
    <path d="M40 40 H480 V380 H40 Z"/>
    <path d="M260 40 V170 M260 230 V380 M40 220 H150 M200 220 H260"/>
  </g>
  <g stroke="#e6edf3" stroke-width="1.5">
    <path d="M150 220 A50 50 0 0 1 200 270"/>
    <path d="M260 170 A60 60 0 0 1 320 230"/>
  </g>
  <g stroke="#ff5f56" stroke-width="1.5" stroke-dasharray="14 5 3 5">
    <path d="M20 300 H500"/>
  </g>
  <g stroke="#3fb950" stroke-width="1" opacity="0.8">
    ${Array.from({ length: 14 }, (_, i) => `<path d="M${290 + i * 14} 380 L${270 + i * 14} 400"/>`).join("")}
  </g>
  <g stroke="#2f81f7" stroke-width="1.5">
    <path d="M40 18 H480 M40 10 V26 M480 10 V26"/>
    <path d="M40 18 l12 -4 v8 z M480 18 l-12 -4 v8 z" fill="#2f81f7"/>
  </g>
  <text x="260" y="12" fill="#2f81f7" font-size="15" font-family="Segoe UI, sans-serif" text-anchor="middle">8.80</text>
  <g fill="#8b96a3" font-size="16" font-family="Segoe UI, sans-serif">
    <text x="80" y="120">LIVING</text><text x="300" y="120">KITCHEN</text><text x="300" y="320">BEDROOM</text>
  </g>
</svg>`;

const OG = `<!doctype html><html><body style="margin:0">
<div style="width:1200px;height:630px;background:#0f1419;display:flex;align-items:center;
  font-family:'Segoe UI',system-ui,sans-serif;color:#e6edf3;box-sizing:border-box;padding:0 64px;gap:48px">
  <div style="flex:1">
    <div style="display:flex;align-items:center;gap:18px;font-size:44px;font-weight:650">
      <span style="width:64px;height:64px;display:inline-flex">${MARK}</span>truedxf
    </div>
    <div style="font-size:58px;font-weight:700;line-height:1.1;margin:36px 0 24px">Free online<br>DXF viewer</div>
    <div style="font-size:26px;color:#8b96a3;line-height:1.4">Drawn the way AutoCAD plots it.<br>
      Your files never leave your browser.</div>
  </div>
  <div style="background:#161b22;border:1px solid #2a323d;border-radius:16px;padding:24px">${PLAN}</div>
</div></body></html>`;

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(OG);
    await page.screenshot({ path: join(OUT, "og.png") });
    await page.setViewportSize({ width: 180, height: 180 });
    await page.setContent(
        `<!doctype html><html><body style="margin:0;background:#2f81f7">` +
            `<div style="width:180px;height:180px">${MARK.replace("<svg", '<svg width="180" height="180"').replace('rx="7"', 'rx="0"')}</div></body></html>`,
    );
    await page.screenshot({ path: join(OUT, "apple-touch-icon.png") });
} finally {
    await browser.close();
}
console.log(`wrote ${join(OUT, "og.png")} and apple-touch-icon.png`);
