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
