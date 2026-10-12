/**
 * Release check for the publishable packages (`pnpm packages:check`, after `pnpm build`):
 * packs each one with pnpm (publishConfig applied, workspace:* replaced), checks the tarball
 * contents and manifest, installs all tarballs into a temporary consumer project, imports the
 * isomorphic packages in Node and type-checks a consumer file against every package.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
/** Packages whose entry points load without a DOM (AGENTS.md: isomorphic below the renderer). */
const ISOMORPHIC = new Set(["core", "model", "geometry", "fonts", "text", "render", "plot"]);

interface Manifest {
    name: string;
    version: string;
    private?: boolean;
    exports: Record<string, string | { types: string; default: string }>;
    dependencies?: Record<string, string>;
}

const sh = (cmd: string, args: string[], cwd: string) =>
    execFileSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });

const work = mkdtempSync(join(tmpdir(), "truedxf-pack-"));
const errors: string[] = [];
const packed: { pkg: string; name: string; tgz: string }[] = [];
try {
    for (const pkg of readdirSync(join(ROOT, "packages")).sort()) {
        const dir = join(ROOT, "packages", pkg);
        let m: Manifest;
        try {
            m = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
        } catch {
            continue;
        }
        if (m.private) continue;
        const out = sh("pnpm", ["pack", "--pack-destination", work], dir).trim().split(/\r?\n/).pop()!;
        const tgz = resolve(dir, out.trim());
        const list = sh("tar", ["-tzf", tgz.replaceAll("\\", "/"), "--force-local"], work).split(/\r?\n/);
        for (const need of [
            "package/README.md",
            "package/LICENSE",
            "package/package.json",
            "package/dist/index.js",
        ])
            if (!list.includes(need)) errors.push(`${m.name}: ${need} missing from the tarball`);
        if (list.some((f) => /\/test\/|\.test\./.test(f))) errors.push(`${m.name}: tests in the tarball`);
        // no fonts, drawings, plot configs or other data files (AGENTS.md: never ship Autodesk files)
        for (const f of list)
            if (/\.(shx|shp|ttf|ttc|otf|pat|lin|ctb|stb|pc3|pmp|fmp|dwg|dxf|pdf|png|jpe?g)$/i.test(f))
                errors.push(`${m.name}: data file ${f} in the tarball`);
        const extracted = join(work, `x-${pkg}`);
        mkdirSync(extracted);
        sh(
            "tar",
            ["-xzf", tgz.replaceAll("\\", "/"), "--force-local", "-C", extracted.replaceAll("\\", "/")],
            work,
        );
        const pm = JSON.parse(readFileSync(join(extracted, "package", "package.json"), "utf8")) as Manifest;
        for (const [k, v] of Object.entries(pm.dependencies ?? {}))
            if (v.startsWith("workspace:")) errors.push(`${m.name}: dependency ${k} is still ${v}`);
        for (const [sub, target] of Object.entries(pm.exports)) {
            const paths = typeof target === "string" ? [target] : [target.types, target.default];
            for (const p of paths) {
                if (!p.startsWith("./dist/"))
                    errors.push(`${m.name}: export "${sub}" → ${p} is not in dist/`);
                else if (!list.includes(`package/${p.slice(2)}`))
                    errors.push(`${m.name}: export "${sub}" → ${p} not packed`);
            }
        }
        packed.push({ pkg, name: m.name, tgz });
    }

    // a consumer project with every tarball
    const app = join(work, "consumer");
    mkdirSync(app);
    const deps: Record<string, string> = {
        three: "^0.186.1",
        "@types/three": "^0.186.0",
        typescript: "^5.9.0",
    };
    for (const p of packed) deps[p.name] = `file:${p.tgz.replaceAll("\\", "/")}`;
    writeFileSync(
        join(app, "package.json"),
        JSON.stringify({ name: "consumer", private: true, type: "module", dependencies: deps }, null, 2),
    );
    // the tarballs depend on each other by version: point those at the local tarballs too
    writeFileSync(
        join(app, "pnpm-workspace.yaml"),
        `overrides:\n${packed.map((p) => `  "${p.name}": "file:${p.tgz.replaceAll("\\", "/")}"`).join("\n")}\n`,
    );
    sh("pnpm", ["install", "--reporter=silent"], app);

    for (const p of packed.filter((x) => ISOMORPHIC.has(x.pkg))) {
        writeFileSync(
            join(app, "import.mjs"),
            `const m = await import("${p.name}");\nif (!Object.keys(m).length) process.exit(1);\n`,
        );
        try {
            sh("node", ["import.mjs"], app);
        } catch (e) {
            const err = (e as { stderr?: string }).stderr ?? String(e);
            errors.push(`${p.name}: import in Node failed: ${err.trim().split("\n").slice(-3).join(" | ")}`);
        }
    }

    // The merge subpath must stay worker/Node-importable without loading three.js's entry point.
    writeFileSync(
        join(app, "import.mjs"),
        'const m = await import("@truedxf/three/merge");\nif (typeof m.mergedGroups !== "function") process.exit(1);\n',
    );
    try {
        sh("node", ["import.mjs"], app);
    } catch (e) {
        errors.push(`@truedxf/three/merge: import in Node failed: ${String(e)}`);
    }

    writeFileSync(
        join(app, "check.ts"),
        packed.map((p, i) => `import * as m${i} from "${p.name}";\nvoid m${i};`).join("\n") +
            '\nimport { mergedGroups } from "@truedxf/three/merge";\nvoid mergedGroups;\n',
    );
    for (const moduleResolution of ["bundler", "nodenext"]) {
        const module = moduleResolution === "bundler" ? "esnext" : "nodenext";
        writeFileSync(
            join(app, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: {
                    target: "es2022",
                    module,
                    moduleResolution,
                    strict: true,
                    noEmit: true,
                    skipLibCheck: false,
                    lib: ["es2023", "dom", "dom.iterable"],
                    types: [],
                },
                files: ["check.ts"],
            }),
        );
        try {
            sh("pnpm", ["exec", "tsc", "-p", "."], app);
        } catch (e) {
            const out = (e as { stdout?: string }).stdout ?? String(e);
            errors.push(
                `type check (${moduleResolution}) failed:\n${out.split("\n").slice(0, 20).join("\n")}`,
            );
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
}
console.log(`packages:check: ${packed.map((p) => p.name).join(", ")} OK`);
