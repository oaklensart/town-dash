// ---- GET /api/city — the city board's one payload ----
//
// Every source the board reads (weather, air, alerts, transit, the airport,
// freeway signs, the tide, gauges, El Niño, earthquakes) is fetched HERE, on
// its own clock, and kept in the colo cache — the way the footer temperature
// is (src/edge/weather.js). The request path only ever reads that cache; a
// stale or missing source is refreshed in the background under ctx.waitUntil,
// a few per request, so no visitor ever waits on a third party and the page
// reads only its own origin (strict CSP, no third-party runtime).
//
// A cold board answers with what it has (sections `null` while warming) and
// the page asks again shortly; a source that fails keeps its last good answer
// and is marked stale once it is too old to vouch for. Nothing is invented.
//
// Absent config = no feature: without a `city` block in site.config.js this
// answers 404, like /api/devfeed without `devFeed`. The rules (parsing, the
// levels, the verdict) are pure and live in src/shared/city.js.

import siteConfig from '../shared/config.js';
import { jsonRes } from '../shared/http.js';
import { temperatureUnit } from '../edge/weather.js';
import {
  parseSky, parseAir, parseAlerts, parseBart, parseAirport, parseSigns,
  parseTide, parseRain, parseStage, parseUsgs, parseEnso, parseQuakes, verdict, lightNow,
  parseTimetable, settleBart, serviceDay, headlines, parseIncidents, parseClosures, bridgeStatus,
} from '../shared/city.js';

const MIN = 60_000;
const REFRESH_PER_REQUEST = 4;   // background refreshes one request may start
const STALE_AFTER = 4;           // × a source's freshness before it is marked stale
const TIMEOUT_MS = 8000;

export function cityConfig(cfg = siteConfig, env = null) {
  const c = cfg.city;
  const coords = cfg.location?.coords;
  if (!c || !Array.isArray(coords) || coords.length !== 2) return null;
  const [lat, lon] = coords.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  // The snapshot's address, for the sources page: only where the CDN is a real host.
  const snapshotUrl = /^https:\/\//.test(cfg.cdnBase || '') ? `${cfg.cdnBase.replace(/\/+$/, '')}/city/now.json` : null;
  // Keys a source needs that are secrets, not config (Worker secrets, never in the repo): 511's,
  // for CHP's incidents on the bridge. Without one that source is off and the board does without.
  const keys = { traffic511: env?.TRAFFIC_511_KEY || null };
  return { ...c, lat, lon, name: cfg.location.name || '', tz: cfg.timezone || 'UTC', snapshotUrl, keys };
}

// `rec`, when the snapshot Worker passes one, is its flight recorder
// (workers/city/capture.js): it keeps each answer exactly as it came, or the
// failure. Without one nothing is kept, which is /api/city.
async function get(url, { as = 'json', headers = {}, rec = null } = {}) {
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'town-dash', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) text = await res.text();
  } catch (err) {
    rec?.read({ url, t0, error: err.message });
    throw err;
  }
  rec?.read({ url, t0, status: res.status, text });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return as === 'text' ? text : JSON.parse(text.replace(/^\uFEFF/, ''));   // 511 starts its JSON with a byte-order mark
}

const cdec = (g) => {
  const now = Date.now(), day = (ms) => new Date(ms - 8 * 3_600_000).toISOString().slice(0, 10);
  return `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${g.station}&SensorNums=${g.sensor}`
    + `&dur_code=${g.dur || 'E'}&Start=${day(now - 2 * 86_400_000)}&End=${day(now + 86_400_000)}`;
};
const usgs = (g) => `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${encodeURIComponent(g.usgs)}`
  + `&parameterCd=${g.kind === 'rain' ? '00045' : '00065'}&period=P2D`;

const noaa = (station, query) => `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${station}`
  + `&datum=MLLW&units=english&time_zone=gmt&format=json&application=town-dash&${query}`;
const noaaMeta = (station, what) => `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${station}/${what}.json`;
const ymdhm = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/-/g, '').replace('T', '%20');

