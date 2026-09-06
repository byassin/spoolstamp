# Attribution and licenses

## Application code

Original Spoolstamp application code is licensed under [MIT](LICENSE). Third-party data, models, fonts, and libraries retain their separate terms.

## BambuStudio catalog and presets

The catalog, printer list, and Studio preset map in `data/` are derived from the public [BambuStudio repository](https://github.com/bambulab/BambuStudio). Each snapshot records its upstream commit and source hashes.

These snapshots are identified as AGPL-3.0-only. See [data/LICENSE.md](data/LICENSE.md) and the [full license text](data/LICENSE-AGPL-3.0.txt).

Optional US storefront metadata is recorded separately from the profile data. No store product images are bundled.

## Model assets

The two model meshes are derived from supplied STL files and are not covered by the application's MIT license. Their original redistribution terms remain unverified; this repository does not grant a separate model license.

- `assets/supplied-drybox.mesh`: source and modifications in [data/supplied-drybox.json](data/supplied-drybox.json) and [design notes](docs/supplied-drybox.md).
- `assets/clip-label.mesh`: source and modifications in [data/clip-label.json](data/clip-label.json) and [design notes](docs/clip-label.md).

## Font and geometry library

- **Noto Sans Bold** — The Noto Project Authors, SIL Open Font License 1.1; supplied through `@fontsource/noto-sans`.
- **Manifold** — [Manifold contributors](https://github.com/elalish/manifold), Apache License 2.0; supplied through `manifold-3d`.

## Trademarks

Bambu Lab, Bambu Studio, MakerWorld, and AMS are names of their respective owners. Spoolstamp is an independent project and is not affiliated with or endorsed by Bambu Lab.
