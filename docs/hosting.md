# Hosting

## AWS Amplify

Connect the repository and deploy `main`. The included `amplify.yml` installs Node.js 22, runs `npm run build:static`, and publishes `dist/client`.

For an existing Amplify app, redeploy the latest commit so it picks up the repository's build settings. The deployment log should end with `Static site ready: dist/client/index.html`.

The static site includes the filament catalog, both label designs, 3D previews, and 3MF downloads. My AMS and one-click Bambu Studio opening use the local app (`npm run dev`).

## Other static hosts

Run `npm ci` and `npm run build:static`, then publish **only `dist/client`**. Serve WebAssembly files with the `application/wasm` content type. No application server is required.

The existing `npm run build` command retains the Cloudflare server build.
