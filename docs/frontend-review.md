# Frontend review

## Spoolstamp workspace redesign — September 5, 2026

- Design choices are first and remain visible on desktop. Filament type precedes color.
- AMS is a native modal drawer, not an inline sidebar section. Its component stays mounted so closing the drawer does not disconnect or stop automatic compatible-text matching. Escape closes it and returns focus to the launcher; choosing a spool closes it after updating the label.
- Desktop uses separate selection, preview, and print-setup panels with export beneath the preview. Tablet uses two columns; phones use a single page flow. Print details remain expanded and X2D remains the default.
- Default framing fits the label; Full plate shows the selected printer bed. The clip close-up looks toward its lettering face; top/full-plate views preserve print orientation. Keyboard orbit now rotates around the selected framing target rather than the world origin.
- Moved zoom controls below the view controls on narrower layouts to prevent overlap. Removed redundant selected-filament recap, marketing tagline, and competing tablet CSS rules.
- Introduced Spoolstamp name, generated coil/tag logo, neutral charcoal panels, lime active states, and a primary Studio action with a secondary download action. The printable font, pure black/white contrast rules, R2 hinge geometry, and export configuration remain unchanged by this redesign.

### Checks

Browser review at 320, 390, 768, 1366 and native desktop widths. Verified no horizontal page overflow at phone/tablet sizes; material search and keyboard selection; color-menu contrast; both designs; modal semantics, Escape focus return, and retained AMS inventory. Automated suite adds translated close-up fitting and clip-facing camera regression coverage. Full test/build results are recorded in the release handoff.

The public repository includes models at the owner's explicit direction; this UI review does not establish redistribution rights or qualify the R2 hinge physically.

## Earlier September 4 review

## Changes

- Apply the dark theme to portaled dropdowns as well as the page. Searchable filament type and color controls display names, real color codes, appearance labels, and complete palettes. Codes are no longer formatted like hexadecimal colors.
- Use one color/contrast implementation for selector swatches, preview materials, the export summary, and exported lettering. Split colors use hard bands; gradients include every stop; alpha colors show a checkerboard swatch and a translucent preview.
- Reduce the page to filament selection, design/printer settings, preview, and download. Move secondary profile/import information into disclosure sections. Remove placeholder navigation, disabled future-feature controls, redundant status panels, and duplicated selected-filament information.
- Keep the WebGL viewer and camera alive across selections. Reuse structural buffers, release replaced geometry/materials/textures, and share a bounded cache of generated meshes between preview and export. Debounce expensive CAD work while immediately announcing pending updates.
- Add Top, 3D, and Fit controls, keyboard camera input, and announced preview failures with retry. Maintain a real preview height on mobile and tablet; use available height on desktop.
- Keep only the hinged dry-box card and flat-front filament clip. Start each design at a gentle 3D angle, fit its projected depth as well as its face, and retain the camera when filament selections change. Remove the retired flat designs' block font and geometry builders.
- Validate agent configuration requests atomically. Clear stale download/error messages on meaningful selection changes, reject concurrent downloads, and cancel stale results before saving a file.
- Remove unused geometry-construction helpers and the unused `@shadcn/react` dependency. Load ZIP packaging on demand. Keep reusable vendored UI primitives and the canonical catalog/provenance data rather than deleting future-use infrastructure indiscriminately.

## Verification

- Automated tests: configuration validation, palette and alpha appearance, contrast selection, preview UV/source-coordinate preservation, shared mesh work, 3MF serialization, and existing geometry/printability checks across all 314 catalog rows and two designs.
- TypeScript and lint checks.
- Camera projection tests cover both remaining designs, flat and angled presets, and narrow, standard, and wide viewports.
- Earlier browser checks (before the design reduction) at 320, 390, 768, and 1440 px widths found no horizontal page overflow; phone/tablet preview heights were 340/480 px.
- Earlier interaction checks covered keyboard type selection and color-code filtering, empty results, transparent and gradient materials, design selection, printer changes, an actual browser download, and clearing old download feedback after reconfiguration.

## Boundaries retained

The dry-box structural coordinates, hinge clearances, and text geometry are unchanged. This review does not establish physical hinge durability or qualify two-material printing. The export remains an unsliced model 3MF; users still choose a real Bambu Studio slicing profile and assign the body/text filaments. Appearance previews are illustrative. No public release or access-policy change is included.
