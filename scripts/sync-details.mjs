// Writes public/data/details/<country>.json: what a beach is like, beyond its
// water quality. Joined onto the catalogue by beach id, from open sources:
//   * OpenStreetMap, through Overpass - the beach outline each bathing water
//     sits on (for sand or pebbles, a lifeguard, a Wikidata link) and the
//     facilities within a short walk.
//   * Wikidata and Wikimedia Commons - a photo. First the image Wikidata holds
//     for the beach OSM links to, which is the right place by construction;
//     failing that, the best free-licensed Commons photo taken nearby whose
//     title or categories say it is a beach or a lake.
//   * Eurostat and GISCO - nights spent in tourist accommodation per region,
//     divided by the region's area, as a measure of how touristy it is.
//   * EMODnet Bathymetry - how deep the sea is 500 m out, for how quickly the
//     water gets deep off a coastal beach.
//
// Run by hand now and then, not on every build: OSM and Commons change slowly,
// and the full run makes tens of thousands of requests. Responses are cached
// under .cache/details, so an interrupted run picks up where it stopped.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const DATA_DIR = new URL("public/data/", ROOT);
const OUT_DIR = new URL("public/data/details/", ROOT);
const CACHE_DIR = new URL(".cache/details/", ROOT);
const USER_AGENT =
  "beaches-details-sync/1.0 (https://beaches.themos.dev; https://github.com/tkutsu/beaches)";

// Public Overpass servers, in the order lanes use them. The first two set no
// per-client rate limit; overpass-api.de allows two queries and turns clients
// away under load, so it is only the fallback. overpass.kumi.systems is left
// out: months stale and slow.
const OVERPASS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const EMODNET_PROFILE = "https://rest.emodnet-bathymetry.eu/depth_profile";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const NUTS_BOUNDARIES =
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_03M_2021_4326_LEVL_2.geojson";
const TOURISM_NIGHTS =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tour_occ_nin2" +
  "?format=JSON&lang=EN&unit=NR&nace_r2=I551-I553&c_resid=TOTAL&sinceTimePeriod=2018";

/** Overpass is asked one 2x2 degree tile at a time: small enough never to time out. */
const TILE_DEGREES = 2;
/** How far a beach may sit from the OSM outline it belongs to. */
const OUTLINE_MATCH_METERS = 150;
const CENTRE_MATCH_METERS = 300;
/** A short walk from the water. */
const FACILITY_METERS = 400;
const PHOTO_SEARCH_METERS = 500;
const COMMONS_CONCURRENCY = 2;
/** EMODnet starts refusing past a few profiles in flight. */
const EMODNET_CONCURRENCY = 3;
/**
 * How far out the depth is read. EMODnet's grid is about 115 m a cell, too
 * coarse for the first few metres off the sand, so the reading is the shelf a
 * swimmer is heading onto rather than the step at the waterline.
 */
const DEPTH_OUT_METERS = 500;
/** Queries in flight: three lanes on the first server, one on the second. */
const OVERPASS_LANES = 4;

// Facilities, one letter each so a beach's list stays a short string.
const FACILITY_CODES = [
  ["L", (tags) => /^lifeguard/.test(tags.emergency ?? "")],
  ["F", (tags) => /^(cafe|restaurant|bar|fast_food|ice_cream)$/.test(tags.amenity ?? "")],
  ["T", (tags) => tags.amenity === "toilets"],
  ["S", (tags) => tags.amenity === "shower"],
  ["P", (tags) => tags.amenity === "parking"],
  ["W", (tags) => tags.amenity === "drinking_water"],
];

// OSM's surface values, folded into the few a swimmer tells apart.
const SURFACES = {
  sand: "sand",
  fine_gravel: "fine gravel",
  gravel: "gravel",
  pebblestone: "pebbles",
  pebbles: "pebbles",
  shingle: "pebbles",
  stone: "rocks",
  rock: "rocks",
  rocks: "rocks",
  grass: "grass",
  concrete: "concrete",
  paved: "concrete",
  paving_stones: "concrete",
  wood: "wooden deck",
};

// Words that mark a Commons photo as being of a beach or bathing lake, across
// the catalogue's languages. Compared without accents and in lower case.
const PLACE_WORDS = [
  "beach", "plage", "strand", "playa", "platja", "praia", "spiaggia", "lido",
  "plaza", "plaza", "plaz", "plaj", "plaja", "paralia", "παραλια", "пляж", "плаж",
  "rand", "papludim", "pludmal", "ranta", "badeplass", "badestrand", "badesee",
  "badestelle", "badeplatz", "strandbad", "zwemplas", "zwemwater", "jezero",
  "ezers", "jarv", "lake", "lac", "lago", "see", "bay", "baie", "bucht", "cala",
  "zatoka", "uvala", "kupaliste", "kapielisko", "koupaliste", "kupalisko",
  "kopalisce", "swimming", "bathing", "coast", "shore", "seaside", "costa",
];
const NOT_A_PHOTO =
  /(\bmap\b|karte|\bcarte\b|\bmapa\b|diagram|\blogo\b|\bflag\b|coat of arms|\biss0|view of earth|\bdop\d|orthophoto|\.svg$|\.tiff?$|\.pdf$)/i;
