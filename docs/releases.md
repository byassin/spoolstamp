# Versioning and releases

`package.json` is the release-version source of truth. `lib/app-version.ts` exposes it to the logo badge and single-label/plate 3MF metadata. The Studio compatibility prefix and legacy metadata paths remain unchanged. The package lock’s root version must match; regression tests enforce this.

Use semantic versions: patch for fixes, minor for compatible features, major for breaking changes. While the app is below 1.0, document any compatibility changes explicitly. The existing `0.1.0` package was the baseline; `0.2.0` begins tracked releases.

1. Run `npm run release:patch`, `npm run release:minor`, or `npm run release:major` once on a release branch. These update package and lock versions without creating a tag or commit.
2. Add the same version and release date to `CHANGELOG.md`.
3. Run typecheck, tests, lint, production/static builds, and relevant browser checks. Test generated-project metadata when changing export behavior.
4. Include version, lock, changelog, code and tests in the PR. After CI passes and publication is approved, merge to `main`.
5. Verify the automatic deployment and the displayed version. If a Git tag/GitHub release is wanted, create `vX.Y.Z` at the merged commit only after approval and successful deployment. Bump commands never publish, push, or tag automatically.

Browser storage schema versions and the pinned Bambu Studio importer identifier are independent of the app’s release number; do not bump or migrate them just to release UI changes.
