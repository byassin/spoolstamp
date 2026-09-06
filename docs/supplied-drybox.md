# Supplied dry-box STL: preservation and print checks

## Current print-test revision: hinge-r2 (2026-09-05)

The user printed R1 and reported improved but still stiff rotation. R2 increases the moving-link bearing relief from 0.05 to **0.075 mm radially**, only **0.025 mm more than R1** at each interface. Moving sockets are approximately 1.475 mm radius and moving pins 1.225 mm radius. The source asset, fixed card/hook, other link surfaces, topology and overall dimensions are unchanged. The revision is always applied to the raw source, never cumulatively to R1.

Fresh exports carry `hinge-r2` in the filename and `bearing-relief-0.075mm-v2` in the manifest. R2 physical qualification is pending; test one label before batching. R1's reported improvement does not establish that either revision reproduces the original's physical feel.

R2 verification: all 211 tests pass, including unchanged source/bounds, single-solid material-removal checks and serialized topology; typecheck, lint and build pass. Installed Studio 02.08.02.61 imported/re-exported four fixtures with zero repairs and retained the explicit purge arrays. A geometry-only diagnostic slice with the earlier comparison's explicit X2D/0.20 mm Standard/Tough+ profiles succeeded with an empty warning message and 264,776 triangles. Direct CLI slicing without these complete profiles returned -100; it is not the supported desktop-project workflow. The diagnostic uses Tough+ for both roles and is not an AMS/profile-mapping test or the downloadable print artifact.

## Previous print-test revision: hinge-r1 (2026-09-05)

After the user reported stiff rotation compared with three successful original labels, R1 added **0.05 mm radial clearance** only at the moving links' spherical bearing surfaces. This was a minimal fit adjustment, not a claim that the earlier digital comparison proved the physical cause.

- Each link has two 1.4 mm-radius sockets and two 1.3 mm-radius pins. Sockets enlarge to approximately 1.45 mm and pins reduce to approximately 1.25 mm; the original tessellation error is retained. Thus each mating interface gets 0.05 mm additional radial clearance, not 0.05 mm on both sides. The fixed card/hook counterparts are unchanged.
- Measured source centers: left sockets X=12.15, left pins X=23.85; right pins X=36.15, right sockets X=47.85; all at Y=62.4 or 66.0, Z=1.6 mm.
- Only vertices on those source-specific spherical surfaces move, by 0.05 mm along the sphere radius, within Float32 rounding tolerance. A separate 0.00005 mm matching tolerance identifies the supplied tessellation. Expected vertex counts (4,033 per socket, 4,034 per pin) fail closed if the source changes.
- The source asset is unmodified. Card/hook coordinates, outer link shells, triangle connectivity, bed contact Z=0, and overall model bounds remain unchanged. Preview and export use the same revised meshes.
- Geometry tests confirm the revised links remain single, positive-volume solids, retain over 95% of their original volume, and introduce no material outside the original solid above 0.0001 mm³ numerical tolerance. Serialized meshes pass manifold/orientation/degeneracy checks.
- Native Bambu Studio 02.08.02.61 sliced the fresh PLA Tough+ Cyan / X2D export at 0.20 mm Standard successfully with an empty warning message, 264,776 total triangles, and the original overall dimensions. This was a local diagnostic slice, not a printer send.
- A same-settings before/R1 G-code comparison at Z=1.6 mm, Y=62.4 mm shows four bearing-axis gap gauges widening from approximately 0.39 to 0.44 mm (source X near 13.5, 25.2, 34.8 and 46.5). Other unchanged gauges remain unchanged. These are nominal extrusion-footprint measurements at 0.01 mm raster resolution, not physical bead measurements or minimum clearance guarantees.
- Export filenames now include `hinge-r1`; the 3MF manifest records `bearing-relief-0.05mm-v1` and pending physical qualification. Older files are unchanged. Print one newly generated sample before batching.

The source-preservation record and pre-revision checks below describe the raw source asset and earlier exports, not a claim that the current moving bearings are unmodified.

## Source and transformation

- Source: `Filament+Dry+Box+Labeled+Tags+-+Bambu+Lab+-+PLA+Basic+1of2.stl`, supplied by the user on 2026-09-04.
- SHA-256: `970ba1c28f13db9db89dcbfefedcdcfae9cab449b170773c2fba380536c89398`.
- Original binary STL: 245,138 triangles, 70 connected components, approximately 60 × 88 × 4 mm.
- Retained: card (52,578 triangles), hook (108,298), left link (32,800), right link (32,800).
- Removed: 66 separate raised-lettering components (18,656 triangles) plus six zero-thickness source faces.

