"use client";

import { useEffect, useState } from "react";
import { ALL_COUNTRIES, mergeCountries } from "@/lib/catalog";
import type { CatalogIndex, CountryCatalog } from "@/lib/types";

interface CountryState {
  country: CountryCatalog | null;
  loading: boolean;
  error: boolean;
}

async function loadCountry(code: string): Promise<CountryCatalog> {
  const response = await fetch(`data/${code}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<CountryCatalog>;
}

/** Loads the country list written by scripts/sync-beaches.mjs. */
export function useCatalogIndex(): CatalogIndex | null {
  const [index, setIndex] = useState<CatalogIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("data/index.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<CatalogIndex>;
      })
      .then((payload) => {
        if (!cancelled) setIndex(payload);
      })
      .catch(() => {
        // Surfaced through the country load, which fails the same way.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return index;
}

/**
 * Loads one country, or every country at once for the combined view. Files are
 * per country so picking a single one stays a small download.
 */
export function useCountryCatalog(
  countryCode: string | null,
  index: CatalogIndex | null,
): CountryState {
  const [country, setCountry] = useState<CountryCatalog | null>(null);
  const [failedCode, setFailedCode] = useState<string | null>(null);
  const codes = index?.countries.map((entry) => entry.code).join(",");

  useEffect(() => {
    if (!countryCode) return;
    if (countryCode === ALL_COUNTRIES && !codes) return;
    let cancelled = false;

    const load =
      countryCode === ALL_COUNTRIES
        ? Promise.all(codes!.split(",").map(loadCountry)).then(mergeCountries)
        : loadCountry(countryCode);

    load
      .then((payload) => {
        if (!cancelled) setCountry(payload);
      })
      .catch(() => {
        if (!cancelled) setFailedCode(countryCode);
      });

    return () => {
      cancelled = true;
    };
  }, [codes, countryCode]);

  // Derived rather than cleared on change, so switching country never renders
  // the previous country's beaches against the new one's seasons.
  const current = country?.code === countryCode ? country : null;
  const error = failedCode === countryCode;

  return { country: current, loading: !error && !current, error };
}
