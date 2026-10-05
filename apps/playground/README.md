# truedxf playground

Vite app around `@truedxf/viewer` for opening DXF files and, with the local `samples/` folder,
comparing fixtures with AutoCAD references and browsing the corpus.

```bash
pnpm playground            # dev server on http://localhost:5173
pnpm playground:build      # static build in apps/playground/dist (with the samples modes)
pnpm playground:deploy     # public build → Cloudflare Pages (see "Public site")
```

## Features

- **Modes** (only when `samples/` exists): **Viewer**; **Fixtures**, a suite/case browser with
  scores from `samples/reports/scoreboard/*.log` and `samples/out/visual/results.json` that
  compares our plot-mode render (raster `autocad`, the case's plot request) with
  `samples/refs/acad2027-*/<suite>/<case>.png` side by side, as onion skin or as a diff (red =
  only AutoCAD, blue = only truedxf, grey = both); **Corpus**, a search over
  `samples/external/manifest.jsonl` by path/title, entity type, version and producer.
- **Open** a DXF with the button, `Ctrl+O`, drag and drop, or `?file=<url>` (in dev, local files
  load through Vite's `/@fs/<absolute path>` URLs). `window.viewer` / `window.truedxf.viewer` is
  the `DxfViewer` (e.g. `viewer.openFiles(files)` from the console).
- **Fonts, shape files and images** (additional files, see
  [packages/viewer/README.md](../../packages/viewer/README.md)): select them together with the
  drawing in the Open dialog, open a whole folder (arrow next to Open → "Open folder…";
  `webkitdirectory`), or drop several files or a folder (read recursively). Files selected
  without a drawing are added to the open one, which re-renders (also the "add them" link next to
  missing files). With several drawings you choose one; the others stay in the **Files** panel
  (right), click one to switch. Matching is by file name only: the folders written in the DXF
  (`C:\…\Fonts\txt.shx`, `..\images\a.png`) do not matter, and `txt` finds `txt.shx`. The panel
  lists what the drawing still lacks (fonts, big fonts, images, shape files). Drawings opened
  with `?file=<url>` also find images next to them on the server. Nothing leaves the browser.
- **Recent drawings** (Chromium: File System Access API, [src/recent.ts](src/recent.ts)): drawings
  opened with the Open / folder dialog or dropped keep their file handles in IndexedDB and are
  listed on the start page and in the Open menu; one click reopens them with the files opened
  together with them (or their folder). The browser asks again for permission to read them.
  Other browsers use plain file inputs and have no list.
- **Layouts** and **Layers** (click: toggle, Alt+click: isolate, filter box) in the left panel.
- **Search** (`Ctrl+F`, top bar): texts of the current layout, block content and attributes
  included; Enter / Shift+Enter step through the matches, each zoomed to and outlined; matches
  in other layouts are offered as links.
- **Export** (download button): the view as PNG, copied to the clipboard, or printed (`Ctrl+P`,
  dark model space on white). **Zoom** buttons (+ / − / fit) at the bottom right; `?` lists the
  keyboard shortcuts.
- **Resizable panels**: drag a sidebar's inner edge or the line between two panels;
  double-click a handle to reset. Sizes are kept in `localStorage` (`truedxf.layout`).
- **Inspector**: click an entity for its type, handle, owning block, layer, colour / linetype /
  lineweight / transparency (raw → resolved) and the raw DXF tags of its record.
- **Measure** (`M`, two clicks; snaps to end points, midpoints, centres, quadrants and points,
  Alt held measures freely), **Fit** (`F` or double-click on empty space), dark / light
  background, lineweights on/off.
- **Errors**: a file that is not a DXF is refused with a message (and, unless it is a DWG, a
  "Report on GitHub" button); DWG files among the opened files are shown in red with a hint.
  Screens narrower than 900 px hide the side panels; a one-time dialog says so.
- **Status bar**: file, entity count, parse / render / upload times, first frame, batches and
  vertices, backend (worker or main thread), cursor world coordinates.
- **Diagnostics panel**: viewer warnings (`viewer.warnings`, e.g. missing fonts, colours adjusted
  for contrast), what the renderer could not draw (`unsupported` counts), model diagnostics and
  entity types. When nothing shows (empty layout, all content layers off / frozen / hidden,
  everything in the background colour, …) a notice in the stage says why and offers an action
  (show all layers, open the layout with content, switch the background).
  `?fallbackFont=a.shx,b.ttf` sets the fonts for text whose font is missing.

## Fonts

Lookup order (`src/fonts.ts`), after the files opened with the drawing:

1. the user's **fonts folder** (Open menu → "Fonts folder…", or the link in the Files panel when
   fonts are missing). Chromium browsers remember it across visits (File System Access API,
   handle in IndexedDB; after a restart the Files panel offers "reconnect" when the permission
   lapsed); other browsers pick it with a folder input per visit. Up to 20 000 font files,
   4 folder levels deep;
2. `/fonts/<file>`: `packages/fonts/assets` (our MIT test fonts) and `apps/playground/fonts`
   (Liberation Sans / Serif / Mono, SIL OFL 1.1, see [fonts/README.md](fonts/README.md)), both
   copied into every build. The dev server and `vite preview` (only) also serve the local system
   font folders and `C:\Program Files\Autodesk\AutoCAD 2027\Fonts` (extra folders:
   `TRUEDXF_FONT_DIRS`, `;`-separated), so real drawings get real fonts on this machine. Nothing
   from those folders is copied into the repository or the build output;
3. the metric-compatible Liberation face for a missing Windows core font (`arial*.ttf`,
   `times*.ttf`, `cour*.ttf`). Any other missing font falls back to the viewer's list, which ends
   in Liberation Sans on the public site.

## Public site

`pnpm playground:deploy` (= `vite build --mode public` + `wrangler pages deploy dist --project-name
truedxf`) publishes to Cloudflare Pages. The `public` mode differs from the default build:

- no Fixtures / Corpus code (`__SAMPLES__` is false, so it is tree-shaken) and no sourcemaps;
- `index.html` gets the canonical URL / Open Graph URLs for `SITE_URL` (default
  `https://truedxf.pages.dev`; set it for a custom domain) and `REPO_URL` (default
  `https://github.com/tth05/truedxf`); local builds drop the canonical link;
- `robots.txt`, `sitemap.xml` and Cloudflare's `_headers` ([cloudflare/_headers](cloudflare/_headers):
  CSP, `nosniff`, no framing, immutable `/assets/*`);
