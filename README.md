# Beaches

A map of every bathing water Europe monitors, 26,199 of them across 31
countries, each coloured by the rating it got that summer.

Live at https://beaches.themos.dev

## What you can do with it

Zoomed out, beaches gather into blobs coloured by how many of them are rated
Excellent. Click one and the map dives into it while it bursts, every beach it
stood for flying out to its own spot, and the beaches around them fade in as
you get close. The legend counts only what is on screen, so it changes as you
pan.

The map underneath is labelled in English everywhere, with names in other
alphabets spelled out in Latin letters, and without the icons for shops, peaks
and bus stops that are easy to mistake for a beach. It follows your system's
light or dark setting, and the button in the top right corner switches it and
remembers the choice.

Drag the timeline back to 1990, or press play and watch 36 seasons run past in
about fifteen seconds. Central Europe goes from orange to green.

Open the rankings for the season on screen and you get the countries in order,
with coast and inland counted separately, because inland water runs worse
everywhere and blending the two mostly ranks what a country bothers to
monitor. Pick a country and the map narrows to it, and the Rankings button
becomes Show all countries. Use it, or zoom out far enough or pan away, and you
get Europe back.

Click a beach for its card: the rating for every season it was sampled, and
what it is like now. On the coast that means the sea temperature and wave
height today, and waves roll past the dot at the real swell's size, rhythm and
direction. Where the sources know, the card also has a photo, sand or pebbles,
and a row of icons for what is within a short walk: a lifeguard, food,
toilets, showers, parking and drinking water. Hover one for its name. The
photo's author and licence are at the bottom of the card, and every other
source is credited in the corner of the map. Click anywhere on the map to put the card
away.

Search takes the local name or a Latin one. Type vouliagmeni or
"βουλιαγμένη", byala or "бяла".

## Where the numbers come from

The European Environment Agency. The 27 EU countries plus Albania and
Switzerland sample their bathing waters through the summer and report them
under the Bathing Water Directive, and the two that have since stopped, the
United Kingdom and Montenegro, are still here for the years they did. The map
shows the class each water was given: Excellent, Good, Sufficient or Poor. A
water with nothing reported for the season you are looking at is left off,
rather than drawn in a colour that means nothing.

The current season fills in as samples come back over the summer. The finished
one lands each June.

The rest of a beach's card comes from elsewhere, gathered by
`pnpm sync:details` now and then rather than on every build. Sand or pebbles,
a lifeguard and what is within a short walk come from OpenStreetMap. The photo
is the one Wikidata holds for the beach when OpenStreetMap links to it, and
otherwise the best free-licensed photo on Wikimedia Commons taken nearby. Sea
temperature and waves are live, from Open-Meteo.

The map is OpenFreeMap's Liberty style, or its dark style at night, vector tiles built from OpenStreetMap
by OpenMapTiles, drawn with MapLibre inside Leaflet.

## APIs

All of them are open and need no key.

| What | API | When |
| --- | --- | --- |
| Ratings up to 2024, coordinates | EEA discodata SQL, `discodata.eea.europa.eu/sql` (WISE Bathing Water Directive database) | `pnpm sync:beaches` |
| Ratings for the current season | EEA ArcGIS layer, `water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater` | `pnpm sync:beaches` |
| Sand, lifeguard, facilities nearby | OpenStreetMap through Overpass (`maps.mail.ru`, `overpass.private.coffee`, `overpass-api.de` as the fallback) | `pnpm sync:details` |
| Photo linked from OpenStreetMap | Wikidata API, `www.wikidata.org/w/api.php` | `pnpm sync:details` |
| Photo taken nearby | Wikimedia Commons API, `commons.wikimedia.org/w/api.php` | `pnpm sync:details` |
| Sea temperature and waves | Open-Meteo Marine, `marine-api.open-meteo.com/v1/marine` | live, when a coastal card opens |
| Photo thumbnails | Wikimedia Commons `Special:FilePath` | live |
| Basemap | OpenFreeMap, `tiles.openfreemap.org/styles/liberty` and `styles/dark` | live |
