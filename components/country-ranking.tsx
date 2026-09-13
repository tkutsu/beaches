"use client";

import { useMemo } from "react";
import { ALL_COUNTRIES, countryFlag } from "@/lib/catalog";
import type { CountrySummary, SeasonTotals } from "@/lib/types";

interface CountryRankingProps {
  countries: readonly CountrySummary[];
  season: number | undefined;
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

// Blues, deliberately nothing like the quality palette: these bars sit beside
// the ranking's own green and amber, and reading them as classes is wrong.
const COAST = "#1c5cab";
const INLAND = "#12889b";

interface Row {
  code: string;
  name: string;
  coastal: number | null;
  inland: number | null;
  overall: number;
  assessed: number;
  history: (number | null)[];
}

function shareAt(totals: SeasonTotals, index: number): number | null {
  const entry = totals[index];
  if (!entry || entry[0] === 0) return null;
  return entry[1] / entry[0];
}

/** Share Excellent across both water types, for the ordering and sparkline. */
function overallHistory(country: CountrySummary): (number | null)[] {
  return country.coastal.map((coastal, index) => {
    const inland = country.inland[index] ?? [0, 0];
    const total = coastal[0] + inland[0];
    return total === 0 ? null : (coastal[1] + inland[1]) / total;
  });
}

function Sparkline({ history }: { history: (number | null)[] }) {
  const points = history
    .map((share, index) =>
      share === null
        ? null
        : `${(index / Math.max(history.length - 1, 1)) * 68},${16 - share * 14}`,
    )
    .filter((point): point is string => point !== null);

  if (points.length < 2) return <svg className="h-4 w-12" />;
  return (
    <svg aria-hidden="true" className="h-4 w-12" viewBox="0 0 68 18">
      <polyline
        fill="none"
        points={points.join(" ")}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Two stacked bars sharing one 0–100% axis: coast above, inland below. */
function SplitBars({ coastal, inland }: { coastal: number | null; inland: number | null }) {
  return (
    <span className="flex w-11 shrink-0 flex-col gap-[3px]">
      {[
        { share: coastal, color: COAST },
        { share: inland, color: INLAND },
      ].map(({ share, color }, index) => (
        <span
          className="block h-[5px] w-full rounded-[2px] bg-ink/10"
          key={index}
        >
          {share !== null && (
            <span
              className="block h-full rounded-[2px]"
              style={{ backgroundColor: color, width: `${share * 100}%` }}
            />
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * The map shows where, never who is ahead: a country with 87% Excellent and
 * one with 97% both read as a wash of green. This ranks them for the season on
 * screen, and re-sorts as the timeline moves.
 */
export function CountryRanking({
  countries,
  season,
  selectedCode,
  onSelect,
  onClose,
}: CountryRankingProps) {
  const rows = useMemo<Row[]>(() => {
    if (season === undefined) return [];
    return countries
      .map((country) => {
        const index = season - country.firstSeason;
        const coastalEntry = country.coastal[index] ?? [0, 0];
        const inlandEntry = country.inland[index] ?? [0, 0];
        const assessed = coastalEntry[0] + inlandEntry[0];
        return {
          code: country.code,
          name: country.name,
          coastal: shareAt(country.coastal, index),
          inland: shareAt(country.inland, index),
          overall:
            assessed === 0
              ? -1
              : (coastalEntry[1] + inlandEntry[1]) / assessed,
          assessed,
          history: overallHistory(country),
        };
      })
      .filter((row) => row.assessed > 0)
      .sort((a, b) => b.overall - a.overall);
  }, [countries, season]);

  return (
    <section className="flex max-h-[min(32rem,70dvh)] w-[min(21rem,100vw)] flex-col border border-b-0 border-ink/20 bg-paper/95 shadow-lg backdrop-blur-sm">
      <header className="flex items-baseline justify-between gap-2 border-b border-ink/10 px-3 py-2">
        <h2 className="m-0 text-xs font-bold tracking-wide uppercase">
          Excellent in {season ?? "—"}
        </h2>
        {/* The only way back out of a country, now that the picker is gone. */}
        {selectedCode !== ALL_COUNTRIES && (
          <button
            className="ml-auto border-0 bg-transparent p-0 text-[11px] text-signal hover:underline"
            onClick={() => onSelect(ALL_COUNTRIES)}
            type="button"
          >
            All countries
          </button>
        )}
        <button
          aria-label="Close ranking"
          className="-m-1 border-0 bg-transparent p-1 text-base leading-none text-ink/55 hover:text-ink"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>

      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {rows.map((row, rank) => (
          <li key={row.code}>
            <button
              className={`flex w-full items-center gap-1.5 border-0 px-3 py-1.5 text-left text-xs transition hover:bg-ink/5 ${
                row.code === selectedCode ? "bg-ink/8" : "bg-transparent"
              }`}
              onClick={() => onSelect(row.code)}
              type="button"
            >
              <span className="w-4 shrink-0 text-right text-ink/40 tabular-nums">
                {rank + 1}
              </span>
              <span aria-hidden="true" className="shrink-0">
                {countryFlag(row.code)}
              </span>
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <SplitBars coastal={row.coastal} inland={row.inland} />
              <span className="w-8 shrink-0 text-right font-semibold tabular-nums">
                {Math.round(row.overall * 100)}%
              </span>
              <span className="shrink-0 text-signal">
                <Sparkline history={row.history} />
              </span>
            </button>
          </li>
        ))}
      </ol>

      <footer className="border-t border-ink/10 px-3 py-2 text-[11px] leading-snug text-ink/50">
        Bars are the share rated Excellent:{" "}
        <span style={{ color: COAST }}>coast</span> above,{" "}
        <span style={{ color: INLAND }}>inland</span> below. Inland waters run
        worse across Europe, so blending them would rank what a country
        monitors as much as how clean it is.
      </footer>
    </section>
  );
}
