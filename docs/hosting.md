# Hosting

## AWS Amplify

Connect the repository and deploy `main`. The included `amplify.yml` installs Node.js 22, runs `npm run build:static`, and publishes `dist/client`.

For an existing Amplify app, redeploy the latest commit so it picks up the repository's build settings. The deployment log should end with `Static site ready: dist/client/index.html`.

The static site includes the filament catalog, both label designs, 3D previews, and 3MF downloads. My AMS uses the optional [separate cloud backend](hosted-cloud-ams.md), deployed as an account-restricted AWS private preview. Set the public build variable `VITE_AMS_API_ORIGIN=https://ams.spoolstamp.bourhan.org` on the Amplify main branch to enable the browser interface for qualification. Other accounts remain blocked by the backend. One-click Bambu Studio opening still uses the local app (`npm run dev`).

## Other static hosts

Run `npm ci` and `npm run build:static`, then publish **only `dist/client`**. Serve WebAssembly files with the `application/wasm` content type. No application server is required.

The existing `npm run build` command retains the Cloudflare server build.

## AMS backend on AWS

The selected backend is [API Gateway + Lambda + DynamoDB + KMS](aws-lambda-ams.md),
deployed independently from the Amplify frontend with `deploy/ams-lambda.yaml`.
The current Amplify build does not provision this stack or update its code.
Deployment starts disabled; enable only the account-restricted preview for
qualification. No Bambu credentials belong in Amplify build variables.
