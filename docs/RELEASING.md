# Releasing

Published packages: core, model, geometry, fonts, text, render, pdf, three and viewer. Packages
marked `"private": true` (testkit, plot) are never published. Every package has its own version.

## With GitHub Actions

Run the **Release** workflow from the Actions tab on `master`.

- `packages`: `all`, or package names separated by spaces or commas (`core`, `model viewer`).
- `bump`: `patch`, `minor` or `major`. `none` publishes the current versions that are not on npm
  yet, e.g. to retry a failed publish.
- `version`: an exact version for all selected packages, overrides `bump`.
- `dry-run`: builds and packs without committing, tagging or publishing. On by default.

The workflow tests and builds the packages, sets the versions, commits, tags each package as
`@truedxf/<name>@<version>`, pushes, and publishes to npm.

## Locally

```bash
pnpm login
pnpm typecheck && pnpm lint && pnpm test
node scripts/set-version.ts patch core      # or: 0.2.0 all, minor model,render
pnpm build
pnpm packages:check
git commit -am "Release @truedxf/core@0.1.1"
git tag @truedxf/core@0.1.1
git push --atomic origin master @truedxf/core@0.1.1
pnpm -r --filter @truedxf/core publish --access public
```

Use one tag and one `--filter` per released package.

## Notes

- Packages depend on each other with `workspace:^`, published as `^<version>`. Below 1.0 a caret
  range only accepts patch releases: after a minor release of a package, release its dependents
  too so they pick it up.
- `set-version.ts` refuses versions that are already on npm, and dependencies on package versions
  that are not on npm yet. Release those dependencies in the same run.
- Always run `pnpm build` right before publishing: `pnpm typecheck` also writes `dist/`, but
  without the fixes `scripts/package-dist.ts` applies (`.js` import paths in declarations, the
  viewer's worker URL, the LICENSE file).
