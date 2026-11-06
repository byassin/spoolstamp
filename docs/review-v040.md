# v0.4.0 implementation and validation

Prepared locally November 6, 2026, based on the released v0.3.0 tree. This record covers the v0.4.0 frontend changes, with no hosting or backend policy changes.

## Features

- Batch copy counts expand within the eight-label limit. The numbered bounds preview and downloaded ZIP consume the same captured meshes, placements, grouping, profiles and layout. Public preview metadata is frozen and private mesh data is held separately; forged/deserialized plans cannot export.
- Named local collections support creation, renaming, search, selection and reprinting. Old v1 storage/backups remain readable. Strict 96 KB imports include bounded names/configurations, preserve conflicting work and remain idempotent after a collection is renamed. The upgraded workspace is isolated under a new storage key with one-time legacy copying, preventing an older open tab from dropping collection/layout fields on its next write.
- The original rounded adhesive label retains the 60 × 25 mm face, 1.6 mm backing and text-safe area, with 2 mm corner radii. Supplied hinge/clip mechanics are preserved.
- Simple/Detailed choices drive preview, exports, metadata, history, drafts, links and backups. Legacy omitted layouts remain Detailed; the clip stays two-line Simple. Saved batches explicitly preserve each saved layout rather than inheriting a current Simple choice accidentally.
- A native modal provides a short Studio printing guide. The version badge opens concise release highlights, with earlier versions collapsed.
- The four-design chooser uses a compact grid. Collection-add controls stay collapsed during ordinary reprinting; stale preview messages now ask the user to prepare again.

## Browser evidence

Local checks used the 1280 × 720 desktop viewport and 390/320 px mobile widths. They covered modal focus/close/Escape behavior, no horizontal overflow, Simple/Detailed preview changes, fixed clip content, backup import with explicit setup restoration, collection creation/search/rename/repeat import, bounded copy counts, arranged/separate plans and quantity-change invalidation.

The actual downloaded saved-plate ZIP contained four rounded Simple labels, including a repeated Green label, and generator version 0.4.0. The synthetic AMS flow prepared three labels with automatic black/white text, then removed live batch export after expiry. Reusing a captured catalog label left the simulated printer-read count at one. Screenshots use public catalog choices and sample collection/inventory data; no Bambu credentials, verification emails or real printer reads were used.

## Automated verification

The integrated full run passed **43 files / 521 tests**. After the final storage-namespace and canonical-identity fixes, the focused persistence run passed **five files / 34 tests**, covering migration, old-client isolation, concurrent initialization, unavailable/quota-limited storage, semantic deduplication and repeat imports. Browser checks preceded that storage-only change; migration was validated with fake-storage tests rather than a real mixed-version browser session.

Final type checking, lint, Lambda bundling, production build and static export all passed locally. The static build prerendered two routes and produced `dist/client/index.html`. Thirteen current screenshots were reviewed, and 69 local documentation/image references resolved. Existing Manifold browser-externalization, large-chunk and Vinext route-classification warnings remain non-fatal. GitHub CI and deployment are separate release steps for this local candidate.

## Qualification limits

The batch diagram is a bounds preview, not sliced toolpaths. Native Studio import/slicing, physical print quality, fit and adhesive durability remain unqualified. The new design does not expand physical printer compatibility claims. Bambu-only catalog scope, account/session handling and vendor read limits remain unchanged. Cross-tab persistence remains optimistic rather than atomic multi-process locking. No analytics, tracking, paid infrastructure or external dependency-vulnerability service was added.
