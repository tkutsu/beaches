"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CircleMarker,
  LayerGroup,
  Map as LeafletMap,
  Marker,
  Renderer,
} from "leaflet";
import {
  CLUSTER_MAX_ZOOM,
  clusterBeaches,
  clusterMembers,
  clusterNeighbours,
  clusterColor,
  clusterRadius,
  type Cluster,
} from "@/lib/cluster";
import { DIVE_SECONDS, playBurst } from "@/lib/burst";
import { QUALITY_COLORS, formatBeachName, qualityAt } from "@/lib/quality";
import type { SeaConditions } from "@/hooks/use-sea-conditions";
import { visibleShare } from "@/lib/viewport";
import type { Beach, Bounds, Coordinates } from "@/lib/types";

interface BeachMapProps {
  beaches: readonly Beach[];
  /** Extent of the selection, framed when `frame` is set. */
  bounds: Bounds | null;
  /** Whether picking this selection should snap the viewport to its extent. */
  frame: boolean;
  focusCenter: Coordinates | null;
  seasonIndex: number;
  selectedBeach: Beach | null;
  /** Live swell at the selected beach, for the wave animation. */
  seaConditions: SeaConditions | null;
  /** Bumped to refit the viewport to `bounds` once frame is off. */
  resetView: number;
  onSelectBeach: (beach: Beach) => void;
  /** A click on the map itself: not a drag, and not on a beach. */
  onMapClick: () => void;
  /** Called with the map's extent whenever it settles. */
  onViewportChange: (bounds: Bounds) => void;
  /** Called once the framed selection no longer holds the view. */
  onLeaveFrame: () => void;
}

const EUROPE_CENTER: [number, number] = [48, 12];
/**
 * How far a framed country's share of the screen may fall before the map
 * gives up on it and goes back to every country. Relative to what it covered
 * when framed, because that varies hugely: Greece fills most of a desktop
 * window, Romania an eighth of it. A fifth is about two zoom levels out, or
 * the country pushed most of the way off the edge.
 */
const ABANDON_FRACTION = 0.2;
const UNMONITORED_STROKE = "#898781";
/** A beach dot's outer radius and its white rim, as the dot reads on screen. */
const DOT_RADIUS = 6;
const DOT_BORDER = 1.5;
const SELECTED_RADIUS = 11;
const SELECTED_BORDER = 3;
const USER_LOCATION_PIN_HTML = `
  <svg aria-hidden="true" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 1.5C7.4 1.5 2 6.9 2 13.5 2 22.1 14 34 14 34s12-11.9 12-20.5C26 6.9 20.6 1.5 14 1.5Z" fill="#1c5cab" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" />
    <circle cx="14" cy="13.5" r="4.5" fill="#fff" />
  </svg>
`;

