# Big Island Events

Event feed and calendar for the whole of Hawaiʻi Island, in two groups.
**Kona & Kohala:** KBXtreme's concert lot on Palani Road, the Aloha Theatre in
Kainaliu, the Kona Coffee Cultural Festival's ten November days, the ranger
programmes at Puʻuhonua o Hōnaunau and Kaloko-Honokōhau, the Waikoloa resorts
(the Waikoloa Bowl, the Hilton Waikoloa Village, Queens' MarketPlace, the
Kings' Shops), Puʻukoholā Heiau at Kawaihae and the Kahilu Theatre in Waimea.
**Hilo, Volcano & Hāmākua:** the Palace Theater, UH Hilo's Performing Arts
Center, the Afook-Chinen Civic Auditorium, the Merrie Monarch Festival, the
Crown Room at the Grand Naniloa, ʻImiloa Astronomy Center, the Vulcans' own
grounds, Hawaiʻi Volcanoes National Park, the Volcano Art Center and the
Honokaʻa People's Theatre — and the University of Hawaiʻi's Rainbow Warriors
(football, basketball) and Rainbow Wahine volleyball in a Teams view.

Published at **https://bigisland.here.events/** (GitHub Pages, built by the
Actions workflow once a day at noon Hawaiʻi time). kona.here.events and
hilo.here.events, the two one-day sites this one merged (2026-10-25), send
their readers here.

Built 2026-10-25 on the family's city pattern: the Hilo site's tree with the
Kona site's rooms and parsers merged in. Everything that makes this the Big
Island's is `site/city.js` (every team, venue, type, default, share-code
registry, holiday and string), `site/index.html`, `scripts/fetch-events.mjs`
(its source list and six parsers of its own), `site/embed.js`, `outlook.json`,
`scripts/data/postseason.json`, `channels.json`, the manifest and icons.
Everything else — `app.js`, `filter.js`, `styles.css` bar its `--v-*` hue
lines, the shared `scripts/*.mjs` and their tests — is lqa-events' own, byte
for byte, copied in by `sync-shared.sh` from the lqa-events project.

## Sources

- **Ticketmaster Discovery API** — the rooms Ticketmaster lists here, each by
  its venue id (every page; KBXtreme, the Hilton, the Kahilu and the PAC read
  two ids apiece). Parking, suites, tours, VIP upgrades and season bundles are
  dropped per room (`tm.exclude`). Church events are left out (`isChurch`).
  For the Kahilu, the Palace and the PAC it is a secondary source that fills
  only the dates their own calendars lack (`tm.secondary`).
- **Aloha Theatre** (Kainaliu) — the Aloha Performing Arts Company's Ludus box
  office (`scripts/feeds.mjs` kind `ludus`, fetched through
  `scripts/cffi-fetch.py` because Ludus's edge refuses Node).
- **Kahilu Theatre** (Waimea) — its own season page (kind `cards`; the page
  prints no clocks, so the clash check with Ticketmaster is by date).
- **Queens' MarketPlace** (Waikoloa) — its Events Calendar REST feed (kind
  `tribe`; the lessons, run clubs and markets dropped).
- **Kings' Shops** (Waikoloa) — its EyeOn calendar: the page's nonce, then the
  plugin's admin-ajax events call, recurrences expanded from each item's
  RRULE (`fetch-events.mjs` `kingsShops`).
- **Kona Coffee Cultural Festival** — its calendar page, one row per event per
  day (`parseKccf`); a festival venue, so its days are one series.
- **Palace Theater** (Hilo) — its Events Calendar REST feed (kind `tribe`;
  classes, rentals and the holiday-closure notices dropped).
- **UH Hilo Performing Arts Center** — its eight-month outlook page
  (`parsePacOutlook`).
- **Merrie Monarch Festival** — the programme page's prose, every dated
  mention an event (`parseMerrieMonarch`); a festival venue.
- **Hawaii Concert Society** — its season page, read as a secondary behind the
  PAC's outlook; its Crown Room concerts land on that room
  (`parseConcertSociety`).
- **ʻImiloa Astronomy Center** — its Squarespace collection (kind `squarespace`).
- **UH Hilo Vulcans** — the athletics department's season iCal (kind
  `icsfile`), the Hilo rows folded by alias to the Civic or the campus row.
- **Volcano Art Center** — its EventPrime month pages (`parseVacMonth`).
- **Honokaʻa People's Theatre** — its Now Playing page, each show's Eventbrite
  page read as schema.org (kind `linked`).
- **The national parks** — the NPS events API for Puʻuhonua o Hōnaunau
  (`puho`), Kaloko-Honokōhau (`kaho`), Puʻukoholā Heiau (`puhe`) and Hawaiʻi
  Volcanoes (`havo`) (kind `nps`).
- **Seasons** — ESPN for the Rainbow Warriors and Wahine (Teams view only:
  their grounds are on Oʻahu).

A row that arrives under a venue `city.js` does not name is dropped and
counted in the build log (there is no grounds venue here).

## Build

```
cp .env.example .env   # TICKETMASTER_API_KEY=… (a free Discovery key)
ALLOW_NO_ARCHIVE=1 node scripts/fetch-events.mjs   # writes site/events.json, the .ics feeds, teams.json
node --test scripts/*.test.mjs
python3 -m http.server 8000 --directory site
```

`ALLOW_NO_ARCHIVE=1` is only for the first build, before the `events-archive`
branch exists; in CI the workflow sets it as a repository variable until the
first run has pushed the archive, then it is deleted.

## Sister sites

lqa-events (Seattle Center) is the source of truth for the shared files. See
its README for the pipeline, the share codes and the Teams view.
