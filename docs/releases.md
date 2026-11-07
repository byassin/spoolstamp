# Versioning and releases

`package.json` is the release-version source of truth. `lib/app-version.ts` exposes it to the logo badge and single-label/plate 3MF metadata. The Studio compatibility prefix and legacy metadata paths remain unchanged. The package lock’s root version must match; regression tests enforce this.

Use semantic versions: patch for fixes, minor for compatible features, major for breaking changes. While the app is below 1.0, document any compatibility changes explicitly. The existing `0.1.0` package was the baseline; `0.2.0` begins tracked releases.

## Prepare and push a candidate

1. Run `npm run release:patch`, `npm run release:minor`, or `npm run release:major` once on a release branch. These update package and lock versions without creating a tag or commit. Do not bump again just to push documentation or screenshots for the same release.
2. Add the same version to `CHANGELOG.md` as **unreleased**, describing the final changes and their validation limits. A branch push or successful local build is not a release. Keep the candidate unreleased while merge/deployment approval is pending.
3. Run the checks below, refresh affected instructions/screenshots, and include version, lock, changelog, implementation and tests in the candidate. Preserve unrelated working-tree edits and exclude secrets or generated build output.
4. Push only the approved scope to its feature branch and open a PR when authorized. Pushing a feature branch does not merge it, publish a GitHub release or deploy the production site. The repository CI runs on pull requests and `main` pushes; a feature-branch push without a PR does not itself run this workflow.

## Validate the candidate

From a clean dependency install, run the current [CI workflow](../.github/workflows/ci.yml) checks:

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run build:ams:lambda
npm run build
npm run build:static
```

Run the two frontend builds sequentially because they share `dist/`. Static validation checks the HTML/client artifacts Amplify publishes from `dist/client`; the normal production build also covers the server build path. Lambda validation produces `.aws-sam/ams/lambda-ams.mjs` locally and does not deploy the separately managed backend. Backend deployment and cloud-state checks are separate actions when backend changes require them.

For design/export changes, retain full catalog text/readability checks, closed positive-volume geometry, glyph attachment and any supplied-template preservation assertions. Verify all offered printer beds and exclusions, matching preview/export orientation, single/separate/arranged exports, filament role assignments/vector sizes, provenance and `APP_VERSION` metadata. Partition expensive catalog checks by product without dropping cases or reducing existing limits. New designs must be included in the relevant test matrices, not only a default-filament smoke test.

Use the [contributor browser recipe](../CONTRIBUTING.md#local-browser-checks-without-bambu-traffic) and `tests/fixtures/ams-browser-preview.mjs` for synthetic AMS states without credentials, verification emails or vendor reads. Check desktop and 390/320 px mobile layouts, captured label reuse after expiry, outage behavior, history cancellation, shared-link restoration, strict backup import and cross-tab stale-write handling. Refresh actual screenshots with sample data, review them for alignment and private information, and distinguish interface evidence from real-printer qualification. Record exact commands/results and any native Studio, provider or physical tests not performed; do not turn automated geometry checks into print/fit claims.

## Merge and verify a release

1. Obtain approval for the merge/deployment; push approval alone is not publication approval. Set the changelog release date as part of the approved release candidate and run CI for that exact final head. Any later change needs checks for the changed head before merging.
2. Merge only the exact CI-tested PR head after all required checks pass. Amplify publishes the static website automatically from `main`; do not assume its success from the GitHub merge result.
3. Verify the deployment and displayed version beside the logo, the affected features/assets, and generated 3MF application-version metadata when exports changed. Compare with the merged revision and report any verification limits. The separate AMS backend is not updated by the static website deployment.
4. If a Git tag/GitHub release is wanted, create `vX.Y.Z` at the merged commit only after approval and successful deployment. Bump commands never publish, push, merge, deploy or tag automatically.

Browser storage schema versions and the pinned Bambu Studio importer identifier are independent of the app’s release number; do not bump or migrate them just to release UI changes.

Keep the current entry in `lib/release-notes.ts` aligned with the release version and user-visible changes. The badge beside the logo opens these short highlights; detailed implementation and qualification history stays in the changelog and feature guides. Check old workspace/backups/shared links when extending saved configuration, and refresh the batch, collection, printing-guide and version-panel screenshots when their behavior changes.
