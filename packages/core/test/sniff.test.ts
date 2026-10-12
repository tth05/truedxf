import { describe, expect, it } from "vitest";
import { BINARY_SENTINEL, sniffFile } from "../src/index.ts";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

describe("sniffFile", () => {
    it("accepts ASCII DXF with any line ending, BOM, comments and leading blank lines", () => {
        expect(sniffFile(bytes("  0\r\nSECTION\r\n  2\r\nHEADER\r\n"))).toBe("ascii");
        expect(sniffFile(bytes("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"))).toBe("ascii");
        expect(sniffFile(bytes("  0\r\r\nSECTION\r\r\n"))).toBe("ascii");
        expect(sniffFile(bytes("0\rSECTION\r"))).toBe("ascii");
        expect(sniffFile(bytes("﻿999\nmade by x\n0\nSECTION\n"))).toBe("ascii");
        expect(sniffFile(bytes("\n\n  0\nEOF\n"))).toBe("ascii");
    });

    it("accepts files without a SECTION start (a header variable first)", () => {
        expect(sniffFile(bytes("999\r\nGerber\r\n  9\r\n$ACADVER\r\n  1\r\nAC1009\r\n"))).toBe("ascii");
        expect(sniffFile(bytes("  0\r\nENDSEC\r\n  0\r\nSECTION\r\n"))).toBe("ascii");
    });

    it("recognises binary DXF, DXB and DWG", () => {
        expect(sniffFile(bytes(`${BINARY_SENTINEL}\x00SECTION\x00`))).toBe("binary");
        expect(sniffFile(bytes("AutoCAD DXB 1.0\r\n\x1a\x00..."))).toBe("dxb");
        expect(sniffFile(new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0, 0, 0, 0, 0, 3]))).toBe("dwg");
        expect(sniffFile(bytes("AC1.40\x00\x00"))).toBe("dwg");
    });

    it("rejects other files", () => {
        expect(sniffFile(bytes("%PDF-1.7\n%\xe2\xe3\n1 0 obj\n"))).toBe("unknown");
        expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe(
            "unknown",
        );
        expect(sniffFile(bytes("{\\rtf1\\ansi\n"))).toBe("unknown");
        expect(sniffFile(bytes("garbage not a dxf at all"))).toBe("unknown");
        expect(sniffFile(bytes("MULTILEADER\r\n  5\r\n2A2\r\n"))).toBe("unknown");
        expect(sniffFile(bytes("1\n2\n3\n4\n"))).toBe("unknown");
        expect(sniffFile(bytes(""))).toBe("unknown");
    });
});
