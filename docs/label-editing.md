# Editing, sharing and workspace transfer

## Edit a label

Choose a design, filament and printer, then use the toolbar above the preview. **Undo** and **Redo** move between recent choices; **Reset** returns to the default label. Saved favorites and drafts stay available.

The editing toolbar provides undo, redo, reset and **Share label**. Undo/redo covers the last 30 label-configuration changes: filament, design, printer profile, and text choices. It does not undo favorite/draft operations or make/cancel Bambu requests. Reset returns the builder to its default configuration without deleting saved items. Configuration changes, including undo/redo, invalidate in-flight model downloads and Studio preparation.

## Share a setup

1. Finish choosing your label and click **Share label**.
2. Paste the copied link into your message. If copying is unavailable, select and copy the **Shareable label link** field.
3. Open the link in another browser to restore its design, filament, printer profile and text choices. Confirm the physical spools in Studio before printing.

![Share label exposes a selectable link above the preview](images/share-label.png)

**Share label** copies a link and exposes a selectable copy field. The URL fragment contains only a versioned catalog filament ID, printer _profile_ ID, design and allowed text options. It contains no Bambu email, code, cookie, token, physical printer ID or AMS inventory. Fragments are not sent in the HTTP request; the choices can still appear in browser history or wherever a user shares the link. Shared choices override remembered setup on initial load and also respond to same-page fragment navigation. Unknown or oversized links leave the builder unchanged and show an error.

## Move favorites and drafts

1. Open **My saved filaments → Backup & restore** and click **Download backup**.
2. On the destination browser, open the same section and choose your JSON file under **Import a Spoolstamp backup**.
3. Review the import result. Your existing favorites and drafts are retained. Choose **Use imported setup** to apply the backed-up label, or keep editing the current one.

![Backup and restore controls under My saved filaments](images/workspace-backup.png)

Under **My saved filaments → Backup & restore**, **Download backup** exports setup, favorites and drafts as a local JSON file. Import is limited to 32 KB and strictly validates schema, fields and current catalog choices. It merges duplicates without replacing existing favorites/drafts; capacity overflow rejects the whole import. Imported setup is applied only after **Use imported setup**. Remember-setting and login state are not transferred. The file is not encrypted, but contains catalog choices only, never credentials or live inventory.

## Multiple tabs and storage limits

Tabs synchronize saved lists through storage events. Before writing, a tab checks whether the stored record changed; unseen changes load the latest workspace and ask the user to retry rather than overwriting it. This is best-effort optimistic detection, not atomic multi-process locking: truly simultaneous writes remain a limitation. External setup changes do not unexpectedly replace an actively edited label. Browser storage may be blocked or cleared; keep a backup if the drafts matter.
