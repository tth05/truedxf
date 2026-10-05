# @truedxf/core

The DXF tag layer: turns ASCII or binary DXF bytes into a lossless, lazily decoded tag store.

## What it does

- `tokenize(bytes)` splits ASCII DXF (CRLF, LF or lone CR line ends, UTF-8 BOM, padded group
  codes) and binary DXF (R12 1-byte codes with the 255 escape, R13+ 2-byte codes) into a
  `TagStore`. DXB input throws `DxfFormatError`.
- `sniffFile(bytes)` tells ASCII / binary DXF from DWG, DXB and other files by their first lines
  (lenient: `999` comments and files without a leading `0 SECTION` pass).
- `TagStore` keeps the original bytes plus per-tag offsets (struct of typed arrays). Values are
  decoded only on access: `str`, `num`, `int`, `bigint`, `bool`, `handle`, `binary`, `value`;
  `lineOf(i)` gives the 1-based source line for diagnostics.
- `readTags(bytes, options)` tokenizes, finds sections (`scanSections`, tolerant of missing
  ENDSEC and duplicates) and picks the string encoding (`detectEncoding`): UTF-8 for AC1021+,
  otherwise `$DWGCODEPAGE` via `codepageToEncoding`, with a per-string code page fallback for
  invalid UTF-8. An `encoding` override and an opt-in `utf8Heuristic` exist.
- Group-code typing by range: `valueKind`, `ValueKind`, `isPointCode` (note 01 §1.2 table).
- `decodeUnicodeEscapes` (`\U+XXXX`, `\M+NXXXX`) and `decodeCaret` (`^J` and friends) for the
  semantic layer; the store itself returns strings as written.
- `Diagnostics` collects errors/warnings/info with stable codes and a per-code cap.
- No DOM and no `node:*` imports: runs in browsers and Node.

## Usage

```ts
import { readTags } from "@truedxf/core";

declare const bytes: Uint8Array; // contents of an ASCII or binary .dxf file

const { store, sections, encoding, diagnostics } = readTags(bytes);
console.log(store.format, encoding.acadver, encoding.encoding);

const entities = sections.find((s) => s.name === "ENTITIES");
if (entities) {
  for (let i = entities.start; i < entities.end; i++) {
    if (store.code(i) === 0) console.log(store.str(i), "line", store.lineOf(i));
  }
}
for (const d of diagnostics.items) console.warn(d.severity, d.code, d.message);
```

## Status

- Not published to npm yet (version 0.0.0); consumed from source inside the workspace.
- The whole local corpus tokenizes without exceptions (`pnpm corpus:tags`). PLAN.md records
  ~140 MB/s tokenizing.
- Input is one complete `Uint8Array`; there is no chunked or `ReadableStream` tokenizer.

## See also

- [research/notes/01-file-format.md](../../research/notes/01-file-format.md): group codes,
  binary DXF, encodings, tolerant parsing
- [@truedxf/model](../model/README.md): the typed document built on this store
