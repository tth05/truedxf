/** Build-time constants (vite.config.ts `define`). */

/** Fixtures / Corpus modes over the local samples/ folder (false in the public build). */
declare const __SAMPLES__: boolean;

/** Build stamp and repository URL. */
declare const __BUILD__: { commit: string; date: string; repo: string };
