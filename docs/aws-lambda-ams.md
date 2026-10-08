# AWS Lambda AMS preview

## Architecture

Amplify serves the static website. `ams.spoolstamp.bourhan.org` maps through an
ACM certificate and API Gateway HTTP API to a 256 MB Node 22 Lambda. Session,
email-code, login and snapshot endpoints preserve the browser contract used by the
local hosted preview. HTTP snapshot requests enqueue a separate 256 MB worker
Lambda and return 202; the browser polls session state. No user credentials are
included in asynchronous job events. Workers run for at most 80 seconds; provider
work has a shared deadline of at most 60 seconds. HTTP requests do not wait for MQTT.

DynamoDB contains versioned sessions, sanitized snapshots and distributed limits.
Each email challenge/token is AES-256-GCM envelope-encrypted with a fresh data key
wrapped by a customer-managed KMS key. KMS encryption context and GCM authenticated
data bind the encrypted secret to the session hash. The data key buffers are
zeroed after use; JavaScript strings cannot guarantee zeroization. KMS HMAC creates
stable account-rate identifiers without a plaintext email in DynamoDB or metadata.
The browser receives only an opaque host-only HttpOnly/Secure/SameSite cookie and
a non-secret CSRF nonce, never a Bambu token, code, email challenge or raw telemetry.

Conditional writes enforce locks and version/expiry fences. Login rotates the
cookie/CSRF and session key in one transaction. A worker claims its job before any
vendor requests; duplicate delivery never retries the printer read. Worker retries
are disabled. Each snapshot rechecks ownership through Bambu before MQTT. Expiry
and logout prevent late results from recreating credentials or inventory. Active
workers poll revocation every two seconds; cancellation of a request already in
flight is best-effort and not a vendor token revocation.

Sessions are unusable after 30 minutes, regardless of DynamoDB TTL delay. TTL can
physically retain encrypted records for days; there are no table backups, PITR,
plaintext credential logs or credential exports in this template. Email challenges
can be used for at most ten minutes. Verification codes are never stored. Logout
deletes the session immediately, subject to a successful DynamoDB acknowledgement.
Lambda restarts do not revoke sessions or reset account/device cooldowns.

## Private preview and bounds

- `EnablePreview` defaults to `disabled`. Health reports readiness without starting
  sessions; other calls fail closed until explicitly enabled.
- `PreviewEmailSha256` (NoEcho) restricts code sending to one owner's lowercase
  email. Its hash is a privacy-sensitive identifier, not an authentication secret.
  Runtime configuration requires it. This is not yet an unrestricted public launch.
- Exact website Origin, secure host-only cookie, CSRF, custom-domain binding and
  JSON 2 KiB bounds. The default execute-api endpoint is disabled. CORS is handled
  by the function, not wildcard API Gateway configuration.
- API source IP comes from Gateway's trusted event, not X-Forwarded-For. Per-peer
  and global request/session/email/read limits persist across Lambda instances.
  Status requests stay at most one per account/device every five minutes, with
  first-request-anchored windows (not a clock-boundary loophole).
- Preview limits: 20 emails and 60 read jobs globally per hour; 5 emails per peer
  per hour; 1 email per account per five minutes; 5 login attempts/account/30min.
  API bootstrap is bounded by 128 starts per 30-minute window globally and ten per
  peer/hour. Windows are bounded, but not an exact count of currently live sessions.
- API Gateway 5 requests/sec, burst ten; API reserved concurrency eight; worker
  reserved concurrency four. Throttling/concurrency limits are not a billing cap.
- Lambda has normal internet egress to fixed vendor HTTPS and MQTT/TLS 8883 hosts;
  no customer VPC/NAT gateway, EC2, App Runner or always-on process is required.
- Two least-privilege Lambda execution roles are created. Existing IAM users/roles,
  the Amplify app and unrelated DNS records are not changed by this stack.
- Application code never logs requests or raw errors; runtime exceptions use fixed
  messages. Payload/access logging and active X-Ray tracing are not enabled. Stack
  log groups retain safe operational errors for seven days. Account-level monitoring
  integrations must also avoid bodies, cookies, credentials and process dumps.

## Build and deploy

AWS CLI v2 and SAM CLI must be installed. Use a scoped identity for routine work;
the owner explicitly approved a temporary root-backed session for initial setup.
Never create root access keys. Do not paste credentials or verification codes into
chat or supply them in process arguments.

