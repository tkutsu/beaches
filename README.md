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
how deep the water is 500 m out, whether there is a lifeguard, food, toilets,
showers or parking within a short walk, and how touristy the area is. Click
anywhere on the map to put it away.

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
otherwise the best free-licensed photo on Wikimedia Commons taken nearby. How
touristy an area is comes from Eurostat: nights spent in tourist accommodation
per square kilometre of the region, split into quarters across every bathing
water on the map. Depth is EMODnet's bathymetry, read 500 m out from the beach
in whichever direction is sea; its grid is too coarse for the first few metres
off the sand, so it tells a shelf from a drop-off rather than where you stop
standing. Sea temperature and waves are live, from Open-Meteo.
