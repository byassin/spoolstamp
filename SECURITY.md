# Security policy

## Supported version

Security fixes are applied to the latest `main` branch and current public deployment.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include real printer access codes, cloud tokens, account credentials, or personally identifiable data in a public issue.

## Trust boundaries

- The optional experimental cloud backend accepts an email and one-time verification code. The local preview keeps Bambu tokens in server memory. The AWS Lambda backend stores temporary tokens and pending email challenges encrypted with AWS KMS in DynamoDB, never browser storage, API responses, or logs. Sessions are rejected after 30 minutes and deleted on logout; challenge use ends after 10 minutes. DynamoDB TTL cleanup is asynchronous and can retain expired encrypted records for days. Backend restarts do not revoke Lambda sessions. No verification codes are persisted.
- 3MF generation runs locally in the browser.
- Catalog data is pinned, generated, and reviewed rather than fetched from an undocumented service on each user request.
- The cloud backend permits only account-owned printer status reads, with origin checks, CSRF protection, bounded sessions, and rate limits; it exposes no printer-control commands.
- Public cloud rollout requires a separate review of vendor access terms and deployment protections. A successful private probe is not approval or production qualification.
- Imported community templates must be treated as untrusted input and validated before preview or export.
