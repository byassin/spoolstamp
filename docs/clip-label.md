# Clip-on label

A flat-front clip with two raised lines:

1. Material type.
2. Color.

The body uses the selected filament color; lettering is pure black or white.

## Geometry

The design is adapted from the supplied `Filament_Clip_Label_3MF.stl`. Its 1.2 mm label recess is filled flush with the surrounding rim. The clip mechanism and overall dimensions are retained: approximately 51.4 × 13.81 × 15 mm.

Text is raised 0.8 mm on the front face. Full names are fitted first; selected long names are shortened when necessary. Complete material and color names remain in the app and export metadata.

## Source and regeneration

`data/clip-label.json` records the original filename, SHA-256, dimensions, and extraction operations.

```sh
node scripts/extract-clip-template.mjs "/path/to/source.stl"
```

The adapter accepts only the inspected source hash. The resulting mesh is stored in `assets/clip-label.mesh`.

## Tests

Tests check retained source triangles, the filled face, two-line text fitting, glyph attachment, and 3MF serialization. Preview and export retain the same print orientation.

Implementation: `lib/clip-label.ts`. Attribution and licensing are documented in [NOTICE-DATA.md](../NOTICE-DATA.md).
