// Regenerates public/data from two open EEA sources and reports what changed:
//   * discodata SQL API - the WISE Bathing Water Directive database, holding
//     every season up to 2024 and coordinates for every bathing water ever
//     reported, including ones since delisted.
//   * discomap ArcGIS layer - the current season, which the WISE database has
//     not been refreshed with yet.
//
// One file per country keeps each download small; index.json lists them.
import { readFile, writeFile } from "node:fs/promises";

const DISCODATA = "https://discodata.eea.europa.eu/sql";
const CURRENT_SEASON = 2025;
const CURRENT_SEASON_LAYER =
  "https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater" +
  `/BathingWater_Dyna_WM_${CURRENT_SEASON}/MapServer/3/query`;
const PAGE_SIZE = 50_000;
const ARCGIS_PAGE_SIZE = 1_000;
const DATA_DIR = new URL("../public/data/", import.meta.url);

// EU Bathing Water Directive classes, stored as one character per season.
// "." covers both "not classified" and never monitored.
const QUALITY_CHARS = { Excellent: "1", Good: "2", Sufficient: "3", Poor: "4" };
const NO_DATA = ".";
const CLASS_NAMES = {
  1: "Excellent",
  2: "Good",
  3: "Sufficient",
  4: "Poor",
  [NO_DATA]: "no data",
};

// Countries that stopped reporting are absent from the current season layer.
const RETIRED_COUNTRY_NAMES = { UK: "United Kingdom", ME: "Montenegro" };

async function queryDiscodata(sql) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const url = `${DISCODATA}?${new URLSearchParams({
      query: sql,
      p: String(page),
      nrOfHits: String(PAGE_SIZE),
    })}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`discodata responded ${response.status} for: ${sql}`);
    }
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(`discodata error: ${JSON.stringify(payload.errors)}`);
    }
    rows.push(...payload.results);
    if (payload.results.length < PAGE_SIZE) return rows;
  }
}

async function queryCurrentSeason(where, fields) {
  const rows = [];
  for (let offset = 0; ; offset += ARCGIS_PAGE_SIZE) {
    const url = `${CURRENT_SEASON_LAYER}?${new URLSearchParams({
      where,
      outFields: fields.join(","),
      returnGeometry: "false",
      resultOffset: String(offset),
      resultRecordCount: String(ARCGIS_PAGE_SIZE),
      f: "json",
    })}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`discomap responded ${response.status}`);
    const payload = await response.json();
    if (payload.error) {
      throw new Error(`discomap error: ${JSON.stringify(payload.error)}`);
    }
    const features = payload.features ?? [];
    rows.push(...features.map((feature) => feature.attributes));
    if (features.length < ARCGIS_PAGE_SIZE) return rows;
  }
}

async function readExisting(name) {
  try {
    return JSON.parse(await readFile(new URL(name, DATA_DIR), "utf8"));
  } catch {
    return null;
  }
}