// Each source's address, built in one place so the board fetches and the
// sources page (/city/sources) cites exactly the same feed.
const ENSO_PAGE = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml';
const FAA_STATUS = 'https://nasstatus.faa.gov/api/airport-status-information';
export const FEED = {
  sky: (c) => 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover_low`
    + '&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,uv_index_max,wind_gusts_10m_max'
    + '&hourly=temperature_2m,precipitation_probability,weather_code,cloud_cover_low,wind_gusts_10m,pressure_msl'
    + `&forecast_days=2&wind_speed_unit=mph&temperature_unit=${temperatureUnit()}`
    + `&timezone=${encodeURIComponent(c.tz)}`,
  air: (c) => `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lon}&current=us_aqi`,
  alerts: (c) => `https://api.weather.gov/alerts/active?point=${c.lat},${c.lon}`,
  signs: (c) => `https://cwwp2.dot.ca.gov/data/d${c.signs.district}/cms/cmsStatusD${String(c.signs.district).padStart(2, '0')}.json`,
  closures: (c) => `https://cwwp2.dot.ca.gov/data/d${c.bridge.district}/lcs/lcsStatusD${String(c.bridge.district).padStart(2, '0')}.json`,
  usgs,
  // the key goes on at fetch time only, so nothing that cites or records this address carries it
  incidents: () => 'https://api.511.org/traffic/events?format=json&status=ACTIVE',
  quakes: (c, now = Date.now()) => {
    const q = c.quakes || {};
    return 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'
      + `&latitude=${c.lat}&longitude=${c.lon}&maxradiuskm=${q.radiusKm || 100}&minmagnitude=${q.minMag || 2.5}`
      + `&starttime=${new Date(now - 7 * 86_400_000).toISOString().slice(0, 10)}&orderby=time&limit=10`;
  },
};

// BART's slow half (trains running, advisories), kept between reads in this
// isolate; see SOURCES.bart.
const BART_SLOW = 50_000;
let bartSlow = null;

