# Hinged dry-box label

A 60 × 88 mm label with a side-entry hook and two moving hinge links. Raised lettering shows material, color, brand, color code, hex color, and nozzle temperature.

## Geometry

The design uses the mechanical components of the supplied `Filament+Dry+Box+Labeled+Tags+-+Bambu+Lab+-+PLA+Basic+1of2.stl`. The importer removes the original lettering and three microscopic opposing face pairs, retaining 226,476 mechanical triangles.

The current `hinge-r2` revision adds 0.075 mm radial clearance to the moving links' bearings—0.025 mm more than R1. The fixed card, hook, overall dimensions, and bed contact remain unchanged. The source asset stays separate from the runtime adjustment.

New text is raised 0.8 mm. Preview and export use the same adjusted geometry.

## Source and regeneration

`data/supplied-drybox.json` records the original filename, SHA-256, component ranges, dimensions, and extraction operations.

```sh
node scripts/extract-drybox-template.mjs "/path/to/source.stl"
```

The adapter accepts only the inspected source hash. The resulting mesh is stored in `assets/supplied-drybox.mesh`.

## Tests

Tests cover source-coordinate preservation, bounded hinge relief, closed moving links, text attachment and stroke widths, and serialized 3MF topology. R2 physical testing is ongoing.

Implementation: `lib/supplied-drybox.ts` and `lib/hinge-clearance.ts`. Attribution and licensing are documented in [NOTICE-DATA.md](../NOTICE-DATA.md).
