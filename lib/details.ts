import type { TourismTier } from "@/lib/types";

export const FACILITY_LABELS: Record<string, string> = {
  L: "Lifeguard",
  F: "Food & drink",
  T: "Toilets",
  S: "Showers",
  P: "Parking",
  W: "Drinking water",
};

/**
 * Quartiles of tourist nights per km² across every beach's region, so each
 * label covers a quarter of Europe's bathing waters.
 */
export const TOURISM_LABELS: Record<TourismTier, string> = {
  1: "Quiet area",
  2: "Some tourism",
  3: "Touristy area",
  4: "Very touristy area",
};

/**
 * How quickly the water gets deep, from its depth 500 m out. Checked against
 * beaches with a known character: Lido di Jesolo reads 4 m, Sitges 7, Nissi
 * 14, Porto Katsiki 73.
 */
export function depthLabel(metres: number): string {
  if (metres < 5) return "Shallow for a long way";
  if (metres < 10) return "Shelves gently";
  if (metres < 25) return "Gets deep quickly";
  return "Deep close to shore";
}

/** A Commons thumbnail, resized by Wikimedia to the width asked for. */
export function commonsThumbnail(file: string, width: number): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

export function commonsPage(file: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;
}

/** "41.5 million", "812,000": readable at a glance in a tooltip. */
export function formatNights(nights: number): string {
  return nights >= 1_000_000
    ? `${(nights / 1_000_000).toFixed(1)} million`
    : nights.toLocaleString("en");
}
