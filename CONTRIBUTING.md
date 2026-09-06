# Contributing

Thanks for helping make physical filament labels easier to generate and safer to share.

## Before opening a pull request

1. Create an issue for significant UI, geometry, catalog, or printer-integration changes.
2. Keep templates clean-room unless the contributor can document a compatible source license and attribution.
3. Never commit printer access codes, Bambu account credentials, cloud tokens, or private model files.
4. Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Template requirements

Every label template must declare:

- a stable id and version;
- author and source;
- SPDX license identifier;
- whether derivatives and commercial use are allowed;
- dimensional parameters and a printable bounding box;
- minimum nozzle and layer-height constraints; and
- semantic mesh roles (`body`, `accent`, `text`).

Templates must produce closed, finite meshes with no zero-area triangles and non-negative Z coordinates. Raised text should overlap the body by a small amount instead of relying on coplanar faces.

## Catalog changes

Do not hand-edit generated JSON. Update `scripts/sync-catalog.mjs`, run the sync, inspect `data/sync-report.json`, and include both the code and generated-data change in the pull request.

Store data is optional commerce enrichment. The BambuStudio profile dataset is the canonical print-data source.
