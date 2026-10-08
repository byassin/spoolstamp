# Spoolstamp

<img src="public/brand/spoolstamp-mark.png" width="72" alt="Spoolstamp logo" />

Create 3D-printable filament labels in a few clicks. Pick a design, choose your filament, and preview your label before opening it in Bambu Studio.

**[Open Spoolstamp →](https://spoolstamp.bourhan.org/)** — use it in your browser, no installation needed.

![Spoolstamp workspace with a hinged filament label](docs/images/workspace.png)

## Features

- **Two label designs** — a hinged dry-box label and a flat-front clip-on label.
- **Bambu Lab filament catalog** — 314 colors with searchable material types, color names, and codes.
- **Live 3D preview** — rotate, zoom, and switch between a label close-up and your printer's build plate.
- **Automatic lettering** — filament details filled in for you, with contrasting black or white text.
- **Printer profiles** — 14 Bambu Lab models with matching bed dimensions and export settings.
- **Color-aware 3MF export** — separate body and text filament profiles, ready to open and slice in Bambu Studio.
- **My AMS cloud preview** — connect in your browser, choose loaded spools, suggest compatible text filament, and batch-export labels. No local helper needed; access is currently limited to the approved preview account.
- **One-click Studio opening** — available when running locally alongside Bambu Studio.
- **Responsive workspace** — designed for desktop, tablet, and phone.

## Clip-on labels

A flat face with two lines: material type and color.

![Clip-on label in the Spoolstamp 3D preview](docs/images/clip-label.png)

## My AMS

Read your loaded spools directly through Bambu Cloud, then create labels without looking up each filament. The browser flow has been tested with a real X2D on the live website.

1. Open **My AMS → Connect Bambu Cloud**.
2. Enter your Bambu account email, accept the connection notice, and request a verification code.
3. Sign in with the code, select your cloud-connected printer, and click **Read fresh AMS**.
4. Confirm your loaded spools, then use a label or select spools for a batch ZIP export.

<img src="docs/images/ams-cloud-snapshot.png" width="420" alt="Live X2D cloud AMS snapshot showing A1 PLA Basic Black at 28 percent and A2 PETG Basic Black at 36 percent remaining" />

**Preview access:** the interface is live, but sign-in is currently restricted to the approved preview account—not open to every Bambu account yet. The manual filament picker works for everyone.

Sign-in expires after 30 minutes. Credentials stay server-side, temporarily encrypted; verification codes are not stored. Reads are on demand with a five-minute cooldown, and label actions require a snapshot less than 45 seconds old. Remaining filament is the printer's estimate. See [My AMS](docs/ams-integration.md) for privacy details and current validation limits.

## Run locally

Requires Node.js 22.13 or newer.

```sh
git clone https://github.com/byassin/spoolstamp.git
cd spoolstamp
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Documentation

[Hosting](docs/hosting.md) · [My AMS](docs/ams-integration.md) · [Bambu Studio](docs/local-studio-handoff.md) · [Development](CONTRIBUTING.md) · [Architecture](docs/architecture.md)

The [browser-hosted cloud AMS preview](docs/hosted-cloud-ams.md) is deployed separately from the static website. Real X2D sign-in and a fresh cloud snapshot have been demonstrated; broader account access and additional qualification remain pending.

## License

Application code: [MIT](LICENSE). Data, model, and font notices: [NOTICE-DATA.md](NOTICE-DATA.md).

Spoolstamp is an independent project, not affiliated with Bambu Lab.
