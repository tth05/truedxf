import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatNotices, packageNotices } from "../server/licenses.ts";

const require = createRequire(join(import.meta.dirname, "..", "package.json"));

describe("third-party notices", () => {
  it("lists each npm package once with its licence file, skipping virtual and workspace modules", () => {
    const three = require.resolve("three");
    const ids = [
      three,
      `${three}?worker`,
      join(dirname(three), "..", "src", "Three.js"),
      "\0vite/preload-helper.js",
      join(import.meta.dirname, "..", "src", "main.ts"),
    ];
    const notices = packageNotices(ids);
    expect(notices.map((n) => n.name)).toEqual(["three"]);
    expect(notices[0]!.license).toBe("MIT");
    expect(notices[0]!.files.map((f) => f.name)).toContain("LICENSE");
    expect(notices[0]!.files[0]!.text).toMatch(/Permission is hereby granted/);

    const text = formatNotices(notices, "https://example.org/repo");
    expect(text).toContain(`  three ${notices[0]!.version} (MIT)\n`);
    expect(text).toContain("--- LICENSE ---");
    expect(text.endsWith("\n")).toBe(true);
  });
});
