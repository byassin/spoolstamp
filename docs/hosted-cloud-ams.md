# Hosted cloud AMS preview

Amplify still hosts the static website. The AWS Lambda backend handles
global-region email-code login and Bambu Cloud snapshot reads. A single-process
Node 22.13+ backend remains available for local development of the hosted flow.
End users need a browser and a cloud-connected printer, not a local helper.
The backend and browser interface are deployed as an account-restricted private
preview. Owner-provided screenshots on October 8, 2026 demonstrate real email-code
sign-in, X2D printer selection, and a fresh snapshot showing black PLA/PETG slots.
See [browser evidence and user steps](ams-integration.md#live-x2d-browser-test).
This qualifies that sign-in/read path only, not broader public access or every
model, lifecycle behavior, and export action.

## Behavior and boundaries

- Explicit consent and one click per verification email. No password, token-paste
  UI, automatic retries, or automatic email resend.
- Choose an account-owned printer, read one fresh full snapshot, close MQTT.
  Uses catalog slot matching, ambiguity confirmation and batch-label safeguards.
- Status requests are limited to one per account/printer every five minutes,
  even across logout/re-login. Label actions require a snapshot under 45 seconds
  old. This is on-demand reading, not continuous monitoring. After changing spools,
  wait and read again. Partial/retained reports never renew spool identity.
- Sessions expire 30 minutes after creation, with no sliding renewal. Tokens
  remain server-side, never browser storage, cookies, or API responses. The local
  preview uses memory only; Lambda uses KMS-encrypted temporary DynamoDB records.
  The host-only HttpOnly cookie is an opaque session identifier. A non-secret
  CSRF nonce and sanitized printer/slot data are the only browser contracts.
- The code is cleared on submission and never persisted. Challenge email is
  encrypted and replaced by the encrypted token after login. Lambda logout deletes
  the session; workers check revocation every two seconds and before starting the
  provider read. In-flight network cancellation is best-effort; late results cannot
  recreate deleted/expired rows. JS strings cannot guarantee secure zeroization.
- Exact Origin and CSRF checks, cookie/nonce rotation after login, bounded payloads,
  capacity and attempt/account limits. No arbitrary MQTT topics/payloads or printer
  control. Every read rechecks ownership at Bambu. TLS verification stays enabled.
- Vendor blocks/challenges are surfaced, never bypassed. No raw provider data or
  errors are logged/returned. Do not enable body, cookie/header, email, telemetry,
  process-memory, crash-dump or credential logging, payload tracing, unencrypted
  credential persistence or swap. Lambda's encrypted session store is intentional.
- Bambu's token may permit more than the read-only API exposed here. A compromised
  backend could misuse it; application restrictions are not vendor-scoped OAuth.

## Local development of the hosted flow

Two PowerShell terminals in `C:\Users\bourhan\GitHub\spoolstamp`:

```powershell
# Backend: explicit opt-in, no Bambu traffic until you use the UI.
$env:SPOOLSTAMP_AMS_ENABLE = 'experimental'
$env:SPOOLSTAMP_AMS_DEV = '1'
$env:SPOOLSTAMP_AMS_APP_ORIGIN = 'http://localhost:3000'
npm run serve:ams:cloud
```

```powershell
# Frontend: use the same hostname; update the backend origin if the port changes.
$env:VITE_AMS_API_ORIGIN = 'http://localhost:3100'
npm run dev -- --port 3000
```

Open My AMS: Send verification email → code → printer → Read fresh AMS.
The AMS panel is cloud-only; manual filament selection stays available. Do not paste codes into chat or command
arguments. Remove these variables from your shells when finished. Never enable
SPOOLSTAMP_AMS_DEV on a remote deployment (it permits insecure loopback cookies).

## AWS Lambda deployment

See [AWS Lambda AMS](aws-lambda-ams.md) for the SAM stack, private-preview gate,
deployment commands, costs, and validation limits. This is the chosen hosted path.
Lambda does not rely on warm-process memory or background work after HTTP return.
Sessions have a hard 30-minute expiry enforced on every API/worker operation;
DynamoDB TTL physical cleanup can take days. Lambda restarts do not clear sessions.

## Alternative single-process deployment — not executed

1. Resolve vendor access/terms and public-rollout approval separately. This is
   unofficial: a working private probe does not constitute vendor approval.
2. Host `deploy/cloud-ams.Dockerfile` behind HTTPS with **exactly one process and
   one running instance**. Build from repository root:
   `docker build -f deploy/cloud-ams.Dockerfile -t spoolstamp-cloud-ams .`
   Its Dockerfile-specific context allowlist excludes credentials, Git history,
   generated models and unrelated source. Pin the base image digest for release.
3. Suggested custom API domain: `https://ams.spoolstamp.bourhan.org` (a separate
   HTTPS child of the website, avoiding third-party cookie requirements). Set
   SPOOLSTAMP_AMS_ENABLE=experimental and
   SPOOLSTAMP_AMS_APP_ORIGIN=https://spoolstamp.bourhan.org. Leave
   SPOOLSTAMP_AMS_DEV unset. PORT defaults to 3100. GET /healthz is anonymous;
   all session API requests require the exact website Origin.
4. Keep backend ingress private/restricted to the HTTPS proxy. Permit outbound
   vendor HTTPS and MQTT/TLS on 8883. Use non-root/read-only runtime, memory/CPU/
   connection bounds, no dumps/swap. Enforce per-client and global abuse limits
   at the trusted edge. App peer-IP limits cannot distinguish clients behind a
   proxy, and arbitrary X-Forwarded-For is deliberately not trusted. Keep bodies,
   cookies and private data out of proxy logs. Do not expose the Node port directly.
5. Set Amplify build variable
   VITE_AMS_API_ORIGIN=https://ams.spoolstamp.bourhan.org and rebuild the static
   site. No secrets belong in VITE_ variables. Without valid configuration the
   site keeps the manual picker fallback; unrelated third-party API domains are rejected.
6. This alternative deployment has not been qualified. On the selected Lambda
   deployment, real OTP/X2D reading and credential-free cookie/CORS checks passed.
   Remaining real-device checks include complete expected inventory, stale
   disablement, logout during read, expiry, cross-account ownership, edge-rate
   limits, and phone use with the local computer off.

This memory-only preview is not HA: restarts, multiple workers, scaling and rolling
deployments lose sessions/counters. Do not put it on a stateless-instance platform
without a reviewed shared encrypted session store and distributed limits. A restart
also resets read cooldowns; never use restarts to force extra reads.
No resources have been created for this alternative container deployment. The
selected Lambda backend and its DNS/website wiring are already deployed.

## Credential-free validation

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:static`.
Hosted tests use real loopback HTTP with an injected fake Bambu provider. They
never send email/read real printers. Container and hosted browser tests are separate.

The Windows static-build shutdown assertion was traced to Vinext's explicit
zero-code process exit. The isolated build launcher now lets Windows drain after
explicit success; nonzero/undefined exits and later failures remain failures, with
a bounded build deadline. The complete configured static build exits successfully.
Linux release CI passed, including both frontend builds and the Lambda bundle.
Synthetic tests remain separate from the real X2D browser evidence above and the
remaining lifecycle/export qualification.
