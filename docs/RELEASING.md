# Releasing the npm packages

The publishable packages are every `packages/*` without `"private": true`: core, model,
geometry, fonts, text, render, three and viewer (testkit and the plot placeholder stay private).
They share one version.

In the workspace each package exports its TypeScript sources (`./src/*.ts`); `publishConfig`
switches the published `exports` to `dist/` (JavaScript + declarations from `tsc -b`), and pnpm
replaces `workspace:*` dependencies with the released version.

## One-time setup

- Create the `truedxf` organization on npmjs.com (free for public packages) and `npm login`.

## Each release

```bash
pnpm typecheck && pnpm lint && pnpm test
node scripts/set-version.ts 0.1.0
pnpm build              # tsc -b + scripts/package-dist.ts
pnpm packages:check     # pack, install into a scratch project, import in Node, type-check
git commit -am "Release 0.1.0" && git tag v0.1.0 && git push --follow-tags
pnpm -r --filter "./packages/*" publish --access public
```

`pnpm build` runs [scripts/package-dist.ts](../scripts/package-dist.ts) after `tsc -b`: it rewrites
`./x.ts` specifiers in the emitted `.d.ts` files and the viewer's worker URL to `.js`, and copies
the root `LICENSE` into each package. `pnpm -r publish` skips private packages and versions that
are already on the registry.
