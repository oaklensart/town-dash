// ============================================================================
// Starter Custom Pipes (`src/adapters/examples.js`)
// ============================================================================
// Any section on the board can be driven by your own adapter in `board.config.js`
// under `pipes: { <name>: { ttl, stale, live, load, cite } }`.
//
// Why code instead of a no-code form?
// Public feeds are full of local quirks — ghost trains after midnight, sign
// tests, unpadded dates, and sensor resets. Writing a 25-line `load(c)`
// function and testing it against a saved JSON capture in `tests/city.test.js`
// keeps your town's board honest.
// ============================================================================

// Each `load(c, { get })` receives the board config and `get(url)`, the same
// fetch the built-in pipes use: a timeout, a User-Agent, JSON parsed.

const MIN = 60_000;

/**
 * Example 1: Custom Rail / Transit Pipe (`pipes.bart`)
 *
 * Drives the MOVING rail card, station tabs, advisories, and verdict.
 * Return shape:
 *   {
 *     label: 'CALTRAIN',          // Heading shown on the card & verdict ("CALTRAIN DELAYS")
 *     unit: 'TRAINS',             // Right-hand counter unit ("14 TRAINS" or "ON SCHEDULE")
 *     trains: 14,                 // Active vehicle count (or null)
 *     asOf: Date.now(),           // Timestamp (ms) the agency stamped the reading
 *     closed: false,              // True overnight when service is resting (suppresses false alarms)
 *     level: 0,                   // 0 = normal (green/amber), 1 = advisory (warm), 2 = major delay (red)
 *     advisories: [               // [{ text, delay: true, posted: ms }]
 *     ],
 *     home: 'SMAT',               // Default selected station code
 *     stations: [
 *       {
 *         code: 'SMAT',
 *         name: 'SAN MATEO',
 *         level: 0,               // 0 | 1 | 2
 *         issue: null,            // Short string under station header when delayed, e.g. 'up to 8 min late'
 *         departures: [
 *           {
 *             dest: 'SAN FRANCISCO',
 *             dir: 'North',
 *             color: '#e31837',   // Line color dot
 *             mins: [4, 28],      // Whole minutes until departure (0 = 'NOW')
 *             at: [Date.now() + 4 * MIN, Date.now() + 28 * MIN],
 *             lates: [0, 0],      // Seconds late per listed train (300+ lights that train warm/red)
 *             late: 0,            // Max seconds late for this destination
 *           },
 *         ],
 *       },
 *     ],
 *   }
 */
export function customTransitPipe({ agency = 'CALTRAIN', url, page }) {
  return {
    ttl: 60_000,
    stale: 5 * MIN,
    live: true,
    cite: {
      section: 'MOVING',
      what: agency,
      how: 'Real-time departures and service advisories',
      by: agency,
      page: page || 'https://511.org/',
    },
    async load(c, { get }) {
      const raw = await get(url);
      // Transform your agency's GTFS-RT / 511 / REST JSON into the contract above:
      return {
        label: agency.toUpperCase(),
        unit: 'TRAINS',
        trains: raw?.trains ?? null,
        asOf: Date.now(),
        closed: false,
        level: 0,
        advisories: [],
        home: raw?.home || 'MAIN',
        stations: raw?.stations || [],
      };
    },
  };
}

/**
 * Example 2: Custom Bridge or Corridor Crossing Pipe (`pipes.bridge`)
 *
 * Drives the crossing card under MOVING and commute headlines.
 * Return shape:
 *   {
 *     label: 'SAN MATEO BRIDGE',  // Card title
 *     toLabel: 'TO EAST BAY',     // Subtitle direction when showing travel time
 *     mode: 'time' | 'status',    // 'time' during commute/day, 'status' for closures/incidents
 *     after: false,               // True when showing overnight closure status
 *     level: 0,                   // 0 = clear, 1 = lane closure / slow, 2 = crash / severe delay
 *     text: '12 MIN',             // Main 5x7 dot-matrix readout (up to 2 lines separated by '\n')
 *     sub: 'from us-101 · via sr-92',
 *   }
 */
export function customCrossingPipe({ label = 'SAN MATEO BRIDGE', toLabel = 'TO EAST BAY', url, page }) {
  return {
    ttl: 2 * MIN,
    stale: 15 * MIN,
    cite: {
      section: 'MOVING',
      what: label,
      how: 'Crossing travel time and incident status',
      by: 'State DOT',
      page: page || 'https://quickmap.dot.ca.gov/',
    },
    async load(c, { get }) {
      const data = await get(url);
      return {
        label,
        toLabel,
        mode: data?.mins ? 'time' : 'status',
        after: false,
        level: data?.level ?? 0,
        text: data?.mins ? `${data.mins} MIN` : (data?.status || 'NO CLOSURES'),
        sub: data?.sub || '',
      };
    },
  };
}

/**
 * Example 3: Custom Highway / Corridor Message Signs (`pipes.signs`)
 *
 * Drives the 3-line amber highway signs at the bottom of MOVING.
 * Return shape:
 *   {
 *     agency: 'WSDOT',            // Credited in the section footer when no signs are active
 *     toSF: null,                 // Optional { mins, near, route } if a sign posts crossing minutes
 *     list: [
 *       {
 *         route: 'I-5',
 *         dir: 'South',
 *         near: 'Seneca St',
 *         lines: ['CRASH AHEAD', 'USE ALT ROUTE'], // 1 to 3 uppercase lines, max 16 chars each
 *         level: 1,               // 1 = incident/closure (amber/red), 0 = informational
 *       },
 *     ],
 *   }
 */
export function customSignsPipe({ agency = 'DOT', url, page }) {
  return {
    ttl: 2 * MIN,
    stale: 15 * MIN,
    cite: {
      section: 'MOVING',
      what: 'Freeway signs',
      how: 'Live overhead changeable message signs',
      by: agency,
      page: page || 'https://dot.gov/',
    },
    async load(c, { get }) {
      const data = await get(url);
      return {
        agency,
        toSF: null,
        list: (data?.signs || []).slice(0, 6),
      };
    },
  };
}