/** Per-country catalogue, with history trimmed to the first assessed season. */
function buildCountry(code, name, spatial, statuses, currentSeason) {
  const historyById = new Map();
  let minSeason = Infinity;
  let maxSeason = -Infinity;

  for (const { bathingWaterIdentifier, season, quality } of statuses) {
    const parsed = Number.parseInt(quality, 10);
    if (Number.isNaN(parsed)) continue;
    minSeason = Math.min(minSeason, season);
    maxSeason = Math.max(maxSeason, season);
    let history = historyById.get(bathingWaterIdentifier);
    if (!history) {
      historyById.set(bathingWaterIdentifier, (history = new Map()));
    }
    history.set(season, parsed >= 1 && parsed <= 4 ? String(parsed) : NO_DATA);
  }

  for (const row of currentSeason) {
    const id = row.bathingWaterIdentifier;
    let history = historyById.get(id);
    if (!history) historyById.set(id, (history = new Map()));
    history.set(CURRENT_SEASON, QUALITY_CHARS[row.qualityStatus] ?? NO_DATA);
    minSeason = Math.min(minSeason, CURRENT_SEASON);
    maxSeason = Math.max(maxSeason, CURRENT_SEASON);
  }

  if (!Number.isFinite(minSeason)) return null;

  const seasons = [];
  for (let year = minSeason; year <= maxSeason; year += 1) seasons.push(year);

  // The WISE record wins over the map layer, which carries fewer name details.
  const placeById = new Map();
  for (const row of currentSeason) {
    placeById.set(row.bathingWaterIdentifier, {
      name: row.bathingWaterName,
      lat: row.latitude,
      lon: row.longitude,
      lake: row.bwWaterCategory === "Lake",
    });
  }
  for (const row of spatial) {
    placeById.set(row.thematicIdIdentifier, {
      name: row.nameText?.trim() || row.nameTextInternational?.trim() || "",
      ascii: row.nameTextInternational?.trim() || "",
      lat: row.lat,
      lon: row.lon,
      lake: row.specialisedZoneType === "lakeBathingWater",
    });
  }

  const beaches = [];
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [id, history] of historyById) {
    const place = placeById.get(id);
    if (!place || place.lat == null || place.lon == null || !place.name) {
      continue;
    }
    const h = seasons
      .map((year) => history.get(year) ?? NO_DATA)
      .join("");
    if (!/[1-4]/.test(h)) continue;
    const beach = { id, name: place.name, lat: place.lat, lon: place.lon, h };
    // Only carry the folded spelling when it differs, for search.
    if (place.ascii && place.ascii !== place.name) beach.a = place.ascii;
    if (place.lake) beach.lake = true;
    beaches.push(beach);
    south = Math.min(south, place.lat);
    north = Math.max(north, place.lat);
    west = Math.min(west, place.lon);
    east = Math.max(east, place.lon);
  }
  if (!beaches.length) return null;
  beaches.sort((a, b) => a.id.localeCompare(b.id));

  return {
    code,
    name,
    seasons,
    bounds: [
      [south, west],
      [north, east],
    ],
    beaches,
  };
}

/**
 * Per-season totals, split by water type. Inland waters run worse than the
 * coast everywhere, so a country's ranking is only fair when the two are
 * shown apart rather than blended into one number.
 */
function summarise(country) {
  const coastal = [];
  const inland = [];
  for (let index = 0; index < country.seasons.length; index += 1) {
    let coastalTotal = 0;
    let coastalExcellent = 0;
    let inlandTotal = 0;
    let inlandExcellent = 0;
    for (const beach of country.beaches) {
      const code = beach.h[index];
      if (code === NO_DATA) continue;
      if (beach.lake) {
        inlandTotal += 1;
        if (code === "1") inlandExcellent += 1;
      } else {
        coastalTotal += 1;
        if (code === "1") coastalExcellent += 1;
      }
    }
    coastal.push([coastalTotal, coastalExcellent]);
    inland.push([inlandTotal, inlandExcellent]);
  }
  return { coastal, inland };
}

/** Human-readable diff between the stored catalogue and the fresh one. */
function describeChanges(previous, next) {
  if (!previous) return [`new country with ${next.beaches.length} beaches`];

  const changes = [];
  const before = new Map(previous.beaches.map((b) => [b.id, b]));
  const after = new Map(next.beaches.map((b) => [b.id, b]));

  const added = next.beaches.filter((b) => !before.has(b.id));
  const removed = previous.beaches.filter((b) => !after.has(b.id));
  if (added.length) changes.push(`+${added.length} beaches`);
  if (removed.length) changes.push(`-${removed.length} beaches`);

  const lastBefore = previous.seasons[previous.seasons.length - 1];
  const lastAfter = next.seasons[next.seasons.length - 1];
  if (lastAfter !== lastBefore) {
    changes.push(`seasons now reach ${lastAfter} (was ${lastBefore})`);
  }

  // Reclassifications, compared season by season on the shared range.
  const examples = [];
  let reclassified = 0;
  for (const beach of next.beaches) {
    const old = before.get(beach.id);
    if (!old) continue;
    for (let index = 0; index < next.seasons.length; index += 1) {
      const season = next.seasons[index];
      const oldIndex = previous.seasons.indexOf(season);
      if (oldIndex === -1) continue;
      const oldChar = old.h[oldIndex] ?? NO_DATA;
      const newChar = beach.h[index] ?? NO_DATA;
      if (oldChar === newChar) continue;
      reclassified += 1;
      if (examples.length < 5) {
        examples.push(
          `${beach.name} ${season}: ${CLASS_NAMES[oldChar]} -> ${CLASS_NAMES[newChar]}`,
        );
      }
    }
  }
  if (reclassified) {
    changes.push(`${reclassified} reclassified season(s)`);
    changes.push(...examples.map((line) => `    ${line}`));
  }

  return changes;
}

