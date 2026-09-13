import type { Bounds } from "@/lib/types";

interface Point {
  x: number;
  y: number;
}

/**
 * Share of a `width`×`height` viewport covered by the rectangle spanning two
 * corners, counting only what is actually on screen. Corners may arrive in
 * either order, and the rectangle may hang off any edge or miss entirely.
 */
export function visibleShare(
  first: Point,
  second: Point,
  width: number,
  height: number,
): number {
  const left = Math.max(Math.min(first.x, second.x), 0);
  const right = Math.min(Math.max(first.x, second.x), width);
  const top = Math.max(Math.min(first.y, second.y), 0);
  const bottom = Math.min(Math.max(first.y, second.y), height);
  return (
    (Math.max(right - left, 0) * Math.max(bottom - top, 0)) / (width * height)
  );
}

const mod = (value: number, span: number) => ((value % span) + span) % span;

/**
 * Whether a point falls inside a map extent. Longitude is wrapped into the
 * extent's own range first: a map panned past the date line reports something
 * like 340°–400°, and a beach at 20° still belongs to it.
 */
export function withinBounds(
  lat: number,
  lon: number,
  bounds: Bounds,
): boolean {
  const [[south, west], [north, east]] = bounds;
  if (lat < south || lat > north) return false;
  if (east - west >= 360) return true;
  return west + mod(lon - west, 360) <= east;
}
