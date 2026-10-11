import rangeData from '@/data/bambu-print-ranges.json';

export type NozzleTemperatureRange = {
  min: number;
  max: number;
  sourceUrl: string;
};

const ranges = new Map<string, NozzleTemperatureRange>(
  rangeData.ranges.map(({ product, ...range }) => [product, range]),
);

// Exact product matches only: never borrow a range from a material family,
// a similarly named product, or the profile's single printing temperature.
export function recommendedNozzleRange(product: string) {
  return ranges.get(product) ?? null;
}

export function formatNozzleRange(range: NozzleTemperatureRange | null) {
  return range ? `${range.min}–${range.max} °C` : 'Not verified';
}

export function printTemperatureLabel(range: NozzleTemperatureRange | null) {
  return range ? `Print: ${formatNozzleRange(range)}` : 'Print: see guide';
}
