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
/** If the map never reports landing, hand over this long after the dive. */
const LANDING_GRACE_MS = 400;
const DOT_RADIUS = 6;
/** The white rim around each dot, matching the landed markers. */
const BORDER = 1.5;
/**
 * The most dots one burst draws, for the blob's own beaches and again for the
 * neighbours. Past that an even sample, so the shape of the coast still comes
 * through without costing a phone its frames.
 */
const MAX_DOTS = 2000;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

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
  /**
   * Beaches that will be on screen when the dive lands but belong to other
   * blobs. They stay where they are and fade in as the camera closes on them.
   */
  neighbours: readonly ClusterMember[];
  /** The zoom the dive ends at, for how far the fade-in has got. */
  targetZoom: number;
  /** The blob's own colour, for its collapse and the ring it leaves. */
  color: string;
  /** The blob's radius on screen at the moment it was clicked. */
  radius: number;
}

interface Dot {
  lat: number;
  lon: number;
  color: string;
  delay: number;
}

/** Every nth member, so no more than MAX_DOTS are drawn. */
function sample(members: readonly ClusterMember[], cluster: Cluster): Dot[] {
  const stride = Math.max(1, Math.ceil(members.length / MAX_DOTS));
  const dots: Dot[] = [];
  for (let index = 0; index < members.length; index += stride) {
    const [lat, lon, quality] = members[index];
    const angle = Math.atan2(lat - cluster.lat, lon - cluster.lon);
    dots.push({
      lat,
      lon,
      color: QUALITY_COLORS[quality],
      delay: ((angle + Math.PI) / (2 * Math.PI)) * STAGGER_MS,
    });
  }
  return dots;
}

/**
 * Draws a cluster bursting into its beaches while the camera dives at it.
 *
 * Leaflet's canvas layers only redraw once a zoom settles, so this draws on a
 * canvas pinned over the map and projects every dot through the live view on
 * each frame: the explosion and the zoom are one motion. The blob's beaches
 * fly out to their places; the beaches around them fade in as the camera
 * closes. Every dot is drawn exactly like the marker it stands in for, and the
 * canvas fades once the map has landed and the real markers are underneath,
 * so the hand-over has no cut.
 *
 * Returns a function that stops the animation and clears the canvas.
 */
export function playBurst({
  map,
  canvas,
  cluster,
  members,
  neighbours,
  targetZoom,
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

  const sparks = sample(members, cluster);
  const around = sample(neighbours, cluster);
  const colors = [...new Set([...sparks, ...around].map((dot) => dot.color))];
  const startZoom = map.getZoom();
  const landsAt = DIVE_SECONDS * 1000;
  const started = performance.now();
  let landed = false;
  let landedAt: number | null = null;
  let frameId = 0;

  // Stamped on the next frame, so the fade runs on the same clock as the
  // frames drawing it.
  const onLanded = () => {
    landed = true;
  };
  map.once("zoomend", onLanded);

  const clear = () => context.clearRect(0, 0, size.x, size.y);

  /** Screen position and radius for each dot this frame. */
  const place = (dots: Dot[], travel: (dot: Dot) => number) =>
    dots.map((dot) => {
      const progress = travel(dot);
      const reach = easeOutBack(progress);
      const point = map.latLngToContainerPoint([
        cluster.lat + (dot.lat - cluster.lat) * reach,
        cluster.lon + (dot.lon - cluster.lon) * reach,
      ]);
      return {
        color: dot.color,
        x: point.x,
        y: point.y,
        size: DOT_RADIUS * (0.5 + 0.5 * easeOutCubic(progress)),
      };
    });

  const draw = (now: number) => {
    const elapsed = now - started;
    if (landedAt === null && (landed || elapsed > landsAt + LANDING_GRACE_MS)) {
      landedAt = now;
    }
    const handoff = landedAt === null ? 1 : 1 - (now - landedAt) / HANDOFF_MS;
    if (handoff <= 0) {
      clear();
      return;
    }

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

    // The blob's beaches travel out; the neighbours are already in place and
    // come up with the zoom, starting a third of the way in.
    const zoomed = clamp01((map.getZoom() - startZoom) / Math.max(targetZoom - startZoom, 0.01));
    const layers = [
      {
        dots: place(sparks, (dot) => clamp01((elapsed - dot.delay) / SPREAD_MS)),
        alpha: handoff,
      },
      {
        dots: place(around, () => 1),
        alpha: easeOutCubic(clamp01((zoomed - 0.33) / 0.67)) * handoff,
      },
    ];

    // Every white rim goes down before any fill, so where dots overlap the
    // colour sits on top and the white only rims the outside, the same way
    // the landed markers are drawn.
    for (const { dots, alpha } of layers) {
      if (alpha <= 0) continue;
      context.globalAlpha = alpha;
      context.fillStyle = "#ffffff";
      context.beginPath();
      for (const { x, y, size: dotSize } of dots) {
        context.moveTo(x + dotSize + BORDER / 2, y);
        context.arc(x, y, dotSize + BORDER / 2, 0, Math.PI * 2);
      }
      context.fill();
    }
    for (const { dots, alpha } of layers) {
      if (alpha <= 0) continue;
      context.globalAlpha = alpha;
      for (const dotColor of colors) {
        context.fillStyle = dotColor;
        context.beginPath();
        for (const dot of dots) {
          if (dot.color !== dotColor) continue;
          const inner = Math.max(0, dot.size - BORDER / 2);
          context.moveTo(dot.x + inner, dot.y);
          context.arc(dot.x, dot.y, inner, 0, Math.PI * 2);
        }
        context.fill();
      }
    }
    context.globalAlpha = 1;
    frameId = requestAnimationFrame(draw);
  };

  frameId = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frameId);
    map.off("zoomend", onLanded);
    clear();
  };
}
