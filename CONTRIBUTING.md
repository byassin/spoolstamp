# Contributing to Spoolstamp

Open an issue to discuss larger changes, or send a pull request for a focused fix.

## Development

Use Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Before submitting, run the same checks as [CI](.github/workflows/ci.yml):

```sh
npm run typecheck
npm test
npm run lint
npm run build:ams:lambda
npm run build
npm run build:static
```

The Lambda command only bundles the backend into `.aws-sam/ams/`; it does not deploy or need AWS credentials. The static build verifies `dist/client/index.html`, the artifact published by Amplify. Run production and static builds sequentially: they share `dist/`. Record what passed and any remaining limits; a passing geometry test is not a physical print or Studio-slicing qualification.

For iteration, run relevant files with `npm test -- tests/label-editing.test.ts tests/saved-workspace-transfer.test.ts`. Run the complete suite before a PR. Catalog geometry tests are deliberately partitioned by product; preserve the full catalog/design matrix, per-design assertions and existing timeouts rather than sampling colors or weakening checks to make a slow run pass.

## Catalog updates

Refresh generated catalog data through the sync scripts:

```sh
npm run sync:catalog
npm run sync:studio-presets
```

Optional store enrichment: `npm run sync:catalog:store`. Include the updated snapshots and sync report with your changes.

## New designs

Keep Bambu-only filament support. For a supplied template, include its source, attribution, license, source hash, dimensions and intended print orientation; preserve accepted mechanical interfaces unless a change is explicitly intended. For an original design, identify it as original and document dimensions, mounting needs and any untested print/fit assumptions. The [flat adhesive label](docs/adhesive-label.md) is the original-design example; it must not inherit the supplied clip's provenance.

Implementation entry points:

- Add a stable ID and display metadata to `DESIGNS` in `lib/catalog.ts`; `DesignId` is derived from it. Keep existing IDs valid for saved drafts and shared links.
- Put geometry in its own `lib/` module and wire `buildConfiguredMeshes` plus design-specific provenance, filename and project description in `lib/generate-3mf.ts`.
- Check preview orientation, face normals, close-up framing and plate placement in `components/label-preview.tsx` and the `lib/preview-*` helpers. Preview and export must use the same geometry and print orientation.
- Extend configuration restoration, link/backup round trips, UI metadata and documentation as needed; catalog validation must still reject unknown design IDs and arbitrary filament data.

Add meaningful tests alongside the design. Use `tests/adhesive-label.test.ts` and `tests/adhesive-export.test.ts` as examples, and extend the existing catalog, build-plate, preview-bed, label-batch and label-plates coverage. Check closed positive-volume meshes on the serialized grid, printable strokes and text bounds across every catalog product/color, glyph attachment, retained source mechanics, and unchanged vertices during placement. Check every offered printer's common printable bed/exclusions and height, single/separate/arranged exports, body/text assignments and colors, filament-vector sizes, and accurate provenance/version metadata. Long names and manual text overrides need coverage. Clearly separate digital checks from native Studio import/slicing and physical qualification.

## Local browser checks without Bambu traffic

Use the synthetic fixture for layout and state checks. It binds only to loopback and returns sample inventory; it never contacts Bambu. Start these in separate PowerShell terminals from the repository root:

```powershell
# Terminal 1: synthetic API and scenario controls.
node tests/fixtures/ams-browser-preview.mjs
```

```powershell
# Terminal 2: frontend pointed only at the synthetic API.
$env:VITE_AMS_API_ORIGIN = 'http://127.0.0.1:3005'
npm run dev -- --host 127.0.0.1 --port 3004 --strictPort
```

Open `http://127.0.0.1:3004` for the app and `http://127.0.0.1:3005/` for scenario controls. Keep this exact hostname/port pair: the fixture permits that frontend origin. Exercise ready, reading, fresh, expired, offline and outage states through **My AMS**. A simulated read advances from reading to fresh after four seconds; the fixture page reports the simulated read count. Choose a label, expire the snapshot, then reopen My AMS and choose another captured catalog label without increasing that count. Check that expired choices are clearly separate from fresh inventory and that outage UI still permits manual/captured catalog choices.

On desktop and 390/320 px mobile layouts, also check all designs, undo/redo/reset, shared-link restoration after reload, text-color overrides, and downloads. Use `tests/fixtures/workspace-backup.json` to check explicit imported-setup selection, duplicate merging and cross-tab saved-list changes. Undo/redo must invalidate in-flight downloads and Studio preparation; invalid links/backups must leave the current configuration/saved lists intact. The fixture covers authenticated UI states, not email-code authentication, real ownership checks, provider behavior or physical printer connectivity. Do not enter credentials or use the real cloud backend for this recipe. Stop both processes and remove the frontend variable when finished:

```powershell
Remove-Item Env:VITE_AMS_API_ORIGIN -ErrorAction SilentlyContinue
```

## Documentation and screenshots

Refresh affected instructions, design details and README images when behavior changes. Prefer the synthetic fixture and sample workspace for screenshots; use the paths already referenced under `docs/images/`. Capture the actual interface at the documented viewport and label synthetic inventory as sample data. Check the saved image for clipping, overlap and readable text before committing it. Exclude account email, codes, cookies/tokens, physical printer names/serials and personal browser UI. A synthetic screenshot documents the interface and does not extend real-device qualification. Keep older dated qualification evidence explicit rather than presenting it as a current feature screenshot.

## Local integrations

Keep printer access codes and account credentials out of commits and issues. See [AMS](docs/ams-integration.md) and [Studio handoff](docs/local-studio-handoff.md) for the implementation entry points.
