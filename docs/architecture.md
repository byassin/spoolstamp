# Architecture

Spoolstamp uses React/Vinext for the interface, Three.js for previewing, Manifold for geometry, and JSZip for 3MF packaging.

## Catalog

Versioned JSON in `data/` contains the Bambu Lab filament catalog, printer models, and compatible Studio presets. Sync scripts resolve upstream profile inheritance and record the source commit and hashes.

Optional store enrichment is cached during catalog sync; the app does not query the store while generating a label.

## Label generation

Design meshes and generated Noto Sans lettering are combined in the browser. The same geometry feeds both the 3D preview and the exported 3MF.

- **Hinged label:** retains the supplied card and hook, with the R2 moving-link clearance adjustment.
- **Clip-on label:** fills the supplied clip's label recess and adds material/color lettering.
- **Text:** uses pure black or white for contrast. Long clip names are fitted or shortened, with full names retained in metadata.

See [hinged design](supplied-drybox.md) and [clip design](clip-label.md).

## Preview and export

The preview provides a label close-up, full printer bed, top view, orbit, and zoom. Printer selection sets the bed dimensions and model placement.

Exports contain separate structural/text parts, two filament profiles, the printer/process presets, and color metadata. The complete assembly is centered within the printer's common printable area. See [3MF settings](studio-project.md).

## Local integrations

Two Vite services are available when running locally:

- **Bambu Studio transfer:** stages a temporary 3MF for Studio's URL handler.
- **My AMS:** reads printer inventory over TLS/MQTT and matches loaded spools to catalog entries.

Neither service is included in the hosted app. See [Studio setup](local-studio-handoff.md) and [AMS setup](ams-integration.md).

## Project layout

- `app/`, `components/`, `hooks/`: interface and interaction state.
- `lib/`: catalog, geometry, export, preview, and matching logic.
- `assets/`, `data/`: model assets and catalog snapshots.
- `scripts/`: sync, extraction, and local integrations.
- `tests/`: geometry, printability, export, and integration tests.
