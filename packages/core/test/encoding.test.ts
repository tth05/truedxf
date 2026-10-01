import { describe, expect, it } from "vitest";
import { getDecoder } from "../src/index.ts";

describe("windows-1252 decoding", () => {
  it("decodes 0x80–0x9F as windows-1252, not as C1 controls (Node decodes them as ISO-8859-1)", () => {
    for (const label of ["windows-1252", "latin1", "iso-8859-1"]) {
      expect(getDecoder(label).decode(Uint8Array.of(0x80, 0x8a, 0x93, 0x9f, 0x41, 0xe4))).toBe("€Š“ŸAä");
    }
    // the five undefined bytes stay C1 controls (WHATWG)
    expect(getDecoder("windows-1252").decode(Uint8Array.of(0x81, 0x9d)).codePointAt(1)).toBe(0x9d);
  });
});
