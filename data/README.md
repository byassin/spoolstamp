# Generated catalog data

Do not edit these files by hand.

- `bambu-catalog.json`: normalized official colors, resolved print/drying specs, and optional cached US store variants.
- `bambu-machines.json`: current Bambu printer-model index.
- `store-handles.json`: cached store products whose API payload reports `isFilament: true`.
- `sync-report.json`: row counts and unmatched-profile audit.

Regenerate with `npm run sync:catalog` or `npm run sync:catalog:store`. The catalog and machine files contain their exact BambuStudio commit and source hash; the sync report repeats that provenance. Store handles are a separate cache derived from the US storefront. Licensing and trademark terms are documented in `LICENSE.md` and `../NOTICE-DATA.md`.
