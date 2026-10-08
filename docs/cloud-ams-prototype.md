# Cloud AMS: isolated read-only qualification

This is an **experimental developer test, not a deployed website feature**.
It checks for a fresh AMS snapshot through Bambu Cloud independently of hosted
login. The [hosted flow](hosted-cloud-ams.md) is now implemented but not deployed;
the LAN connection has been removed from the application.
No companion app or local bridge is part of the proposed hosted solution.

## Run the one-time test

In your own PowerShell terminal:

```powershell
cd C:\Users\bourhan\GitHub\spoolstamp
npm run probe:ams:cloud -- --run
```

The printer must appear online in Bambu Handy, not be in LAN-only mode. Do not
change printer settings or disable two-factor authentication to pass this test.
Enter your account email, type `SEND` to request one verification email, enter
the six-digit code in the hidden prompt, and select the printer. Compare the
returned slots/material/product/color/presence/remaining values with the printer.
Report only whether they match and any fixed error text, never tokens or codes.

If an email was delivered but the test stopped while parsing its acknowledgement,
use that existing code without sending another email:

```powershell
npm run probe:ams:cloud -- --run --auth code
```

This prompts for the account email and the hidden code, then attempts login
directly. It does not call the send-email endpoint. If the code has expired, do
not repeatedly retry it; deliberately request a fresh email through the normal
mode. An unexpected API response now includes a safe diagnostic containing only
the operation, HTTP status, and bounded response-shape categories, never raw
vendor messages, API-code values, account details, or response bodies.

No arguments or `--help` shows offline help. The CLI requires an interactive
terminal and refuses piped input. If email-code login is not supported for your
account, stop and report the error. Optional `--auth token` prompts without echo
for an existing access token **only if you already have one and choose to use
it**. Never put secrets in chat, command arguments, environment variables, or
source files. `--region china --auth token` explicitly selects the China service;
we do not infer region from email or implement SMS login.

## Safety boundaries

- Process-memory credentials only: no persistence, password collection, raw API
  bodies, or private error logging. MQTT password buffers are cleared on connect
  and cleanup. JavaScript string copies cannot be guaranteed zeroized; exiting
  ends the process.
- Honest Spoolstamp identity, no official-client impersonation, CAPTCHA bypass,
  anti-bot evasion, signing-key extraction, or retries. Stop on access/challenge
  rejection, authentication failure, or unexpected responses.
- Fixed regional HTTPS API/broker hosts, no redirects, verified cloud TLS on 8883.
- Ownership rechecked for every read; device LAN access codes are never returned.
- One serial-specific report subscription and one fixed `pushing.pushall` status
  request. No printer controls, settings changes, wildcards, or arbitrary publish.
- Bounded HTTP/MQTT payloads and at most 60 seconds waiting for telemetry. Ignore
  wrong-topic, retained, malformed, and delta-only reports. Reuse the existing
  sanitized AMS parser without merging cached spool identities.
- Only sanitized AMS fields and a receipt timestamp are printed. An empty
  snapshot or scanning/unknown trays do not qualify populated inventory.

## Before hosting

Fixtures validate the implementation, **not live Bambu compatibility**. Qualify a
real populated X2D snapshot, 2FA retained, multi-AMS layout, offline/timeout,
sign-out, and freshness after a spool change. Hosted acceptance should work from
a phone with this development computer powered off, proving no local dependency.

Amplify currently serves a static site. Production needs a separate backend with
outbound MQTT/TLS, authenticated per-user sessions, ownership checks, encrypted
token handling, expiration/revocation, rate/concurrency limits, no-cache responses,
CSRF/origin controls, and a sanitized inventory API. Our app's read-only behavior
does not make the account token narrowly scoped. Do not expose this prototype
directly as a public API.

Establish vendor-supported access before public rollout. Community code is not
vendor approval. No deployment, partnership email, credential retrieval, or
printer configuration change is performed by the offline tests.

## Sources

- [Cloud HTTP protocol](https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md)
- [MQTT protocol](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)
- [Email-code authentication reference](https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/bambu_cloud.py)
- [X2D cloud status reference](https://github.com/tribixbite/beambam/blob/main/docs/CLOUD_BRIDGE.md)
- [Bambu cloud-access position](https://blog.bambulab.com/setting-the-record-straight-on-cloud-access-and-community/)
- [Partnership contact](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/)

Protocol references are unofficial and may change. Their spoofing/control paths
are not used. No real Bambu account has authenticated during automated development.
