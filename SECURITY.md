# Security policy

## Supported version

Security fixes are applied to the latest `main` branch and current public deployment.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include real printer access codes, cloud tokens, account credentials, or personally identifiable data in a public issue.

## Trust boundaries

- The hosted generator does not request or store Bambu credentials.
- 3MF generation runs locally in the browser.
- Catalog data is pinned, generated, and reviewed rather than fetched from an undocumented service on each user request.
- The future printer companion must keep all printer communication on the user's machine and use Bambu Connect or an approved integration path.
- Imported community templates must be treated as untrusted input and validated before preview or export.
