import type { Beach, ClassifiedQuality } from "@/lib/types";

// Fixed status palette: quality is a good-to-critical state, and the color is
// always paired with its label so it never carries meaning alone.
export const QUALITY_COLORS: Record<ClassifiedQuality, string> = {
  1: "#0ca30c",
  2: "#fab219",
  3: "#ec835a",
  4: "#d03b3b",
};

export const QUALITY_LABELS: Record<ClassifiedQuality, string> = {
  1: "Excellent",
  2: "Good",
  3: "Sufficient",
  4: "Poor",
};

export const NO_DATA_LABEL = "No data";

/**
 * Quality of one season, or null when the beach carries no usable class.
 * The EEA's "not classified" is indistinguishable from missing data for a
 * swimmer, so the catalogue stores both as ".".
 */
export function qualityAt(
  beach: Beach,
  seasonIndex: number,
): ClassifiedQuality | null {
  const code = beach.h.charCodeAt(seasonIndex) - 48;
  return code >= 1 && code <= 4 ? (code as ClassifiedQuality) : null;
}

/**
 * Most countries report in capitals ("KATO SAMIKO"), which reads as shouting;
 * names that already carry their own casing are left alone.
 */
export function formatBeachName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-(/])(\p{L})/gu, (_, boundary: string, letter: string) => {
      return boundary + letter.toUpperCase();
    });
}
