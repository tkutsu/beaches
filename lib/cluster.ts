import { qualityAt } from "@/lib/quality";
import type { Beach, Bounds, ClassifiedQuality } from "@/lib/types";

/**
 * Zoomed out to a continent, 26,000 dots overplot into a blob where the
 * greenest country is really just the busiest one. Below this zoom the map
 * gathers beaches into circles instead, coloured by the share classified
 * Excellent, which burst back into their beaches when clicked.
 */
export const CLUSTER_MAX_ZOOM = 7;

/** How far apart cluster centres sit on screen, whatever the zoom. */
const SPACING_PIXELS = 52;
const EARTH_RADIUS = 6378137;
const WORLD_METERS_PER_PIXEL = 156543.03392804097;
/** A beach inside a cluster: where it is and what it was rated. */
export type ClusterMember = [lat: number, lon: number, quality: ClassifiedQuality];

export interface Cluster {
  key: string;
  /** Centre of gravity of its beaches, not of the grid cell. */
  lat: number;
  lon: number;
  total: number;
  excellent: number;
  /** Share of the cluster classified Excellent, 0 to 1. */
  share: number;
  bounds: Bounds;
}

function project(lat: number, lon: number): [number, number] {
  const x = (EARTH_RADIUS * lon * Math.PI) / 180;
  const y =
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

/** Nearest hexagonal cell to a fractional axial coordinate, by cube rounding. */
function axialRound(q: number, r: number): [number, number] {
  const cubeY = -q - r;
  let roundedQ = Math.round(q);
  let roundedY = Math.round(cubeY);
  let roundedR = Math.round(r);
  const deltaQ = Math.abs(roundedQ - q);
  const deltaY = Math.abs(roundedY - cubeY);
  const deltaR = Math.abs(roundedR - r);

  if (deltaQ > deltaY && deltaQ > deltaR) roundedQ = -roundedY - roundedR;
  else if (deltaY > deltaR) roundedY = -roundedQ - roundedR;
  else roundedR = -roundedQ - roundedY;

  return [roundedQ, roundedR];
}

interface Accumulator {
  total: number;
  excellent: number;
  latSum: number;
  lonSum: number;
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The hexagonal cell a position falls in at this zoom. */
function cellKey(lat: number, lon: number, zoom: number): string {
  const size = (SPACING_PIXELS * WORLD_METERS_PER_PIXEL) / 2 ** zoom;
  const [x, y] = project(lat, lon);
  const [q, r] = axialRound(
    ((Math.sqrt(3) / 3) * x - y / 3) / size,
    ((2 / 3) * y) / size,
  );
  return `${q},${r}`;
}

/**
 * Groups the season's classified beaches. Cells come from a hexagonal grid,
 * which spaces the circles evenly, but each circle sits on its beaches' mean
 * position so it hugs the coastline rather than the grid.
 */
export function clusterBeaches(
  beaches: readonly Beach[],
  seasonIndex: number,
  zoom: number,
): Cluster[] {
  const cells = new Map<string, Accumulator>();

  for (const beach of beaches) {
    const quality = qualityAt(beach, seasonIndex);
    if (!quality) continue;
    const key = cellKey(beach.lat, beach.lon, zoom);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        total: 0,
        excellent: 0,
        latSum: 0,
        lonSum: 0,
        south: beach.lat,
        west: beach.lon,
        north: beach.lat,
        east: beach.lon,
      };
      cells.set(key, cell);
    }
    cell.total += 1;
    if (quality === 1) cell.excellent += 1;
    cell.latSum += beach.lat;
    cell.lonSum += beach.lon;
    cell.south = Math.min(cell.south, beach.lat);
    cell.north = Math.max(cell.north, beach.lat);
    cell.west = Math.min(cell.west, beach.lon);
    cell.east = Math.max(cell.east, beach.lon);
  }

  return [...cells].map(([key, cell]) => ({
    key,
    lat: cell.latSum / cell.total,
    lon: cell.lonSum / cell.total,
    total: cell.total,
    excellent: cell.excellent,
    share: cell.excellent / cell.total,
    bounds: [
      [cell.south, cell.west],
      [cell.north, cell.east],
    ] as Bounds,
  }));
}

/**
 * Every beach one cluster counted. Worked out only when a cluster is burst,
 * rather than carried by every cluster on every pass, because the clustering
 * reruns on each zoom and each step of season playback.
 */
export function clusterMembers(
  beaches: readonly Beach[],
  seasonIndex: number,
  zoom: number,
  key: string,
): ClusterMember[] {
  const members: ClusterMember[] = [];
  for (const beach of beaches) {
    const quality = qualityAt(beach, seasonIndex);
    if (quality && cellKey(beach.lat, beach.lon, zoom) === key) {
      members.push([beach.lat, beach.lon, quality]);
    }
  }
  return members;
}

/**
 * Beaches inside `bounds` that belong to any cluster but `key`: the ones a
 * burst dives past, which should come into view with the zoom rather than pop
 * in once it lands.
 */
export function clusterNeighbours(
  beaches: readonly Beach[],
  seasonIndex: number,
  zoom: number,
  key: string,
  bounds: Bounds,
): ClusterMember[] {
  const [[south, west], [north, east]] = bounds;
  const neighbours: ClusterMember[] = [];
  for (const beach of beaches) {
    if (beach.lat < south || beach.lat > north || beach.lon < west || beach.lon > east) {
      continue;
    }
    const quality = qualityAt(beach, seasonIndex);
    if (quality && cellKey(beach.lat, beach.lon, zoom) !== key) {
      neighbours.push([beach.lat, beach.lon, quality]);
    }
  }
  return neighbours;
}

/**
 * Bands share-of-Excellent onto the same status colours the dots use, so a
 * green circle and a green dot carry the same meaning.
 */
export function clusterColor(share: number): string {
  if (share >= 0.9) return "#0ca30c";
  if (share >= 0.75) return "#fab219";
  if (share >= 0.5) return "#ec835a";
  return "#d03b3b";
}

/** Area grows with the count, so a circle twice as wide holds four times as many. */
export function clusterRadius(total: number, largest: number): number {
  return 9 + 21 * Math.sqrt(total / Math.max(largest, 1));
}
