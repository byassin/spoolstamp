# MakerWorld template research

Checked 2026-09-04. Licenses can change, so recheck the live source before using, adapting, or seeking permission for any third-party design.

| Design                                                                                                                              | Creator         | Current license                          | Project decision                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Filament Label System for AMS and Dry Boxes](https://makerworld.com/en/models/2766575-filament-label-system-for-ams-and-dry-boxes) | Ynor9           | CC BY-SA 4.0                             | Research link only. Any future adaptation must document attribution and ShareAlike obligations before integration.                                              |
| [Magnetic Drybox Filament Labels](https://makerworld.com/en/models/3207223-magnetic-drybox-filament-labels)                         | Lube Ur Mom     | CC BY 4.0                                | Research and permission-outreach candidate. Do not bundle its CAD or a derivative without documenting the rights and required attribution.                      |
| [label holder bambulab for dry box](https://makerworld.com/en/models/512550-label-holder-bambulab-for-dry-box)                      | LoReArt3d       | CC BY-SA 4.0                             | Useful mounting-accessory reference, not a built-in generated-label design. Any adaptation would require documented license compliance.                         |
| [Filament Dry Box Hinged Label](https://makerworld.com/en/models/395861-filament-dry-box-hinged-label)                              | Genetic Designs | MakerWorld Standard Digital File License | Visual reference. The current private integration uses a user-supplied STL; confirm its precise upstream identity and distribution terms before public release. |
| [Filament Tags for Dry Boxes](https://makerworld.com/en/models/3002234-filament-tags-for-dry-boxes)                                 | MMSK2           | MakerWorld Standard Digital File License | Product reference and permission-outreach target only; no file or derivative is bundled.                                                                        |
| [Filament Dry Box Tags for Lid Flaps](https://makerworld.com/en/models/983964-filament-dry-box-tags-for-lid-flaps)                  | Klothi2002      | CC BY-NC 4.0                             | Do not bundle by default. A separate grant would be needed if the intended public use is not permitted by the listed license.                                   |
| [Bambu Labs Filament Spool Tags](https://makerworld.com/en/models/172553-bambu-labs-filament-spool-tags)                            | DevlshOne       | CC BY-NC-SA 4.0                          | Research link or permission-outreach target; noncommercial and ShareAlike obligations are not the built-in project's license boundary.                          |

## Existing generator comparison

[SoCuul/Bambu-LabelGen](https://github.com/SoCuul/Bambu-LabelGen) is a useful competitive reference: it collects label fields manually and downloads a PNG rendered from an SVG. It does not ingest Bambu profile data, create geometry or 3MF files, show a 3D preview, apply printer profiles, or send to a printer.

That repository currently has no declared license, so its code and assets are not copied here.

## Built-in template policy

The app integrates the supplied hinged dry-box STL and the supplied filament clip with its label recess filled. Both designs use generated Noto Sans outline text. All previews use the download's mesh data.

The supplied mechanical mesh is explicitly third-party material, preserved at the user's request, and not relicensed as original MIT geometry. Its exact bytes and extraction are recorded in `data/supplied-drybox.json`. The owner explicitly requested inclusion in the public repository; that direction does not establish an upstream license grant. Other community designs remain research links until their source, attribution, and distribution terms are recorded.

This is a practical project-screening record, not legal advice.