// Each source: how long an answer stays fresh, whether this config asks for
// it, and how to fetch and reduce it.
export const SOURCES = {
  sky: {
    fresh: 10 * MIN, on: () => true,
    load: async (c, rec) => parseSky(await get(FEED.sky(c), { rec }), temperatureUnit()),
  },
  air: {
    fresh: 30 * MIN, on: (c) => c.air !== false,
    load: async (c, rec) => parseAir(await get(FEED.air(c), { rec })),
  },
  alerts: {
    fresh: 3 * MIN, on: (c) => c.alerts !== false,
    load: async (c, rec) => parseAlerts(await get(FEED.alerts(c), { headers: { Accept: 'application/geo+json' }, rec })),
  },
  bart: {
    // live: the snapshot reads it every run, and again within the run (workers/city/)
    fresh: 1 * MIN, live: true, on: (c) => !!c.bart?.key,
    load: async (c, rec, prev) => {
      const b = (path, q) => get(`https://api.bart.gov/api/${path}.aspx?${q}&key=${c.bart.key}&json=y`, { rec });
      // One call carries every station's departures (~80 KB), so watching
      // eight stations costs the same as watching one. The train count and
      // the advisories move by the hour, not the second, so they're fetched at
      // most once in BART_SLOW: the snapshot's reads 20 s apart within a run
      // fetch the departures alone (each request is CPU on a 10 ms budget).
      const slowDue = !bartSlow || Date.now() - bartSlow.at > BART_SLOW;
      const [slow, etd] = await Promise.all([
        slowDue
          ? Promise.all([b('bsa', 'cmd=count'), b('bsa', 'cmd=bsa')]).then(([count, bsa]) => (bartSlow = { at: Date.now(), count, bsa }))
          : bartSlow,
        b('etd', 'cmd=etd&orig=ALL'),
      ]);
      // the last reading (`prev`) says since when each train has read "1" (src/shared/city.js BART_STUCK)
      return parseBart({ count: slow.count, bsa: slow.bsa, etd }, c.bart, Date.now(), prev);
    },
  },
  airport: {
    fresh: 5 * MIN, on: (c) => !!c.airport,
    load: async (c, rec) => parseAirport(await get(FAA_STATUS, { as: 'text', rec }), c.airport),
  },
  signs: {
    fresh: 5 * MIN, on: (c) => !!c.signs?.district,
    load: async (c, rec) => parseSigns(await get(FEED.signs(c), { rec }), c.signs),
  },
  // The Bay Bridge when its signs aren't posting a time (src/shared/city.js bridgeStatus).
  // Caltrans' closures are the whole district's, about 4.5 MB, so the flight
  // recorder keeps only the bridge's (it would otherwise hold ~600 MB a day of
  // the rest of the Bay Area); they move every 5 minutes, and planned ones by the day.
  closures: {
    fresh: 10 * MIN, on: (c) => !!(c.bridge?.box && c.bridge?.district),
    load: async (c, rec) => {
      const url = FEED.closures(c), t0 = Date.now();
      let json;
      try { json = await get(url); } catch (err) { rec?.read({ url, t0, error: err.message }); throw err; }
      const box = c.bridge.box, near = (lat, lon) => lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];
      const kept = (json.data || []).filter(({ lcs }) => lcs?.location?.begin?.beginRoute === c.bridge.route
        && (near(Number(lcs.location.begin.beginLatitude), Number(lcs.location.begin.beginLongitude))
          || near(Number(lcs.location.end?.endLatitude), Number(lcs.location.end?.endLongitude))));
      rec?.read({ url, t0, status: 200, text: JSON.stringify({ trimmed: 'the bridge only', data: kept }) });
      return parseClosures({ data: kept }, c.bridge, Date.now(), c.tz);
    },
  },
  // CHP's incidents on the bridge, through 511 (needs TRAFFIC_511_KEY; 60 requests an hour, so every 3 minutes)
  incidents: {
    fresh: 3 * MIN, on: (c) => !!(c.bridge?.box && c.keys?.traffic511),
    load: async (c, rec) => parseIncidents(await get(`${FEED.incidents()}&api_key=${encodeURIComponent(c.keys.traffic511)}`, { rec }), c.bridge),
  },
  tide: {
    fresh: 6 * MIN, on: (c) => !!c.tide,
    load: async (c, rec) => {
      const now = Date.now();
      const [observed, predicted, datums, flood] = await Promise.all([
        get(noaa(c.tide, 'product=water_level&date=recent'), { rec }),
        get(noaa(c.tide, `product=predictions&begin_date=${ymdhm(now - 13 * 3_600_000)}&end_date=${ymdhm(now + 25 * 3_600_000)}`), { rec }),
        get(noaaMeta(c.tide, 'datums'), { rec }), get(noaaMeta(c.tide, 'floodlevels'), { rec }),
      ]);
      return parseTide({ observed, predicted, datums, flood }, now);
    },
  },
  gauges: {
    fresh: 15 * MIN, on: (c) => Array.isArray(c.gauges) && c.gauges.length > 0,
    load: async (c, rec, prev) => keepGauges(await Promise.all(c.gauges.map(async (g) => {
      try {
        if (g.usgs) {
          const json = await get(usgs(g), { rec });
          return { label: g.label, ...parseUsgs(json, g.kind || 'stage') };
        }
        const rows = await get(cdec(g), { rec });
        return { label: g.label, ...(g.kind === 'stage' ? parseStage(rows) : parseRain(rows)) };
      } catch { return null; }
    })), prev, c.gauges),
  },
  elnino: {
    fresh: 12 * 60 * MIN, on: (c) => c.elnino === true,
    load: async (c, rec) => parseEnso(await get(ENSO_PAGE, { as: 'text', rec })),
  },
  quakes: {
    fresh: 10 * MIN, on: (c) => c.quakes !== false,
    load: async (c, rec) => parseQuakes(await get(FEED.quakes(c), { rec }), Date.now()),
  },
};

/**
 * The gauges' answers with the failures filled in, so a slow CDEC never
 * blanks a good reading (2026-11-01, 12:22 am: both reads timed out at 8 s and
 * the panel went "missing" for a quarter of an hour, with rain forecast). A
 * gauge that didn't answer keeps its last reading, whose `at` says how old it
 * is; one with none yet is missing; and when none answered at all the source
 * fails, so its last answer stays and goes stale like any other.
 */
export function keepGauges(answers, prev, gauges) {
  if (answers.every((a) => a == null)) throw new Error('no gauge answered');
  return answers.map((a, i) => a ?? prev?.find((p) => p.label === gauges[i].label && !p.missing) ?? { label: gauges[i].label, missing: true });
}

