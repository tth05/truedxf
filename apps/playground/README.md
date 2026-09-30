# truedxf playground

A Vite app around `@truedxf/viewer`.

```bash
pnpm playground            # dev server on http://localhost:5173
pnpm playground:build      # static build in apps/playground/dist
```

- **Open** a DXF with the button, `Ctrl+O`, drag and drop, or `?file=<url>` (in dev, local
  files load through Vite's `/@fs/<absolute path>` URLs).
- **Layouts** and **Layers** (click: toggle, Alt+click: isolate, filter box) in the left panel.
- **Inspector**: click an entity for its type, handle, owning block, layer, colour / linetype /
  lineweight / transparency (raw → resolved) and the raw DXF tags of its record.
- **Measure** (`M`): two clicks. **Fit** (`F` or double-click on empty space). Dark / light
  background, lineweights on/off.
- Status bar: file, entity count, parse / render / upload times, first frame, batches and
  vertices, backend (worker or main thread), cursor world coordinates. The Diagnostics panel lists
  what the renderer could not draw (`unsupported` counts), model diagnostics and entity types.

## Fonts

`/fonts/<file>` serves `packages/fonts/assets` (our MIT test fonts, also copied into the build).
The **dev server only** additionally serves the local system font folders and
`C:\Program Files\Autodesk\AutoCAD 2027\Fonts` (extra folders: `TRUEDXF_FONT_DIRS`, `;`-separated),
so real drawings get real fonts on this machine. Nothing from those folders is copied into the
repository or the build output.
