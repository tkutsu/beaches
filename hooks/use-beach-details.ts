"use client";

import { useEffect, useState } from "react";
import type {
  Beach,
  BeachDetails,
  CountryDetails,
  RegionTourism,
} from "@/lib/types";

export interface ResolvedDetails {
  details: BeachDetails;
  region: RegionTourism | null;
}

// One file per country, fetched the first time a beach there is opened and
// kept for the page's life. Null marks a country whose file failed to load.
const files = new Map<string, CountryDetails | null>();
const inFlight = new Set<string>();

/**
 * Sand, facilities, photo and how touristy the area is, for one beach. Every
 * beach id starts with its country code, which names the file to fetch, so
 * this works the same in the all-countries view.
 */
export function useBeachDetails(beach: Beach): ResolvedDetails | null {
  const [, countArrivals] = useState(0);
  const code = beach.id.slice(0, 2);

  useEffect(() => {
    if (files.has(code) || inFlight.has(code)) return;
    inFlight.add(code);
    fetch(`data/details/${code}.json`)
      .then((response) =>
        response.ok ? (response.json() as Promise<CountryDetails>) : null,
      )
      .catch(() => null)
      .then((payload) => {
        files.set(code, payload);
        inFlight.delete(code);
        countArrivals((arrivals) => arrivals + 1);
      });
  }, [code]);

  const file = files.get(code);
  const details = file?.beaches[beach.id];
  if (!file || !details) return null;
  return {
    details,
    region: details.r ? (file.regions[details.r] ?? null) : null,
  };
}