// BART's timetable for the watched stations (src/shared/city.js
// parseTimetable): every station's schedule in the run the service day turns
// (3 am), so a day costs eight reads, none on the request path. It was one a
// run while the free plan's 10 ms held each run (a schedule is ~56 KB), and
// then the stations not read yet had no hours: each read red, "no departures
// listed", for up to seven minutes every night (2026-10-31). Kept by the
// snapshot, like BART's day; a failed read is tried again next run.
export async function timetableStep(tt, c, now = Date.now(), rec = null) {
  if (!c?.bart?.key || !c.bart.stations?.length) return null;
  const { day } = serviceDay(now, c.tz);
  const next = tt?.day === day ? { ...tt, stations: { ...tt.stations } } : { day, stations: {} };
  const missing = c.bart.stations.filter((s) => !(s in next.stations));
  if (!missing.length) return next;
  const [y, m, d] = day.split('-');
  await Promise.all(missing.map(async (code) => {
    const r = rec?.for('timetable');
    try {
      const json = await get(`https://api.bart.gov/api/sched.aspx?cmd=stnsched&orig=${code}&date=${m}/${d}/${y}&key=${c.bart.key}&json=y`, { rec: r });
      next.stations[code] = parseTimetable(json, day, c.tz);   // null: no trains that day, and that is known too
    } catch (err) {
      console.error(`[city] timetable ${code} failed:`, err.message);
      r?.fail(err.message);
    }
  }));
  // in the watched order, whichever answered first
  return { ...next, stations: Object.fromEntries(c.bart.stations.filter((s) => s in next.stations).map((s) => [s, next.stations[s]])) };
}

