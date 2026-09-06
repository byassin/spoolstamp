# Spoolstamp

<img src="public/brand/spoolstamp-mark.png" width="88" alt="Spoolstamp logo" />

An independent filament label studio. Choose a design, select a Bambu Lab filament type and color, inspect the live 3D preview, and export a color-aware project 3MF.

[Open the app](https://bambu-filament-label-generator.bourhan.chatgpt.site)

## What works today

Optional **My AMS** is a local-only preview: read loaded spools, prefill catalog matches, suggest compatible black/white text profiles, and download batches of separate 3MFs. Inventory reading has been observed on an X2D; broader hardware/firmware compatibility is not yet qualified. See [pairing, privacy and compatibility](docs/ams-integration.md). The hosted site retains manual generation and does not collect printer credentials.

- 314 official Bambu filament colors, including gradient, split-color, and transparent definitions.
- Searchable type-first selectors with full-palette swatches and explicit appearance labels.
- 14 printer models from a pinned BambuStudio profile release.
- Two designs: the supplied hinged dry-box STL and the supplied filament clip with a filled label recess.
- Smooth Noto Sans Bold outline text for the dry-box card and two-line clip.
- A crease-aware orthographic Three.js preview built from the same indexed mesh data as the downloaded model.
- A design-first workspace with a separate AMS drawer, expanded print settings, label/plate framing, zoom controls, and representative gradient/split-color finishes. Pure black/white text is shared across preview and export.
- 226,476 mechanical triangles retained in the source asset. The current print-test revision adds 0.075 mm radial relief to the moving links' spherical bearings; card, hook and overall dimensions stay unchanged.
- Dry-box lettering screened per connected component for 0.45 mm extrusion width, with closed mesh and label-face bounds tests across the full catalog.
- Standards-oriented 3MF Core + Materials packaging with explicit structural/text roles and honest generator provenance.
- Local-only Bambu Studio handoff: selections prepare automatically; once ready, one click opens Studio's registered URL handler without uploading files. See [local handoff](docs/local-studio-handoff.md).
- Bambu Studio CLI import and single-filament P1S geometry-slice verification; every reported mesh-repair counter is zero.
- Reproducible catalog sync with optional, cached US store enrichment.

The interface supports phone, tablet, and desktop layouts. Palette placement and transparency in the preview are illustrative, not a prediction of spool color transitions or optical properties. See the [frontend review](docs/frontend-review.md) for the current checks and cleanup scope.

## Important boundary

The download is an **unsliced project 3MF**, not printer G-code. Open it as a project in current Bambu Studio with the selected printer's presets installed. It includes that printer's 0.4 mm preset, compatible 0.20 mm Standard process, and exactly two filament slots: the selected product/color for the body and an independent text profile with contrasting pure black or white. Text defaults to PLA Basic for PLA bodies, otherwise the body product; choose the actual text spool's product in **Text filament**. These are project colors, not automatic assignments to physical AMS spools. Confirm those assignments and inspect the slice before printing. Unsupported printer/material combinations cannot export silently with a substitute preset.

Studio requires a BambuStudio-prefixed `Application` identifier to read project settings. The export uses the disclosed compatibility token `BambuStudio-02.08.02.61+FilamentLabelLab.0.1.0`; the actual generator remains Filament Label Lab in standard creator and explicit provenance metadata. See [import compatibility and verification](docs/studio-project.md). A trust prompt for an independently generated file may still appear.

The default Hinged dry-box card uses the user-supplied STL, not a reconstruction. The raw asset preserves its retained coordinates after removal of the 66 lettering shells and three microscopic opposing face pairs. Following stiff-hinge print reports, revision `hinge-r2` enlarges moving-link sockets and reduces moving-link pins by 0.075 mm radially, leaving the fixed card/hook geometry, link outer shells, and bed contact unchanged. Generated text rises 0.8 mm above the face, retaining the 60 × 88 × approximately 4 mm overall dimensions. See [source and revision checks](docs/supplied-drybox.md). R2 physical fit and hinge cycling remain pending user print feedback.

The supplied models are provenance-separated from original application code and are **not relicensed as MIT**. They are included at the project owner's explicit direction. Their upstream redistribution permissions have not been verified; inclusion here is not a license grant for these models. See [model provenance](NOTICE-DATA.md) before redistributing or remixing model assets.

The Flat-front filament clip preserves the supplied clip mechanism and fills its 1.2 mm label recess. It adds two raised lines: filament type and color, with printable condensed lettering and occasional shortening of long names. The preview faces the label toward the viewer; the 3MF retains the source print orientation. See [clip adaptation and checks](docs/clip-label.md).

Direct printer sending is deliberately not performed by the hosted app. Bambu's supported path requires local slicing and Bambu Connect (or an approved integration), so the planned direct-send feature belongs in an optional local companion that never gives printer credentials to the website.

When running locally on the same computer as Bambu Studio, the current selection is prepared automatically in a temporary, memory-only transfer. Once ready, one click on **Open in Bambu Studio** launches the native import flow, subject to browser/Studio confirmation. Changing the selection prepares a replacement; expiring links refresh automatically. **Download 3MF** remains available independently. This local transfer service is not included in the hosted app.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Then open `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Refresh the catalog

The committed catalog is pinned to an exact BambuStudio commit for repeatable builds.

```bash
npm run sync:catalog
npm run sync:studio-presets
```

Optional US store metadata uses Bambu's undocumented storefront service and a cached handle list:

```bash
npm run sync:catalog:store
```

Only maintainers should refresh handles, and the command intentionally runs slowly:

```bash
npm run sync:catalog:store:refresh
```

See [data provenance](NOTICE-DATA.md), the [architecture](docs/architecture.md), and the [template licensing review](docs/template-research.md) before adding data or geometry.

## Project status

This is a functional MVP. The next major deliverable is an optional local companion that invokes an independently installed Bambu Studio CLI, produces a genuinely sliced 3MF, and hands it to Bambu Connect. See the [MakerWorld launch checklist](docs/makerworld-launch.md).

## License

Original application code is MIT licensed. The supplied dry-box and clip meshes are excluded from that grant. The committed BambuStudio-derived catalog snapshot is separately identified under BambuStudio's AGPL-3.0 terms; Noto Sans is used under the SIL Open Font License 1.1. See [NOTICE-DATA.md](NOTICE-DATA.md) and [data/LICENSE.md](data/LICENSE.md).

Spoolstamp (formerly Filament Label Lab) is independent and is not affiliated with, sponsored by, or endorsed by Bambu Lab. Legacy generator identifiers remain stable for 3MF compatibility. See the [brand assets and generation prompt](docs/brand.md).
