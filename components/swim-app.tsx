"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeachMap } from "@/components/beach-map";
import { BeachPanel } from "@/components/beach-panel";
import { CountryRanking } from "@/components/country-ranking";
import {
  useCatalogIndex,
  useCountryCatalog,
} from "@/hooks/use-beach-catalog";
import { useSeaConditions } from "@/hooks/use-sea-conditions";
import {
  NO_DATA_LABEL,
  QUALITY_COLORS,
  QUALITY_LABELS,
  formatBeachName,
  qualityAt,
} from "@/lib/quality";
import { ALL_COUNTRIES } from "@/lib/catalog";
import { searchBeaches } from "@/lib/search";
import { withinBounds } from "@/lib/viewport";
import type { Beach, Bounds, ClassifiedQuality, Coordinates } from "@/lib/types";

const LEGEND_ORDER: ClassifiedQuality[] = [1, 2, 3, 4];

export function SwimApp() {
  const index = useCatalogIndex();
  // Every country at once until the visitor narrows it down.
  const [countryCode, setCountryCode] = useState(ALL_COUNTRIES);
  const { country, loading, error } = useCountryCatalog(countryCode, index);
  const [query, setQuery] = useState("");
  const [selectedBeach, setSelectedBeach] = useState<Beach | null>(null);
  const [focusCenter, setFocusCenter] = useState<Coordinates | null>(null);
  const [seasonIndex, setSeasonIndex] = useState<number | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const sea = useSeaConditions(selectedBeach);

  const seasons = useMemo(() => country?.seasons ?? [], [country]);
  const beaches = useMemo(() => country?.beaches ?? [], [country]);
  // Defaults to the latest season until the user moves the timeline.
  const activeIndex =
    seasonIndex === null || seasonIndex >= seasons.length
      ? Math.max(seasons.length - 1, 0)
      : seasonIndex;
  const activeSeason = seasons[activeIndex];

  // The season the playback timer should advance from, without making the
  // timer depend on every render.
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (!playing || seasons.length === 0) return;
    const timer = setInterval(() => {
      const next = activeIndexRef.current + 1;
      if (next >= seasons.length) {
        setPlaying(false);
        return;
      }
      activeIndexRef.current = next;
      setSeasonIndex(next);
    }, 420);
    return () => clearInterval(timer);
  }, [playing, seasons.length]);

  /** Replays from the first season once the run has finished. */
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (activeIndex >= seasons.length - 1) {
      activeIndexRef.current = 0;
      setSeasonIndex(0);
    }
    setTimelineOpen(true);
    setPlaying(true);
  };

  // Only what is on screen: a count of every beach in Europe says the same
  // thing all day, where this one answers what is in front of you.
  const counts = useMemo(() => {
    const byCode = new Map<ClassifiedQuality, number>();
    for (const beach of beaches) {
      if (viewBounds && !withinBounds(beach.lat, beach.lon, viewBounds)) {
        continue;
      }
      const quality = qualityAt(beach, activeIndex);
      if (quality) byCode.set(quality, (byCode.get(quality) ?? 0) + 1);
    }
    return byCode;
  }, [activeIndex, beaches, viewBounds]);

  // Beaches assessed in the shown season rank first, so delisted ones never
  // crowd out the beach someone can actually swim at today.
  const results = useMemo(() => {
    const found = searchBeaches(beaches, query, 24);
    return found
      .map((beach, rank) => ({
        beach,
        rank,
        assessed: qualityAt(beach, activeIndex) !== null,
      }))
      .sort((a, b) => Number(b.assessed) - Number(a.assessed) || a.rank - b.rank)
      .slice(0, 8)
      .map((entry) => entry.beach);
  }, [activeIndex, beaches, query]);

  const selectBeach = (beach: Beach, recenter: boolean) => {
    // The beach panel and the ranking share the bottom of the screen.
    setRankingOpen(false);
    setSelectedBeach(beach);
    setQuery("");
    if (recenter) {
      setFocusCenter({ latitude: beach.lat, longitude: beach.lon });
    }
  };

  // Stable so the map keeps the one handler it bound on load.
  const trackViewport = useCallback((bounds: Bounds) => {
    setViewBounds(bounds);
  }, []);

  // Stable so the map's watcher does not rebind on every render. Keeps the
  // viewport where it is: the point is to widen the data, not move the map.
  const leaveCountry = useCallback(() => {
    setCountryCode(ALL_COUNTRIES);
    setSeasonIndex(null);
  }, []);

  /** Back to every country, and back to seeing all of them. */
  const showAllCountries = () => {
    changeCountry(ALL_COUNTRIES);
    setResetViewSignal((signal) => signal + 1);
  };

  const changeCountry = (code: string) => {
    // Picking a country is the point of the ranking; get out of the way and
    // let them see the map they just asked for.
    setRankingOpen(false);
    setPlaying(false);
    setCountryCode(code);
    setSelectedBeach(null);
    setQuery("");
    setSeasonIndex(null);
  };

  return (
    <main className="relative flex h-dvh flex-col">
      <BeachMap
        beaches={beaches}
        bounds={country?.bounds ?? null}
        frame={countryCode !== ALL_COUNTRIES}
        focusCenter={focusCenter}
        seasonIndex={activeIndex}
        selectedBeach={selectedBeach}
        seaConditions={sea}
        resetView={resetViewSignal}
        onSelectBeach={(beach) => selectBeach(beach, false)}
        onViewportChange={trackViewport}
        onLeaveFrame={leaveCountry}
      />

      {/* Floating search */}
      <div className="absolute top-3 left-1/2 z-[500] w-[min(92%,22rem)] -translate-x-1/2">
        <input
          aria-label="Search for a beach"
          className="h-10 w-full border border-ink/25 bg-paper/95 px-3 text-sm shadow-lg outline-none backdrop-blur-sm transition focus:border-signal"
          placeholder="Search for a beach…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {results.length > 0 && (
          <ul className="m-0 list-none border border-t-0 border-ink/25 bg-paper p-0 shadow-lg">
            {results.map((beach) => {
              const quality = qualityAt(beach, activeIndex);
              return (
                <li key={beach.id}>
                  <button
                    className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm hover:bg-ink/5"
                    onClick={() => selectBeach(beach, true)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: quality
                          ? QUALITY_COLORS[quality]
                          : "transparent",
                        border: quality
                          ? undefined
                          : "1.5px solid rgb(var(--ink-rgb) / 0.35)",
                      }}
                    />
                    <span className="truncate">
                      {formatBeachName(beach.name)}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-ink/50">
                      {quality ? QUALITY_LABELS[quality] : NO_DATA_LABEL}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="m-0 mt-2 bg-red-50 px-3 py-1.5 text-center text-xs text-red-800 shadow">
            The beach catalogue failed to load.
          </p>
        )}
        {loading && !error && (
          <p className="m-0 mt-2 bg-paper/95 px-3 py-1.5 text-center text-xs text-ink/60 shadow">
            Loading catalogue…
          </p>
        )}
      </div>

      {/* The legend, always on, counting what the viewport holds */}
      <div className="pointer-events-none absolute right-2 bottom-20 z-[500] rounded bg-paper/30 px-2 py-1.5 backdrop-blur-sm">
        <ul className="m-0 list-none p-0 text-xs">
          {LEGEND_ORDER.map((code) => {
            const count = counts.get(code) ?? 0;
            if (count === 0 && code !== 1) return null;
            return (
              <li
                className="flex items-center justify-end gap-2 py-0.5"
                key={code}
              >
                <span className="text-ink/60 tabular-nums">
                  {count.toLocaleString("en")}
                </span>
                {QUALITY_LABELS[code]}
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: QUALITY_COLORS[code] }}
                />
              </li>
            );
          })}
        </ul>
      </div>

      {/* The ranking, rising out of the bottom edge over its own button */}
      {rankingOpen && (
        <div className="rise-in absolute bottom-0 left-1/2 z-[501] -translate-x-1/2">
          <CountryRanking
            countries={index?.countries ?? []}
            season={activeSeason}
            selectedCode={countryCode}
            onClose={() => setRankingOpen(false)}
            onSelect={changeCountry}
          />
        </div>
      )}

      {!rankingOpen && (
        <div
          className={`absolute bottom-8 left-1/2 z-[500] -translate-x-1/2 ${
            // No room for both on a phone; the timeline has the row.
            timelineOpen ? "max-sm:hidden" : ""
          }`}
        >
          {countryCode !== ALL_COUNTRIES ? (
            // While a framed country holds the view there is nothing more the
            // ranking would add; the way back out is what is missing.
            <button
              className="rounded-full border border-ink/20 bg-paper/95 px-4 py-2 text-xs font-bold tracking-widest uppercase shadow transition hover:bg-paper"
              onClick={showAllCountries}
              type="button"
            >
              Show all countries
            </button>
          ) : (
            <button
              aria-expanded={false}
              className="rounded-full border border-ink/20 bg-paper/95 px-4 py-2 text-xs font-bold tracking-widest uppercase shadow transition hover:bg-paper disabled:text-ink/35"
              disabled={!index}
              onClick={() => {
                setSelectedBeach(null);
                setRankingOpen(true);
              }}
              type="button"
            >
              Rankings
            </button>
          )}
        </div>
      )}

      {/* Timeline, collapsed to the active season. Stops short of the
          centre-on-location button, and takes the width it is given. */}
      <div className="pointer-events-none absolute right-14 bottom-8 left-2 z-[500] flex items-center gap-2 sm:right-auto">
        <button
          aria-expanded={timelineOpen}
          aria-label="Season timeline"
          className="pointer-events-auto flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full border border-ink/20 bg-paper/95 px-3 text-sm font-bold shadow transition tabular-nums hover:bg-paper"
          onClick={() => setTimelineOpen((open) => !open)}
          title="Season timeline"
          type="button"
        >
          {activeSeason ?? "—"}
        </button>
        {timelineOpen && seasons.length > 0 && (
          <div className="slide-in-left pointer-events-auto flex h-10 min-w-0 flex-1 items-center gap-3 rounded-full border border-ink/20 bg-paper/95 pr-4 pl-2 shadow-lg backdrop-blur-sm sm:flex-none">
            <button
              aria-label={playing ? "Pause" : "Play the seasons"}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-signal transition hover:bg-ink/5"
              onClick={togglePlay}
              title={playing ? "Pause" : "Play the seasons"}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="size-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                {playing ? (
                  <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                ) : (
                  <path d="M8 5v14l11-7z" />
                )}
              </svg>
            </button>
            <span className="hidden text-xs text-ink/55 tabular-nums sm:inline">
              {seasons[0]}
            </span>
            <input
              aria-label="Bathing season"
              aria-valuetext={String(activeSeason ?? "")}
              className="min-w-0 flex-1 accent-signal sm:w-64 sm:flex-none"
              max={seasons.length - 1}
              min={0}
              step={1}
              type="range"
              value={activeIndex}
              onChange={(event) => {
                setPlaying(false);
                setSeasonIndex(Number(event.target.value));
              }}
            />
            <span className="hidden text-xs text-ink/55 tabular-nums sm:inline">
              {seasons[seasons.length - 1]}
            </span>
          </div>
        )}
      </div>

      {selectedBeach && (
        <div className="pointer-events-none absolute right-0 bottom-24 left-0 z-[500] flex justify-center px-3">
          <BeachPanel
            activeSeason={activeSeason}
            beach={selectedBeach}
            sea={sea}
            seasons={seasons}
            onClose={() => setSelectedBeach(null)}
            onSelectSeason={(season) => setSeasonIndex(seasons.indexOf(season))}
          />
        </div>
      )}
    </main>
  );
}
