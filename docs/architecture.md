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

## Cloud AMS preview

The optional AMS connection uses a separate Lambda backend for global-region Bambu
email verification and account-owned printer status reads over cloud TLS/MQTT.
Tokens are stored temporarily encrypted with AWS KMS in DynamoDB; the browser receives an opaque session cookie and
sanitized inventory. Reads are on demand, with freshness and cooldown safeguards.
The backend is deployed as an account-restricted AWS private preview; the browser
interface is unpublished and actual AWS-to-Bambu access remains unqualified. There is no LAN printer connection
or saved-pairing service. A memory-only Node preview supports local development
of the hosted flow. See [AMS setup](ams-integration.md) and [Lambda deployment](aws-lambda-ams.md).

## Local Studio integration

- **Bambu Studio transfer:** stages a temporary 3MF for Studio's URL handler.

This Vite service is not included in the hosted app. See [Studio setup](local-studio-handoff.md).

## Project layout

- `app/`, `components/`, `hooks/`: interface and interaction state.
- `lib/`: catalog, geometry, export, preview, and matching logic.
- `assets/`, `data/`: model assets and catalog snapshots.
- `scripts/`: sync, extraction, cloud AMS backend, and local Studio integration.
- `tests/`: geometry, printability, export, and integration tests.
