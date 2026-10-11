# 3MF project settings

Each single-label export contains two project filaments:

1. The selected body material and color.
2. The selected text material, colored black or white automatically, or with the user's white, black, gray, red, blue or yellow override.

Text defaults to PLA Basic for PLA bodies, or the body product for other material families. My AMS can suggest a compatible loaded text spool.

## Printer settings

The selected printer uses its compatible 0.4 mm nozzle and 0.20 mm Standard process presets from `data/bambu-studio-presets.json`. Both filament profiles are checked against the printer.

The assembly is placed on Z=0 and centered in the common printable area, with a 10 mm margin from bed edges and exclusion zones. Preview placement uses the same calculation.

Arranged batches preserve whole label assemblies and pack them at Z=0 with 6 mm spacing and the same bed/exclusion margin. Each plate has at most four unique profile/color combinations; identical combinations share a filament. Exact body/text product pairs stay together, while extra colors and bed limits create additional projects. Support filaments are rejected for combined plates. Placement checks label bounds, not final brim or purge-tower clearance; inspect each project in Studio before slicing. See [saved workspace and plates](saved-workspace.md).

## Import compatibility

Open the 3MF as a project so Studio loads its profiles and colors.

Studio's importer requires a BambuStudio-prefixed application identifier. Single-label exports retain `BambuStudio-02.08.02.61+FilamentLabelLab.0.1.0` for compatibility; arranged plates use `BambuStudio-02.08.02.61+Spoolstamp.0.1.0`. Separate generator metadata identifies the application. Legacy single-label metadata names remain stable.

Purge tables are sized to the printer's physical nozzle count and the actual project filament count, using Studio's default 280 mm³ transitions. These are not color-calibrated recommendations; Studio can recalculate purging for the selected colors.

## Verification

`npm test` checks project profiles, colors, part assignments, placement, and mesh serialization.

Optional native import/re-export check:

```sh
node scripts/verify-studio-import.mjs "/path/to/bambu-studio"
```

Implementation: `lib/studio-project.ts`, `lib/generate-3mf.ts`, `lib/generate-label-plates.ts`, and `lib/build-plate.ts`. Automated geometry/package checks do not qualify native Studio import or a physical multi-label print.

Upstream references: [3MF importer](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/Format/bbs_3mf.cpp), [preset handling](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PresetBundle.cpp), and [print defaults](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PrintConfig.cpp).
