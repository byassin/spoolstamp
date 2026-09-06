# Flat-front filament clip

## Source and adaptation

- Source: user-supplied `Filament_Clip_Label_3MF.stl`.
- SHA-256: `e328ce1fa4e135e1e94348b78fdb448b088f8c0e5a10880d57329ff05bf6d47f`.
- Original bounds: 51.400162 × 13.810226 × 15.002007 mm; retained unchanged.
- The original 1.2 mm-deep recess opens toward -Y. Its mouth is approximately 34.84 × 12.51 mm in XZ.
- Source triangles 4206–4215 (zero-based) form the pocket floor and walls. They are replaced with two outward-wound triangles across the existing mouth corners. The face is flush with the surrounding rim within the source's 0.001 mm planar tolerance.
- Two exact zero-area source triangles, 2796 and 3943, are omitted. This removes no material.
- The remaining 4,204 source triangles, including the spring, clip opening, filament eye, and outer body, retain their exact coordinates and winding. No whole-body Boolean or remesh is used.
- Adapted mesh: 2,103 vertices, 4,206 triangles; closed, outward-wound, genus 1, volume approximately 2939.270133 mm³.

Regenerate with `node scripts/extract-clip-template.mjs PATH_TO_SOURCE.stl`. The adapter checks the exact source hash before modifying anything. `data/clip-label.json` records hashes and dimensions. The asset is a derivative of supplied geometry, not original MIT-licensed project geometry.

## Two-line label

1. Filament type, such as `PLA Basic`.
2. Color, such as `Bambu Green`.

The body uses the selected filament color. Lettering is always pure black or pure white, chosen with the shared palette-contrast rule. Noto Sans Bold is fitted into a 36.5 mm-wide area on the now-continuous face/rim. The two row centers are 10.6 and 4.6 mm above the original bed plane. Text rises 0.8 mm outward from the front and overlaps the face inward by 0.02 mm.

Full names are attempted first with at most 35% horizontal condensation. A few long names are shortened when necessary: redundant finish descriptions may be removed; `Support for` becomes `Support`; `Blueberry Bubblegum` can become `Blueb. Bubblegum`. The complete selected product/color names remain visible in the app and in metadata, alongside the actual printed row values. There is no automatic truncation or third text line.

## Checks and print boundary

Tests hash all retained source triangles, verify the cap's position/winding and closed structure, check exactly two rows, audit printability for all 314 catalog entries, and validate the actual serialized 3MF geometry. The default fixture also verifies that every disconnected glyph physically intersects the filled label body.

The default PLA Basic / Bambu Green 3MF was also imported and re-exported by the installed Bambu Studio on September 4, 2026. It returned `Success` with 4,206 body triangles and 13,984 text triangles retained; all reported mesh-repair counters were zero. This was an import check, not a slice or physical print qualification.

The preview and downloaded 3MF both keep the original source print orientation, positioned on the selected printer's bed using the same placement calculation. The angled camera looks from the front-left to reveal the -Y-facing lettering; rotate and zoom to inspect it. Lettering is on a vertical side: inspect the slicer's text paths, overhangs/supports, and body/text filament assignments before a test print. The file is not pre-sliced, and physical clip fit, strength, and two-material printing are not yet qualified.