`scripts/extract-drybox-template.mjs` accepts only the inspected source hash. It preserves the exact Float32 values and winding/order of every retained triangle. It does not scale, redraw, Boolean or remesh the source. `data/supplied-drybox.json` records source spans, repaired counts, excluded face pairs, bounds, and expanded triangle-coordinate hashes. Tests reproduce those hashes from the asset and actual exported 3MF XML. Preview tests verify unchanged triangle coordinates independently of render normals.

The user's desktop import exposed three non-manifold edges inherited from the source hook. Each is caused by a microscopic coincident, opposite-winding face pair. The hash-specific extraction now removes both faces in each global STL pair: 81195/88420, 117689/124097, and 117691/124699. The script verifies cyclic reverse Float32-byte identity before exclusion. Exactly six faces are removed, with zero net physical volume; all bounds and retained surface coordinates remain unchanged. All four structural parts now pass exact Float32 audits for closed, consistently oriented, nondegenerate manifold geometry. New lettering is independently checked after export quantization.

## Replacement lettering

The existing card face is approximately Z 3.200073 mm. Generated Noto Sans Bold text occupies X 3–57 mm and Y 3–58 mm, away from the hinges. Its base overlaps the card by 0.02 mm and its visible relief is 0.80 mm, matching the original relief. Boolean contact tests on the serialized text verify positive contact volume for every connected letter/punctuation component.

For a 0.4 mm nozzle, the generator screens a 0.45 mm extrusion width. It tests each connected component with erosion and dilation at a 0.225 mm radius, requiring at least 98% recoverable component area and unchanged component/counter counts. Small outline expansion (at most 0.15 mm) is allowed without merging letters or closing counters. Additional tracking provides room for this expansion. A reserved margin keeps the final expanded bounds inside each row. If the constraints cannot be met, generation fails with an explicit text-size error rather than silently dropping strokes.

All 314 catalog entries pass this screen. Tests also reconstruct a section from serialized 3MF lettering, check the screen again, and verify physical contact with the source card. This is a geometric screening criterion, not a claim that every local tapered tip measures at least 0.45 mm.

## Actual Bambu Studio checks

On 2026-09-05, native Bambu Studio 02.08.02.61 import/re-export retained all 271,428 faces of the repaired dry-box test fixture, both selected PLA material/color slots, and the P1S preset IDs, with zero repair counters. Independent source-vs-asset comparison confirmed unchanged bounds and volume (15,778.892495455333 mm³ for the four structural parts). See [the current config checks](studio-project.md).

### Earlier geometry slice (before the six-face source repair)

Verified 2026-09-04 with installed Bambu Studio **02.08.02.61**, P1S 0.4 mm nozzle, `0.20mm Standard @BBL X1C`, and `Bambu PLA Basic @BBL P1S 0.4 nozzle`. The fixture uses PLA Basic / Ocean to Meadow (10902) to exercise spaces and multiple appearance colors.

- Import/re-export: all four mechanical face counts unchanged; reported repair counters zero; structure role 1 and lettering role 2 retained.
- Slice: exit/return code 0, `Success`, empty warning message.
- 271,434 triangles; approximately 60 × 88 × 4.00007 mm.
- Twenty 0.2 mm layers. Above the structure, text paths appear at Z 3.4, 3.6, 3.8, and 4.0 mm.
- The four text-only layers contain 12,812 positive XY extrusion moves. The final layer includes outer-wall and top-surface paths.
- G-code SHA-256: `92c0f9528adaa082aa4cafa0638b1d99d3902912a1f77127c2cb0e5b811aafc6`.

Both project material slots used the same PLA profile in that earlier CLI geometry check, and it performed no tool changes. **Two-material switching is not verified.** Map body and lettering to the desired physical spools in Bambu Studio and inspect its slice preview before printing. The current output remains an unsliced project 3MF, with the compatibility identifier and creator provenance documented separately.

Digital tests do not establish physical fit, free movement, retention, or durability on a particular printer. The current minimal bearing revision above needs one flat sample at 0.2 mm layers before making a batch.

## Provenance

This supplied template is separate from original application code and is not relicensed under MIT. It is included in the public repository at the owner's explicit direction, with upstream redistribution permissions unverified. See `NOTICE-DATA.md`.
