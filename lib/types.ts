/** The classes the app shows; the EEA's "not classified" counts as missing. */
export type ClassifiedQuality = 1 | 2 | 3 | 4;

export interface Beach {
  id: string;
  /** Name as the country reports it, in its own language and script. */
  name: string;
  /** Official Latin transliteration, when it differs from the name. */
  a?: string;
  lat: number;
  lon: number;
  lake?: boolean;
  /** One character per season: "1".."4" by class, "." when unassessed. */
  h: string;
}

export type Bounds = [[number, number], [number, number]];

export interface CountryCatalog {
  code: string;
  name: string;
  seasons: number[];
  bounds: Bounds;
  beaches: Beach[];
}

/** Per season, from the country's first: [assessed, of which Excellent]. */
export type SeasonTotals = [number, number][];

export interface CountrySummary {
  code: string;
  name: string;
  beaches: number;
  firstSeason: number;
  latestSeason: number;
  bounds: Bounds;
  coastal: SeasonTotals;
  inland: SeasonTotals;
}

export interface CatalogIndex {
  updated: string;
  currentSeason: number;
  countries: CountrySummary[];
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * What a beach is like beyond its water, from scripts/sync-details.mjs. Keys
 * are short because there is one entry per beach.
 */
export interface BeachDetails {
  /** What it is made of, e.g. "sand" or "sand and pebbles". */
  s?: string;
  /** Facilities within a short walk, one letter each; see FACILITY_LABELS. */
  f?: string;
  /** NUTS 2 region, keying the file's regions. */
  r?: string;
  /** A Wikimedia Commons photo: file name, author and licence. */
  p?: [file: string, author: string, license: string];
  /** Metres of water 500 m out from the beach, from EMODnet; coast only. */
  d?: number;
}

export type TourismTier = 1 | 2 | 3 | 4;

/** Region name, tourist nights, year of that figure, nights per km², tier. */
export type RegionTourism = [
  name: string,
  nights: number,
  year: number,
  density: number,
  tier: TourismTier,
];

export interface CountryDetails {
  regions: Record<string, RegionTourism>;
  beaches: Record<string, BeachDetails>;
}