/** Renders every beach as a quality-colored marker on a canvas layer. */
export function BeachMap({
  beaches,
  bounds,
  frame,
  focusCenter,
  seasonIndex,
  selectedBeach,
  seaConditions,
  resetView,
  onSelectBeach,
  onMapClick,
  onViewportChange,
  onLeaveFrame,
}: BeachMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markersByIdRef = useRef<Map<string, CircleMarker>>(new Map());
  const halosByIdRef = useRef<Map<string, CircleMarker>>(new Map());
  const haloRendererRef = useRef<Renderer | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const waveMarkerRef = useRef<Marker | null>(null);
  const handledResetRef = useRef(0);
  const selectBeachRef = useRef(onSelectBeach);
  const viewportRef = useRef(onViewportChange);
  const mapClickRef = useRef(onMapClick);
  const clusterLayerRef = useRef<LayerGroup | null>(null);
  const clusterRendererRef = useRef<Renderer | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const stopBurstRef = useRef<(() => void) | null>(null);
  const growFrameRef = useRef<number | null>(null);
  const wasAggregatedRef = useRef(true);
  const burstStartedAtRef = useRef(0);
  const framedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [isLocating, setIsLocating] = useState(false);
  const selectedId = selectedBeach?.id ?? null;

  useEffect(() => {
    selectBeachRef.current = onSelectBeach;
  }, [onSelectBeach]);

  useEffect(() => {
    viewportRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    mapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    const markersById = markersByIdRef.current;
    const halosById = halosByIdRef.current;

    const initialize = async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: EUROPE_CENTER,
        zoom: 4,
        minZoom: 3,
        maxZoom: 18,
        preferCanvas: true,
        // Dots draw their fill without a stroke, so the click target would be
        // only the fill; a few pixels of slack keep beaches easy to tap.
        renderer: L.canvas({ tolerance: 3 }),
        zoomControl: true,
      });

      map.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      // Its own pane, faded as a whole: neighbouring blobs overlap, and
      // per-shape transparency would darken every overlap.
      map.createPane("clusters");
      const clusterPane = map.getPane("clusters");
      if (clusterPane) {
        clusterPane.style.zIndex = "450";
        clusterPane.classList.add("cluster-pane");
      }
      // Under the beach markers' canvas, so the dot stays on top of its sea.
      map.createPane("waves");
      const wavePane = map.getPane("waves");
      if (wavePane) {
        wavePane.style.zIndex = "350";
        wavePane.style.pointerEvents = "none";
      }

      // White rims for the beach dots, on a canvas of their own under the
      // fills: drawn with each dot, a rim would cut across any dot beneath it.
      map.createPane("halos");
      const haloPane = map.getPane("halos");
      if (haloPane) {
        haloPane.style.zIndex = "390";
        haloPane.style.pointerEvents = "none";
      }
      haloRendererRef.current = L.canvas({ pane: "halos" });

      clusterRendererRef.current = L.canvas({ pane: "clusters" });
      clusterLayerRef.current = L.layerGroup([], { pane: "clusters" }).addTo(map);
      map.on("zoomend", () => setZoom(map.getZoom()));
      // Leaflet only fires click when the pointer did not move, so a drag to
      // pan never counts.
      map.on("click", () => mapClickRef.current());

      // Zooming ends in a moveend too, so one handler covers both; resizing
      // changes what is on screen without either.
      const reportViewport = () => {
        const extent = map.getBounds();
        viewportRef.current([
          [extent.getSouth(), extent.getWest()],
          [extent.getNorth(), extent.getEast()],
        ]);
      };
      map.on("moveend", reportViewport);
      map.on("resize", reportViewport);
      reportViewport();

      mapRef.current = map;
      setZoom(map.getZoom());
      setMapReady(true);

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (!cancelled) map.invalidateSize({ animate: false, pan: false });
        });
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    };

    let disconnectResizeObserver: (() => void) | undefined;
    void initialize().then((disconnect) => {
      if (cancelled) {
        disconnect?.();
        return;
      }
      disconnectResizeObserver = disconnect;
    });

    return () => {
      cancelled = true;
      disconnectResizeObserver?.();
      mapRef.current?.remove();
      mapRef.current = null;
      stopBurstRef.current?.();
      if (growFrameRef.current) cancelAnimationFrame(growFrameRef.current);
      clusterLayerRef.current = null;
      clusterRendererRef.current = null;
      haloRendererRef.current = null;
      markersById.clear();
      halosById.clear();
      userMarkerRef.current = null;
      waveMarkerRef.current = null;
    };
  }, []);

  /** Creates one persistent marker per beach; the season effect adds them. */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady || beaches.length === 0) return;

    const markersById = markersByIdRef.current;
    const halosById = halosByIdRef.current;
    for (const marker of markersById.values()) marker.remove();
    for (const halo of halosById.values()) halo.remove();
    markersById.clear();
    halosById.clear();
    const haloRenderer = haloRendererRef.current ?? undefined;

    for (const beach of beaches) {
      halosById.set(
        beach.id,
        L.circleMarker([beach.lat, beach.lon], {
          pane: "halos",
          renderer: haloRenderer,
          radius: DOT_RADIUS + DOT_BORDER / 2,
          stroke: false,
          fillColor: "#ffffff",
          fillOpacity: 1,
          interactive: false,
        }),
      );
      const marker = L.circleMarker([beach.lat, beach.lon], {
        radius: DOT_RADIUS - DOT_BORDER / 2,
        stroke: false,
        fillOpacity: 1,
        // A click on a beach opens its card; letting it reach the map too
        // would close the card in the same breath.
        bubblingMouseEvents: false,
      });
      marker
        .bindTooltip(formatBeachName(beach.name), {
          direction: "top",
          offset: [0, -4],
        })
        .on("click", () => selectBeachRef.current(beach));
      markersById.set(beach.id, marker);
    }
  }, [beaches, mapReady]);

  const aggregated = zoom < CLUSTER_MAX_ZOOM;

  /** Wave fronts rolling in beside the selected beach, sized by the swell. */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    waveMarkerRef.current?.remove();
    waveMarkerRef.current = null;

    if (!selectedBeach || aggregated) return;
    const waveHeight = seaConditions?.waveHeight;
    if (!seaConditions || waveHeight === null || waveHeight === undefined) {
      return;
    }

    // The train keeps the swell's own rhythm: one front per real period.
    const period = Math.min(Math.max(seaConditions.wavePeriod ?? 5, 2), 12);
    const strength = Math.min(0.25 + waveHeight * 0.45, 0.85);
    const stroke = (2 + Math.min(waveHeight, 3)).toFixed(1);
    // The bearing is where the swell comes from and the fronts travel the
    // opposite way. They travel along +x in the SVG, so bearing+90 lines
    // compass north up with screen up.
    const rotation = Math.round((seaConditions.waveDirection ?? 270) + 90);

    const icon = L.divIcon({
      className: "",
      iconSize: [96, 96],
      iconAnchor: [48, 48],
      html:
        `<div class="wave-train" style="--wave-period:${period}s;` +
        `--wave-strength:${strength.toFixed(2)};transform:rotate(${rotation}deg)">` +
        `<svg viewBox="0 0 96 96" width="96" height="96" fill="none" ` +
        `stroke="var(--signal)" stroke-width="${stroke}" stroke-linecap="round">` +
        `<path d="M40 22 Q66 48 40 74"/>` +
        `<path d="M40 22 Q66 48 40 74"/>` +
        `<path d="M40 22 Q66 48 40 74"/>` +
        `</svg></div>`,
    });
    waveMarkerRef.current = L.marker([selectedBeach.lat, selectedBeach.lon], {
      icon,
      interactive: false,
      keyboard: false,
      pane: "waves",
    }).addTo(map);
  }, [aggregated, mapReady, seaConditions, selectedBeach]);

  /** Gathers beaches into blobs while the whole continent is on screen. */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = clusterLayerRef.current;
    if (!L || !map || !mapReady || !layer) return;

    layer.clearLayers();
    // The pane's canvas covers the whole map, so it swallows clicks and hovers
    // meant for the beach markers underneath it whenever it has nothing drawn.
    const pane = map.getPane("clusters");
    if (pane) {
      pane.style.pointerEvents = aggregated ? "" : "none";
      // Back in after a burst faded it out; the stylesheet eases it.
      if (aggregated) pane.style.opacity = "";
    }
    if (!aggregated || beaches.length === 0) return;

    const renderer = clusterRendererRef.current ?? undefined;
    const clusters = clusterBeaches(beaches, seasonIndex, zoom);
    const largest = Math.max(...clusters.map((cluster) => cluster.total));

    /**
     * Bursts the cluster into its beaches while the camera dives at them, as
     * one motion. The dive always lands past the clustering zoom, so it ends
     * on dots rather than on a smaller blob.
     */
    const burst = (cluster: Cluster, blob: CircleMarker) => {
      stopBurstRef.current?.();
      const extent = L.latLngBounds(cluster.bounds);
      const target = Math.min(
        12,
        Math.max(
          CLUSTER_MAX_ZOOM,
          map.getBoundsZoom(extent, false, L.point(120, 120)),
        ),
      );

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        map.setView(extent.getCenter(), target, { animate: false });
        return;
      }

      // The other blobs step back while this one opens.
      if (pane) pane.style.opacity = "0";
      blob.setStyle({ opacity: 0, fillOpacity: 0 });
      const centre = extent.getCenter();
      if (overlayRef.current) {
        // What will be on screen once the dive lands, with a margin.
        const half = map.getSize().divideBy(2);
        const middle = map.project(centre, target);
        const landing = L.latLngBounds(
          map.unproject(middle.subtract(half), target),
          map.unproject(middle.add(half), target),
        ).pad(0.1);
        burstStartedAtRef.current = performance.now();
        stopBurstRef.current = playBurst({
          map,
          canvas: overlayRef.current,
          cluster,
          members: clusterMembers(beaches, seasonIndex, zoom, cluster.key),
          neighbours: clusterNeighbours(beaches, seasonIndex, zoom, cluster.key, [
            [landing.getSouth(), landing.getWest()],
            [landing.getNorth(), landing.getEast()],
          ]),
          targetZoom: target,
          color: clusterColor(cluster.share),
          radius: blob.getRadius(),
        });
      }
      map.flyTo(centre, target, { duration: DIVE_SECONDS });
    };

    for (const cluster of clusters) {
      const color = clusterColor(cluster.share);
      const blob: CircleMarker = L.circleMarker([cluster.lat, cluster.lon], {
        pane: "clusters",
        renderer,
        radius: clusterRadius(cluster.total, largest),
        color,
        weight: 0,
        fillColor: color,
        fillOpacity: 1,
      });
      blob
        .bindTooltip(
          `${cluster.total} beaches · ${Math.round(cluster.share * 100)}% excellent`,
          { direction: "top", sticky: true },
        )
        .on("click", () => burst(cluster, blob))
        .addTo(layer);
    }
  }, [aggregated, beaches, mapReady, seasonIndex, zoom]);

  /** Shows only beaches assessed in the timeline season and recolors them. */
  useEffect(() => {
    const map = mapRef.current;
    const markersById = markersByIdRef.current;
    const halosById = halosByIdRef.current;
    if (!map || !mapReady || markersById.size === 0) return;

    // Dots only grow in when the map has just left the blobs behind, not on
    // every season change or selection. After a burst they are already on the
    // burst canvas at full size, so they arrive at full size and the canvas
    // fades over them instead.
    const justBurst = performance.now() - burstStartedAtRef.current < 3000;
    const growIn =
      wasAggregatedRef.current &&
      !aggregated &&
      !justBurst &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    wasAggregatedRef.current = aggregated;

    if (aggregated) {
      for (const marker of markersById.values()) marker.remove();
      for (const halo of halosById.values()) halo.remove();
      return;
    }

    if (growFrameRef.current) cancelAnimationFrame(growFrameRef.current);
    // Only what is on screen animates; thousands of offscreen dots would just
    // cost frames.
    const view = map.getBounds().pad(0.2);
    // Each entry: a circle and the radius it settles at.
    const growing: [CircleMarker, number][] = [];
    const place = (circle: CircleMarker, radius: number, animate: boolean) => {
      if (animate) {
        growing.push([circle, radius]);
        circle.setRadius(0);
      } else {
        circle.setRadius(radius);
      }
      if (!map.hasLayer(circle)) circle.addTo(map);
    };

    for (const beach of beaches) {
      const marker = markersById.get(beach.id);
      const halo = halosById.get(beach.id);
      if (!marker || !halo) continue;
      const quality = qualityAt(beach, seasonIndex);
      const isSelected = beach.id === selectedId;

      // Beaches without a class drop off the map; the selected one stays as a
      // ring so picking it from search never lands on an invisible marker.
      if (!quality && !isSelected) {
        marker.remove();
        halo.remove();
        continue;
      }

      const animate = growIn && view.contains(marker.getLatLng());
      const outer = isSelected ? SELECTED_RADIUS : DOT_RADIUS;
      const border = isSelected ? SELECTED_BORDER : DOT_BORDER;

      if (quality) {
        // The fill sits inside the rim; the rim itself lives on the halo
        // canvas beneath every fill.
        marker.setStyle({
          stroke: false,
          fillColor: QUALITY_COLORS[quality],
          fillOpacity: 1,
        });
        place(marker, outer - border / 2, animate);
        place(halo, outer + border / 2, animate);
      } else {
        // An unassessed selected beach is an outline, so it keeps its own
        // grey stroke and has no white rim.
        marker.setStyle({
          stroke: true,
          color: UNMONITORED_STROKE,
          weight: SELECTED_BORDER,
          opacity: 1,
          fillColor: UNMONITORED_STROKE,
          fillOpacity: 0.15,
        });
        place(marker, SELECTED_RADIUS, animate);
        halo.remove();
      }
      if (isSelected) marker.bringToFront();
    }

    if (growing.length === 0) return;
    // Land as the burst's sparks fade, overshooting slightly like they do.
    const started = performance.now();
    const grow = (now: number) => {
      const progress = Math.min(1, (now - started) / 260);
      const scale =
        1 + 2.70158 * (progress - 1) ** 3 + 1.70158 * (progress - 1) ** 2;
      for (const [circle, radius] of growing) {
        circle.setRadius(Math.max(0, radius * scale));
      }
      growFrameRef.current = progress < 1 ? requestAnimationFrame(grow) : null;
    };
    growFrameRef.current = requestAnimationFrame(grow);
  }, [aggregated, beaches, mapReady, seasonIndex, selectedId]);

  /**
   * Frames the selected country and keeps panning inside it. The combined view
   * is framed only on the first load: going back to it should leave whatever
   * corner of Europe you were looking at alone.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !bounds) return;
    if (!frame && framedRef.current) return;
    map.fitBounds(bounds, { padding: [24, 24] });
    framedRef.current = true;
  }, [bounds, frame, mapReady]);

  /**
   * Watches how much of the screen the framed country still covers, and hands
   * the map back to every country once too little of it is left, whether that
   * came from zooming out past it or panning off it.
   */
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !mapReady || !frame || !bounds) return;

    const country = L.latLngBounds(bounds);
    // Measured at the zoom the framing picked rather than the live map, so it
    // holds even while that move is still animating.
    const framedZoom = map.getBoundsZoom(country, false, L.point(24, 24));
    const northWest = map.project(country.getNorthWest(), framedZoom);
    const southEast = map.project(country.getSouthEast(), framedZoom);
    const viewport = map.getSize();
    const framed =
      (Math.abs(southEast.x - northWest.x) *
        Math.abs(southEast.y - northWest.y)) /
      (viewport.x * viewport.y);

    const check = () => {
      const size = map.getSize();
      const share = visibleShare(
        map.latLngToContainerPoint(country.getNorthWest()),
        map.latLngToContainerPoint(country.getSouthEast()),
        size.x,
        size.y,
      );
      if (share < framed * ABANDON_FRACTION) onLeaveFrame();
    };

    map.on("moveend", check);
    map.on("zoomend", check);
    return () => {
      map.off("moveend", check);
      map.off("zoomend", check);
    };
  }, [bounds, frame, mapReady, onLeaveFrame]);

  /**
   * Refits to the extent on request — the way back out to every country from
   * a framed one. It waits for the combined catalogue: until that arrives the
   * bounds still belong to the country being left.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || resetView === handledResetRef.current) return;
    if (frame || !bounds) return;
    handledResetRef.current = resetView;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [bounds, frame, mapReady, resetView]);

  useEffect(() => {
    if (!focusCenter || !mapRef.current) return;
    mapRef.current.setView(
      [focusCenter.latitude, focusCenter.longitude],
      Math.max(mapRef.current.getZoom(), 12),
    );
  }, [focusCenter, mapReady]);

  /** Pans to the device location and drops a pin. */
  const locate = () => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || isLocating) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setIsLocating(false);
        const position: [number, number] = [coords.latitude, coords.longitude];
        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng(position);
        } else {
          const icon = L.divIcon({
            className: "",
            html: USER_LOCATION_PIN_HTML,
            iconAnchor: [14, 34],
            iconSize: [28, 36],
            tooltipAnchor: [0, -34],
          });
          userMarkerRef.current = L.marker(position, {
            icon,
            keyboard: false,
            zIndexOffset: 1000,
          })
            .bindTooltip("Your position", { direction: "top" })
            .addTo(map);
        }
        map.setView(position, 12);
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
      <div
        aria-label="Map of bathing waters"
        className="min-h-0 w-full flex-1"
        ref={containerRef}
      />
      {/* Above the map panes, under the controls: where bursts are drawn. */}
      <canvas
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[450] size-full"
        ref={overlayRef}
      />
      <button
        aria-label="Centre on your location"
        className="absolute right-2 bottom-8 z-[500] flex size-10 items-center justify-center rounded-full border border-ink/20 bg-paper/95 text-signal shadow transition hover:bg-paper disabled:text-ink/35"
        disabled={isLocating}
        onClick={locate}
        title="Centre on your location"
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`size-5 ${isLocating ? "animate-pulse" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
          <circle cx="12" cy="12" r="8" />
        </svg>
      </button>
    </div>
  );
}
