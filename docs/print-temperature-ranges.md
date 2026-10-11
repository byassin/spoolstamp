# Print-temperature ranges

The hinged card uses `Print: 190–230 °C` for PLA Basic, or the selected product's own manufacturer-recommended nozzle-temperature range. PLA Tough+ uses `Print: 220–250 °C`. The two-line clip remains product + color only.

`data/bambu-print-ranges.json` is a manually reviewed, product-keyed factual reference table, separate from the generated BambuStudio catalog. Each range carries its source URL; `reviewedAt` records the review date, not a manufacturer's publication date. Sources are Bambu technical data sheets (including two distributor-hosted copies), its filament guide, and official store tables. We do not redistribute those documents. Catalog synchronization does not overwrite this table.

The UI lists **Print range (nozzle)** and **Profile nozzle** separately. The latter remains the imported base-profile value, not a range or a live reading. This change only affects label text and displayed reference information; it does not modify Studio's printer-specific presets or slicing temperatures.

37 of the current 46 product families have reviewed ranges. Seven have no verified recommendation in this snapshot: PETG Matte, PLA Dynamic, PLA Lite, PLA Tough (not Tough+), TPU 85A, TPU 90A, and TPU 95A (not HF). Two are withheld because Bambu's sources conflict:

- Support for PLA/PETG: [TDS](https://store.bblcdn.com/s6/default/fd441c590b03464dba1d5237008732b2/Bambu_Support_for_PLA_PETG_Technical_Data_Sheet.pdf) gives 190–240 °C; the [store](https://eu.store.bambulab.com/en-ch/products/support-for-pla-petg) gives 190–220 °C.
- Support for PA/PET: [TDS](https://store.bblcdn.com/7e83189be1eb4a3dab8ce9b9a7b2065a.pdf) gives 260–290 °C; the same store comparison gives 280–300 °C.

Unverified/conflicting products display **Not verified** in details and **Print: see guide** on the card. No material-family inference, preset +/- offset, or similarly named product fallback is allowed. Verify the exact product/revision before adding a range; distinguish recommended settings from specimen-test temperatures. Check that recommendations cover the catalog variants. New catalog products must be explicitly accounted for in the source table or unresolved lists (enforced by tests).

These ranges describe the filament stored in the box, not an instruction to use that material to print the label. Confirm printer/nozzle compatibility and follow the product's complete printing guidance.
