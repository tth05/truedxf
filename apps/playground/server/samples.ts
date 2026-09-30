/**
 * Dev-server API over the local samples/ folder (docs/PLAN.md §7.6: samples stay local and may be
 * absent — every endpoint then answers with empty data).
 */
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

export const SAMPLES = join(import.meta.dirname, "..", "..", "..", "samples");

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

export function samplesMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/samples/")) return next();
    const route = url.pathname.slice("/api/samples/".length);
    if (route === "status") return json(res, { available: existsSync(SAMPLES) });
    json(res, { error: "not found" }, 404);
  };
}