// Where every reading comes from, for /city/sources: in the order the board
// shows them, each with a page a person can read and the exact feed the board
// reads. Never a key: BART's feed needs one, so its entry links BART's API
// documentation instead of the request.
const CITES = {
  sky: (c) => [{ name: 'Temperature, today’s range, wind, barometer, sunrise and sunset, and the hours ahead', by: 'Open-Meteo',
    page: 'https://open-meteo.com/en/docs', data: FEED.sky(c) }],
  air: (c) => [{ name: 'Air quality (US AQI)', by: 'Open-Meteo', page: 'https://open-meteo.com/en/docs/air-quality-api', data: FEED.air(c) }],
  bart: () => [{ name: 'BART: trains running, advisories, departures', by: 'BART',
    page: 'https://www.bart.gov/schedules/eta', data: 'https://api.bart.gov/docs/overview/index.aspx', dataLabel: 'API' },
  { name: 'BART: each station’s first and last train of the day', by: 'BART',
    page: 'https://www.bart.gov/schedules/bystation', data: 'https://api.bart.gov/docs/sched/stnsched.aspx', dataLabel: 'API' }],
  airport: (c) => [{ name: `${c.airport} airport status`, by: 'FAA', page: 'https://nasstatus.faa.gov/', data: FAA_STATUS }],
  signs: (c) => [{ name: 'Freeway message signs and the Bay Bridge time', by: 'Caltrans', page: 'https://quickmap.dot.ca.gov/', data: FEED.signs(c) }],
  closures: (c) => [{ name: 'Lane closures on the Bay Bridge, now and planned', by: 'Caltrans', page: 'https://quickmap.dot.ca.gov/', data: FEED.closures(c) }],
  // 511 asks to be credited as the provider; its feed needs a key, so the entry links its documentation
  incidents: () => [{ name: 'Crashes and stalls on the Bay Bridge, as CHP reports them', by: '511 SF Bay',
    page: 'https://511.org/', data: 'https://511.org/open-data/traffic', dataLabel: 'API' }],
  alerts: (c) => [{ name: 'Weather alerts', by: 'National Weather Service',
    page: `https://forecast.weather.gov/MapClick.php?lat=${c.lat}&lon=${c.lon}`, data: FEED.alerts(c) }],
  tide: (c) => [{ name: 'The tide and its flood levels', by: 'NOAA Tides & Currents',
    page: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${c.tide}`, data: noaa(c.tide, 'product=water_level&date=recent') }],
  gauges: (c) => c.gauges.map((g) => g.usgs
    ? { name: `${(g.kind || 'stage') === 'stage' ? 'Water level' : 'Rain'}, ${g.label.toLowerCase()}`, by: `USGS ${g.usgs}`,
        page: `https://waterdata.usgs.gov/monitoring-location/${g.usgs}/`, data: usgs(g) }
    : { name: `${g.kind === 'stage' ? 'Water level' : 'Rain'}, ${g.label.toLowerCase()}`, by: `CDEC ${g.station}`,
        page: `https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=${g.station}`, data: cdec(g) }),
  quakes: (c) => [{ name: `Earthquakes within ${(c.quakes || {}).radiusKm || 100} km`, by: 'USGS',
    page: 'https://earthquake.usgs.gov/earthquakes/map/', data: FEED.quakes(c) }],
  elnino: () => [{ name: 'El Niño status', by: 'NOAA Climate Prediction Center', page: ENSO_PAGE }],
};
const CITE_ORDER = [
  ['NOW', ['sky', 'air']],
  ['MOVING', ['bart', 'airport', 'signs', 'bridge', 'closures', 'incidents']],
  ['WATCHING', ['alerts', 'tide', 'gauges', 'quakes', 'elnino']],
];

// A custom pipe in `c.pipes?.[name]` overrides or replaces the built-in source
// for that slot (`bart`, `signs`, `gauges`, `airport`, `tide`, …) so a fork can
// wire a local transit agency or road feed in board.config.js without editing this file.
const pipeOf = (name, c) => {
  const custom = c?.pipes?.[name];
  if (!custom) return SOURCES[name];
  return {
    fresh: custom.fresh ?? custom.ttl ?? SOURCES[name]?.fresh ?? 5 * MIN,
    live: custom.live ?? false,
    on: custom.on ?? (() => true),
    load: (cfg, rec, prev) => custom.load(cfg, { get: (u, o) => get(u, { ...o, rec }), rec, prev }),
  };
};
const citeOf = (name, c) => {
  const custom = c?.pipes?.[name]?.cite;
  if (custom) {
    const raw = typeof custom === 'function' ? custom(c) : custom;
    return [raw].flat().map((item) => ({
      ...item,
      name: item.name || (item.what && item.how ? `${item.what}: ${item.how}` : item.what || name),
    }));
  }
  return CITES[name] ? CITES[name](c) : [];
};
const sourceNames = (c) => [...new Set([...Object.keys(SOURCES), ...Object.keys(c?.pipes || {})])]
  .filter((n) => pipeOf(n, c)?.on(c));

/** The sources this config reads, by the board's sections, then the board's own data. */
export function buildSources(c, snapshotUrl = null) {
  const sections = CITE_ORDER.map(([section, names]) => ({
    section, items: names.filter((n) => pipeOf(n, c)?.on(c)).flatMap((n) => citeOf(n, c)),
  })).filter((s) => s.items.length);
  sections.push({ section: 'THE BOARD', items: [
    ...(snapshotUrl ? [{ name: 'This board’s snapshot, rewritten every 20 seconds', by: 'this site', data: snapshotUrl }] : []),
    { name: 'The same, gathered on request', by: 'this site', data: '/api/city' },
  ] });
  return sections;
}

// Bump when a parser's output changes shape or meaning (src/shared/city.js):
// an answer parsed by the old rules is then refetched at once instead of
// being served for up to its freshness window (twelve hours for El Niño).
export const PARSE_VERSION = 24;
const cacheKey = (origin, name) => `${origin}/__city/v${PARSE_VERSION}/${name}`;

// The payload changes by the minute and is cheap to build from cache, so it is never stored downstream.
function reply(data, status) {
  const res = jsonRes(data, status);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

async function readEntry(origin, name) {
  try {
    const hit = await caches.default.match(new Request(cacheKey(origin, name)));
    return hit ? await hit.json() : null;
  } catch { return null; }
}

// One refresh per source per isolate at a time.
const inflight = new Map();
export function refreshSource(origin, name, c) {
  if (!inflight.has(name)) {
    const run = (async () => {
      try {
        const data = await pipeOf(name, c).load(c);
        if (data == null) throw new Error('nothing to read');
        await caches.default.put(cacheKey(origin, name), new Response(JSON.stringify({ data, ts: Date.now() }),
          { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } }));
      } catch (err) {
        console.error(`[city] ${name} refresh failed:`, err.message);   // the last good answer stays
      }
    })().finally(() => inflight.delete(name));
    inflight.set(name, run);
  }
  return inflight.get(name);
}

/**
 * The payload the page draws, from each source's last good answer
 * ({ name: { data, ts } }). Shared by /api/city and the scheduled snapshot
 * (workers/city/), so the board reads the same whichever one answered. Only
 * the snapshot keeps BART's day (`record`, src/shared/city.js recordDay) and
 * its timetable (`timetable`, which rests a station that is quiet before its
 * first train or after its last): /api/city answers without either.
 */
export function buildPayload(entries, c, now = Date.now(), record = null, timetable = null) {
  const names = sourceNames(c);
  const sections = {}, at = {}, stale = [];
  for (const n of names) {
    const e = entries[n];
    sections[n] = e ? e.data : null;
    if (e) at[n] = e.ts;
    if (e && now - e.ts > pipeOf(n, c).fresh * STALE_AFTER) stale.push(n);
  }
  if (sections.bart && timetable) sections.bart = settleBart(sections.bart, timetable, now);
  // A stale section still shows its last value, but it may not drive the verdict, or the headlines.
  const trusted = Object.fromEntries(Object.entries(sections).filter(([n]) => !stale.includes(n)));
  const v = verdict(trusted);
  return {
    ok: true, name: c.name, tz: c.tz, now, sections, at, stale,
    warming: names.filter((n) => sections[n] == null),
    light: sections.sky ? lightNow(sections.sky.sun, now) : null,
    verdict: v,
    headlines: headlines(trusted, v, now, c.tz, {
      record,
      ...(c.events && { events: c.events }),
      ...(c.bridge?.label && { bridgeLabel: c.bridge.label }),
    }),
    bridge: trusted.bridge !== undefined ? trusted.bridge : bridgeStatus(trusted, now, c.tz, c.bridge),
    sources: buildSources(c, c.snapshotUrl),
    ...(record && { record }),
    ...(timetable && { timetable }),
  };
}

/** The sources this config reads live: refreshed on every scheduled run, outside the budget. */
export const liveSources = (c) => sourceNames(c).filter((n) => pipeOf(n, c).live);

/** The sources due a refresh, most overdue first, at most `budget` of them (`except` aside). */
export function dueSources(entries, c, now = Date.now(), budget = REFRESH_PER_REQUEST, except = []) {
  return sourceNames(c).filter((n) => !except.includes(n))
    .map((n) => [n, entries[n] ? now - entries[n].ts : Infinity])
    .filter(([n, age]) => age > pipeOf(n, c).fresh)
    .sort((a, b) => b[1] - a[1]).slice(0, budget).map(([n]) => n);
}

/**
 * Refresh what is due and return the entries with the new answers in. A
 * source that fails keeps its last good answer (and its age, so it goes stale
 * honestly). For the scheduled snapshot, which awaits the work. `always`
 * are refreshed whatever their age, and don't count against the budget.
 * `rec` is the snapshot's flight recorder (get() above).
 */
export async function gather(entries, c, now = Date.now(), budget = REFRESH_PER_REQUEST, always = [], rec = null) {
  const next = { ...entries };
  await Promise.all([...always, ...dueSources(entries, c, now, budget, always)].map(async (n) => {
    const r = rec?.for(n);
    try {
      const data = await pipeOf(n, c).load(c, r, entries[n]?.data);   // the last answer, for a source that reads on from it
      if (data == null) throw new Error('nothing to read');
      next[n] = { data, ts: Date.now() };
    } catch (err) {
      console.error(`[city] ${n} refresh failed:`, err.message);
      r?.fail(err.message);
    }
  }));
  return next;
}

/** The entries back out of a payload, so the snapshot can carry its own state. */
export function entriesFrom(payload) {
  const out = {};
  for (const [n, data] of Object.entries(payload?.sections || {})) {
    if (data != null && payload.at?.[n]) out[n] = { data, ts: payload.at[n] };
  }
  return out;
}

export async function handleCity(request, url, ctx, env = null) {
  const c = cityConfig(undefined, env);
  if (!c) return reply({ ok: false }, 404);
  const now = Date.now();
  const names = sourceNames(c);
  const read = await Promise.all(names.map((n) => readEntry(url.origin, n)));
  const entries = Object.fromEntries(names.map((n, i) => [n, read[i]]).filter(([, e]) => e));
  for (const n of dueSources(entries, c, now)) ctx.waitUntil(refreshSource(url.origin, n, c));
  return reply(buildPayload(entries, c, now), 200);
}
