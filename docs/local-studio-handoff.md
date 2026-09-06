# Local Bambu Studio handoff

Run the app with `npm run dev` on the same computer as Bambu Studio. Choose a
label; preparation starts automatically after a short pause in your edits.
Once the button is ready, click **Open in Bambu Studio** once.
The local app is served at `http://127.0.0.1:3000/` when port 3000 is selected.
The action is a real link clicked by the user, so it does not depend on
browser user activation surviving asynchronous geometry generation and transfer.
Approve the browser's external-app prompt and Studio's untrusted-site prompt.
If either application refuses the launch, use **Download 3MF** and open that file.
Downloads are independent of background Studio preparation. Failed preparation
shows an explicit retry button, not an automatic retry loop. Nothing launches
Studio until the user clicks the ready link. This improves the app interaction;
it cannot guarantee external protocol registration, permission, or native import.

The model remains unsliced. Choose the printer profile, assign the body and text
filaments, and inspect the slice in Studio before sending anything to a printer.
This handoff does not remove Studio's third-party model/config import warning.
The networking plug-in must be available for Studio's URL download path.

## Local boundary

- The service is a Vite `configureServer` middleware, registered before app
  routing and enabled only for the development server. It is not an app route,
  a production Worker, or a background companion executable.
- The development listener is bound to `127.0.0.1`, not a network-wide address.
  Studio download links use that explicit IPv4 address; browser staging stays
  same-origin. Bambu Studio's HTTP client forces IPv4, so Vite's default IPv6-only
  localhost listener is incompatible even when the browser can reach it.
- The browser checks the same-origin capability endpoint only on a loopback URL.
  Hosted, unsupported, missing, or failing endpoints leave the normal download
  flow available without showing a broken Studio control.
- Requests must arrive directly over a loopback socket with a strict loopback
  Host and the actual listening port. Forwarded headers are rejected. Writes
  additionally require the exact Origin and a custom request header; no CORS
  permission is granted.
- POST accepts only binary 3MF ZIP packages with the required model/relationship
  entries and a restricted `.3mf` basename. It accepts no paths, external URLs,
  executable arguments, or printer credentials, and launches no processes.
- Bytes are held in memory only, with a 16 MiB per-file limit, one receiving
  upload at a time, at most three retained files, and 32 MiB total retained bytes.
  Oldest transfers are evicted when those limits are reached.
  The 32 MiB value limits the retained cache, not total process memory; incoming
  buffers, ZIP parsing, and active responses also use memory. Uploads have an
  absolute 30-second deadline, including oversized chunked bodies being drained.
- Download paths contain 256-bit random tokens and end in `.3mf`. GET and HEAD
  require the token but no browser cookies, allowing Studio to fetch the file.
  Both can be retried until expiry; a GET does not consume the link.
- Links expire after 15 minutes. The page automatically refreshes its ready link
  one minute before expiry and rechecks expiry on focus and on the actual click
  (timers can pause in sleeping tabs). An expired click is blocked while a fresh
  link is prepared; it does not automatically launch after that preparation.
  Expired entries are purged on requests and a 30-second timer.
- Selection changes immediately invalidate the visible link. Builds are debounced
  and serialized; stale results cannot replace the latest selection. Superseded
  or unmounted transfers that have not been clicked are revoked. Transfers the
  user has clicked remain available: Studio can still be starting or waiting for
  a prompt after the page changes or unmounts. The cache's expiry/eviction limits
  own their lifetime. Downloads do not invalidate the Studio link. Stale results
  that were never published are also revoked;
  server shutdown clears all retained files. Interrupted requests may leave a
  staged file until expiry. Studio's own downloaded copy is retained by Studio,
  not deleted by the app.

No files are uploaded to a hosted service. No D1/R2 bindings or hosting access
policies were changed. Hosted transfers would be a separate implementation.

## Protocol and checks

The installed Windows Bambu Studio 02.08.02.61 registers `bambustudio:` with its
executable. Windows/Linux links use `bambustudio://open?file=<encoded URL>`;
macOS links use `bambustudioopen://<encoded URL>`. The remote filename is included
in the download path so Studio can identify it as a 3MF. These forms follow the
[Windows startup handler](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/GUI_App.cpp#L1045-L1084),
[macOS handler](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/GUI_App.cpp#L7138-L7177),
and [model downloader](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/Plater.cpp#L18364-L18490).

Studio's [HTTP wrapper](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/Utils/Http.cpp)
sets `CURLOPT_IPRESOLVE` to `CURL_IPRESOLVE_V4`. Its downloader displays
“Importing to Bambu Studio failed” after three HTTP errors, before 3MF parsing.
The original local listener on `::1` reproduced that incompatibility: an
IPv4-only connection was refused. The regression test now starts an actual Vite
server and downloads a staged package with a forced-IPv4 HTTP client, rather
than testing only a standalone middleware server.

After changing the listener address, fully restart the development server;
hot-reloading its configuration can leave an old listener with a separate
transfer cache. The live server was restarted and verified to have only an
IPv4 loopback listener. Both model fixtures were staged through `localhost`
and fetched unchanged with forced IPv4 through both hostnames. Old links from
before a restart are invalid; refresh the app and prepare a new transfer.

Tests cover URI/platform validation, loopback/Host/Origin restrictions,
required write headers, invalid/oversized packages, opaque paths, expiry,
eviction, revocation, HEAD, retries, IPv4 binding, and exact byte round trips.
Preparation and hook lifecycle tests cover automatic staging, debouncing,
serialized stale-result handling, selection invalidation, clicked versus unopened
link cleanup, expiry/wake handling, explicit retry, and independent downloads.
Live requests
through the app's actual Vite server also transferred both generated model
fixtures unchanged (216,270-byte clip and 3,871,646-byte dry-box card).

Chrome was observed launching Studio, and the user reported an untrusted-source
prompt followed by the HTTP download failure. The corrected transfer is tested
without UI control; a complete post-fix native import has not been observed.
macOS/Linux protocol selection is source-backed, not device-tested.