- `404.html` ([cloudflare/404.html](cloudflare/404.html)): without it Cloudflare Pages answers
  every unknown path with `index.html` and status 200 (single-page-app mode);
- `version.json` with the build id. An open tab checks it when it becomes visible again, every
  30 minutes and after viewer errors ([src/update.ts](src/update.ts)): a newer deployment shows
  "A new version is available" with a Reload button; a tab with nothing open that you come back
  to reloads by itself.

The static `#landing` content of `index.html` (heading, features, FAQ, licence and trademark
notes) is what search engines and no-JS visitors see; `main.ts` moves it into the stage as the
empty state. `public/og.png` (link previews) and `public/apple-touch-icon.png` are rendered by
`pnpm --filter @truedxf/playground site-images` (Playwright). The status bar links to the source
and a prefilled GitHub issue ("Report a problem": build, browser, DXF version, entity types, what
was not rendered; never the file name).

One-time setup and checks:

```bash
pnpm --filter @truedxf/playground exec wrangler login
pnpm --filter @truedxf/playground exec wrangler pages project create truedxf --production-branch master
pnpm --filter @truedxf/playground run preview:public   # public build with _headers on http://localhost:8788
```

**Pre-launch gate:** [functions/_middleware.ts](functions/_middleware.ts) (a Pages Function
wrangler uploads with the site) answers every request with HTTP Basic Auth (user `truedxf`,
password `truedxf`, also for preview URLs and `preview:public`). Delete it and redeploy to go
public. The gate is part of each deployment: a deployment's own URL (`<id>.truedxf.pages.dev`)
keeps the state it was deployed with (`wrangler pages deployment delete <id>` removes one).

Deploys from `master` go to production, other branches to preview URLs. For search, verify the
domain in Google Search Console (a DNS record in Cloudflare) and submit `sitemap.xml`.

## Tests and performance

- `test/samples.test.ts`: the samples API on a temporary folder.
- `test/smoke.test.ts`: builds the app, serves it with `vite preview`, opens a small DXF in
  headless Chromium (SwiftShader), checks drawn pixels and click → selection → inspector. Skipped
  when Playwright's Chromium is not installed.
- `pnpm perf:viewer [--count 5] [--files external/…] [--gpu]`: opens the largest ASCII DXFs of
  the corpus in the built app and reports parse / frontend / upload / first-frame / frame times
  (SwiftShader by default, so pessimistic). Results: `samples/reports/viewer-perf.json`.
- `--files-from samples/reports/prof/perf-files.txt` reads the comma-separated UTF-8 file list
  without shell encoding problems. Performance results include renderer draw calls.
- The viewer merges batches by default; `?merge=0` uses the original path for comparison and
  `?aa=0` disables antialiasing. The plot comparison renderer keeps its original path.
- `pnpm exec node apps/playground/scripts/merge-check.ts` compares fitted views with merging on
  and off, with antialiasing disabled on the real D3D11 GPU. It reads that same UTF-8 file list
  and writes `samples/reports/prof/merge-check.json`. Synthetic checks cover painter order,
  clipping, blending, images, host layers, released arrays and fallback paths. Optional
  `--only circles_large --diagnose` compares against the original renderer with rebased batch
  origins to isolate coordinate-rounding differences; `--skip-build` reuses the build.

Measured 2026-10-01 (`pnpm perf:viewer --count 6`, headless Chromium on SwiftShader, 1600×1000,
worker backend; the 75.8 MB file renders at ~15 ms per frame on this machine's GPU):

| File | MB | parse | frontend | first frame | vertices / batches | frame (SwiftShader) |
|---|---|---|---|---|---|---|
| spline_points_large | 80.2 | 1.7 s | 3.3 s | 5.3 s | 1.67 M / 2 | 104 ms |
| 1#门诊…(proxy entities) | 75.8 | 0.8 s | 1.6 s | 3.1 s | 2.40 M / 3976 | 242 ms |
| ellipse_large | 43.7 | 1.1 s | 1.1 s | 2.4 s | 1.73 M / 2 | 118 ms |
| arcs-large | 40.4 | 1.4 s | 1.2 s | 2.9 s | 2.87 M / 3 | 240 ms |
| lines_large | 35.6 | 1.0 s | 0.6 s | 1.9 s | 0.38 M / 1 | 27 ms |
| Mr DIY … Elektrik Projeler | 34.5 | 0.3 s | 1.3 s | 1.9 s | 1.98 M / 1972 | 181 ms |
