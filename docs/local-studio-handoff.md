# Open in Bambu Studio

Run Spoolstamp locally on the same computer as Bambu Studio.

1. Choose your design, filament, and printer.
2. Click **Open in Bambu Studio** once the selection is ready.
3. Open the file as a project, check the body/text spool assignments, and slice.

The selection prepares automatically as you make changes. **Download 3MF** is also available if you prefer to open the file yourself.

## Troubleshooting

- **Studio does not open:** check that Bambu Studio and its networking plug-in are installed, or use Download 3MF.
- **An old link fails:** refresh Spoolstamp to prepare a new transfer.
- **Wrong physical spool:** change the AMS slot assignment in Studio's print dialog.

## How it works

The local service temporarily holds the generated 3MF in memory so Studio can download it from the same computer. Transfers expire after 15 minutes or when the server stops.

The service binds to IPv4 loopback and is only included in the local development server. Hosted users can download their 3MF instead.

Windows and Linux use `bambustudio://open?file=…`; macOS uses `bambustudioopen://…`.

Implementation: `scripts/local-studio-transfer.ts`, `lib/studio-handoff.ts`, and `lib/studio-preparation.ts`.
