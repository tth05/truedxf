import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname, "harness"),
  base: "./",
  logLevel: "warn",
  build: {
    outDir: resolve(import.meta.dirname, ".harness-dist"),
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    sourcemap: true,
  },
});
