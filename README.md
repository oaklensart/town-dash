# Town Dash

A live dot-matrix civic status board for a town or region, running on Cloudflare Workers.

Built from the engine behind [oaklens.art/town](https://oaklens.art/town). Everything is drawn on a true 5×7 LED dot-matrix grid (`js/dotmatrix.js` + `css/dotmatrix.css`) and backed by a single edge endpoint (`/api/city`) that caches each public feed at its own cadence and never lets a stale reading drive the top-of-board verdict.

---

## Why This Is a Developer Kit (Not a One-Click Toy)

Real civic feeds are messy. Transit APIs leave ghost trains on the board at 3 a.m., freeway signs broadcast `SIGN TEST ABCDEFG`, and rain gauges reset on October 1st. If someone stands up a town board without reading the feeds and maintaining the rules, they publish bad local information when neighbors actually need it.

This repo is intentionally set up for a developer who lives in (or cares about) a place:
1. You configure your town in **[`board.config.js`](board.config.js)**.
2. National feeds (Weather, Air Quality, Sunrise/Golden Hour, NWS Alerts, USGS Quakes, FAA Airport Status, NOAA Tides, USGS Creeks & Rain) come alive immediately from your coordinates and station IDs — **zero API keys required**.
3. For regional transit, crossings, and highway signs, you either enable the built-in California / Bay Area parsers or wire a 25-line adapter in **[`src/adapters/examples.js`](src/adapters/examples.js)** and test it against real captured payloads with `npm test`.

---

## Quick Start

```bash
npm install
npm test
npx wrangler dev
```

Open `http://localhost:8787` to see the board and `http://localhost:8787/sources/` to see the live self-documenting citation page.

When your tests pass and your feeds look right:

```bash
npx wrangler deploy
```

---

## What Works Out of the Box vs. What You Wire

| Section | Pipe key | Out of the box (US / Global) | Built-in CA / Bay Area | Custom (`pipes.<key>`) |
| :--- | :--- | :--- | :--- | :--- |
| **Sky, Wind, Barometer, Light** | `sky` | Open-Meteo (any `coords`) | — | Override via `pipes.sky` |
| **Air Quality (US AQI)** | `air` | Open-Meteo Air Quality (any `coords`) | — | Override via `pipes.air` |
| **Weather & Flood Advisories** | `alerts` | National Weather Service (any US `coords`) | — | Override via `pipes.alerts` |
| **Airport Status** | `airport` | FAA NAS Status (any 3-letter US IATA code) | — | Override via `pipes.airport` |
| **Tides & Storm Surge** | `tide` | NOAA CO-OPS (any 7-digit station ID) | — | Override via `pipes.tide` |
| **Earthquakes** | `quakes` | USGS 200 km radius (any `coords`) | — | Override via `pipes.quakes` |
| **El Niño / La Niña** | `elnino` | NOAA CPC monthly bulletin | — | Override via `pipes.elnino` |
| **Rain & Creek Gauges** | `gauges` | **USGS Water Services** (`usgs: '<siteId>'`) | **CA DWR CDEC** (`station`, `sensor`) | Override via `pipes.gauges` |
| **Freeway Signs** | `signs` | — | **Caltrans CWWP2** (`district`, `routes`, `box`) | `customSignsPipe()` in `src/adapters/examples.js` |
| **Bridge / Crossing** | `bridge` | — | **Caltrans Closures + 511 CHP** | `customCrossingPipe()` in `src/adapters/examples.js` |
| **Rail / Transit** | `bart` | — | **BART ETD + Advisories + Transfers** | `customTransitPipe()` in `src/adapters/examples.js` |

---

## Wiring a Custom Feed ("Blank Pipe")

Every feed on the board is a pipe in `src/api/city.js`. To replace BART with Caltrain, Muni, MTA, CTA, or Sound Transit — or to wire a local bridge or DOT sign feed — add a pipe to `pipes` in `board.config.js`:

```js
import { customTransitPipe, customCrossingPipe } from './src/adapters/examples.js';

export const BOARD = {
  name: 'SAN MATEO',
  timezone: 'America/Los_Angeles',
  coords: [37.5630, -122.3255],
  airport: 'SFO',
  tide: '9414523',
  pipes: {
    bart: customTransitPipe({
      agency: 'CALTRAIN',
      url: 'https://your-gtfs-rt-proxy.example/caltrain.json',
      page: 'https://www.caltrain.com/status',
    }),
    bridge: customCrossingPipe({
      label: 'SAN MATEO BRIDGE',
      toLabel: 'TO EAST BAY',
      url: 'https://your-corridor-feed.example/sr92.json',
      page: 'https://quickmap.dot.ca.gov/',
    }),
  },
};
```

Any pipe you add automatically:
- Participates in edge caching (`ttl`) and staleness protection (`stale`) so a dead upstream never raises a false alarm on the verdict banner.
- Appears on `/sources/` with its `cite` metadata so neighbors can inspect every raw feed the board reads.

---

## Testing Against Real Captures

Before deploying a new parser, curl a real response from your agency's API and add a unit test in [`tests/city.test.js`](tests/city.test.js):

```bash
npm test
```

---

## License

MIT — see [`LICENSE`](LICENSE).
