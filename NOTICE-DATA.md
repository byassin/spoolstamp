# Attribution and licenses

## Application code

Original Spoolstamp application code is licensed under [MIT](LICENSE). Third-party data, models, fonts, and libraries retain their separate terms.

## BambuStudio catalog and presets

The catalog, printer list, and Studio preset map in `data/` are derived from the public [BambuStudio repository](https://github.com/bambulab/BambuStudio). Each snapshot records its upstream commit and source hashes.

These snapshots are identified as AGPL-3.0-only. See [data/LICENSE.md](data/LICENSE.md) and the [full license text](data/LICENSE-AGPL-3.0.txt).

Optional US storefront metadata is recorded separately from the profile data. No store product images are bundled.

## Model assets

The two model meshes are derived from supplied STL files and are not covered by the application's MIT license. The source pages list MakerWorld's Standard Digital File License, which restricts redistribution, including remixes. Separate permission from the creators is needed for redistribution; this repository does not grant a model license.

- `assets/supplied-drybox.mesh`: [Filament Dry Box Hinged Label by Genetic Designs](https://makerworld.com/en/models/395861-filament-dry-box-hinged-label). Modifications: [manifest](data/supplied-drybox.json) and [design notes](docs/supplied-drybox.md).
- `assets/clip-label.mesh`: [THE Filament Clip AND Label by Stag 3D](https://makerworld.com/en/models/181699-the-filament-clip-and-label). Modifications: [manifest](data/clip-label.json) and [design notes](docs/clip-label.md).

## Font and geometry library

- **Noto Sans Bold** — The Noto Project Authors, SIL Open Font License 1.1; supplied through `@fontsource/noto-sans`.
- **Manifold** — [Manifold contributors](https://github.com/elalish/manifold), Apache License 2.0; supplied through `manifold-3d`.

## Trademarks

Bambu Lab, Bambu Studio, MakerWorld, and AMS are names of their respective owners. Spoolstamp is an independent project and is not affiliated with or endorsed by Bambu Lab.
