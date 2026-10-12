/**
 * Backends run the ViewerCore: in a module worker (default) or on the main thread (fallback when
 * workers are unavailable, or when requested). Font and image requests from the worker are
 * answered on the main thread by the configured loaders, so any loader works (fetch, File
 * System Access, in-memory maps, …).
 */
import type { AssetLoader, FromWorker, Request, ResponseValue, ToWorker, ViewerCore } from "./protocol.ts";

export interface Backend {
    call<R extends Request>(request: R, transfer?: Transferable[]): Promise<ResponseValue<R>>;
    dispose(): void;
    readonly kind: "worker" | "main";
}

/** Main-thread backend; the pipeline (parser, model, frontend) is loaded on first use. */
export class LocalBackend implements Backend {
    readonly kind = "main";
    private readonly core: Promise<ViewerCore>;

    constructor(loadFont: AssetLoader, loadImage: AssetLoader) {
        this.core = import("./protocol.ts").then((m) => new m.ViewerCore(loadFont, loadImage));
    }

    async call<R extends Request>(request: R): Promise<ResponseValue<R>> {
        return (await (await this.core).handle(request)) as ResponseValue<R>;
    }

    dispose(): void {}
}

export class WorkerBackend implements Backend {
    readonly kind = "worker";
    private readonly worker: Worker;
    private nextId = 1;
    private readonly pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
    private readonly loadFont: AssetLoader;
    private readonly loadImage: AssetLoader;

    constructor(worker: Worker, loadFont: AssetLoader, loadImage: AssetLoader) {
        this.worker = worker;
        this.loadFont = loadFont;
        this.loadImage = loadImage;
        worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
        worker.onerror = (ev) => {
            const err = new Error(`viewer worker failed: ${ev.message || "error"}`);
            for (const p of this.pending.values()) p.fail(err);
            this.pending.clear();
        };
    }

    call<R extends Request>(request: R, transfer: Transferable[] = []): Promise<ResponseValue<R>> {
        const id = this.nextId++;
        return new Promise((ok, fail) => {
            this.pending.set(id, { ok: ok as (v: unknown) => void, fail });
            const msg: ToWorker = { kind: "request", id, request };
            this.worker.postMessage(msg, transfer);
        });
    }

    private receive(m: FromWorker): void {
        if (m.kind === "asset") {
            const load = m.asset === "font" ? this.loadFont : this.loadImage;
            load(m.name)
                .catch(() => undefined)
                .then((bytes) => {
                    const reply: ToWorker = { kind: "asset", id: m.id, bytes };
                    // copies: loaders may cache their buffers
                    this.worker.postMessage(reply);
                });
            return;
        }
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.ok(m.value);
        else p.fail(new Error(m.error));
    }

    dispose(): void {
        this.worker.terminate();
        for (const p of this.pending.values()) p.fail(new Error("viewer disposed"));
        this.pending.clear();
    }
}
