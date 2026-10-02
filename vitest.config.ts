import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // Geometry property tests sample thousands of points per generated curve.
    testTimeout: 15000,
  },
});
