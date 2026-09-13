import type { Bounds, CountryCatalog } from "@/lib/types";

export const ALL_COUNTRIES = "ALL";

/**
 * France, Spain and Portugal report their overseas territories too, from
 * Guadeloupe to Réunion, so the real extent of "all countries" is most of the
 * globe. The combined view opens on Europe instead; the rest is a pan away.
 */
const EUROPE_FRAME: Bounds = [
  [34, -11],
  [61, 31],
];

/** 🇬🇷 for EL, 🇬🇧 for UK, and the plain regional pair for everyone else. */
const FLAG_REGIONS: Record<string, string> = { EL: "GR", UK: "GB" };

export function countryFlag(code: string): string {
  if (code === ALL_COUNTRIES) return "🇪🇺";
  const region = FLAG_REGIONS[code] ?? code;
  return String.fromCodePoint(
    ...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

/**
 * Combines the per-country files into one catalogue. Countries start reporting
 * in different years, so every history is repadded onto the shared range.
 */
export function mergeCountries(
  countries: readonly CountryCatalog[],
): CountryCatalog {
  const first = Math.min(...countries.map((entry) => entry.seasons[0]));
  const last = Math.max(...countries.map((entry) => entry.seasons.at(-1)!));
  const seasons: number[] = [];
  for (let year = first; year <= last; year += 1) seasons.push(year);

  const beaches = countries.flatMap((entry) => {
    const before = ".".repeat(entry.seasons[0] - first);
    const after = ".".repeat(last - entry.seasons.at(-1)!);
    if (!before && !after) return entry.beaches;
    return entry.beaches.map((beach) => ({
      ...beach,
      h: `${before}${beach.h}${after}`,
    }));
  });

  return {
    code: ALL_COUNTRIES,
    name: "All countries",
    seasons,
    bounds: EUROPE_FRAME,
    beaches,
  };
}
