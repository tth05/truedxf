/** Module worker entry of the viewer backend (see backend.ts). */
import { serveWorker } from "./serve.ts";

serveWorker(self as unknown as Parameters<typeof serveWorker>[0]);
