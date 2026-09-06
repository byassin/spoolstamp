# 3MF project settings

Each export contains two project filaments:

1. The selected body material and color.
2. The selected text material, colored pure black or white.

Text defaults to PLA Basic for PLA bodies, or the body product for other material families. My AMS can suggest a compatible loaded text spool.

## Printer settings

The selected printer uses its compatible 0.4 mm nozzle and 0.20 mm Standard process presets from `data/bambu-studio-presets.json`. Both filament profiles are checked against the printer.

The assembly is placed on Z=0 and centered in the common printable area, with a 10 mm margin from bed edges and exclusion zones. Preview placement uses the same calculation.

## Import compatibility

Open the 3MF as a project so Studio loads its profiles and colors.

Studio's importer requires a BambuStudio-prefixed application identifier. Spoolstamp retains `BambuStudio-02.08.02.61+FilamentLabelLab.0.1.0` for compatibility; separate generator metadata identifies the application. Legacy metadata names remain stable.

Purge tables are sized to the printer's nozzle count and the two project filaments, using Studio's default 280 mm³ transitions. Studio can recalculate purging for the selected colors.

## Verification

`npm test` checks project profiles, colors, part assignments, placement, and mesh serialization.

Optional native import/re-export check:

```sh
node scripts/verify-studio-import.mjs "/path/to/bambu-studio"
```

Implementation: `lib/studio-project.ts`, `lib/generate-3mf.ts`, and `lib/build-plate.ts`.

Upstream references: [3MF importer](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/Format/bbs_3mf.cpp), [preset handling](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PresetBundle.cpp), and [print defaults](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PrintConfig.cpp).
