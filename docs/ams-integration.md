# My AMS

Use the spools already loaded in your printer to create labels.

## Connect

1. Run Spoolstamp locally with `npm run dev`.
2. Open **My AMS → Connect**.
3. Enter your printer's LAN IP address, confirm the certificate fingerprint, then enter its serial number and LAN access code.
4. Select **Use label** on a spool to fill in its material and color.

The drawer can be closed while the connection stays active.

## Text and batches

**Use compatible loaded black/white text automatically** suggests a contrasting spool from the same material family. You can also choose the text filament manually in Print setup.

Select **Batch** on up to eight spools to download their labels together as a ZIP. Each label uses the current design and printer profile.

Bambu Studio handles the final AMS slot assignments when printing.

## Connection details

AMS reading is available in the local app. It supports multiple reported AMS units and has been used with an X2D; other printer and accessory combinations may vary.

The connection reads inventory over the local network. Access codes stay in server memory and are not saved to the repository or browser storage. Restarting the app server clears the connection.

If inventory is missing, check the printer's address and LAN access code, reconnect, and expand **Connection diagnostics** for details.

## Developer references

- `scripts/local-ams.ts`: local connection and session handling.
- `scripts/ams-network.ts`: TLS/MQTT transport.
- `lib/ams.ts`: inventory parsing.
- `lib/ams-matching.ts`: catalog and text-spool matching.
- `tests/ams*.test.ts` and `tests/local-ams.test.ts`: protocol and lifecycle coverage.
