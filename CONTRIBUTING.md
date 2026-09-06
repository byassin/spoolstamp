# Contributing to Spoolstamp

Open an issue to discuss larger changes, or send a pull request for a focused fix.

## Development

Use Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Before submitting:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

## Catalog updates

Refresh generated catalog data through the sync scripts:

```sh
npm run sync:catalog
npm run sync:studio-presets
```

Optional store enrichment: `npm run sync:catalog:store`. Include the updated snapshots and sync report with your changes.

## New designs

Include the source, attribution, license, dimensions, and print settings. Templates should produce closed meshes, attached printable lettering, and consistent preview/export geometry. Add tests alongside the design.

## Local integrations

Keep printer access codes and account credentials out of commits and issues. See [AMS](docs/ams-integration.md) and [Studio handoff](docs/local-studio-handoff.md) for the implementation entry points.
