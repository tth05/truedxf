/**
 * Newer deployments of the public site. Every build writes its id to `version.json`
 * (vite.config.ts); a tab left open keeps running its old build, whose lazily loaded chunks
 * (viewer worker, PDF.js) the new deployment no longer serves. The page checks when it becomes
 * visible again, every 30 minutes, and after errors. Coming back to a tab with nothing open
 * reloads it right away; otherwise the reload is offered (an open drawing's files would be gone,
 * and a page must not reload under someone reading it).
 */

const INTERVAL_MS = 30 * 60_000;
/** Visibility changes and errors check at most this often. */
const MIN_GAP_MS = 60_000;

export interface UpdateWatch {
  /** Checks now (unless checked within the last minute), e.g. after a failed load. */
  check(): void;
}

export function watchUpdates(options: {
  /** Whether reloading would lose something (a drawing or files are open). */
  inUse(): boolean;
  /** A newer version exists: offer `reload`. */
  offer(reload: () => void): void;
}): UpdateWatch {
  let last = 0;
  let found = false;
  const reload = () => location.reload();
  const check = async (force = false, returned = false) => {
    if (found || (!force && performance.now() - last < MIN_GAP_MS)) return;
    last = performance.now();
    let id: unknown;
    try {
      const r = await fetch("version.json", { cache: "no-store" });
      if (!r.ok) return;
      id = ((await r.json()) as { id?: unknown }).id;
    } catch {
      return; // offline or blocked: try again next time
    }
    if (typeof id !== "string" || id === __BUILD__.id) return;
    found = true;
    if (returned && !options.inUse()) reload();
    else options.offer(reload);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check(false, true);
  });
  setInterval(() => void check(true), INTERVAL_MS);
  return { check: () => void check() };
}
