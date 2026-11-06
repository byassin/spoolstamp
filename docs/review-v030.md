# v0.3.0 local review

Reviewed November 6, 2026. This is an engineering correctness/privacy review and implementation record, not a security certification or a production/physical qualification.

## Scope

Reviewed AMS connection lifecycle and public response handling; server origin/CSRF/ownership/session/rate/revocation fences; saved-workspace persistence and transfer; shared-link validation; configuration changes and export cancellation; Studio preparation; multipart assignments/plate placement; preview orientation; and design provenance. Existing unrelated working-tree edits and supplied mechanical templates were preserved.

## Findings addressed

- **Malformed cloud responses could crash the interface.** Array-only checks admitted invalid nested printer/slot entries. The client now validates bounded nested public fields and IDs before rendering, bounds JSON payload size, strips unrecognized fields, and preserves the CSRF revision fence. Invalid HTTP-200 payloads become a fixed, safe error/fallback.
- **Stale tabs could overwrite saved work.** Storage events and read-before-write revision checks synchronize ordinary cross-tab changes and reject stale actions. No silent merging of previously deleted drafts. The remaining simultaneous-write limitation is explicit.
- **Design metadata assumed two source templates.** Added shared design display metadata and a distinct dispatch/provenance branch for the original flat adhesive label, rather than reporting it as a supplied clip. Existing mechanics remain unchanged.
- **Local download feedback was hidden by Studio readiness.** A completed download now takes precedence over the standing Studio-ready message.
- **Expiry copy implied the wrong starting point.** The interface now says connection lasts _up to_ 30 minutes and explains that the session starts on Connect.

## Features added

Original 60 × 25 mm flat adhesive label, configuration undo/redo/reset, catalog-only fragment links, and strict local workspace backup/import. See [editing and transfer](label-editing.md) and [flat design](adhesive-label.md).

## Verification and boundaries

Automated checks exercise catalog-wide flat-design text readability, closed positive-volume geometry and glyph attachment, single/separate/arranged 3MF exports, all offered printer beds, preview/export placement, history/link parsing, backup validation/merge/revision checks, and malformed cloud responses. Local browser checks cover desktop and narrow mobile layouts, imported-setup opt-in, link restoration, undo/redo, cross-tab synchronization and synthetic AMS flow. No Bambu credentials, verification emails, or real printer reads are used for these checks.

Validation passed: **40 test files / 443 tests**, type checking, lint, static and production builds, and the Lambda bundle. After the final interface-copy adjustments, the focused client/editing/transfer checks passed again (**22 tests**). Browser checks used a 1440 px desktop and 390/320 px mobile widths, and verified fresh synthetic spool rendering and expired-snapshot guidance.

No additional high-impact issue was identified in the reviewed paths. This does not establish the absence of vulnerabilities. No external dependency-vulnerability service, live-provider qualification, native Studio slicing, physical print/adhesive durability test, or paid infrastructure change was performed. Backend credential handling and read limits are unchanged; no analytics or new tracking was added. The transport User-Agent remains pinned pending separate provider qualification.
