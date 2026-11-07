# Architecture

Spoolstamp uses React/Vinext for the interface, Three.js for previewing, Manifold for geometry, and JSZip for 3MF packaging.

## Catalog

Versioned JSON in `data/` contains the Bambu Lab filament catalog, printer models, and compatible Studio presets. Sync scripts resolve upstream profile inheritance and record the source commit and hashes.

Optional store enrichment is cached during catalog sync; the app does not query the store while generating a label.

## Label generation

Design meshes and generated Noto Sans lettering are combined in the browser. The same geometry feeds both the 3D preview and the exported 3MF.

- **Hinged label:** retains the supplied card and hook, with the R2 moving-link clearance adjustment.
- **Clip-on label:** fills the supplied clip's label recess and adds material/color lettering.
- **Flat Label:** builds an original 60 × 25 mm adhesive backing with a 2 mm corner radius and raised product/color lettering. The square-corner option is removed; older saved design IDs normalize to the retained rounded design.
- **Printed layout:** Simple emphasizes product/color; Detailed keeps additional information where it fits. The narrow clip remains two-line. One validated layout choice drives preview, generation, saved choices, links and export metadata.
- **Text:** defaults to black or white for contrast, with six optional text colors and a short same-material profile list. A low-contrast override shows an advisory suggestion. Long clip names are fitted or shortened, with full names retained in metadata.

See [hinged design](supplied-drybox.md), [clip design](clip-label.md), and [flat design](adhesive-label.md).

## Preview and export

The preview provides a label close-up, full printer bed, top view, orbit, and zoom. Printer selection sets the bed dimensions and model placement.

Single-label exports contain separate structural/text parts, two filament profiles, the printer/process presets, and color metadata. The complete assembly is centered within the printer's common printable area. Arranged batch exports use independent multipart assemblies, whole-assembly translations, and up to four unique profile/color combinations per plate. Exact body/text product pairs are grouped conservatively; additional colors or bed limits split the export into more projects. Studio still checks brim and purge-tower clearance. See [3MF settings](studio-project.md).

Per-label copy counts expand to at most eight instances before planning. A prepared plan exposes frozen bounds, restrictions and filament metadata for the accessible SVG batch preview, while retaining mesh data privately. The ZIP consumes that same plan and captured placements. Caller revision/freshness fences invalidate obsolete plans; forged/deserialized previews cannot be exported. See [batch previews](batch-preview.md).

## Saved workspace

The browser can optionally remember the builder setup and store favorites and label drafts using a versioned, catalog-validated local-storage record. This contains no Bambu credentials or printer identifiers. Drafts are catalog configurations, not live inventory, and can be exported without an AMS session. Saving from AMS still requires a fresh resolved snapshot. See [saved workspace and plates](saved-workspace.md).

Named collections group up to eight catalog configurations for selection and reprinting. Collection IDs/names and label configurations are bounded and validated. The upgraded workspace uses `spoolstamp.workspace.v2` so older open tabs writing `spoolstamp.workspace.v1` cannot erase collection or layout fields. When the new key is absent, sanitized legacy choices are copied forward once; an existing new record wins. The old key is preserved and later old-tab edits are not automatically merged. Record and backup format versions remain v1, with optional collection fields on older input. Backups include collection names as well as catalog choices, with a 96 KB transfer bound. Names are user-authored local preferences, never derived from Bambu account or inventory data.

Configuration history supports undo/redo/reset. Catalog-only fragment links restore shared setups, and validated JSON backups merge favorites/drafts with an explicit imported-setup action. Cross-tab storage events and revision checks protect ordinary concurrent editing. See [editing and workspace transfer](label-editing.md) for limits.

The version badge opens short release highlights from `lib/release-notes.ts`; the export area opens the three-step Studio printing guide. Both use native modal dialogs with labelled close controls and Escape handling.

## Cloud AMS preview

The optional AMS connection uses a separate Lambda backend for global-region Bambu
email verification and account-owned printer status reads over cloud TLS/MQTT.
Tokens are stored temporarily encrypted with AWS KMS in DynamoDB; the browser receives an opaque session cookie and
sanitized inventory. Reads are on demand, with freshness and cooldown safeguards.
The interface updates freshness state every second and retains manual picking and saved drafts during outages. Exact catalog label choices captured while fresh are also retained in memory for the visit, separate from live inventory, so returning for another label does not need another vendor read. Only session-state GET polling backs off; verification emails, sign-in and printer reads are not automatically retried.
The backend and browser interface are open to all global-region Bambu accounts.
Public access is explicitly configured; account ownership, session isolation and
all existing rate limits remain enforced. The owner demonstrated real X2D email-code
sign-in and a fresh cloud snapshot on October 8, 2026; broader model and lifecycle/export
qualification remain separate. There is no LAN printer connection
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
