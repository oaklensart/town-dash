// ============================================================================
// Town Dash — Configuration
// ============================================================================
// Edit this file for your town or region, run `npm test`, then preview with
// `npx wrangler dev` or publish with `npx wrangler deploy`.
//
// Feeds work in three tiers:
//   1. National (US) — work automatically from `coords`, `airport`, `tide`,
//      and `gauges` with `usgs` site numbers. No API keys required:
//        • Weather, wind, barometer & golden hour (Open-Meteo)
//        • Air quality — US AQI (Open-Meteo)
//        • Active weather & flood advisories (National Weather Service)
//        • Earthquakes within 200 km (USGS)
//        • El Niño / La Niña bulletin (NOAA Climate Prediction Center)
//        • Airport ground stops & delays (FAA NAS Status)
//        • Tide chart & storm surge (NOAA CO-OPS)
//        • Creek stage & rain gauges (USGS Water Services)
//
//   2. California / Bay Area built-ins — turn on by setting config blocks:
//        • `signs`: Caltrans CWWP2 live changeable message signs
//        • `bridge`: Caltrans lane closures + 511 SF Bay CHP incidents
//        • `gauges` with `station`/`sensor`: California DWR CDEC gauges
//        • `bart`: BART real-time departures, advisories & timed transfers
//
//   3. Custom pipes (`pipes.*`) — plug in your own `{ load, cite, ttl, stale }`
//      adapter for any local transit system (Caltrain, Muni, MTA, CTA, Sound
//      Transit, GTFS-RT), bridge/corridor crossing, or local sensor.
//      See `src/adapters/examples.js` for starter adapters.
// ============================================================================

export const BOARD = {
  // Shown in the board header and page title
  name: 'SAN MATEO',
  timezone: 'America/Los_Angeles',

  // [latitude, longitude] — must be non-zero to turn the board on
  coords: [37.5630, -122.3255],

  // 3-letter IATA code for FAA NAS status (omit or set null to hide)
  airport: 'SFO',

  // NOAA CO-OPS 7-digit water-level station ID (omit or set null for inland towns)
  // Find yours: https://tidesandcurrents.noaa.gov/map/
  tide: '9414523', // Redwood City, CA

  // Show NOAA Climate Prediction Center's El Niño / La Niña watch
  elnino: true,

  // Rain & creek stage gauges (up to 6 recommended).
  //   • National (USGS): { label, kind: 'stage' | 'rain', usgs: '<8-to-15-digit site id>' }
  //     Find sites: https://waterdata.usgs.gov/nwis/rt
  //   • California (CDEC): { label, kind: 'rain' | 'stage', station: 'OSO', sensor: 2, dur: 'H' }
  gauges: [
    { label: 'SAN FRANCISQUITO', kind: 'stage', usgs: '11164500' },
    { label: 'SAN MATEO CREEK',  kind: 'stage', usgs: '11162753' },
  ],

  // California Caltrans CWWP2 freeway signs (District 4 = Bay Area; omit outside CA
  // or replace with `pipes.signs` in `src/adapters/examples.js`).
  signs: {
    district: 4,
    routes: ['US-101', 'I-280', 'SR-92'],
    // [southLat, westLon, northLat, eastLon] bounding box around your corridor
    box: [37.44, -122.45, 37.68, -122.18],
  },

  // Primary bridge / corridor crossing card (omit to hide, or supply `pipes.bridge`).
  // bridge: {
  //   label: 'SAN MATEO BRIDGE',
  //   toLabel: 'TO EAST BAY',
  //   district: 4,
  //   route: 'SR-92',
  //   box: [37.55, -122.30, 37.64, -122.11],
  // },

  // BART real-time departures (optional — requires `BART_KEY` secret or BART's
  // public demo key, or replace with `pipes.bart` for another transit system).
  // bart: {
  //   station: 'MLBR',
  //   stations: ['MLBR', 'SBRN', 'SSAN', 'COLM', 'DALY'],
  //   names: { MLBR: 'Millbrae', SBRN: 'San Bruno', SSAN: 'South SF', COLM: 'Colma', DALY: 'Daly City' },
  //   meets: {}, // Timed cross-platform transfers (default BART_MEETS is Oakland's 19th/MacArthur)
  // },

  // Optional one-off town headlines (championships, parades, civic milestones):
  // events: [
  //   {
  //     from: Date.parse('2026-11-01T00:00:00Z'),
  //     until: Date.parse('2026-11-03T14:00:00Z'),
  //     text: 'LOCAL HEADLINE HERE',
  //     sub: 'short lowercase context line under the main board',
  //     tone: 'pumpkin', // 'pumpkin' | 'valkyrie' | undefined
  //     flash: false,
  //   },
  // ],

  // Custom feed adapters — override any built-in pipe (`bart`, `bridge`,
  // `signs`, `gauges`, etc.) with your own loader + citation.
  // See `src/adapters/examples.js`.
  pipes: {},
};
