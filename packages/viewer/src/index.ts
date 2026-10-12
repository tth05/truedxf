/**
 * Main-thread API. The pipeline (ViewerCore: parser, model, frontend) runs in the worker
 * ("@truedxf/viewer/worker") and is importable for Node / custom hosts from "@truedxf/viewer/core".
 */
export { type Backend, LocalBackend, WorkerBackend } from "./backend.ts";
export type { EntityGeometry } from "./drawing.ts";
export * from "./files.ts";
export * from "./interaction.ts";
export * from "./lod.ts";
export * from "./pick.ts";
export type {
    AssetLoader,
    DocumentInfo,
    EntityInfo,
    FromWorker,
    LayerInfo,
    LayoutInfo,
    RenderParams,
    RenderResult,
    Request,
    SearchResult,
    SnapHit,
    TagInfo,
    TextMatch,
    ToWorker,
} from "./protocol.ts";
export * from "./view.ts";
export * from "./viewer.ts";
export * from "./warnings.ts";
