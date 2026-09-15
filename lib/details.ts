import {
  GlassWater,
  LifeBuoy,
  ShowerHead,
  SquareParking,
  Toilet,
  Utensils,
  type LucideIcon,
} from "lucide-react";

/** Facility letters, in the order the sync writes them. */
export const FACILITIES: Record<string, { label: string; Icon: LucideIcon }> = {
  L: { label: "Lifeguard", Icon: LifeBuoy },
  F: { label: "Food & drink", Icon: Utensils },
  T: { label: "Toilets", Icon: Toilet },
  S: { label: "Showers", Icon: ShowerHead },
  P: { label: "Parking", Icon: SquareParking },
  W: { label: "Drinking water", Icon: GlassWater },
};

/** A Commons thumbnail, resized by Wikimedia to the width asked for. */
export function commonsThumbnail(file: string, width: number): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

export function commonsPage(file: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;
}
