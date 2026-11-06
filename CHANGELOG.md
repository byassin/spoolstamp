# Changelog

## 0.3.0 — 2026-11-06

- Add an original 60 × 25 mm flat label for user-supplied adhesive, with raised text, catalog-wide readability checks, and single/batch/plate export support.
- Add bounded undo/redo and reset for label configuration changes.
- Share catalog-only label configurations through URL fragments; no Bambu login or physical printer identifiers are included.
- Back up and merge saved favorites/drafts with strict local JSON validation and an explicit imported-setup restore action.
- Reject malformed nested cloud responses and protect saved work from stale-tab overwrites.
- Keep Bambu-only catalog support, existing source mechanics, privacy boundaries, and live-inventory freshness/read limits unchanged.

## 0.2.0 — 2026-11-04

- Simplified My AMS into one clear status card; fixed wrapped, overlapping status borders.
- Kept reusable catalog label choices from the last read for the current visit. Returning for another label no longer requires another printer read after live inventory expires.
- Shortened the primary instructions and moved timing guidance into “How it works.”
- Automatically selected an account’s only printer and kept different printers’ live inventory separate.
- Added a version badge beside the logo, sourced from the package version. No footer added.
- Unified UI and 3MF generator version reporting and added release-bump commands.

## 0.1.0 — previous baseline

Bambu catalog label generation, cloud AMS preview, manual text colors, saved workspace, arranged plate exports, and mobile quick download.
