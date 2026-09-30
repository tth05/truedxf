/** Worker side of the viewer backend (see backend.ts). */
import {
  type AssetLoader,
  type FromWorker,
  responseTransfer,
  type ToWorker,
  ViewerCore,
} from "./protocol.ts";

/**
 * Worker side: wires a ViewerCore to a worker scope. Exported for custom worker entry points
 * (import it from "@truedxf/viewer/worker" or call it from your own worker module).
 */
export function serveWorker(scope: {
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}): void {
  let nextAsset = 1;
  const waiting = new Map<number, (b: Uint8Array | undefined) => void>();
  const asset =
    (kind: "font" | "image"): AssetLoader =>
    (name) =>
      new Promise((ok) => {
        const id = nextAsset++;
        waiting.set(id, ok);
        scope.postMessage({ kind: "asset", id, asset: kind, name });
      });
  const core = new ViewerCore(asset("font"), asset("image"));
  scope.onmessage = (ev) => {
    const m = ev.data;
    if (m.kind === "asset") {
      waiting.get(m.id)?.(m.bytes);
      waiting.delete(m.id);
      return;
    }
    core.handle(m.request).then(
      (value) => scope.postMessage({ kind: "response", id: m.id, ok: true, value }, responseTransfer(value)),
      (err: unknown) =>
        scope.postMessage({
          kind: "response",
          id: m.id,
          ok: false,
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        }),
    );
  };
}
