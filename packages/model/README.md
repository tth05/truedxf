# @truedxf/model

A typed, read-only DXF document model whose entities, table entries and objects are views over
the lossless tag store of [@truedxf/core](https://github.com/tth05/truedxf/tree/master/packages/core).

## Install

```bash
pnpm add @truedxf/model
```

ESM only. No DOM and no Node.js APIs: runs in browsers, workers and Node.

## What it does

- `loadDxf(bytes, options)` (same as `DxfDocument.load`) builds a `DxfDocument` with `header`,
  `classes`, `tables`, `blocks`, `layouts`, `objects`, `modelSpace` and `paperSpace`, plus the
  lookups `getBlock`, `getEntity`, `getObject` and `namedObject`. Names are case-insensitive.
- Ownership comes from file position (ENTITIES split by group 67, BLOCKS by the enclosing BLOCK),
  not from group 330 (note 02 §4.2). Layouts are sorted by tab order.
- `Entity` is a union discriminated on `type`: LINE, POINT, CIRCLE, ARC, ELLIPSE, SOLID/TRACE,
  3DFACE, RAY/XLINE, SPLINE, SHAPE, LWPOLYLINE, POLYLINE/VERTEX, TEXT, ATTRIB/ATTDEF, INSERT,
  MTEXT, HATCH, MPOLYGON, DIMENSION (incl. ARC_ and LARGE_RADIAL_), LEADER, MULTILEADER,
  TOLERANCE, VIEWPORT, IMAGE, WIPEOUT, underlays, OLE2FRAME, MLINE, ACAD_TABLE, MESH, HELIX, the
  ACIS family and ACAD_PROXY_ENTITY. Anything else is an `UnknownEntity` with its `dxfType`.
- Every view keeps its `record: DxfRecord`, which exposes subclass, 102 app-data, embedded
  object and XDATA parts (`parts`, `subclass`, `appData`, `xdata`). `recordTags` and
  `xdataTags` return typed tags. Nothing in the file is dropped.
- Tables (`layers`, `linetypes`, `styles`, `dimstyles`, `vports`, `views`, `ucs`, `appids`,
  `blockRecords`) and objects (DICTIONARY, XRECORD, SORTENTSTABLE, LAYOUT, PLOTSETTINGS,
  MLINESTYLE, MLEADERSTYLE, TABLESTYLE, IMAGEDEF, SPATIAL_FILTER, GROUP, SCALE, ...).
- `PropertyResolver` / `resolveProperties`: effective layer, ACI, RGB, linetype, linetype
  scale, lineweight, transparency, plot style, visibility and plottability of an entity inside
  a block nesting stack and a paper-space viewport (per-viewport layer freeze and overrides).
- `effectiveDimStyle`: entity DSTYLE overrides > DIMSTYLE record > AutoCAD's imperial defaults
  (records are written sparsely, note 02 §2.6). `aciToRgb`, `nearestAci`, `ACI_PALETTE_LIGHT`
  and `ACI_PALETTE_DARK` for colours.
- No DOM and no `node:*` imports: runs in browsers and Node.

## Usage

```ts
import { readFileSync } from "node:fs";
import { loadDxf, PropertyResolver } from "@truedxf/model";

const doc = loadDxf(readFileSync("drawing.dxf")); // any Uint8Array
console.log(doc.acadver, doc.header.num("$INSUNITS", 0), doc.layouts.map((l) => l.name));

const resolver = new PropertyResolver(doc);
for (const e of doc.modelSpace.entities) {
  if (e.type !== "LINE") continue;
  const p = resolver.resolve(e); // top level: no parent INSERTs, no viewport
  console.log(e.handle, e.start, e.end, p.layer, p.rgb.toString(16), p.lineweightMm, p.visible);
}
for (const d of doc.diagnostics.items) console.warn(d.code, d.message);
```

## Status

- Read-only by design: truedxf reads and views DXF, it does not write or edit it. Parsers are
  hand-written.
- 182 corpus entities of 14 custom classes (KS_*, LIGHT, 3DLINE, REPEAT/ENDREP, ...) stay
  UNKNOWN. ACAD_TABLE cell content and MESH override data are not decoded.
- Against ezdxf over the project's real-world corpus: 99.77 % attribute agreement over 50.8 M compared
  attributes, residuals classified. Loading runs at ~53 MB/s.
- Some resolution rules are not confirmed in AutoCAD (ATTRIB parent, frozen vs. off INSERT
  layers). They are marked UNVERIFIED with question ids in `resolve.ts`.

## See also

- [01-file-format](https://github.com/tth05/truedxf/blob/master/research/notes/01-file-format.md),
  [02-tables-objects](https://github.com/tth05/truedxf/blob/master/research/notes/02-tables-objects.md),
  [03-entities-geometry](https://github.com/tth05/truedxf/blob/master/research/notes/03-entities-geometry.md),
  [05-dimensions-leaders](https://github.com/tth05/truedxf/blob/master/research/notes/05-dimensions-leaders.md),
  [06-hatch-linetype-appearance](https://github.com/tth05/truedxf/blob/master/research/notes/06-hatch-linetype-appearance.md) (property
  resolution), [07-blocks-inserts-misc](https://github.com/tth05/truedxf/blob/master/research/notes/07-blocks-inserts-misc.md)
- [@truedxf/geometry](https://github.com/tth05/truedxf/tree/master/packages/geometry) takes model points (`{ x, y, z }`) directly

## License

MIT. AutoCAD and DXF are trademarks of Autodesk, Inc. truedxf is not affiliated with or
endorsed by Autodesk.