console.log("Fetching the list of reporting countries...");
const countryRows = await queryDiscodata(
  "SELECT countryCode, COUNT(DISTINCT bathingWaterIdentifier) AS beaches " +
    "FROM [WISE_BWD].[latest].[assessment_BathingWaterStatus] " +
    "GROUP BY countryCode ORDER BY countryCode",
);

const currentSeasonNames = await queryCurrentSeason("1=1", [
  "countryCode",
  "countryName",
]);
const countryNames = { ...RETIRED_COUNTRY_NAMES };
for (const row of currentSeasonNames) {
  countryNames[row.countryCode] = row.countryName;
}
console.log(`  ${countryRows.length} countries\n`);

const index = [];
const report = [];
const kept = [];

for (const { countryCode } of countryRows) {
  const name = countryNames[countryCode] ?? countryCode;
  process.stdout.write(`${countryCode} ${name}... `);
  const previous = await readExisting(`${countryCode}.json`);

  let country = null;
  let note = "";
  try {
    const [spatial, statuses, currentSeason] = await Promise.all([
      queryDiscodata(
        "SELECT thematicIdIdentifier, nameText, nameTextInternational, lat, lon, " +
          "specialisedZoneType FROM [WISE_BWD].[latest].[spatial_ProtectedArea] " +
          `WHERE countryCode = '${countryCode}' AND lat IS NOT NULL`,
      ),
      queryDiscodata(
        "SELECT bathingWaterIdentifier, season, quality " +
          "FROM [WISE_BWD].[latest].[assessment_BathingWaterStatus] " +
          `WHERE countryCode = '${countryCode}'`,
      ),
      queryCurrentSeason(`countryCode='${countryCode}'`, [
        "bathingWaterIdentifier",
        "bathingWaterName",
        "qualityStatus",
        "latitude",
        "longitude",
        "bwWaterCategory",
      ]),
    ]);
    country = buildCountry(
      countryCode,
      name,
      spatial,
      statuses,
      currentSeason,
    );
    if (!country) note = "no usable data";
  } catch (error) {
    note = error.message;
  }

  if (country) {
    const changes = describeChanges(previous, country);
    await writeFile(
      new URL(`${countryCode}.json`, DATA_DIR),
      JSON.stringify(country),
    );
    if (changes.length) report.push({ code: countryCode, name, changes });
  } else if (previous) {
    // Keep what is already on disk. A build left to run on its own must not
    // drop a country from the catalogue over one bad minute at the EEA.
    country = previous;
    kept.push(`${name} (${note})`);
  } else {
    console.log(`skipped: ${note}`);
    continue;
  }

  const { beaches, seasons, bounds } = country;
  index.push({
    code: countryCode,
    name,
    beaches: beaches.length,
    firstSeason: seasons[0],
    latestSeason: seasons[seasons.length - 1],
    bounds,
    ...summarise(country),
  });
  console.log(
    `${beaches.length} beaches, ${seasons[0]}-${seasons.at(-1)}` +
      (note ? ` - kept the existing file: ${note}` : ""),
  );
}

if (!index.length) {
  console.error("\nNo country produced any data; leaving public/data alone.");
  process.exit(1);
}

index.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(
  new URL("index.json", DATA_DIR),
  JSON.stringify({
    updated: new Date().toISOString().slice(0, 10),
    currentSeason: CURRENT_SEASON,
    countries: index,
  }),
);

const totalBeaches = index.reduce((sum, entry) => sum + entry.beaches, 0);
console.log(
  `\nWrote ${index.length} countries and ${totalBeaches} beaches to public/data.`,
);
if (kept.length) {
  console.log(
    `Kept the committed data for ${kept.length}: ${kept.join(", ")}.`,
  );
}

console.log("\nChanges since the last sync");
console.log("---------------------------");
if (!report.length) {
  console.log("Nothing changed.");
} else {
  for (const { code, name, changes } of report) {
    console.log(`${code} ${name}: ${changes[0]}`);
    for (const line of changes.slice(1)) console.log(`  ${line}`);
  }
}