const FREE_LICENSE = /^(cc[ -]?by|cc0|cc-zero|public domain|pd\b|pdm)/i;

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fold(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function metersBetween(lat1, lon1, lat2, lon2) {
  const x = ((lon2 - lon1) * Math.PI) / 180 * Math.cos(((lat1 + lat2) * Math.PI) / 360);
  const y = ((lat2 - lat1) * Math.PI) / 180;
  return 6371000 * Math.hypot(x, y);
}

async function cached(name, produce) {
  const file = new URL(name, CACHE_DIR);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const value = await produce();
    await mkdir(new URL(".", file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  }
}

async function fetchJson(url, init = {}, { attempts = 6, label = url } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(240_000),
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.error?.code === "maxlag") throw new Error("maxlag");
      return payload;
    } catch (error) {
      lastError = error;
      const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      console.warn(`  ${label}: ${error.message}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastError;
}

/**
 * A fetcher for one service that backs off as a group: when the service asks
 * us to slow down, every request to it waits, rather than each retrying on its
 * own schedule and keeping the pressure up.
 */
function politeClient() {
  let resumesAt = 0;
  return async function getJson(url, label) {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const wait = resumesAt - Date.now();
      if (wait > 0) await sleep(wait);
      let response;
      try {
        response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (attempt === 8) throw error;
        await sleep(2_000 * attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const seconds = Number(response.headers.get("retry-after")) || 15 * attempt;
        resumesAt = Math.max(resumesAt, Date.now() + seconds * 1000);
        console.warn(`  ${label}: HTTP ${response.status}, pausing ${seconds}s`);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.error?.code === "maxlag") {
        resumesAt = Math.max(resumesAt, Date.now() + 5_000);
        continue;
      }
      return payload;
    }
    throw new Error("kept refusing");
  };
}

const commonsGet = politeClient();
const emodnetGet = politeClient();

function commonsJson(params, label) {
  return commonsGet(
    `${COMMONS_API}?${new URLSearchParams({ ...params, format: "json", maxlag: "5" })}`,
    label,
  );
}

/** Runs `work` over `items` with a fixed number of requests in flight. */
async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await work(items[index], index);
      }
    }),
  );
}

// --- Catalogue -------------------------------------------------------------

async function loadCatalogue() {
  const index = JSON.parse(await readFile(new URL("index.json", DATA_DIR), "utf8"));
  const countries = [];
  for (const { code } of index.countries) {
    const catalog = JSON.parse(await readFile(new URL(`${code}.json`, DATA_DIR), "utf8"));
    countries.push({ code, beaches: catalog.beaches });
  }
  return countries;
}

// --- Tourism ---------------------------------------------------------------

function ringArea(ring) {
  // Spherical excess of a lon/lat ring, in km².
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total +=
      ((lon2 - lon1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return (Math.abs(total) * 6371.0088 ** 2) / 2;
}

function insideRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function metersToRing(lat, lon, ring) {
  const scale = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = (ring[i][0] - lon) * scale;
    const ay = ring[i][1] - lat;
    const bx = (ring[i + 1][0] - lon) * scale;
    const by = ring[i + 1][1] - lat;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return (best * Math.PI * 6371000) / 180;
}

/** Reads a Eurostat JSON-stat response into { geo: { year, value } } for the latest year. */
function latestByRegion(payload) {
  const dims = payload.id;
  const strides = dims.map((_, i) => payload.size.slice(i + 1).reduce((a, b) => a * b, 1));
  const positions = Object.fromEntries(
    dims.map((dim) => [
      dim,
      Object.fromEntries(
        Object.entries(payload.dimension[dim].category.index).map(([code, pos]) => [pos, code]),
      ),
    ]),
  );
  const latest = {};
  for (const [flat, value] of Object.entries(payload.value)) {
    let rest = Number(flat);
    const codes = {};
    dims.forEach((dim, i) => {
      codes[dim] = positions[dim][Math.floor(rest / strides[i])];
      rest %= strides[i];
    });
    const year = Number(codes.time);
    if (!latest[codes.geo] || latest[codes.geo].year < year) {
      latest[codes.geo] = { year, value };
    }
  }
  return latest;
}

async function loadRegions() {
  console.log("Loading NUTS 2 regions and tourism nights…");
  const [boundaries, nights] = await Promise.all([
    cached("nuts2-boundaries.json", () => fetchJson(NUTS_BOUNDARIES, {}, { label: "GISCO" })),
    cached("tourism-nights.json", () => fetchJson(TOURISM_NIGHTS, {}, { label: "Eurostat" })),
  ]);
  const latest = latestByRegion(nights);

  const regions = boundaries.features.map((feature) => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    let west = 180, south = 90, east = -180, north = -90, area = 0;
    for (const polygon of polygons) {
      polygon.forEach((ring, index) => {
        area += (index === 0 ? 1 : -1) * ringArea(ring);
      });
      for (const [lon, lat] of polygon[0]) {
        west = Math.min(west, lon); east = Math.max(east, lon);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
    }
    const code = feature.properties.NUTS_ID;
    const tourism = latest[code];
    return {
      code,
      name: feature.properties.NAME_LATN,
      polygons,
      box: [west, south, east, north],
      nights: tourism?.value ?? null,
      year: tourism?.year ?? null,
      density: tourism ? tourism.value / area : null,
    };
  });
  console.log(`  ${regions.length} regions, ${Object.keys(latest).length} with tourism figures\n`);
  return regions;
}

function regionFor(lat, lon, regions) {
  for (const region of regions) {
    const [west, south, east, north] = region.box;
    if (lon < west || lon > east || lat < south || lat > north) continue;
    for (const polygon of region.polygons) {
      if (insideRing(lon, lat, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(lon, lat, hole))) {
        return region;
      }
    }
  }
  // Simplified coastlines leave some beaches just offshore: take the nearest
  // region within 25 km instead.
  let best = null;
  for (const region of regions) {
    const [west, south, east, north] = region.box;
    if (lon < west - 0.3 || lon > east + 0.3 || lat < south - 0.3 || lat > north + 0.3) continue;
    for (const polygon of region.polygons) {
      const distance = metersToRing(lat, lon, polygon[0]);
      if (distance < 25_000 && (!best || distance < best.distance)) best = { region, distance };
    }
  }
  return best?.region ?? null;
}

// --- OpenStreetMap ---------------------------------------------------------

function tilesFor(countries) {
  const tiles = new Map();
  for (const { beaches } of countries) {
    for (const beach of beaches) {
      const south = Math.floor(beach.lat / TILE_DEGREES) * TILE_DEGREES;
      const west = Math.floor(beach.lon / TILE_DEGREES) * TILE_DEGREES;
      tiles.set(`${south}_${west}`, { south, west });
    }
  }
  return [...tiles.values()];
}

/** Posts a query, treating Overpass's in-band timeouts as the failures they are. */
async function overpass(query, lane, label) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // Each lane keeps to one server, switching only after a failure.
    const endpoint = OVERPASS[((lane < 3 ? 0 : 1) + attempt) % OVERPASS.length];
    try {
      const payload = await fetchJson(
        endpoint,
        {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        { attempts: 1, label },
      );
      // A query that runs out of time still answers 200, with whatever it had
      // found so far and a remark saying so. Caching that would silently drop
      // beaches, so it counts as a failure.
      if (/runtime error|timed out|out of memory/i.test(payload.remark ?? "")) {
        throw new Error(`incomplete: ${payload.remark.slice(0, 80)}`);
      }
      return payload.elements;
    } catch (error) {
      lastError = error;
      if (String(error.message).startsWith("incomplete")) throw error;
      await sleep(Math.min(90_000, 10_000 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Keeps only what the matching needs, so the cache stays small. */
function slim(elements) {
  return elements.map((element) => {
    const tags = element.tags ?? {};
    const keep = {};
    for (const key of ["natural", "leisure", "amenity", "emergency", "surface", "supervised", "lifeguard", "wikidata", "wikimedia_commons", "image"]) {
      if (tags[key]) keep[key] = tags[key];
    }
    // Overpass gives outlines a bounding box but no centre, so the centre
    // comes from the box.
    const bounds = element.bounds;
    return {
      ref: `${element.type}/${element.id}`,
      lat: element.lat ?? element.center?.lat ?? (bounds && (bounds.minlat + bounds.maxlat) / 2),
      lon: element.lon ?? element.center?.lon ?? (bounds && (bounds.minlon + bounds.maxlon) / 2),
      box: bounds ? [bounds.minlat, bounds.minlon, bounds.maxlat, bounds.maxlon] : null,
      tags: keep,
    };
  });
}

/** Beach outlines in one tile: a plain tag lookup in a box, which is cheap. */
function fetchOutlines({ south, west }, lane) {
  const pad = 0.05;
  const bbox = [south - pad, west - pad, south + TILE_DEGREES + pad, west + TILE_DEGREES + pad].join(",");
  return overpass(
    `[out:json][timeout:180][bbox:${bbox}];
(
  nwr[natural=beach];
  nwr[leisure=bathing_place];
);
out tags bb;`,
    lane,
    `outlines ${south},${west}`,
  ).then(slim);
}

/**
 * Facilities around the outlines bathing waters actually matched, named by id.
 * Asking around every beach feature in a tile made the dense lake country of
 * central Europe run past Overpass's time limit; a batch that still does is
 * split in half and asked again.
 */
async function fetchFacilities(refs, lane, label) {
  const ids = { node: [], way: [], relation: [] };
  for (const ref of refs) {
    const [type, id] = ref.split("/");
    ids[type].push(id);
  }
  const sets = Object.entries(ids)
    .filter(([, list]) => list.length)
    .map(([type, list]) => `${type}(id:${list.join(",")});`)
    .join("");
  try {
    return slim(
      await overpass(
        `[out:json][timeout:180];
(${sets})->.matched;
(
  nwr(around.matched:${FACILITY_METERS})[amenity~"^(cafe|restaurant|bar|fast_food|ice_cream|toilets|shower|parking|drinking_water)$"];
  nwr(around.matched:${FACILITY_METERS})[emergency~"^lifeguard"];
);
out tags center;`,
        lane,
        label,
      ),
    );
  } catch (error) {
    if (refs.length <= 1 || !String(error.message).startsWith("incomplete")) throw error;
    const half = Math.ceil(refs.length / 2);
    console.warn(`  ${label}: timed out, splitting ${refs.length} outlines in two`);
    return [
      ...(await fetchFacilities(refs.slice(0, half), lane, `${label}a`)),
      ...(await fetchFacilities(refs.slice(half), lane, `${label}b`)),
    ];
  }
}

class Grid {
  constructor(cell) {
    this.cell = cell;
    this.buckets = new Map();
  }
  key(lat, lon) {
    return `${Math.floor(lat / this.cell)},${Math.floor(lon / this.cell)}`;
  }
  add(item, box) {
    const [south, west, north, east] = box;
    for (let y = Math.floor(south / this.cell); y <= Math.floor(north / this.cell); y += 1) {
      for (let x = Math.floor(west / this.cell); x <= Math.floor(east / this.cell); x += 1) {
        const key = `${y},${x}`;
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(item);
      }
    }
  }
  near(lat, lon) {
    const y = Math.floor(lat / this.cell);
    const x = Math.floor(lon / this.cell);
    const found = new Set();
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const item of this.buckets.get(`${y + dy},${x + dx}`) ?? []) found.add(item);
      }
    }
    return found;
  }
}

function metersToBox(lat, lon, box) {
  const [south, west, north, east] = box;
  const clampedLat = Math.max(south, Math.min(north, lat));
  const clampedLon = Math.max(west, Math.min(east, lon));
  return metersBetween(lat, lon, clampedLat, clampedLon);
}

function surfaceOf(tags) {
  if (!tags.surface) return null;
  const kinds = [...new Set(tags.surface.split(";").map((value) => SURFACES[value.trim()]).filter(Boolean))];
  if (kinds.length === 0) return null;
  return kinds.slice(0, 2).join(" and ");
}

function commonsFileFromTags(tags) {
  const commons = tags.wikimedia_commons ?? "";
  if (/^File:/i.test(commons)) return commons.replace(/^File:/i, "");
  const image = tags.image ?? "";
  const match = image.match(/commons\.wikimedia\.org\/wiki\/File:([^?#]+)/i);
  return match ? decodeURIComponent(match[1]).replace(/_/g, " ") : null;
}

/** The OSM beach outline each bathing water sits on, when there is one. */
function matchOutlines(beaches, outlines) {
  const outlineOf = new Map();
  for (const beach of beaches) {
    let outline = null;
    let bestScore = Infinity;
    for (const candidate of outlines.near(beach.lat, beach.lon)) {
      const toBox = candidate.box ? metersToBox(beach.lat, beach.lon, candidate.box) : Infinity;
      const toCentre = metersBetween(beach.lat, beach.lon, candidate.lat, candidate.lon);
      if (toBox > OUTLINE_MATCH_METERS && toCentre > CENTRE_MATCH_METERS) continue;
      const score = Math.min(toBox, toCentre) + toCentre / 1000;
      if (score < bestScore) {
        bestScore = score;
        outline = candidate;
      }
    }
    if (outline) outlineOf.set(beach.id, outline);
  }
  return outlineOf;
}

// --- Depth -----------------------------------------------------------------

/**
 * A straight depth profile through the beach, split into its two halves, each
 * running outwards from the beach. EMODnet reads only a line's two ends, so a
 * path with corners comes back flat; each direction pair costs a request.
 */
async function profileThrough(beach, axis) {
  const reach = (DEPTH_OUT_METERS * 2) / 111320;
  const wide = reach / Math.cos((beach.lat * Math.PI) / 180);
  const [from, to] =
    axis === "NS"
      ? [[beach.lon, beach.lat + reach], [beach.lon, beach.lat - reach]]
      : [[beach.lon - wide, beach.lat], [beach.lon + wide, beach.lat]];
  const geom = `LINESTRING(${from[0].toFixed(5)} ${from[1].toFixed(5)},${to[0].toFixed(5)} ${to[1].toFixed(5)})`;
  const values = await emodnetGet(
    `${EMODNET_PROFILE}?${new URLSearchParams({ geom })}`,
    `EMODnet ${beach.id}`,
  );
  const middle = Math.floor(values.length / 2);
  return [values.slice(0, middle).reverse(), values.slice(middle)];
}

/**
 * Metres of water 500 m out, in whichever direction from the beach is sea, or
 * null when the model shows none. A direction counts as sea when it is at
 * least 2 m deep a kilometre out; then its 500 m reading is kept however
 * shallow, because "barely waist deep 500 m out" is the answer a flat sandy
 * coast should get, not a blank. A beach runs along its shore, so when its
 * OSM outline is clearly longer one way, only the line across it is asked for.
 */
async function depthOffshore(beach, outline) {
  let axes = ["NS", "EW"];
  if (outline?.box) {
    const [south, west, north, east] = outline.box;
    const tall = metersBetween(south, west, north, west);
    const wide = metersBetween(south, west, south, east);
    if (wide > tall * 1.5) axes = ["NS"];
    else if (tall > wide * 1.5) axes = ["EW"];
  }
  let deepest = null;
  for (const axis of axes) {
    for (const side of await profileThrough(beach, axis)) {
      // EMODnet gives height, so the sea is negative.
      const farOut = -side[side.length - 1];
      if (farOut < 2) continue;
      const depth = Math.max(0, -side[Math.floor(side.length / 2)]);
      if (deepest === null || depth > deepest) deepest = depth;
    }
  }
  return deepest === null ? null : Math.round(deepest);
}

/** Depth readings for every coastal beach, one cache file per country. */
async function measureDepths(countries, outlineOf) {
  const all = {};
  for (const { code, beaches } of countries) {
    const cacheName = `emodnet/${code}.json`;
    const known = await cached(cacheName, async () => ({}));
    // The bathymetry is of the sea; lakes have none.
    const pending = beaches.filter((beach) => !beach.lake && !(beach.id in known));
    let sinceSave = 0;
    await pool(pending, EMODNET_CONCURRENCY, async (beach) => {
      try {
        known[beach.id] = await depthOffshore(beach, outlineOf.get(beach.id));
      } catch (error) {
        console.warn(`  ${beach.id}: ${error.message}`);
        return;
      }
      sinceSave += 1;
      if (sinceSave >= 300) {
        sinceSave = 0;
        await writeFile(new URL(cacheName, CACHE_DIR), JSON.stringify(known));
      }
    });
    await writeFile(new URL(cacheName, CACHE_DIR), JSON.stringify(known));
    const measured = beaches.filter((beach) => known[beach.id] != null).length;
    console.log(`  depth ${code}: ${pending.length} measured, ${measured} of ${beaches.length} with a reading`);
    Object.assign(all, known);
  }
  return all;
}

// --- Photos ----------------------------------------------------------------

function stripHtml(html = "") {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Author and licence, or null when the file is not a usable free photo. */
function usablePhoto(page) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? "")) return null;
  if ((info.width ?? 0) < 400) return null;
  const license = stripHtml(info.extmetadata?.LicenseShortName?.value);
  if (!FREE_LICENSE.test(license)) return null;
  const author = stripHtml(info.extmetadata?.Artist?.value) || "Unknown author";
  return {
    file: page.title.replace(/^File:/, ""),
    author: author.length > 60 ? `${author.slice(0, 57)}…` : author,
    license,
  };
}

/**
 * Author and licence for Commons files, [author, license] or null when a file
 * is not a usable free photo. Fifty to a request, and kept in one cache file,
 * so a rerun only asks about files it has not seen.
 */
async function describeFiles(files) {
  const cacheFile = new URL("commons-files.json", CACHE_DIR);
  let known = {};
  try {
    known = JSON.parse(await readFile(cacheFile, "utf8"));
  } catch {}
  const pending = [...new Set(files)].filter((file) => !(file in known));
  const batches = [];
  for (let i = 0; i < pending.length; i += 50) batches.push(pending.slice(i, i + 50));
  let sinceSave = 0;
  await pool(batches, COMMONS_CONCURRENCY, async (batch) => {
    let payload;
    try {
      payload = await commonsJson(
        {
          action: "query",
          titles: batch.map((file) => `File:${file}`).join("|"),
          prop: "imageinfo",
          iiprop: "extmetadata|size|mime",
          iiextmetadatafilter: "Artist|LicenseShortName",
        },
        "Commons file info",
      );
    } catch (error) {
      // Left out of the cache, so a rerun asks about these files again.
      console.warn(`  Commons file info: batch skipped, ${error.message}`);
      return;
    }
    const asked = new Map(
      (payload.query?.normalized ?? []).map(({ from, to }) => [to, from]),
    );
    for (const file of batch) known[file] = null;
    for (const page of Object.values(payload.query?.pages ?? {})) {
      const file = (asked.get(page.title) ?? page.title).replace(/^File:/, "");
      const photo = usablePhoto(page);
      known[file] = photo ? [photo.author, photo.license] : null;
    }
    sinceSave += 1;
    if (sinceSave >= 20) {
      sinceSave = 0;
      await writeFile(cacheFile, JSON.stringify(known));
    }
  });
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(known));
  return known;
}

async function wikidataImages(ids) {
  const images = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const payload = await fetchJson(
      `${WIKIDATA_API}?${new URLSearchParams({
        action: "wbgetentities",
        ids: ids.slice(i, i + 50).join("|"),
        props: "claims",
        format: "json",
        maxlag: "5",
      })}`,
      {},
      { label: "Wikidata" },
    );
    for (const [id, entity] of Object.entries(payload.entities ?? {})) {
      const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file) images.set(id, file);
    }
  }
  return images;
}

function nameTokens(beach) {
  const generic = new Set(PLACE_WORDS);
  return [beach.name, beach.a ?? ""]
    .flatMap((name) => fold(name).split(/[^\p{L}]+/u))
    .filter((token) => token.length >= 4 && !generic.has(token));
}

/**
 * The three best nearby Commons files for a beach, best first. This asks only
 * for what ranking needs; licences are looked up afterwards for the few files
 * that made a shortlist, because fetching them for every nearby file is what
 * makes the search slow.
 */
async function searchCandidates(beach) {
  const payload = await commonsJson(
    {
      action: "query",
      generator: "geosearch",
      ggscoord: `${beach.lat}|${beach.lon}`,
      ggsradius: String(PHOTO_SEARCH_METERS),
      ggslimit: "20",
      ggsnamespace: "6",
      prop: "imageinfo|categories|coordinates",
      iiprop: "size|mime",
      cllimit: "max",
      clshow: "!hidden",
    },
    `Commons near ${beach.id}`,
  );
  const tokens = nameTokens(beach);
  const ranked = [];
  for (const page of Object.values(payload.query?.pages ?? {})) {
    if (NOT_A_PHOTO.test(page.title)) continue;
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? "") || (info.width ?? 0) < 400) continue;
    const words = fold(
      [page.title, ...(page.categories ?? []).map((category) => category.title)].join(" "),
    ).split(/[^\p{L}\d]+/u);
    let score = 0;
    if (words.some((word) => PLACE_WORDS.includes(word))) score += 3;
    if (tokens.some((token) => words.includes(token))) score += 2;
    const coords = page.coordinates?.[0];
    const distance = coords ? metersBetween(beach.lat, beach.lon, coords.lat, coords.lon) : PHOTO_SEARCH_METERS;
    if (distance < 200) score += 1;
    if (score >= 3) ranked.push({ score, distance, file: page.title.replace(/^File:/, "") });
  }
  ranked.sort((a, b) => b.score - a.score || a.distance - b.distance);
  return ranked.slice(0, 3).map((candidate) => candidate.file);
}

/** Shortlists for every beach, one cache file per country. */
async function searchAllCandidates(countries) {
  const all = {};
  for (const { code, beaches } of countries) {
    const cacheName = `commons-candidates/${code}.json`;
    const known = await cached(cacheName, async () => ({}));
    const pending = beaches.filter((beach) => !(beach.id in known));
    let sinceSave = 0;
    await pool(pending, COMMONS_CONCURRENCY, async (beach) => {
      try {
        known[beach.id] = await searchCandidates(beach);
      } catch (error) {
        console.warn(`  ${beach.id}: ${error.message}`);
        return;
      }
      sinceSave += 1;
      if (sinceSave >= 200) {
        sinceSave = 0;
        await writeFile(new URL(cacheName, CACHE_DIR), JSON.stringify(known));
      }
    });
    await writeFile(new URL(cacheName, CACHE_DIR), JSON.stringify(known));
    const shortlisted = beaches.filter((beach) => known[beach.id]?.length).length;
    console.log(`  photos ${code}: ${pending.length} searched, ${shortlisted} of ${beaches.length} with candidates`);
    Object.assign(all, known);
  }
  return all;
}

// --- Run -------------------------------------------------------------------

const countries = await loadCatalogue();
const allBeaches = countries.flatMap(({ code, beaches }) => beaches.map((beach) => ({ ...beach, code })));
console.log(`${allBeaches.length} beaches in ${countries.length} countries\n`);

// Tourism: each beach's region, then tiers by quartile across all beaches.
const regions = await loadRegions();
const regionOf = new Map();
for (const beach of allBeaches) {
  const region = regionFor(beach.lat, beach.lon, regions);
  if (region?.density != null) regionOf.set(beach.id, region);
}
const densities = [...regionOf.values()].map((region) => region.density).sort((a, b) => a - b);
const quartile = (q) => densities[Math.floor((densities.length - 1) * q)];
const cuts = [quartile(0.25), quartile(0.5), quartile(0.75)];
const tierOf = (density) => 1 + cuts.filter((cut) => density > cut).length;
console.log(`  ${regionOf.size} beaches placed in a region with tourism figures`);
console.log(`  tier cuts (nights per km²): ${cuts.map((cut) => Math.round(cut)).join(", ")}\n`);

// The Commons search does not depend on OpenStreetMap, so it runs alongside.
console.log("Searching Commons for nearby photos, alongside OpenStreetMap…");
const candidateSearch = searchAllCandidates(countries);

// OpenStreetMap, in two passes over the same tiles: outlines, then facilities
// around the outlines that matched.
const tiles = tilesFor(countries);
const tileKey = (tile) => `${tile.south}_${tile.west}`;
const tileOfBeach = (beach) =>
  `${Math.floor(beach.lat / TILE_DEGREES) * TILE_DEGREES}_${Math.floor(beach.lon / TILE_DEGREES) * TILE_DEGREES}`;

async function overTiles(label, work) {
  let done = 0;
  let nextLane = 0;
  const skipped = [];
  await pool(tiles, OVERPASS_LANES, async (tile) => {
    const lane = nextLane++ % OVERPASS_LANES;
    const started = Date.now();
    try {
      await work(tile, lane);
    } catch (error) {
      // One tile the servers will not answer should not throw away the rest
      // of the run. It stays uncached, so the next run asks for it again.
      skipped.push(tileKey(tile));
      console.warn(`  ${label} ${tileKey(tile)} skipped: ${error.message}`);
    }
    done += 1;
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds > 5 || done % 25 === 0 || done === tiles.length) {
      console.log(`  ${label} ${done}/${tiles.length} tiles (${tileKey(tile)} took ${seconds}s)`);
    }
  });
  if (skipped.length) {
    console.warn(`  ${label}: ${skipped.length} tiles skipped (${skipped.join(" ")}); run again to fill them in`);
  }
}

console.log(`Fetching OpenStreetMap beach outlines in ${tiles.length} tiles…`);
const outlines = new Grid(0.02);
const seenOutlines = new Set();
await overTiles("outlines", async (tile, lane) => {
  const elements = await cached(`overpass-outlines/${tileKey(tile)}.json`, () => fetchOutlines(tile, lane));
  for (const element of elements) {
    if (element.lat == null || seenOutlines.has(element.ref)) continue;
    seenOutlines.add(element.ref);
    outlines.add(element, element.box ?? [element.lat, element.lon, element.lat, element.lon]);
  }
});

const details = new Map();
const outlineOf = matchOutlines(allBeaches, outlines);
const matchedRefsByTile = new Map();
for (const beach of allBeaches) {
  const outline = outlineOf.get(beach.id);
  if (!outline) continue;
  const key = tileOfBeach(beach);
  if (!matchedRefsByTile.has(key)) matchedRefsByTile.set(key, new Set());
  matchedRefsByTile.get(key).add(outline.ref);
}
console.log(`  ${outlineOf.size} of ${allBeaches.length} beaches matched to an OSM beach outline\n`);

// Depth needs the outlines but nothing after them, so it runs alongside.
console.log("Measuring depth off coastal beaches, alongside the rest…");
const depthSearch = measureDepths(countries, outlineOf);

console.log("Fetching facilities around the matched outlines…");
const facilities = new Grid(0.01);
const seenFacilities = new Set();
await overTiles("facilities", async (tile, lane) => {
  const refs = [...(matchedRefsByTile.get(tileKey(tile)) ?? [])].sort();
  if (refs.length === 0) return;
  const elements = await cached(`overpass-facilities/${tileKey(tile)}.json`, () =>
    fetchFacilities(refs, lane, `facilities ${tileKey(tile)}`),
  );
  for (const element of elements) {
    if (element.lat == null || seenFacilities.has(element.ref)) continue;
    seenFacilities.add(element.ref);
    facilities.add(element, [element.lat, element.lon, element.lat, element.lon]);
  }
});
console.log("");

const wikidataWanted = new Map();
for (const beach of allBeaches) {
  const entry = {};
  const codes = new Set();
  const outline = outlineOf.get(beach.id);
  if (outline) {
    const surface = surfaceOf(outline.tags);
    if (surface) entry.s = surface;
    if (outline.tags.supervised === "yes" || outline.tags.lifeguard === "yes") codes.add("L");
    const file = commonsFileFromTags(outline.tags);
    if (file) entry.photoFile = file;
    else if (/^Q\d+$/.test(outline.tags.wikidata ?? "")) wikidataWanted.set(beach.id, outline.tags.wikidata);
  }
  for (const facility of facilities.near(beach.lat, beach.lon)) {
    if (metersBetween(beach.lat, beach.lon, facility.lat, facility.lon) > FACILITY_METERS) continue;
    for (const [code, test] of FACILITY_CODES) if (test(facility.tags)) codes.add(code);
  }
  const ordered = FACILITY_CODES.map(([code]) => code).filter((code) => codes.has(code)).join("");
  if (ordered) entry.f = ordered;
  const region = regionOf.get(beach.id);
  if (region) entry.r = region.code;
  details.set(beach.id, entry);
}

// Photos: the one the OSM outline points at, directly or through Wikidata,
// else the best nearby candidate with a free licence.
console.log(`Looking up Wikidata images for ${wikidataWanted.size} linked beaches…`);
const wikidataFiles = await cached("wikidata-images.json", async () =>
  Object.fromEntries(await wikidataImages([...new Set(wikidataWanted.values())])),
);
for (const [beachId, qid] of wikidataWanted) {
  if (wikidataFiles[qid]) details.get(beachId).photoFile = wikidataFiles[qid];
}

const candidates = await candidateSearch;
console.log("Checking licences for the shortlisted photos…");
const fileInfo = await describeFiles([
  ...[...details.values()].map((entry) => entry.photoFile).filter(Boolean),
  ...Object.values(candidates).flat(),
]);

let curatedCount = 0;
let nearbyCount = 0;
for (const beach of allBeaches) {
  const entry = details.get(beach.id);
  const curatedFile = entry.photoFile;
  delete entry.photoFile;
  // Authors often end in a stray full stop, which reads badly before the
  // licence that follows it on the card.
  const credit = (file) => {
    const [author, license] = fileInfo[file];
    return [file, author.replace(/[\s.,;:]+$/, ""), license];
  };
  if (curatedFile && fileInfo[curatedFile]) {
    entry.p = credit(curatedFile);
    curatedCount += 1;
    continue;
  }
  const nearby = (candidates[beach.id] ?? []).find((file) => fileInfo[file]);
  if (nearby) {
    entry.p = credit(nearby);
    nearbyCount += 1;
  }
}
console.log(`  ${curatedCount} photos of the right place, ${nearbyCount} nearby\n`);

const depths = await depthSearch;
for (const beach of allBeaches) {
  if (depths[beach.id] != null) details.get(beach.id).d = depths[beach.id];
}

// One file per country.
await mkdir(OUT_DIR, { recursive: true });
const counts = { surface: 0, facilities: 0, photo: 0, region: 0, depth: 0 };
for (const { code, beaches } of countries) {
  const fileRegions = {};
  const fileBeaches = {};
  for (const beach of beaches) {
    const entry = details.get(beach.id);
    if (Object.keys(entry).length === 0) continue;
    fileBeaches[beach.id] = entry;
    if (entry.s) counts.surface += 1;
    if (entry.f) counts.facilities += 1;
    if (entry.p) counts.photo += 1;
    if (entry.d != null) counts.depth += 1;
    if (entry.r) {
      counts.region += 1;
      const region = regionOf.get(beach.id);
      fileRegions[region.code] = [
        region.name,
        Math.round(region.nights),
        region.year,
        Math.round(region.density),
        tierOf(region.density),
      ];
    }
  }
  await writeFile(
    new URL(`${code}.json`, OUT_DIR),
    JSON.stringify({ regions: fileRegions, beaches: fileBeaches }),
  );
}
const share = (count) => `${count} (${Math.round((count / allBeaches.length) * 100)}%)`;
console.log("Wrote public/data/details");
console.log(`  sand or pebbles known: ${share(counts.surface)}`);
console.log(`  facilities nearby:     ${share(counts.facilities)}`);
console.log(`  photo:                 ${share(counts.photo)}`);
console.log(`  touristy tier:         ${share(counts.region)}`);
console.log(`  depth offshore:        ${share(counts.depth)}`);
