# My AMS: local developer preview

Run `npm ci` and `npm run dev -- --port 3000`, then open `http://127.0.0.1:3000/`. Choose **My AMS → Connect**. Enter the printer's private LAN IPv4 address, review its certificate fingerprint on a trusted network, then enter its serial and 8-character LAN access code in the local form. Never paste access codes into chat, issues, or source files.

## What works

- Shared inventory contract, one connected printer and multiple reported AMS units; no X2D-only model allowlist.
- Exact product-family ID + full RGBA palette matching. Ambiguous matches require confirmation; unknown/custom profiles keep the manual picker. Nearby colors never establish a SKU.
- Automatic text uses a known product in the same base material and opaque, solid pure black/white. No gray, transparent, multicolor or PLA/PETG substitution. Changing Text filament manually disables automatic selection until re-enabled.
- Batch download: up to eight separate 3MF projects in a ZIP using the current design/printer. Changed/stale inventory cancels work. Studio still owns final physical spool assignments; confirm them before printing.

## Boundary

The adapter runs in the local Vite service, not the hosted Worker. A packaged companion and hosted-page pairing remain separate release work. The hosted site neither probes localhost nor requests printer credentials.

Direct loopback Host/port, custom headers and exact Origin on writes protect the API. No CORS grant, forwarded requests, DNS, public/link-local destinations, arbitrary URLs/ports, scanning, cloud login or automatic discovery. Only manually supplied RFC1918 IPv4 on TLS port 8883 is accepted.

Certificate trust is **trust on first use**, not Bambu-verified identity. The unauthenticated probe obtains a fingerprint; the approved pin is checked on the next TLS connection BEFORE MQTT is constructed or credentials are sent. TLS 1.2 minimum, no plaintext fallback. No printer security changes or authorization bypass.

When the certificate common name looks like a printer serial, a mismatch with the entered serial is rejected before authentication. Generic/absent common names are not treated as serials; this check does not replace certificate trust.

Only fixed `info.get_version` and `pushing.pushall` read requests exist; full status is requested every 30 seconds. No generic command API, printing, G-code, feeding, RFID scan, heating, calibration or AMS settings. Pairing has a 2 KiB/five-second limit, serialized/rate-limited attempts and single-use three-minute tokens. Transport waits and MQTT packets are bounded. Retained/wrong-topic/malformed reports are discarded.

Responses contain sanitized slots/model/firmware, not access codes, serials, RFID/spool UUIDs or raw telemetry. Credentials are not logged, persisted, uploaded, stored in browser storage or exported. JavaScript memory is not a secure enclave; cryptographic string erasure is not claimed. Disconnect clears inventory and retires callbacks. Sessions expire after one hour or roughly one minute without local requests; no automatic reconnect.

MQTT subscription success is not inventory success. If no complete AMS snapshot arrives within 60 seconds, the session closes with a differentiated no-report/incomplete-report/unreadable-report message. The local status includes only diagnostic counters (writes, messages, retained/unreadable messages, parsed reports and full/incomplete AMS reports). A completed QoS 0 write is not proof the printer processed the request. No raw payloads or topics are included. The UI pauses automatic text matching without claiming spools are absent while data is unavailable.

Only full snapshots replace inventory. Differential/incomplete AMS reports pause suggestions until refresh; cached identity is never merged into a replacement spool. Data older than 45 seconds is stale. Presence uses unit/tray masks, not remembered filament fields or RFID IDs. Reading/unknown-layout slots are not matched. External holders are not treated as AMS slots. Remaining percentage is a printer estimate.

## Compatibility matrix

| Capability | Evidence | Status |
| --- | --- | --- |
| Existing 14 export profiles | Catalog/project regression tests | Independent of AMS pairing |
| Classic AMS / Lite / 2 Pro, multiple units | Official mappings + synthetic fixtures | Implemented; hardware unverified |
| AMS HT / mixed Lite | Official mappings + synthetic fixtures | Implemented; hardware unverified |
| X2D firmware 01.02.00.00 | User pairing attempt; subscription established but no usable inventory | Not qualified; diagnostic retry pending |
| Other Bambu models/firmware | Shared adapter | Untested; no universal compatibility claim |
| Unknown layout / no AMS / unavailable LAN | Fail-closed tests | Manual generator available |
| Hosted pairing / packaged companion | Not implemented | Unsupported in this preview |
| Non-Bambu protocols / cloud / direct printing | Not implemented | Out of scope |

Before public qualification, test real pairing, empty/replaced/unknown spools, accessory layouts, disconnection and actual Studio assignments across printer families. Keep serials and unredacted captures out of the repository.

## Sources and tests

Official [layout/presence parsing](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/DeviceCore/DevFilaSystem.cpp) and [assignment priorities](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/DeviceCore/DevMapping.cpp), plus original [LAN protocol research](https://github.com/ClusterM/open-bamboo-networking/blob/master/research/06.02-mqtt.md) and [status request observations](https://github.com/ClusterM/open-bamboo-networking/blob/master/research/12.01-status.md). Those captures are not X2D verification.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Tests simulate transport/telemetry and exercise a real localhost HTTP listener without contacting printers. Live interoperability, browser interaction and physical printing still need separate verification.
