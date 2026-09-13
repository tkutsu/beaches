"use client";

import { useEffect, useState } from "react";
import type { Beach } from "@/lib/types";

export interface SeaConditions {
  /** Sea surface temperature in °C, or null when the model has none. */
  temperature: number | null;
  /** Significant wave height in metres, or null when the model has none. */
  waveHeight: number | null;
}

interface MarineResponse {
  current?: {
    sea_surface_temperature: number | null;
    wave_height: number | null;
  };
}

const MARINE_API = "https://marine-api.open-meteo.com/v1/marine";

// One reading per beach for the life of the page, read straight back during
// render. The model moves every fifteen minutes and nobody reopens a card
// that often.
const readings = new Map<string, SeaConditions>();

/**
 * What the water is doing right now, from Open-Meteo's marine model. The model
 * is an ocean grid: inland waters come back empty, so they are never asked.
 */
export function useSeaConditions(beach: Beach): SeaConditions | null {
  const [, countArrivals] = useState(0);

  useEffect(() => {
    if (beach.lake || readings.has(beach.id)) return;

    const controller = new AbortController();
    const url = `${MARINE_API}?${new URLSearchParams({
      latitude: String(beach.lat),
      longitude: String(beach.lon),
      current: "sea_surface_temperature,wave_height",
    })}`;

    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: MarineResponse | null) => {
        const current = payload?.current;
        if (!current) return;
        const reading: SeaConditions = {
          temperature: current.sea_surface_temperature ?? null,
          waveHeight: current.wave_height ?? null,
        };
        // A beach the grid cannot reach reports both as null; leave the card
        // as it was rather than giving it an empty line.
        if (reading.temperature === null && reading.waveHeight === null) return;
        readings.set(beach.id, reading);
        countArrivals((arrivals) => arrivals + 1);
      })
      // An unreachable forecast is not worth saying anything about.
      .catch(() => {});

    return () => controller.abort();
  }, [beach.id, beach.lake, beach.lat, beach.lon]);

  return beach.lake ? null : (readings.get(beach.id) ?? null);
}
