# Saved workspace and multi-label plates

Spoolstamp remains limited to the Bambu catalog. This release adds no custom brands or account system.

## Browser-only choices

- Enable **Remember my setup on this browser** to restore the last catalog filament, printer profile, design and text choice after reloading. Disable it to stop remembering and remove the saved setup.
- **Save favorite** keeps a catalog shortcut; select it under **My saved filaments**.
- **Save label draft** keeps a catalog label configuration for later. AMS **Save draft** requires a fresh, resolved spool and a confirmed compatible automatic text profile, or an explicit manual text choice.
- At most 16 favorites and 16 drafts are retained. Remove individual items in the saved workspace. If storage is unavailable, an explicit notice says they last only for this visit.

The versioned `spoolstamp.workspace.v1` browser-storage record contains only catalog filament IDs, printer *profile* IDs, design IDs and allowed text options. It never contains email, code, token, CSRF, printer serial, slot identity, remaining percentage or live inventory timestamps. Loading revalidates all choices against the current catalog. Saved preferences do not extend a Bambu session.

Drafts are not live inventory and can be exported without signing in. They say to confirm the physical spools in Studio. Expired AMS snapshots still cannot be used to create new drafts or live exports; the 45-second freshness and five-minute vendor-read cooldown are unchanged. No stale inventory is silently upgraded to current inventory.

## Plate projects

Select up to eight loaded labels or saved drafts, choose **Arrange compatible labels on plates**, and download the ZIP. Each `.3mf` contains one plate with independent multipart label objects and their body/text filament assignments. Saved batches use the currently selected design and printer; individual **Use draft** restores that draft's configuration.

Labels are grouped conservatively by the exact body and text product pair, not merely a broad material family. Support profiles are rejected for combined plates. Every body/text profile must exist for the chosen printer and 0.4 mm nozzle. Within each group, a plate has at most four unique profile/color combinations; duplicates share a project filament. Extra colors or insufficient bed space produce additional projects.

Packing uses whole-assembly translations, 10 mm bed/exclusion clearance, 6 mm spacing between label bounds, the common dual-nozzle printable area, and printable height. It never scales/rotates source mechanics or changes cached vertices. New unsupported bed shapes are rejected. Project filament vectors, purge matrices and multipart assignments are generated for the actual filament count. Existing single-label exports and slicing presets remain unchanged.

Automatic placement checks label bounds, not the final sliced toolpath. Open each project in Studio, confirm physical AMS spool assignments, and inspect brim and purge-tower clearance before slicing. Default purge values are not color-calibrated recommendations. No new physical-fit, multi-label print or broader printer compatibility qualification is claimed.

## Other improvements

Manual text colors with estimated contrast below 3:1 show an advisory suggestion, never a blocking restriction. Transparent palettes skip this numerical estimate; actual filament finish and lighting can differ from screen colors. This is not a physical readability or accessibility certification.

Mobile controls have larger tap targets and a bottom quick-download bar. AMS status shows snapshot age and time to another read. During outages, manual picking and saved drafts remain usable. Only session-state GET polling backs off to at most 60 seconds; email requests, sign-in and printer reads are never automatically retried. Authentication, credential handling and provider read limits are unchanged.

Regression coverage includes storage validation/secret-field stripping, advisory contrast, the exact freshness boundary, outage sanitization/no POST retry, both designs across all catalog printer beds, plate splitting, geometry preservation, and 3MF profile/filament assignments. Real printer qualification still needs consenting physical tests.

Local browser checks on October 11, 2026 covered desktop (1440 px), mobile (390 px), and narrow mobile (320 px): contrast suggestion, remembered setup after reload, favorites/draft persistence, clearing manual overrides when restoring an automatic draft, disabling remembered setup without deleting drafts, mobile quick download, and a two-label saved plate ZIP. The downloaded clip-label project had two independent assemblies and correct black/white role assignments for A1 mini. No Bambu credentials were entered and no vendor reads were requested. Native Studio slicing and physical multi-label printing remain unqualified.
