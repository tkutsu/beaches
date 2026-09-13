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
  clusterColor,
  clusterRadius,
  type Cluster,
} from "@/lib/cluster";
import { QUALITY_COLORS, formatBeachName, qualityAt } from "@/lib/quality";
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
  onSelectBeach: (beach: Beach) => void;
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
  onSelectBeach,
  onViewportChange,
  onLeaveFrame,
}: BeachMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markersByIdRef = useRef<Map<string, CircleMarker>>(new Map());
  const userMarkerRef = useRef<Marker | null>(null);
  const selectBeachRef = useRef(onSelectBeach);
  const viewportRef = useRef(onViewportChange);
  const clusterLayerRef = useRef<LayerGroup | null>(null);
  const clusterRendererRef = useRef<Renderer | null>(null);
  const burstRef = useRef<number | null>(null);
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
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    const markersById = markersByIdRef.current;

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
      clusterRendererRef.current = L.canvas({ pane: "clusters" });
      clusterLayerRef.current = L.layerGroup([], { pane: "clusters" }).addTo(map);
      map.on("zoomend", () => setZoom(map.getZoom()));

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
      if (burstRef.current) cancelAnimationFrame(burstRef.current);
      clusterLayerRef.current = null;
      clusterRendererRef.current = null;
      markersById.clear();
      userMarkerRef.current = null;
    };
  }, []);

  /** Creates one persistent marker per beach; the season effect adds them. */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady || beaches.length === 0) return;

    const markersById = markersByIdRef.current;
    for (const marker of markersById.values()) marker.remove();
    markersById.clear();

    for (const beach of beaches) {
      const marker = L.circleMarker([beach.lat, beach.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.95,
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
    if (pane) pane.style.pointerEvents = aggregated ? "" : "none";
    if (!aggregated || beaches.length === 0) return;

    const renderer = clusterRendererRef.current ?? undefined;
    const clusters = clusterBeaches(beaches, seasonIndex, zoom);
    const largest = Math.max(...clusters.map((cluster) => cluster.total));

    /** Scatters the cluster into its beaches, then dives into them. */
    const burst = (cluster: Cluster, blob: CircleMarker) => {
      if (burstRef.current) cancelAnimationFrame(burstRef.current);
      const color = clusterColor(cluster.share);
      const sparks = cluster.members.map(() =>
        L.circleMarker([cluster.lat, cluster.lon], {
          pane: "clusters",
          renderer,
          radius: 5,
          color,
          weight: 0,
          fillColor: color,
          fillOpacity: 1,
        }).addTo(layer),
      );
      const radius = blob.getRadius();
      const started = performance.now();

      const frame = (now: number) => {
        // Ease out, so the blob leaps apart and settles rather than drifting.
        const progress = Math.min(1, (now - started) / 520);
        const eased = 1 - (1 - progress) ** 3;
        sparks.forEach((spark, index) => {
          const [lat, lon] = cluster.members[index];
          spark.setLatLng([
            cluster.lat + (lat - cluster.lat) * eased,
            cluster.lon + (lon - cluster.lon) * eased,
          ]);
        });
        blob.setRadius(radius * (1 + 0.9 * eased));
        blob.setStyle({ fillOpacity: 1 - eased, opacity: 1 - eased });

        if (progress < 1) {
          burstRef.current = requestAnimationFrame(frame);
          return;
        }
        burstRef.current = null;
        for (const spark of sparks) spark.remove();
        map.flyToBounds(cluster.bounds, {
          duration: 0.7,
          padding: [60, 60],
          maxZoom: 12,
        });
      };
      burstRef.current = requestAnimationFrame(frame);
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
    if (!map || !mapReady || markersById.size === 0) return;

    if (aggregated) {
      for (const marker of markersById.values()) marker.remove();
      return;
    }

    for (const beach of beaches) {
      const marker = markersById.get(beach.id);
      if (!marker) continue;
      const quality = qualityAt(beach, seasonIndex);
      const isSelected = beach.id === selectedId;

      // Beaches without a class drop off the map; the selected one stays as a
      // ring so picking it from search never lands on an invisible marker.
      if (!quality && !isSelected) {
        marker.remove();
        continue;
      }

      marker.setStyle(
        quality
          ? {
              color: "#ffffff",
              weight: isSelected ? 3 : 1.5,
              fillColor: QUALITY_COLORS[quality],
              fillOpacity: 0.95,
            }
          : {
              color: UNMONITORED_STROKE,
              weight: 3,
              fillColor: UNMONITORED_STROKE,
              fillOpacity: 0.15,
            },
      );
      marker.setRadius(isSelected ? 11 : 6);
      if (!map.hasLayer(marker)) marker.addTo(map);
      if (isSelected) marker.bringToFront();
    }
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
