"use client";

import { useMemo, useState } from "react";
import { useSeaConditions } from "@/hooks/use-sea-conditions";
import {
  NO_DATA_LABEL,
  QUALITY_COLORS,
  QUALITY_LABELS,
  formatBeachName,
  qualityAt,
} from "@/lib/quality";
import type { Beach, ClassifiedQuality } from "@/lib/types";

interface BeachPanelProps {
  activeSeason: number | undefined;
  beach: Beach;
  seasons: readonly number[];
  onClose: () => void;
  onSelectSeason: (season: number) => void;
}

/** Detail card with the per-season quality strip for one beach. */
export function BeachPanel({
  activeSeason,
  beach,
  seasons,
  onClose,
  onSelectSeason,
}: BeachPanelProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const sea = useSeaConditions(beach);

  // One entry per season, with unclassified seasons collapsed to null.
  const history = useMemo(
    () => seasons.map((_, index) => qualityAt(beach, index)),
    [beach, seasons],
  );

  // The strip starts at the first classified season to skip a run of blanks.
  const firstAssessed = useMemo(() => {
    const index = history.findIndex((quality) => quality !== null);
    return index === -1 ? 0 : index;
  }, [history]);

  const stripSeasons = seasons.slice(firstAssessed);
  const stripQualities = history.slice(firstAssessed);
  const excellentCount = stripQualities.filter((q) => q === 1).length;
  const assessedCount = stripQualities.filter((q) => q !== null).length;
  const activeQuality =
    activeSeason === undefined ? null : history[seasons.indexOf(activeSeason)];
  const hovered = hoveredIndex === null ? null : {
    season: stripSeasons[hoveredIndex],
    quality: stripQualities[hoveredIndex] as ClassifiedQuality | null,
  };

  return (
    <section className="pointer-events-auto w-full max-w-xl border border-ink/20 bg-paper/95 p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-bold">
            {formatBeachName(beach.name)}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-ink/55">
            {beach.lake ? "Lake" : "Coast"} · {assessedCount} seasons monitored
            · Excellent in {excellentCount}
          </p>
        </div>
        <button
          aria-label="Close"
          className="-m-1 border-0 bg-transparent p-1 text-lg leading-none text-ink/55 hover:text-ink"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>

      <p className="m-0 mt-2 flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full"
          style={{
            backgroundColor: activeQuality
              ? QUALITY_COLORS[activeQuality]
              : "transparent",
            border: activeQuality
              ? undefined
              : "1.5px solid rgb(var(--ink-rgb) / 0.35)",
          }}
        />
        {activeQuality ? QUALITY_LABELS[activeQuality] : NO_DATA_LABEL}
        {activeSeason !== undefined && (
          <span className="font-normal text-ink/55">
            {activeSeason} season
          </span>
        )}
      </p>

      {/* The class is a verdict on last summer; this is the water today. */}
      {sea && (
        <p className="m-0 mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-ink/65">
          {sea.temperature !== null && (
            <span>
              Sea{" "}
              <span className="font-semibold text-ink tabular-nums">
                {sea.temperature.toFixed(1)} °C
              </span>
            </span>
          )}
          {sea.waveHeight !== null && (
            <span>
              Waves{" "}
              <span className="font-semibold text-ink tabular-nums">
                {sea.waveHeight.toFixed(1)} m
              </span>
            </span>
          )}
          <a
            className="text-ink/45 hover:underline"
            href="https://open-meteo.com/"
            rel="noreferrer"
            target="_blank"
          >
            now, via Open-Meteo
          </a>
        </p>
      )}

      <div className="mt-3" onMouseLeave={() => setHoveredIndex(null)}>
        <div
          className="flex gap-[2px]"
          role="img"
          aria-label="Quality history by year"
        >
          {stripQualities.map((quality, index) => {
            const isActive = stripSeasons[index] === activeSeason;
            return (
              <button
                key={stripSeasons[index]}
                aria-label={`${stripSeasons[index]}: ${
                  quality ? QUALITY_LABELS[quality] : NO_DATA_LABEL
                }`}
                className={`h-5 min-w-0 flex-1 rounded-[2px] border-0 p-0 ${
                  hoveredIndex === index || isActive
                    ? "outline outline-2 outline-signal"
                    : ""
                }`}
                style={{
                  backgroundColor: quality
                    ? QUALITY_COLORS[quality]
                    : "rgb(var(--ink-rgb) / 0.12)",
                }}
                onClick={() => onSelectSeason(stripSeasons[index])}
                onFocus={() => setHoveredIndex(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                type="button"
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink/55">
          <span>{stripSeasons[0]}</span>
          <span className="font-semibold text-ink/80">
            {hovered
              ? `${hovered.season} · ${
                  hovered.quality
                    ? QUALITY_LABELS[hovered.quality]
                    : NO_DATA_LABEL
                }`
              : "Quality per bathing season"}
          </span>
          <span>{stripSeasons[stripSeasons.length - 1]}</span>
        </div>
      </div>

      <a
        className="mt-3 inline-block text-xs font-semibold text-signal"
        href={`https://www.google.com/maps/search/?api=1&query=${beach.lat},${beach.lon}`}
        rel="noreferrer"
        target="_blank"
      >
        Open in maps ↗
      </a>
    </section>
  );
}
