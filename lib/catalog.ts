import catalogData from '@/data/bambu-catalog.json';
import machineData from '@/data/bambu-machines.json';

export type ColorType = 'single' | 'gradient' | 'multi';

export type StoreVariant = {
  skuId: string;
  spoolType: string | null;
  size: string | null;
  priceUsd: number | null;
  discountUsd: number | null;
  soldOut: boolean;
  maximum: number | null;
};

export type Filament = {
  id: string;
  product: string;
  material: string;
  colorName: string;
  colorCode: string;
  colors: string[];
  colorType: ColorType;
  transparent: boolean;
  amsId: string;
  colorVariantId: string;
  nozzleTemperature: number | null;
  texturedPlateTemperature: number | null;
  density: number | null;
  maxVolumetricSpeed: number | null;
  dryingTemperature: number | null;
  dryingTime: number | null;
  profile: string | null;
  store?: {
    product: string;
    handle: string;
    url: string;
    variants: StoreVariant[];
  };
};

type GeneratedRow = (typeof catalogData.catalog)[number];

export const FILAMENTS: Filament[] = catalogData.catalog.map(
  (item: GeneratedRow) => {
    const row = item as GeneratedRow & { store?: Filament['store'] };
    return {
      id: item.id,
      product: item.product,
      material: item.material,
      colorName: item.colorName,
      colorCode: item.colorCode,
      colors: item.colors.length ? item.colors : ['#D9E0DBFF'],
      colorType: item.colorType as ColorType,
      transparent: item.transparent,
      amsId: item.amsId,
      colorVariantId: item.colorVariantId,
      nozzleTemperature: item.specs.nozzleTemperature,
      texturedPlateTemperature: item.specs.texturedPlateTemperature,
      density: item.specs.density,
      maxVolumetricSpeed: item.specs.maxVolumetricSpeed,
      dryingTemperature: item.specs.amsDryingTemperature,
      dryingTime: item.specs.amsDryingTime,
      profile: item.specs.profile,
      ...(row.store ? { store: row.store } : {}),
    };
  },
);

export type FilamentType = {
  product: string;
  material: string;
  colorCount: number;
};

export const FILAMENTS_BY_PRODUCT = new Map<string, Filament[]>();

for (const filament of FILAMENTS) {
  const group = FILAMENTS_BY_PRODUCT.get(filament.product) ?? [];
  group.push(filament);
  FILAMENTS_BY_PRODUCT.set(filament.product, group);
}

for (const group of FILAMENTS_BY_PRODUCT.values()) {
  group.sort(
    (left, right) =>
      left.colorName.localeCompare(right.colorName) ||
      left.colorCode.localeCompare(right.colorCode),
  );
}

export const FILAMENT_TYPES: FilamentType[] = [
  ...FILAMENTS_BY_PRODUCT.entries(),
]
  .map(([product, filaments]) => ({
    product,
    material: filaments[0]?.material ?? '',
    colorCount: filaments.length,
  }))
  .sort((left, right) => left.product.localeCompare(right.product));

export const DEFAULT_FILAMENT =
  FILAMENTS.find(
    (item) => item.product === 'PLA Basic' && item.colorName === 'Bambu Green',
  ) ?? FILAMENTS[0];

export const PRINTERS = machineData.machines;

export const DEFAULT_PRINTER =
  PRINTERS.find((item) => item.name === 'X2D') ?? PRINTERS[0];

export const CATALOG_META = {
  generatedAt: catalogData.generatedAt,
  commit: catalogData.source.commit,
  count: FILAMENTS.length,
};

export const DESIGNS = [
  {
    id: 'drybox-tab',
    name: 'Hinged dry-box card',
    note: '60 × 88 mm · fine-clearance hinge',
  },
  {
    id: 'clip-label',
    name: 'Flat-front filament clip',
    note: '51.4 × 15 mm · two-line clip-on',
  },
] as const;

export type DesignId = (typeof DESIGNS)[number]['id'];
