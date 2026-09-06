# Bambu Studio project import

The browser exports two project filament slots, never the user's existing Studio list:

1. The selected filament product's compatible system profile, with the chosen body RGB.
2. An independently selected text product profile, with pure black or white for contrasting text. PLA bodies default to PLA Basic text; other material families default to the body product. The Text filament field lets users describe their actual black/white spool without changing the body or text color. It currently limits choices to the body's material family; printer compatibility is validated for both profiles.

This is not live AMS detection. Studio's [mapping implementation](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/DeviceCore/DevMapping.cpp) prioritizes material type, then setting/product IDs, then color. Correct independent profiles address the Tough+ body / Basic text mismatch, but cannot guarantee a specific physical slot. Color-first automatic selection would require reading current AMS inventory and resolving its actual preset before slicing; the current local transfer service does neither. Confirm the physical slot in Studio, and never disguise a different material as PLA to force a color match.

The text color is a spool-assignment hint, not a claim that a matching Bambu SKU exists. Gradient/multi-color spools have one representative project color, retaining the complete palette in generator metadata. Clear RGBA `#00000000` uses neutral `#D9E0DB` for Studio's opaque swatch, not black.

`scripts/sync-studio-presets.mjs` resolves profile inheritance and explicit printer compatibility from the catalog's pinned upstream commit. It verifies unique matches and filament-family IDs. The snapshot covers 595 of 644 printer/product pairs; unsupported pairs show an actionable message and cannot export with a silently substituted material. The printer selection assumes a 0.4 mm nozzle and the machine's compatible 0.20 mm Standard process.

## Importer compatibility and actual provenance

Bambu Studio 02.08.02.61 ignores `Metadata/project_settings.config` unless the model's `Application` starts with `BambuStudio-` followed by a parseable version. A standalone `BambuStudio:3mfVersion` does not enable config loading. The decisive source is [bbs_3mf.cpp](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/Format/bbs_3mf.cpp#L1807-L1818), with prefix parsing at lines 3893–3899.

The export therefore uses `BambuStudio-02.08.02.61+FilamentLabelLab.0.1.0` as a disclosed **importer compatibility identifier**, not a claim that Bambu Studio authored it. `dc:creator`, `fll:generator`, an explicit compatibility explanation, and `Metadata/filament-label-lab.json` identify Filament Label Lab. Trust prompts are not disabled.

The project config references exact installed system preset IDs. Empty `different_settings_to_system` entries let the desktop importer restore unmodified system settings; color is a project option. Two `filament_diameter` entries are essential because Studio uses their count to normalize filament vectors. Official printer bed/nozzle/extruder arrays and two support-material flags also avoid pre-default failures in the CLI importer. Machine G-code and arbitrary fallback slicing defaults are not embedded. See [PresetBundle.cpp](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PresetBundle.cpp#L3461) and [Preset.cpp](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/Preset.cpp#L2079).

Open the file **as a project**, with the matching current system presets installed. Geometry-only import intentionally does not load project settings. Map the two project filaments to actual physical spools and inspect the slice. Sparse exports are not intended for unattended CLI slicing; that workflow needs complete settings.

## Explicit purging defaults (2026-09-05)

Exports now include a two-filament purge table for **each physical nozzle**, with zero diagonal and 280 mm³ off-diagonal transitions, four 140 mm³ load/unload entries, normal multipliers of 1 and fast multipliers of 1.2 per nozzle. These are [Studio's PrintConfig defaults](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PrintConfig.cpp), sized to our actual two project filaments rather than inherited from an existing Studio session. The matrix layout is nozzle-count × filament-count², as used by [PresetBundle](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/PresetBundle.cpp).

This addresses missing/zero transition settings, **not color-calibrated purging**. Check Studio's Purging Volume auto-calculation for the actual colors and nozzle, especially black-to-white/light transitions; 280 mm³ is not a guarantee of clean color changes. The native regression checks retention of these arrays separately from geometry, and does not claim to exercise the desktop warning UI.

Verified with Studio 02.08.02.61: all four current import fixtures retain these exact arrays, material assignments and world placement with zero mesh repairs. The user's desktop warning still needs confirmation on a freshly generated file.

## Build-plate placement

Source mesh coordinates start at the origin, which overlaps the 18 × 28 mm front-left exclusion zone on X1/P1 printers. The exported assembly now receives one translation-only build-item transform, centering it on the printer bed with its lowest point at Z=0. Individual source vertices, hinges, text attachment and preview geometry are unchanged.

Placement uses the intersection of all nozzle-printable rectangles on dual-extruder printers. It requires a 10 mm margin from bed boundaries and the conservative bounds of exclusion/clumping-detection zones. It refuses models that do not fit safely instead of changing printer exclusions or model dimensions. Both designs are tested across all 14 printer profiles.

## Verification, 2026-09-05

`npm test` regenerates fixtures. Optional native verification:

```powershell
node scripts/verify-studio-import.mjs 'C:/Program Files/Bambu Studio/bambu-studio.exe'
```

This invokes only hidden, bounded CLI imports, never desktop control or printing. It verifies the actual re-exported config and mesh counters for:

- Dry-box: PLA Basic on P1S, representative blue body / black text, 271,428 faces.
- Clip: PETG HF on P1S, black body / white text, 9,118 faces.
- Clip: PLA Basic on X2D, black body / white text, 12,974 faces, two physical nozzle/extruder types preserved.

All three returned success, retained the exact two filament preset IDs/colors/types, selected printer/process IDs, face counts and part assignments, and reported zero repairs. The native check now reconstructs world-space bounds through all assembly/resource transforms: the P1S dry-box occupies X 98–158 and Y approximately 84–172 mm, clear of its exclusion zone; both clip fixtures are centered safely too. A control file without the compatibility identifier lost the config and reverted to one default PLA slot.

This proves native import, placement and assignment retention, not a desktop UI test, automatic AMS selection, two-material slicing, or physical hinge/clip performance. Older downloaded files are unchanged; generate a fresh file after updating the app.

Independent text-profile regression: the additional Tough+ Cyan / PLA Basic Black X2D dry-box fixture also passed native import/re-export. It retained both distinct preset IDs, filament-family IDs, exact `#009BD8` / `#000000` colors, part assignments, and centered placement with zero repairs. All 151 tests, typecheck, lint and production build passed after this change. Live AMS mapping is not verified by these checks.
