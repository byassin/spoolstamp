# My AMS

Use the spools loaded in your printer to create labels through the optional,
experimental Bambu Cloud connection. The LAN connection and saved-printer
controls have been removed. The cloud backend is deployed as an AWS private
preview, but the public browser interface is not enabled yet. Until browser
qualification/configuration, the manual filament picker remains available.

## Connect

1. Open **My AMS → Connect Bambu Cloud** on a configured edition.
2. Enter your global-region Bambu email and accept the temporary connection notice.
3. Click **Send verification email**, then enter the six-digit code.
4. Choose a cloud-connected printer from your account and click **Read fresh AMS**.
5. Confirm the loaded spools and select **Use label**.

No local helper, printer IP, LAN access code, or account password is requested.
The backend holds the Bambu token temporarily; it is never saved in the browser.
Sign out ends the session. Sessions expire after 30 minutes. A local-preview
backend restart clears sessions; a Lambda restart does not. Lambda stores temporary
credentials encrypted with AWS KMS in DynamoDB; expired rows can remain encrypted
until asynchronous TTL cleanup. Codes are never persisted.

Reads are on demand: one per account/printer every five minutes. Label actions
require a complete snapshot under 45 seconds old. After changing spools, wait
and read again; old cached identities are not treated as current inventory.

## Text and batches

**Use compatible loaded black/white text automatically** suggests a contrasting
spool from the same material family. Text filament can also be chosen manually.
Select up to eight spools to download separate 3MF labels together as a ZIP,
using the current design and printer profile. Bambu Studio assigns final AMS
slots when printing. Ambiguous products require confirmation, not guessing.

## Legacy saved credentials

The removed LAN feature's saved pairing files are not read, migrated, or deleted.
Existing local credential files remain untouched outside this repository.
No credentials are copied into the new cloud service.

## Setup and qualification

See [Hosted cloud AMS preview](hosted-cloud-ams.md) for local development of the
hosted flow, deployment wiring, security boundaries, and pending qualification.
The [isolated cloud probe](cloud-ams-prototype.md) remains a developer tool.