```powershell
npm ci
npm run typecheck
npm run lint
npx vitest run tests/lambda-ams.test.ts tests/lambda-ams-aws.test.ts
npm run build:ams:lambda
sam validate --template deploy/ams-lambda.yaml --lint --region us-east-1
sam deploy --template-file deploy/ams-lambda.yaml --stack-name spoolstamp-ams `
  --region us-east-1 --profile spoolstamp --resolve-s3 `
  --capabilities CAPABILITY_IAM --confirm-changeset `
  --parameter-overrides HostedZoneId=YOUR_EXISTING_ZONE EnablePreview=disabled
```

The artifact is an explicit bundled backend entrypoint in `.aws-sam/ams` (ignored),
without source maps or repository upload. SAM's private managed artifact bucket is
an additional deployment resource. Check the change set before execution. ACM DNS
validation creates a new validation record and the new API hostname in the existing
zone. Check that the API DNS name is unused first; do not overwrite another service.

After disabled deployment, verify health and that session creation remains 503.
Enable the private preview only with the owner email hash configured, then test
actual vendor access. AWS-origin vendor blocks must be surfaced, never bypassed.
The owner approved publishing the browser interface for account-restricted
qualification after infrastructure/session checks. Set the public frontend build
variable `VITE_AMS_API_ORIGIN=https://ams.spoolstamp.bourhan.org`; this contains no
credentials. Keep the backend account restriction until real-provider/browser
qualification and separate public-rollout approval.
The SAM template and an eventual dedicated GitHub deployment workflow are separate
from the existing Amplify-on-main workflow; repository pushes alone do not currently
deploy this backend. A GitHub OIDC deployment role needs separate scoped setup.

## Costs and qualification

### Current deployment evidence

The `spoolstamp-ams` stack in `us-east-1` reached CREATE_COMPLETE while disabled,
then UPDATE_COMPLETE with the account-restricted preview enabled. Public HTTPS
health passed with normal certificate verification. Anonymous bootstrap,
host-only secure cookies, exact credentialed CORS, cross-request session
persistence, preflight, CSRF rejection, logout and post-logout read rejection all
passed using `node scripts/check-ams-deployment.mjs --preview`. No Bambu email,
credentials or printer requests were used. The default execute-api endpoint is
disabled; table TTL is enabled on `expires`, and PITR is disabled. Worker retry
count is zero with a 60-second maximum event age. The SAM artifact bucket blocks
all public access. These are infrastructure/session checks, not live provider or
browser qualification. Publishing the frontend does not remove the backend's
account restriction or qualify AWS-to-Bambu access.

Working-checkout validation: 299 tests passed with two workers, lint/typecheck and the
Lambda/static frontend builds passed. The exhaustive catalog test timed out under
unbounded desktop parallelism; the test configuration now caps concurrency at two
without weakening assertions or increasing its timeout. Dependency audit still
reports advisories in the larger application/build dependency tree; this work does
not claim an audit-clean repository or apply broad unrelated dependency upgrades.

### Usage estimate

Two customer-managed KMS keys start at $2/month combined plus usage. Symmetric key
rotation adds storage charges at its first two rotations. At modest private-preview
traffic an estimated $2–$5/month is reasonable, not guaranteed or a spending cap.
API requests, Lambda duration, DynamoDB requests/storage, artifacts, DNS queries and
logs also cost money; account-wide free tiers may already be used elsewhere.
No NAT gateway or provisioned concurrency is included. Review AWS billing after
qualification and establish the owner's desired alerts before broader rollout.

Local tests use synthetic providers and mocked SDKs; they do not prove live AWS
configuration, actual Bambu cloud access from AWS, or browser privacy behavior.
Remaining qualification includes runtime health, encrypted database writes,
cookie/CORS boundaries, real OTP, expected X2D slots, expiry, stale disabling,
logout during reads and a phone test without the local computer running. Vendor
terms/access and public-rollout approval remain separate from a successful probe.

Primary documentation: [Lambda statelessness](https://docs.aws.amazon.com/lambda/latest/dg/concepts-application-design.html),
[HTTP API timeout](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html),
[DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html),
[KMS envelope keys](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html),
[KMS pricing](https://aws.amazon.com/kms/pricing/).
