# Data, asset, and trademark notice

The MIT license in this repository applies only to original application code and original clean-room geometry authored for Filament Label Lab. It does not relicense upstream data, third-party models, or trademarks.

## BambuStudio profile data

`data/bambu-catalog.json` and `data/bambu-machines.json` are normalized from Bambu Lab's public [BambuStudio repository](https://github.com/bambulab/BambuStudio). They record the exact upstream commit, source URLs, generation time, and color-table hash. BambuStudio states that it is distributed under AGPL version 3; the committed derived snapshot is separately marked `AGPL-3.0-only` in [data/LICENSE.md](data/LICENSE.md). Preserve upstream copyright and license notices when redistributing upstream or derived profile data.

The application uses:

- `resources/profiles/BBL.json` for printer and profile discovery;
- `resources/profiles/BBL/filament/filaments_color_codes.json` for official color identities and RGBA stops; and
- recursively resolved BBL filament profiles for print and drying recommendations.

`data/bambu-studio-presets.json` is a separate normalized map of compatible machine, process, and filament preset references from the same pinned profile tree, under the same data license. Its sync records the upstream commit and aggregate input hashes; no user presets or credentials are bundled.

The application does not copy Bambu logos.

## Store enrichment

Optional US price, availability, size, and spool metadata comes from Bambu's public storefront service. `store-handles.json` and the optional `store` fields are provenance-separated from the AGPL profile snapshot. The service is undocumented and has no published stability or redistribution commitment. Store enrichment is cached, rate-limited, region-labeled, and never required at runtime. No store product images are bundled.

## Built-in and third-party model geometry

The default hinged dry-box card uses the user-supplied `Filament+Dry+Box+Labeled+Tags+-+Bambu+Lab+-+PLA+Basic+1of2.stl`. Its four mechanical components are preserved in `assets/supplied-drybox.mesh`; its separate lettering is replaced with generated Noto Sans text. The source hash, extraction operation, and component hashes are recorded in `data/supplied-drybox.json`. The current runtime applies the documented 0.075 mm moving-link bearing relief in `lib/hinge-clearance.ts`; the source asset and fixed card/hook are unchanged. This remains an adaptation of the supplied design, not newly licensed geometry. The preview and download use the same revised mesh arrays.

The supplied mesh is not original project geometry and is not covered by this repository's MIT license. It is included at the project owner's explicit direction. Its filename alone does not establish the precise upstream page or a redistribution grant; those permissions remain unverified. Inclusion in this repository does not grant recipients a model license. Do not imply that extracting or recreating a model grants a new license to its design.

The additional `assets/clip-label.mesh` is derived from the user-supplied `Filament_Clip_Label_3MF.stl`, with only the recessed label pocket capped and two zero-area source triangles omitted. Its source/asset hashes and adaptation are recorded in `data/clip-label.json` and `docs/clip-label.md`. It is likewise included at the owner's explicit direction with redistribution permissions unverified, and is excluded from the MIT grant.

Other community designs listed in `docs/template-research.md` remain research links. Record source, license, and attribution before distributing additional template assets.

## Printable text font

Dry-box label text uses Noto Sans Bold from `@fontsource/noto-sans`, copyright The Noto Project Authors, under the SIL Open Font License 1.1. The font is loaded as an unmodified package asset and converted to printable outline geometry in the browser.

## Geometry kernel

Printable solids are constructed and validated with the open-source [Manifold](https://github.com/elalish/manifold) geometry library, distributed under the Apache License 2.0. It is consumed as the unmodified `manifold-3d` package.

## Trademarks

Bambu Lab, Bambu Studio, MakerWorld, AMS, and associated names and marks belong to their respective owners. Their use here is descriptive. This project is not affiliated with, sponsored by, or endorsed by Bambu Lab.

This notice summarizes project policy and is not legal advice.
