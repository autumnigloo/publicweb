# Venice on Location

An interactive map of Venice filming locations — 39 places, 15 films, 1955–2019.

The map has a point of view: it marks the places where the film **cheats**. Hollow
gold pins are buildings that stand in for somewhere else on screen, and "Where the
film cheats" filters down to just those. Some of the better ones:

- **The Tourist** — Depp and Jolie check into the Hotel Danieli, but the entrance,
  the pier and the rooms are Palazzo Pisani Moretta, a mile west across the city.
  The room's view of the Rialto exists from neither building.
- **Don't Look Now** — the Baxters' hotel is the Gabrielli from the outside and the
  Bauer from the inside, twenty minutes' walk apart.
- **Indiana Jones and the Last Crusade** — the library exterior is the church of San
  Barnaba, its interior is the Scuola Grande di San Rocco, and the boat chase is
  Tilbury Docks in Essex. The unit was in Venice for one day.
- **Casino Royale** — the sinking house is on the canal at Campiello del Remer. The
  real building is in no danger; the collapse was built at Pinewood.

## How it works

A single self-contained `index.html`: [Leaflet](https://leafletjs.com) from a CDN,
live tiles from OpenStreetMap, and the location data inline at the top of the
script. No build step and no dependencies to install — edit the `DATA` object and
reload.

Pins are **sized by how many films used the place**, so Piazza San Marco reads as
the hub it is. There is deliberately no colour-per-film: fifteen categories cannot
be told apart reliably by colour, so gold is reserved for whichever film is
selected, and everything else stays in ink.

The OSM tiles are run through a CSS filter to settle them into the page's palette,
and a second filter inverts them for dark mode. An earlier attempt used full
`grayscale()`, which looked elegant and was wrong: it erased the Grand Canal. In
Venice the water is the information, so the filters desaturate but keep the water's
hue.

## Tiles

Tiles come from `tile.openstreetmap.org` under the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/), which
suits a small personal site but not a busy one. If this ever gets real traffic,
point the `L.tileLayer` URL at a keyed provider instead — nothing else needs to
change. Attribution is required either way and is shown on the map.

Map tiles and data © OpenStreetMap contributors, ODbL.

## Sourcing

Locations were checked against published location guides — the BFI,
movie-locations.com, and the Bond location databases — rather than recalled, and
the coordinates come from Nominatim lookups of the named buildings rather than
estimates. A few entries are deliberately coarse where the sources only name a
neighbourhood.
