/** Build-time constants (vite.config.ts `define`). */

/** Fixtures / Corpus modes over the local samples/ folder (false in the public build). */
declare const __SAMPLES__: boolean;

/** The deployed site checks version.json for newer deployments (true in the public build only). */
declare const __UPDATES__: boolean;

/** Build stamp (`id` differs per build) and repository URL. */
declare const __BUILD__: { commit: string; date: string; id: string; repo: string };
