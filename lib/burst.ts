import type { Map as LeafletMap } from "leaflet";
import type { Cluster, ClusterMember } from "@/lib/cluster";
import { QUALITY_COLORS } from "@/lib/quality";

/** How long the camera takes to dive into a cluster that was clicked. */
export const DIVE_SECONDS = 0.9;

const COLLAPSE_MS = 180;
const RING_MS = 480;
const SPREAD_MS = 560;
// Kept under 50ms in total: enough to read as the blob peeling open, not
// enough to feel like a queue.
const STAGGER_MS = 40;
const HANDOFF_MS = 220;
const DOT_RADIUS = 6;
/** The white rim around each dot, matching the landed markers. */
const BORDER = 1.5;
/**
 * The most sparks one burst draws. Every beach in all but the biggest few
 * continental clusters; past that an even sample, so the shape of the coast
 * still comes through without costing a phone its frames.
 */
const MAX_SPARKS = 2000;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

// Runs about 10% past the target and settles back, so sparks land on their
// beaches rather than stopping dead.
const easeOutBack = (t: number) => {
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
};

interface BurstOptions {
  map: LeafletMap;
  canvas: HTMLCanvasElement;
  cluster: Cluster;
  /** The beaches the blob counted, each flown to its own position. */
  members: readonly ClusterMember[];
  /** The blob's own colour, for its collapse and the ring it leaves. */
  color: string;
  /** The blob's radius on screen at the moment it was clicked. */
  radius: number;
}

/**
 * Draws a cluster bursting into its beaches while the camera dives at it.
 *
 * Leaflet's canvas layers only redraw once a zoom settles, which is why the
 * burst used to finish before the flight could start. This draws on a canvas
 * pinned over the map instead and projects every spark through the live view
 * on each frame, so the explosion and the zoom are one motion. Each spark is
 * drawn exactly like the dot it flies to, and fades as the real dots grow in
 * underneath, so the burst hands over to the data without a cut.
 *
 * Returns a function that stops the animation and clears the canvas.
 */
export function playBurst({
  map,
  canvas,
  cluster,
  members,
  color,
  radius,
}: BurstOptions): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => {};

  const size = map.getSize();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = size.x * ratio;
  canvas.height = size.y * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const stride = Math.max(1, Math.ceil(members.length / MAX_SPARKS));
  // Grouped by colour, so a frame is four fills and four strokes however many
  // sparks there are, rather than two canvas calls per spark.
  const byColor = new Map<string, { lat: number; lon: number; delay: number }[]>();
  for (let index = 0; index < members.length; index += stride) {
    const [lat, lon, quality] = members[index];
    const angle = Math.atan2(lat - cluster.lat, lon - cluster.lon);
    const color = QUALITY_COLORS[quality];
    const group = byColor.get(color) ?? [];
    group.push({
      lat,
      lon,
      delay: ((angle + Math.PI) / (2 * Math.PI)) * STAGGER_MS,
    });
    byColor.set(color, group);
  }
  const landsAt = DIVE_SECONDS * 1000;
  const endsAt = landsAt + HANDOFF_MS;
  const started = performance.now();
  let frameId = 0;

  const clear = () => context.clearRect(0, 0, size.x, size.y);

  const draw = (now: number) => {
    const elapsed = now - started;
    clear();
    const origin = map.latLngToContainerPoint([cluster.lat, cluster.lon]);

    // The blob gives way in the first beat...
    const collapse = Math.min(1, elapsed / COLLAPSE_MS);
    if (collapse < 1) {
      context.globalAlpha = 0.74 * (1 - collapse);
      context.fillStyle = color;
      context.beginPath();
      context.arc(
        origin.x,
        origin.y,
        radius * (1 - 0.6 * easeOutCubic(collapse)),
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    // ...and leaves a ring spreading out from where it stood.
    const ring = Math.min(1, elapsed / RING_MS);
    if (ring < 1) {
      context.globalAlpha = 0.6 * (1 - ring);
      context.strokeStyle = color;
      context.lineWidth = 1 + 3 * (1 - ring);
      context.beginPath();
      context.arc(
        origin.x,
        origin.y,
        radius * (1 + 1.6 * easeOutCubic(ring)),
        0,
        Math.PI * 2,
      );
      context.stroke();
    }

    // Sparks travel in map coordinates, so the camera's own motion carries
    // them across the screen as it dives.
    const placed: { color: string; x: number; y: number; size: number }[] = [];
    for (const [color, group] of byColor) {
      for (const spark of group) {
        const progress = Math.min(
          1,
          Math.max(0, (elapsed - spark.delay) / SPREAD_MS),
        );
        const reach = easeOutBack(progress);
        const point = map.latLngToContainerPoint([
          cluster.lat + (spark.lat - cluster.lat) * reach,
          cluster.lon + (spark.lon - cluster.lon) * reach,
        ]);
        placed.push({
          color,
          x: point.x,
          y: point.y,
          size: DOT_RADIUS * (0.5 + 0.5 * easeOutCubic(progress)),
        });
      }
    }

    // Every white border goes down before any fill, so where sparks overlap
    // the colour sits on top and the white only rims the outside, the same
    // way the landed dots are drawn.
    context.globalAlpha =
      elapsed <= landsAt ? 1 : Math.max(0, 1 - (elapsed - landsAt) / HANDOFF_MS);
    context.fillStyle = "#ffffff";
    context.beginPath();
    for (const { x, y, size } of placed) {
      context.moveTo(x + size + BORDER / 2, y);
      context.arc(x, y, size + BORDER / 2, 0, Math.PI * 2);
    }
    context.fill();
    for (const color of byColor.keys()) {
      context.fillStyle = color;
      context.beginPath();
      for (const spark of placed) {
        if (spark.color !== color) continue;
        const inner = Math.max(0, spark.size - BORDER / 2);
        context.moveTo(spark.x + inner, spark.y);
        context.arc(spark.x, spark.y, inner, 0, Math.PI * 2);
      }
      context.fill();
    }
    context.globalAlpha = 1;

    if (elapsed < endsAt) {
      frameId = requestAnimationFrame(draw);
    } else {
      clear();
    }
  };

  frameId = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frameId);
    clear();
  };
}
