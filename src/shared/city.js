// ---- The city board's rules (pure) ----
//
// /city is the city's pulse on one dark board, lit only where it needs you.
// src/api/city.js fetches each source on its own clock and caches it; this
// file turns each source's raw answer into the small, honest shape the page
// draws, and decides the board's one-line verdict. Nothing here touches the
// network, so tests/city.test.js holds every rule against real captures.
//
// Levels are the emissive ladder the page lights with: 0 normal (cold iron),
// 1 worth a look (warm, amber), 2 act on it (hot, red). The rain and creek
// thresholds are owner-chosen "look now" marks, not an agency's; the tide uses
// NOAA's own flood levels and the alerts the National Weather Service's own
// words. A source we could not read is absent, never guessed.

const HOUR = 3_600_000;

// Rain in inches: a 0.5"/hour burst floods small hill creeks; 3" in a day is
// atmospheric-river rain. Creek rise in feet over the last hour. A tide counts
// as worth a look from half a foot under minor flooding, because the surge
// alone moves that much in a few hours.
export const RAIN_HOUR = [0.25, 0.5];
export const RAIN_DAY = [1.5, 3.0];
export const CREEK_RISE = [0.5, 1.5];
export const TIDE_NEAR = 0.5;

const level = (v, steps) => steps.reduce((n, s) => n + (v != null && s != null && v >= s ? 1 : 0), 0);

// ── sky and light (Open-Meteo forecast) ─────────────────────────────────────
const SKY = [
  [[0], 'CLEAR'], [[1], 'MOSTLY CLEAR'], [[2], 'PARTLY CLOUDY'], [[3], 'CLOUDY'],
  [[45, 48], 'FOG'], [[51, 53, 55, 56, 57], 'DRIZZLE'], [[61, 63, 80, 81], 'RAIN'],
  [[65, 82], 'HEAVY RAIN'], [[66, 67], 'FREEZING RAIN'], [[71, 73, 75, 77, 85, 86], 'SNOW'],
  [[95, 96, 99], 'THUNDER'],
];
export function skyWord(code) {
  for (const [codes, word] of SKY) if (codes.includes(code)) return word;
  return '';
}

/** Local wall-clock strings (Open-Meteo's, in the site's zone) → epoch ms. */
const localToMs = (s, offsetSec) => Date.parse(`${s}:00Z`) - offsetSec * 1000;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Meteorological degrees (where the wind blows from) → an eight-point compass bearing. */
export function compassDir(deg) {
  return Number.isFinite(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : null;
}

const INHG_PER_HPA = 0.029529983;
const BARO_TREND_HPA = 1.0;   // ~0.03 inHg over 3 hours: the weather-glass mark for rising or falling
const BARO_DROP_HPA = 3.0;    // ~0.09 inHg fall in 3 hours: a front coming in fast
function parsePressure(c, hourly, off) {
  const hpa = c?.pressure_msl;
  if (!Number.isFinite(hpa)) return null;
  const inHg = Math.round(hpa * INHG_PER_HPA * 100) / 100;
  let delta = null;
  if (c.time && hourly?.time?.length && hourly?.pressure_msl?.length) {
    const nowMs = localToMs(c.time, off), fromMs = localToMs(hourly.time[0], off);
    const idx = Math.round((nowMs - fromMs) / HOUR);
    // the forecast starts at midnight, so before 3 am there is no three-hour tendency to read: steady, not a shorter one
    const past = idx >= 3 ? hourly.pressure_msl[idx - 3] : null;
    if (Number.isFinite(past)) delta = hpa - past;
  }
  const trend = delta == null || Math.abs(delta) < BARO_TREND_HPA ? 'steady' : delta > 0 ? 'rising' : 'falling';
  const lvl = (delta != null && delta <= -BARO_DROP_HPA) || hpa < 999 ? 1 : 0;
  return { inHg, hpa: Math.round(hpa), trend, level: lvl };
}

export function parseSky(json, unit = 'fahrenheit') {
  const c = json.current, off = json.utc_offset_seconds || 0;
  const windDir = compassDir(c.wind_direction_10m);
  const windGust = Number.isFinite(c.wind_gusts_10m) ? Math.round(c.wind_gusts_10m) : null;
  const windLevel = level(Math.max(c.wind_speed_10m ?? 0, (c.wind_gusts_10m ?? 0) - 10), [25, 40]);
  const pressure = parsePressure(c, json.hourly, off);
  return {
    temp: Math.round(c.temperature_2m),
    unit: unit === 'celsius' ? 'C' : 'F',
    sky: skyWord(c.weather_code),
    wind: Math.round(c.wind_speed_10m),
    ...(windDir && { windDir }),
    ...(windGust != null && { windGust }),
    ...(windLevel > 0 && { windLevel }),
    ...(pressure && { pressure }),
    lowCloud: c.cloud_cover_low ?? null,
    sun: json.daily.sunrise.map((rise, i) => ({ rise: localToMs(rise, off), set: localToMs(json.daily.sunset[i], off) })),
    // the whole day, for someone heading out at 7:30 who will still be out at 2
    today: {
      hi: json.daily.temperature_2m_max ? Math.round(json.daily.temperature_2m_max[0]) : null,
      lo: json.daily.temperature_2m_min ? Math.round(json.daily.temperature_2m_min[0]) : null,
      uv: json.daily.uv_index_max ? Math.round(json.daily.uv_index_max[0]) : null,
      gust: json.daily.wind_gusts_10m_max ? Math.round(json.daily.wind_gusts_10m_max[0]) : null,
    },
    // today and tomorrow by the hour, from local midnight, for the headlines
    // that look ahead (headlines): [temperature, chance of rain %, weather code,
    // low cloud %, gusts], one row an hour
    ...(json.hourly?.time?.length && { hours: {
      from: localToMs(json.hourly.time[0], off),
      rows: json.hourly.time.map((_, i) => [
        Math.round(json.hourly.temperature_2m?.[i] ?? NaN), json.hourly.precipitation_probability?.[i] ?? null,
        json.hourly.weather_code?.[i] ?? null, json.hourly.cloud_cover_low?.[i] ?? null, Math.round(json.hourly.wind_gusts_10m?.[i] ?? NaN),
      ].map((v) => (Number.isFinite(v) ? v : null))),
    } }),
  };
}

/**
 * The light, for a photographer: golden hour is the hour after sunrise and
 * the hour before sunset. Returns what is happening now and what is next.
 */
export function lightNow(sun, now) {
  for (const { rise, set } of sun) {
    if (now < rise - HOUR) return { phase: 'NIGHT', next: 'SUNRISE', at: rise };
    if (now < rise) return { phase: 'BLUE HOUR', next: 'SUNRISE', at: rise };
    if (now < rise + HOUR) return { phase: 'GOLDEN HOUR', next: 'ENDS', at: rise + HOUR };
    if (now < set - HOUR) return { phase: 'DAYLIGHT', next: 'GOLDEN HOUR', at: set - HOUR };
    if (now < set) return { phase: 'GOLDEN HOUR', next: 'SUNSET', at: set };
    if (now < set + 40 * 60_000) return { phase: 'BLUE HOUR', next: 'DARK', at: set + 40 * 60_000 };
  }
  const last = sun[sun.length - 1];
  return { phase: 'NIGHT', next: 'SUNRISE', at: last ? last.rise + 24 * HOUR : null };
}

// ── air (Open-Meteo air quality, US AQI) ────────────────────────────────────
export function parseAir(json) {
  const aqi = Math.round(json.current.us_aqi);
  const word = aqi <= 50 ? 'GOOD' : aqi <= 100 ? 'MODERATE' : aqi <= 150 ? 'SENSITIVE GROUPS'
    : aqi <= 200 ? 'UNHEALTHY' : aqi <= 300 ? 'VERY UNHEALTHY' : 'HAZARDOUS';
  return { aqi, word, level: aqi > 150 ? 2 : aqi > 100 ? 1 : 0 };
}

// ── weather alerts (National Weather Service, GeoJSON) ──────────────────────
export function parseAlerts(json) {
  return (json.features || []).map(({ properties: p }) => {
    const event = String(p.event || '').toUpperCase();
    const what = /\* WHAT\.\.\.([\s\S]+?)(?:\n\s*\n|\* [A-Z ]+\.\.\.|$)/.exec(p.description || '');
    return {
      event,
      until: p.ends || p.expires || null,
      what: (what ? what[1] : p.headline || '').replace(/\s+/g, ' ').trim(),
      level: /WARNING|EMERGENCY/.test(event) ? 2 : 1,
    };
  }).filter((a) => a.event && a.event !== 'TEST MESSAGE')
    .sort((a, b) => b.level - a.level);
}

// ── BART (api.bart.gov: trains running, advisories, every station's departures) ──
// A rider scanning the board looks for WHERE the trouble is before whether a
// train is on time, so each watched station carries its own issue, and the
// page lights that station's name red. An issue is trains there running 5+
// minutes late, no departures listed at all, or an advisory naming it.
export const BART_LATE_SECONDS = 300;
// Only a train due within this many minutes, and not yet at the platform,
// makes its station late: in a disruption BART lists trains two hours out as
// 80 to 100 minutes late, and they reddened stations for trains no one there
// was waiting for; and one at the platform has arrived (owner, 2026-10-30).
// The page lights a countdown red by the same rules, and NOW is never red.
export const BART_LATE_WITHIN = 30;
const NO_DEPARTURES = 'no departures listed';

/**
 * When BART stamped a reading: its feed carries the date and a Pacific clock
 * time to the second ("10/28/2026", "05:17:32 PM PDT"). Epoch ms, or null.
 */
export function bartTime(date, time) {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(date ?? '').trim());
  const t = /^(\d{1,2}):(\d{2}):(\d{2}) ([AP]M) P([DS])T$/.exec(String(time ?? '').trim());
  if (!d || !t) return null;
  const hour = (Number(t[1]) % 12) + (t[4] === 'PM' ? 12 : 0) + (t[5] === 'D' ? 7 : 8);
  return Date.UTC(Number(d[3]), Number(d[1]) - 1, Number(d[2]), hour, Number(t[2]), Number(t[3]));
}

const MONTH = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** When BART posted an advisory ("Fri Oct 30 2026 03:15 PM PDT"). Epoch ms, or null. */
export function bsaTime(s) {
  const x = /^\w{3} (\w{3}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}) ([AP]M) P([DS])T$/.exec(String(s ?? '').trim());
  if (!x || !(x[1] in MONTH)) return null;
  const hour = (Number(x[4]) % 12) + (x[6] === 'PM' ? 12 : 0) + (x[7] === 'D' ? 7 : 8);
  return Date.UTC(Number(x[3]), MONTH[x[1]], Number(x[2]), hour, Number(x[5]));
}

/** A station's name as the board shows it: the config's short name, else BART's own, in capitals. */
export function stationName(st, code, names = {}) {
  return (names[code] || (st ? String(st.name).replace(/\./g, '') : code)).toUpperCase();
}

// Each departure also carries `at`: when it reaches the platform, as a time,
// so the page counts it down between readings instead of showing a number
// that ages. It leans early: missing a train is worse than a "2" that turns
// back into a "3". BART's "1" reaches the platform about BART_LEAD later
// than a whole minute (the capture of 2026-10-29: 30 s at the median, 45 s
// at p90), and a rider on the stairs saw a train roll out under a "1". A
// train BART lists as Leaving is at the platform now.
export const BART_LEAD = 30_000;
const bartAt = (asOf, m) => asOf + (m ? m * 60_000 - BART_LEAD : 0);

// What BART lists that isn't what it seems (owner, 4:48 pm 2026-10-30:
// Coliseum read NOW NOW NOW for Dublin/Pleasanton). In a disruption BART
// listed trains it had added or rerouted (`dynamicflag`) at "1", up to three
// at once, unmoving for ten minutes (638 s at the median) until they
// vanished; the real next Dublin train was 10 minutes out and 14 late. So:
// - one train listed twice is one train: the same line, platform and minute
//   can't be two (and BART double-lists real trains too, now and then);
// - a destination's next train still at "1" after BART_STUCK is held short
//   of the platform, flagged or not (real trains sat there up to 11 minutes
//   that afternoon; on a normal morning a "1" moves on inside a minute, and
//   3 of 1,133 stayed past three). It reads "1", not NOW, and it is left out
//   of the transfer calls and BART's day: its timing is unknown.
// The moment each went to "1" rides in the payload (`ones`) for the next read.
export const BART_STUCK = 3 * 60_000;
const ONES_MAX = 30 * 60_000;
const estimatesOf = (e) => {
  const seen = new Set();
  return [].concat(e?.estimate || []).filter((x) => {
    const k = `${x.minutes}|${x.color}|${x.platform}`;
    return !seen.has(k) && seen.add(k);
  });
};
const oneKey = (st, e, x) => `${st.abbr}|${e.abbreviation}|${x.color}`;

export function parseBart({ count, bsa, etd }, { station = null, stations = [], names = {}, meets = BART_MEETS } = {}, now = Date.now(), prev = null) {
  // Each with when BART posted it: in a meltdown the cause and its age say
  // whether the system is about to grind (owner, 2026-10-30). BART's "nothing
  // to report" comes in two wordings, and both were once counted as one.
  const advisories = [].concat(bsa?.root?.bsa || [])
    .map((b) => ({ text: String(b.description?.['#cdata-section'] ?? b.description ?? '').replace(/\s+/g, ' ').trim(),
      delay: b.type === 'DELAY', posted: bsaTime(b.posted) }))
    .filter((a) => a.text && !/^no (delays reported|advisories issued)/i.test(a.text));
  // BART's own stamp, unless it is missing or far from our clock (then: when we read it)
  const stamped = bartTime(etd?.root?.date, etd?.root?.time);
  const asOf = stamped != null && Math.abs(stamped - now) < 5 * 60_000 ? stamped : now;
  const all = [].concat(etd?.root?.station || []);
  const byCode = new Map(all.map((st) => [st.abbr, st]));
  // Closed: not one station in the system lists a train, which is every night
  // once the last ones are in. That is no trouble, so no station is an issue
  // and the panel says nothing to the verdict. Read as "nowhere", not "the
  // count is 0", so an empty answer mid-day makes a quieter board, never a
  // false alarm; a fetch that fails never reaches here at all.
  const closed = !all.some((st) => [].concat(st?.etd || []).some((e) => [].concat(e.estimate || []).length));
  // each line's next train at "1": since when, and the ones stuck there. And
  // a log of what was merged and held, system-wide, for the flight record
  // (`quirks`: twins as [station, destination, line, platform, minutes,
  // listed, of them flagged dynamic]; stuck as [station, destination, line,
  // since, flagged]); docs/bart-capture/quirks.mjs adds them up.
  const ones = {};
  const stuck = new Set();
  const twins = [], held = [];
  for (const st of all) {
    for (const e of [].concat(st?.etd || [])) {
      const listed = new Map();
      for (const x of [].concat(e.estimate || [])) {
        const k = `${x.minutes}|${x.color}|${x.platform}`;
        listed.set(k, [...(listed.get(k) || []), x]);
      }
      for (const xs of listed.values()) {
        if (xs.length > 1) twins.push([st.abbr, e.abbreviation, xs[0].color, xs[0].platform, xs[0].minutes, xs.length, xs.filter((x) => x.dynamicflag === '1').length]);
      }
      const next = new Map();   // line colour -> its soonest estimate
      for (const x of estimatesOf(e)) {
        const m = /^leaving$/i.test(x.minutes) ? 0 : Number(x.minutes);
        if (Number.isFinite(m) && !(next.get(x.color)?.m <= m)) next.set(x.color, { x, m });
      }
      for (const { x, m } of next.values()) {
        if (m !== 1) continue;
        const key = oneKey(st, e, x), was = prev?.ones?.[key];
        const since = was != null && was <= asOf && asOf - was < ONES_MAX ? was : asOf;
        ones[key] = since;
        if (asOf - since > BART_STUCK) {
          stuck.add(x);
          held.push([st.abbr, e.abbreviation, x.color, since, x.dynamicflag === '1']);
        }
      }
    }
  }
  const departuresAt = (st) => [].concat(st?.etd || []).map((e) => {
    const est = estimatesOf(e);
    // each train's minutes, how late it runs and whether it is stuck at "1", kept together: in step with `mins`
    const trains = est.map((x) => [/^leaving$/i.test(x.minutes) ? 0 : Number(x.minutes), Math.max(0, Number(x.delay) || 0), stuck.has(x)])
      .filter(([m]) => Number.isFinite(m));
    const mins = trains.map(([m]) => m);
    return {
      dest: String(e.destination).toUpperCase(),
      dir: String(est[0]?.direction || '').toUpperCase(),
      color: est[0]?.hexcolor || null,
      mins,
      at: mins.map((m) => bartAt(asOf, m)),
      late: Math.max(0, ...est.map((x) => Number(x.delay) || 0)),
      lates: trains.map(([, s]) => s),
      ...(trains.some(([, , s]) => s) && { stuck: trains.map(([, , s]) => s) }),
    };
  }).filter((d) => d.mins.length).sort((a, b) => a.mins[0] - b.mins[0]);

  const watched = stations.map((code) => {
    const st = byCode.get(code);
    const name = stationName(st, code, names);
    const deps = departuresAt(st);
    // a train at the platform has arrived: late or not, no one here waits on it (owner, 2026-10-30)
    const late = Math.max(0, ...deps.flatMap((d) => d.lates.filter((_, k) => d.mins[k] > 0 && d.mins[k] <= BART_LATE_WITHIN)));
    // An advisory names a station by its full name or its short one ("Coliseum").
    const mentions = (text) => [st?.name, name].filter(Boolean)
      .some((n) => text.toLowerCase().includes(n.toLowerCase()));
    const named = st && advisories.find((a) => mentions(a.text));
    const issue = closed ? null
      : !st || !deps.length ? NO_DEPARTURES
      : late >= BART_LATE_SECONDS ? `up to ${Math.round(late / 60)} min late`
      : named ? 'BART advisory' : null;   // the text itself waits, folded, under the departures
    const transfers = meets?.[code] ? meetsAt(st, meets[code], asOf, stuck) : null;
    // Every destination: a station on four lines lists eight, and the page
    // decides how many to show. Cut here, the furthest-out train vanished
    // from the board, and its line's pip with it.
    return { code, name, issue, level: issue ? 2 : 0,
      departures: deps.map((d) => ({ ...d, mins: d.mins.slice(0, 3), at: d.at.slice(0, 3), lates: d.lates.slice(0, 3),
        ...(d.stuck && { stuck: d.stuck.slice(0, 3) }) })),
      ...(transfers && { transfers, transfer: worstMeet(transfers) }) };
  });

  const main = station ? byCode.get(station) : null;
  const trains = Number(count?.root?.traincount);
  return {
    trains: Number.isFinite(trains) ? trains : null,
    station: main ? String(main.name).toUpperCase() : null,
    home: station,
    asOf,
    closed,
    departures: departuresAt(main),
    stations: watched,
    advisories,
    // BART's own count says nothing is running: any estimate left listed is a ghost (overnight
    // 2026-11-01 one Orange train sat late in the feed from 3 am, and the day's record counted it
    // every read, 0% on time before a train had run)
    sample: closed || trains === 0 ? null : onTimeSample(all, stuck),
    ones,
    ...((twins.length || held.length) && { quirks: { twins, stuck: held } }),
    level: !closed && (advisories.some((a) => a.delay) || watched.some((w) => w.issue)) ? 1 : 0,
  };
}

// ── a train at the platform: since when, carried by the snapshot ───────────
// One reading can't say how long a train has sat at the platform, and BART
// lists one as Leaving for a minute or more after it rolls (the capture: 74 s
// at the median). So the snapshot carries the moment each was first seen
// there from its last write: the page counts the train gone a little after
// that (its expected time), and one still listed past BART_HELD_AFTER comes
// back as held. Better to walk in and find it waiting than to run for one
// that has left (owner, 2026-10-29). p90 of that night's dwell was 106 s.
// One a transfer is waiting on is held from the start (below).
export const BART_HELD_AFTER = 120_000;
const SINCE_MAX = 15 * 60_000;   // a feed stuck on Leaving for longer is no reason to keep a moment
export function carryLeaving(b, prev) {
  if (!b?.stations || b.asOf == null) return b;
  const was = new Map();
  for (const st of prev?.stations || []) {
    for (const d of st.departures || []) if (d.since != null) was.set(`${st.code}|${d.dest}|${d.color}`, d.since);
  }
  // A train standing for a transfer is held, however briefly it has stood: BART
  // waits it for the train coming in (7:44 am 2026-10-30 at MacArthur, the SF
  // train dropped from the rows while the shelf had it AT STATION).
  const mark = (st) => (d) => {
    if (d.mins?.[0] !== 0) return d;
    const kept = was.get(`${st.code}|${d.dest}|${d.color}`);
    const since = kept != null && kept <= b.asOf && b.asOf - kept < SINCE_MAX ? kept : b.asOf;
    const forMeet = (st.transfers || []).some((m) => m.status === 'here' && m.waiting && m.dest === d.dest);
    return { ...d, since, at: [since, ...d.at.slice(1)], held: forMeet || b.asOf - since > BART_HELD_AFTER };
  };
  return { ...b, stations: b.stations.map((st) => ({ ...st, departures: (st.departures || []).map(mark(st)) })) };
}

// ── BART's timetable: each watched station's first and last train of the day ──
// One schedule read per station per service day (api.bart.gov sched stnsched),
// summarised to what the board needs: when each destination's first train
// leaves, and when the last train of the day does. The live departures are
// the fact; the timetable only says when a station's quiet is expected. Before
// the first train and after the last, a station listing nothing is resting,
// not in trouble (the capture of 2026-10-29: all eight read red for 12 to 30
// minutes after their last trains while BART still ran elsewhere).
const BART_ROUTE_LINES = { 1: 'YELLOW', 2: 'YELLOW', 3: 'ORANGE', 4: 'ORANGE', 5: 'GREEN', 6: 'GREEN',
  7: 'RED', 8: 'RED', 11: 'BLUE', 12: 'BLUE', 19: 'BEIGE', 20: 'BEIGE' };
const BART_HEX = { YELLOW: '#ffff33', ORANGE: '#ff9933', GREEN: '#339933', RED: '#ff0000', BLUE: '#0099cc', BEIGE: '#d5cfa3' };
// The timetable names a train by its whole run ("OAK Airport / Berryessa/North
// San Jose"); the live feed by where it ends ("Berryessa"). Same row either way.
const HEADS = [
  [/berryessa/i, 'BERRYESSA'], [/antioch/i, 'ANTIOCH'], [/pittsburg|bay point/i, 'PITTSBURG/BAY POINT'],
  [/richmond/i, 'RICHMOND'], [/daly city/i, 'DALY CITY'], [/dublin|pleasanton/i, 'DUBLIN/PLEASANTON'],
  [/(airport|sfo).*millbrae|millbrae.*(airport|sfo)/i, 'SFO/MILLBRAE'], [/millbrae/i, 'MILLBRAE'],
  [/international airport|int'l airport|sfo/i, 'SF AIRPORT'], [/oak airport/i, 'OAK AIRPORT'],
];
const headDest = (h) => HEADS.find(([re]) => re.test(h))?.[1] ?? String(h).split(' / ').pop().toUpperCase();
// The service day's date and a clock time on it, as a moment: a time before the
// day starts (3 am) is after midnight, so it is the next calendar day.
function onServiceDay(day, minutes, tz) {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes + (minutes * 60_000 < DAY_STARTS ? 24 * 60 : 0));
  const offset = (t) => {
    const p = zoneClock(t, tz);
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - t;
  };
  // The zone's offset taken out, then taken again at the moment it gave: on
  // the day the clocks change, the wall time read as UTC can sit on the other
  // side of the change (Sunday 2026-11-01's 8:07 am train read as 7:07 once).
  const first = wall - offset(wall);
  return wall - offset(first);
}
const FIRST_WITHIN = 90 * 60_000;
const clockMinutes = (t) => {
  const x = /^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(String(t ?? '').trim());
  return x ? (Number(x[1]) % 12) * 60 + Number(x[2]) + (x[3] === 'PM' ? 720 : 0) : null;
};

/**
 * A station's day from BART's schedule: `first`, each destination's first
 * train as [destination, line colour, when], soonest first; `opens`, the
 * first of them; `last`, when the day's last train leaves. Null when the
 * answer has no trains.
 */
export function parseTimetable(json, day, tz = 'UTC') {
  const items = [].concat(json?.root?.station?.item || []);
  const seen = new Map();
  let last = null;
  for (const it of items) {
    const mins = clockMinutes(it['@origTime']);
    if (mins == null) continue;
    const at = onServiceDay(day, mins, tz);
    const line = BART_ROUTE_LINES[Number(String(it['@line']).replace(/\D/g, ''))] || null;
    const key = `${headDest(it['@trainHeadStation'])}|${line}`;
    if (!seen.has(key) || at < seen.get(key)[2]) seen.set(key, [headDest(it['@trainHeadStation']), BART_HEX[line] || null, at]);
    if (last == null || at > last) last = at;
  }
  if (!seen.size) return null;
  // the morning's trains: a line whose first run is the evening's is no help at 4 am
  const all = [...seen.values()].sort((a, b) => a[2] - b[2]);
  const first = all.filter((f) => f[2] - all[0][2] <= FIRST_WITHIN);
  const name = String(json?.root?.station?.name || '').trim();
  return { first, opens: first[0][2], last, ...(name && { name }) };
}

/**
 * BART as the board shows it, with the timetable's word on quiet stations:
 * one listing nothing before its first train or after its last is resting
 * (`rests`), so it is no issue, and the panel's level is taken again without
 * it. A resting station is closed for whoever picked it, whatever still runs
 * elsewhere: the night of 2026-10-30 a train at Milpitas sat at "Leaving" in
 * BART's feed from 2:16 to 4:31 am, so `closed` (nothing listed anywhere)
 * never came, and the big line counted trains down past MacArthur's last
 * (js/page-city.js drawBartHead).
 */
export function settleBart(b, timetable, now) {
  if (!b || !timetable?.stations) return b;
  let moved = false;
  const stations = (b.stations || []).map((st) => {
    const t = timetable.stations[st.code];
    if (!t) return st;
    // BART leaves a station with no trains out of its feed, name and all: the timetable still has it
    const named = st.name === st.code && t.name ? { ...st, name: stationName(t, st.code) } : st;
    if (named !== st) moved = true;
    if (st.departures?.length || !(now < t.opens || now > t.last)) return named;
    moved = true;
    return { ...named, issue: null, level: 0, rests: true };
  });
  if (!moved) return b;
  return { ...b, stations, level: !b.closed && ((b.advisories || []).some((a) => a.delay) || stations.some((w) => w.issue)) ? 1 : 0 };
}

// ── BART's day: the minute's sample, kept by the snapshot ──────────────────
// Of the next train to each destination at every station in the system, how
// many run within BART_LATE_SECONDS of the timetable: BART's own line for
// late. A cancelled train is late. On or off, never an average: in a
// meltdown BART's `delay` reads 3,000 s and more, which would swamp a mean,
// while a share of trains on time just reads low, which is true. It is the
// board's reading of BART's feed, not BART's own on-time figure (that one is
// measured at the rider's destination).
function onTimeSample(all, stuck = new Set()) {
  let on = 0, n = 0;
  const late = {};
  for (const st of all) {
    for (const e of [].concat(st?.etd || [])) {
      const x = estimatesOf(e)[0];
      if (!x || stuck.has(x)) continue;   // a train stuck at "1" says nothing about the timetable
      n++;
      if (Number(x.delay) < BART_LATE_SECONDS && x.cancelflag !== '1') on++;
      else if (x.color) late[x.color] = (late[x.color] || 0) + 1;
    }
  }
  return n ? { on, n, late } : null;
}

// The day runs from 3 am to 3 am in the city's zone, so the last trains
// after midnight count to the day they ran in. Bins of RECORD_BIN minutes:
// a service day is about 80 of them, one row of dots across a phone.
export const RECORD_BIN = 15;
export const RECORD_DAYS = 35;
const DAY_STARTS = 3 * HOUR;
const zoneParts = new Map();
/** A moment's calendar date and 24-hour clock in a zone, as parts. */
function zoneClock(t, tz) {
  if (!zoneParts.has(tz)) {
    zoneParts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  return Object.fromEntries(zoneParts.get(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
}
/** The service day (`YYYY-MM-DD`) a moment belongs to, and its bin within that day. */
export function serviceDay(now, tz = 'UTC') {
  const p = zoneClock(now - DAY_STARTS, tz);
  return { day: `${p.year}-${p.month}-${p.day}`, bin: Math.floor((Number(p.hour) * 60 + Number(p.minute)) / RECORD_BIN) };
}

const share = (on, n) => (n ? Math.round((on / n) * 1000) / 1000 : null);
const BINS = (24 * 60) / RECORD_BIN;

/**
 * Today's record with this minute's reading in, and the day just finished
 * when this minute starts a new one. `bart` is the minute's own BART read, or
 * null when it failed or BART is closed: nothing is counted then, so a
 * reading is never counted twice and a closed hour stays empty. Each bin is
 * [on time, counted, most trains running]; the record keeps the last
 * RECORD_DAYS days' scores, and a finished day goes out whole to be filed.
 */
export function recordDay(record, bart, now, tz) {
  const { day, bin } = serviceDay(now, tz);
  let rec = record?.day ? record : { day, bins: Array(BINS).fill(null), late: {}, days: [] };
  let done = null;
  if (rec.day !== day) {
    done = closeDay(rec);
    rec = { day, bins: Array(BINS).fill(null), late: {},
      days: [...(rec.days || []), ...(done ? [{ day: done.day, score: done.score }] : [])].slice(-RECORD_DAYS) };
  }
  const s = bart?.sample;
  if (s) {
    const bins = rec.bins.slice();
    const [on = 0, n = 0, trains = 0] = bins[bin] || [];
    bins[bin] = [on + s.on, n + s.n, Math.max(trains, bart.trains || 0)];
    const late = { ...rec.late };
    for (const [line, k] of Object.entries(s.late || {})) late[line] = (late[line] || 0) + k;
    rec = { ...rec, bins, late };
  }
  return { record: rec, done };
}

/** A finished day as it is filed: its score, its bins, its first and last train, and the line most often late. */
function closeDay(rec) {
  const lit = rec.bins.map((b, i) => (b && b[1] && b[2] ? i : -1)).filter((i) => i >= 0);   // trains running (b[2])
  if (!lit.length) return null;   // a day with nothing counted (the Worker was down) files nothing
  const on = lit.reduce((t, i) => t + rec.bins[i][0], 0), n = lit.reduce((t, i) => t + rec.bins[i][1], 0);
  const worst = Object.entries(rec.late || {}).sort((a, b) => b[1] - a[1])[0];
  return {
    day: rec.day, score: share(on, n), binMinutes: RECORD_BIN, startsAt: '03:00',
    first: lit[0], last: lit[lit.length - 1],
    trains: Math.max(...lit.map((i) => rec.bins[i][2] || 0)),
    worstLine: worst ? worst[0] : null,
    bins: rec.bins.map((b) => (b && b[1] ? share(b[0], b[1]) : null)),
  };
}

// ── transfers: the meets BART plans, and whether they are holding ───────────
// Curated, not derived: the connections BART's own trip planner routes riders
// through at the watched stations (api.bart.gov sched depart, 2026-10-29, a
// weekday morning and that night alike). In Oakland it plans them at
// MacArthur and 19th St, each a step across the platform (MacArthur's
// southbound island is platforms 2 and 4, 19th St's northbound 1 and 3), and
// none at 12th St or West Oakland. A meet is the train you arrive on and the
// one you step onto, each matched by destination code AND line colour: a
// SFO-bound red train at MacArthur came from Richmond, a yellow one from
// Antioch. `planned` is the timetable's gap in minutes. `timed`: BART holds
// the connecting train a little for it; `window`, how many minutes out a call
// on the hold is worth making (owner, 2026-10-29: a rider looks that up just
// before the station, not ten minutes out). The night of 2026-10-29 every
// 19th St meet was made, so it is timed too. Re-check against the planner
// when BART changes its timetable.
export const BART_MEETS = {
  MCAR: [
    // its SF train waits under two minutes: the capture's misses, night and rush (2026-10-30)
    // and leaves on its own time: due out before yours, or just after, it is TIGHT at any distance (`strict`, meetsAt)
    { name: 'richmond › sf', from: { dest: ['BERY'], line: ['ORANGE'] }, to: { dest: ['SFIA', 'MLBR'], line: ['YELLOW'] }, planned: 1, timed: true, window: 5, hold: 1.5, strict: true },
    { name: 'antioch › san jose', from: { dest: ['SFIA', 'MLBR'], line: ['YELLOW'] }, to: { dest: ['BERY'], line: ['ORANGE'] }, planned: 3, timed: true, window: 5 },
  ],
  '19TH': [
    { name: 'sf › richmond', from: { dest: ['ANTC'], line: ['YELLOW'] }, to: { dest: ['RICH'], line: ['ORANGE', 'RED'] }, planned: 1, timed: true, window: 3 },
    { name: 'san jose › antioch', from: { dest: ['RICH'], line: ['ORANGE'] }, to: { dest: ['ANTC'], line: ['YELLOW'] }, planned: 1, timed: true, window: 3 },
  ],
};
// How long a timed meet's train waits for the one coming in, in minutes. It
// isn't rigid (owner, on the platform, 2026-10-30): at the platform it
// generally waits up to about three minutes, and at five or more it goes.
// The capture of 2026-10-29 saw waits of 60 to 105 seconds, and two riders a
// minute or two behind left on the platform. So between the two the call is
// TIGHT, and the number is always the train's own time: the board shows the
// safest number and never promises a hold.
export const BART_SAME = 1;   // due out within a minute of yours getting in: you arrive together
export const BART_HOLD = 3;   // at the platform, it generally waits this long for yours; a meet may set its own (`hold`)
export const BART_MISS = 5;   // due out this far before yours, it goes without you
// The station's headline: the worst call, and among the good ones the most telling.
const MEET_ORDER = ['missed', 'late', 'tight', 'here', 'arriving', 'go', 'open'];

/**
 * Each meet at a station as it stands: when your train gets in (`arrive`),
 * when the one you can catch leaves (`leave`) and where it goes (`dest`, as
 * the departures name it, so the page can find it in the rows), and what
 * that adds up to.
 * Far out, the call answers one question, is the train you will step onto
 * on time; inside the meet's `window` it also says whether you will make it.
 * It leans on the expected times: a train due to leave before yours gets in
 * reads as gone, and a later reading that has it still at the platform
 * brings it back as here (owner, 2026-10-29: better to walk in and find it
 * waiting than to run for one that has left). Each call says what the train
 * you step onto is doing, not what BART does with it: "held" needed telling
 * what it meant, to a rider already at the transfer station (owner, 2026-10-30).
 *   go       the train you step onto is on time and inside the timetable's gap
 *   late     it is 5+ minutes late and leaves well after yours gets in, so you wait
 *            on it. Late but still meeting yours is on time: to a rider already
 *            on the train, the meet is all that matters (owner, 2026-10-30)
 *   here     (close) it is at the platform now, within BART_HOLD of yours: it generally waits
 *   arriving (close) it is due within BART_SAME of yours: you get in together
 *   go       also when it gets there ahead of yours by no more than BART_HOLD: a little
 *            early is on time, and it waits (owner, 8:14 am 2026-10-30: two minutes
 *            ahead read TIGHT; "it's not tight, just on time")
 *   tight    (close) the same on a meet BART does not hold; or due out past BART_HOLD and
 *            short of BART_MISS minutes before yours, or the night's last: it may wait, it may not
 *   missed   it goes BART_MISS or more before yours, and yours is running late
 *            enough to account for it; `left` is when, `leave` the next one
 *   open   a long wait: shown, not judged
 * Your train at the platform keeps its meet while the train you step onto
 * is still to leave inside the timetable's gap: you are stepping across, and
 * that is the number you need (the owner at 6:43 am, 2026-10-30: the
 * Berryessa in 3, not the next yellow's in 23). Once that train has gone, the
 * meet after it is the one worth showing (11:46 pm the night before: a
 * finished transfer read `NOW › 18` under ON TIME). Both at the platform at
 * once is `here`. A meet with either train missing from the feed (a line not
 * running) is left out.
 */
function meetsAt(st, meets, asOf, stuck = new Set()) {
  const trains = (side) => [].concat(st?.etd || []).filter((e) => side.dest.includes(e.abbreviation))
    .flatMap((e) => estimatesOf(e).filter((x) => side.line.includes(x.color) && !stuck.has(x)).map((x) => {
      const now = /^leaving$/i.test(x.minutes);
      return { at: bartAt(asOf, now ? 0 : Number(x.minutes)), now, late: Number(x.delay) || 0, color: x.hexcolor || null,
        dest: String(e.destination ?? '').toUpperCase() };
    }))
    .filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
  return meets.map((m) => {
    const from = trains(m.from), to = trains(m.to);
    const stillMeets = (x) => to.some((t) => t.at >= x.at && (t.at - x.at) / 60_000 <= m.planned + 2);
    const you = from.find((x) => !x.now || stillMeets(x));
    if (!you || !to.length) return null;
    const next = to.find((x) => x.at >= you.at);
    const before = to.filter((x) => x.at < you.at).pop();
    const gap = before ? (you.at - before.at) / 60_000 : null;
    const wait = next ? (next.at - you.at) / 60_000 : null;
    const close = (you.at - asOf) / 60_000 <= m.window;
    // how long this meet's train waits: the owner's three minutes, or what the captures measured for it
    const hold = m.hold ?? BART_HOLD;
    const holds = before && (gap <= BART_SAME || (before.now && gap <= hold));
    // A strict meet's train leaves on its own time (MacArthur's SF train: it
    // waits a minute and a half at most). Due out before yours, or within a
    // minute after, is a coin toss at any distance, unless it is standing
    // there for you: called on time far out, those were missed two times in
    // three (every record to 2026-10-30: 4 made, 8 missed); TIGHT all the way
    // in reads true and flips less (the rush: 9.7 changes an hour, from 12).
    const toss = m.strict && next && wait < BART_SAME && !(close && next.now);
    let status, on = next, left = null;
    if (close && holds) { status = !m.timed ? 'tight' : before.now ? 'here' : 'arriving'; on = before; }
    // they meet: whatever either is running, that is on time for the transfer
    else if (next && wait <= m.planned + 2 && !toss) status = close && next.now ? 'here' : 'go';
    else if (toss) status = 'tight';
    // a little early is on time too: it gets there first and waits
    else if (m.timed && !m.strict && before && gap <= hold) { on = before; status = 'go'; }
    // missed, on evidence at any distance: it goes BART_MISS or more before yours, and yours runs late enough to explain it
    else if (before && next && gap >= BART_MISS && you.late >= BART_LATE_SECONDS && you.late / 60 >= gap - BART_MISS) { status = 'missed'; left = before.at; }
    // short of that it is fuzzy, and the night's last connection BART holds (12:58 that night was made)
    else if (close && before && (gap < BART_MISS || !next)) { status = 'tight'; on = before; }
    else if (before && gap < BART_MISS) { on = before; status = m.strict ? 'tight' : 'go'; }   // far out: they meet, as far as anyone can tell yet (strict: a toss)
    else if (!next) return null;
    else status = next.late >= BART_LATE_SECONDS ? 'late' : 'open';
    return {
      name: m.name, colors: [you.color, on?.color ?? null],
      arrive: you.at, leave: on?.at ?? null, dest: on?.dest || null, left,
      arrived: you.now, waiting: !!on?.now,   // your train, and the one you step onto, at the platform as BART read it
      late: status === 'late' ? on.late : status === 'missed' ? you.late : 0, status,
    };
  }).filter(Boolean);
}
const worstMeet = (meets) => (meets.length ? MEET_ORDER.find((s) => meets.some((m) => m.status === s)) : null);

// ── the airport (FAA National Airspace System status, XML) ──────────────────
// The FAA lists only airports with something going on, so absent is normal.
const FAA_KINDS = [
  [/Airport Closures/i, 'CLOSED', 2],
  [/Ground Stop/i, 'GROUND STOP', 2],
  [/Ground Delay/i, 'GROUND DELAY', 1],
  [/Arrival\/Departure Delay/i, 'DELAYS', 1],
];
export function parseAirport(xml, code) {
  const found = [];
  for (const block of String(xml).split('<Delay_type>').slice(1)) {
    const name = (/<Name>([^<]*)<\/Name>/.exec(block) || [])[1] || '';
    const kind = FAA_KINDS.find(([re]) => re.test(name));
    if (!kind) continue;
    for (const entry of block.split(/<ARPT>/).slice(1)) {
      if (!entry.startsWith(`${code}<`)) continue;
      const reason = (/<Reason>([^<]*)<\/Reason>/.exec(entry) || [])[1] || '';
      const avg = (/<Avg>([^<]*)<\/Avg>/.exec(entry) || /<Max>([^<]*)<\/Max>/.exec(entry) || [])[1] || '';
      found.push({ status: kind[1], level: kind[2], reason: reason.trim(), delay: avg.trim() });
    }
  }
  found.sort((a, b) => b.level - a.level);
  return found[0] ? { code, ...found[0] } : { code, status: 'NORMAL', level: 0, reason: '', delay: '' };
}

// ── freeway signs (Caltrans changeable message signs) ───────────────────────
const SIGN_TEST = /SIGN TEST|ABCDEFGH|1234567890/;
// A picture, not words: the sign's own command to draw stored graphic n at
// column x, row y ("[g1,1,1,F5F9]" in NTCIP's MULTI, the last part the
// picture's id), which the feed passes through as a line. The picture itself
// isn't in the feed, so the line is dropped, and a sign with only a picture
// isn't shown.
const GRAPHIC = /^\[?G\d+(?:,\d+){2}(?:,[0-9A-F]{4})?\]?$/i;
// A travel-time line for San Francisco, as a sign writes it: "SF DWNTWN 10 MIN".
const TO_SF = /^(?:SF|S\.F\.)(?: DWNTWN| DOWNTOWN)?\s+(\d+)\s*MIN$/;

/**
 * The message signs in the box, each message once and incidents first, and
 * `toSF`: the minutes to San Francisco over the Bay Bridge that the sign
 * nearest the bridge (westernmost) is posting, or null when none is.
 */
export function parseSigns(json, { routes = [], box = null, max = 6 } = {}) {
  const seen = new Set(), out = [];
  let toSF = null;
  for (const { cms } of json.data || []) {
    const L = cms.location, m = cms.message;
    if (cms.inService !== 'true' || !/page/i.test(m.display || '')) continue;
    if (routes.length && !routes.includes(L.route)) continue;
    if (box) {
      const lat = Number(L.latitude), lon = Number(L.longitude);
      if (!(lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3])) continue;
    }
    const lines = [1, 2, 3].map((i) => (m.phase1?.[`phase1Line${i}`] || '').trim()).filter((l) => l && !GRAPHIC.test(l));
    const text = lines.join('\n');
    for (const line of lines) {
      const sf = TO_SF.exec(line.replace(/\s+/g, ' '));
      const lon = Number(L.longitude);
      if (sf && (!toSF || lon < toSF.lon)) toSF = { mins: Number(sf[1]), near: L.nearbyPlace || '', route: L.route, lon };
    }
    if (!text || SIGN_TEST.test(text) || seen.has(text)) continue;
    seen.add(text);
    out.push({ route: L.route, dir: String(L.direction || '').toUpperCase(), near: L.nearbyPlace || '', lines,
      level: /CLOSED|CLSD|BLKD|BLOCKED|CRASH|FIRE|COLLISION|HAZARD|FLOOD/.test(text) ? 1 : 0 });
  }
  return {
    list: out.sort((a, b) => b.level - a.level).slice(0, max),
    toSF: toSF && { mins: toSF.mins, near: toSF.near, route: toSF.route },
  };
}

// ── the Bay Bridge, when the signs aren't posting a time ────────────────────
// The signs post the minutes to San Francisco by day and go quiet at night
// (owner, 2026-10-31: "useful to know what's going on that bridge at all
// times"). Nobody else posts that number (Caltrans has no Bay Area travel-time
// feed, 511 none at all), so after hours the readout says what is true of the
// bridge instead: a crash or stall CHP has reported on it (511), lanes Caltrans
// crews have closed right now, or that none are reported, with the next
// planned closure. `bridge` is the config's { route, box: [south, west, north,
// east] } around the span and its approaches.
const inBox = (lat, lon, box) => lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];
const DIRS = { westbound: 'WB', eastbound: 'EB', west: 'WB', east: 'EB' };
const dirOf = (s) => DIRS[String(s || '').toLowerCase().replace(/\s.*$/, '')] || '';
// what CHP calls it, in a sign's words
const INCIDENT_KINDS = [[/collision|crash/i, 'CRASH'], [/fire/i, 'FIRE'], [/stall|disabled/i, 'STALL'],
  [/debris|hazard|object/i, 'HAZARD'], [/spill/i, 'SPILL']];

/**
 * CHP's incidents on the bridge, from 511's traffic events (api.511.org
 * traffic/events): newest first, each { kind, dir, text, level, at }. `text` is
 * 511's headline without its "CHP :" prefix; `level` 2 when 511 calls it
 * major or a lane is blocked, else 1.
 */
export function parseIncidents(json, bridge) {
  const out = [];
  for (const e of json?.events || []) {
    if (e.event_type !== 'INCIDENT' || (e.status && e.status !== 'ACTIVE')) continue;
    const roads = e.roads || [];
    const road = roads.find((r) => !bridge.route || String(r.name || '').startsWith(bridge.route));
    if (!road) continue;
    const [lon, lat] = e.geography?.type === 'Point' ? e.geography.coordinates.map(Number) : [];
    if (!inBox(lat, lon, bridge.box)) continue;
    // "CHP : Traffic Collision on I-80 Westbound east of Treasure Island Rd (San Francisco). Right shoulder affected. Expect delays."
    const text = String(e.headline || '').replace(/^\s*CHP\s*:\s*/i, '').replace(/\s*Expect delays\.?\s*$/i, '')
      .replace(/\s*\([^)]*\)/g, '').replace(/\.\s+/g, ' · ').replace(/\.\s*$/, '').trim();
    const kind = (INCIDENT_KINDS.find(([re]) => re.test(text)) || [null, 'INCIDENT'])[1];
    out.push({ kind, dir: dirOf(road.direction), text,
      level: /major|severe/i.test(e.severity || '') || /blocked|closed/i.test(text) ? 2 : 1,
      at: Date.parse(e.created || e.updated) || null });
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

// "LShoulder, 1, 2, 3" is three lanes; "All" is every one; shoulders aren't lanes
const lanesIn = (s, of) => (/all/i.test(s) ? of : String(s || '').split(',').filter((x) => /^\s*\d+\s*$/.test(x)).length);
// A wall-clock time in a zone ("2026-11-01T22:01:00", America/Los_Angeles) as a moment.
function zoneTime(local, tz) {
  const guess = Date.parse(`${local}Z`);
  const p = zoneClock(guess, tz);
  return guess - (Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - guess);
}
const lcsTime = (ts, k, tz) => {
  const d = ts?.[`closure${k}Date`], t = ts?.[`closure${k}Time`];
  return d && t ? zoneTime(`${d}T${t}`, tz) : null;
};

/**
 * Caltrans' lane closures on the bridge (cwwp2 lcsStatusD04.json), reduced to
 * the span: `now`, the closures crews have started and not yet ended (LCS
 * codes 1097 and 1098), and `planned`, the ones still to come, soonest first.
 * Each { dir, lanes, of, from, until, work, where, ramp }. A ramp closure is
 * kept apart (`ramp`): it closes an exit, not the bridge.
 */
export function parseClosures(json, bridge, now = Date.now(), tz = 'UTC') {
  const live = [], planned = [];
  for (const row of json?.data || []) {
    const r = row.lcs || row, L = r.location || {}, c = r.closure || {};
    const b = L.begin || {}, e = L.end || {};
    if (bridge.route && b.beginRoute !== bridge.route) continue;
    if (!inBox(Number(b.beginLatitude), Number(b.beginLongitude), bridge.box)
      && !inBox(Number(e.endLatitude), Number(e.endLongitude), bridge.box)) continue;
    const from = lcsTime(c.closureTimestamp, 'Start', tz), until = lcsTime(c.closureTimestamp, 'End', tz);
    if (!until || until <= now) continue;
    const of = Number(c.totalExistingLanes) || 0;
    const item = {
      dir: dirOf(L.travelFlowDirection), lanes: lanesIn(c.lanesClosed, of), of, from, until,
      work: String(c.typeOfWork || '').toLowerCase(),
      where: [b.beginLocationName, e.endLocationName].filter(Boolean).join(' to ').toLowerCase(),
      ramp: /ramp/i.test(`${c.facility || ''} ${b.beginLocationName || ''} ${e.endLocationName || ''}`),
    };
    const started = c.code1097?.isCode1097 === 'true', ended = c.code1098?.isCode1098 === 'true';
    if (started && !ended) live.push(item);
    else if (!started && from > now) planned.push(item);
  }
  planned.sort((a, b) => a.from - b.from);
  return { now: live, planned: planned.slice(0, 6) };
}

// AFTER HOURS (the label, and the moon) when no sign is posting the minutes between 10 pm and
// 5:30 am. From the flight recorder, 2026-10-30/31: the signs stopped posting the time at 10:04
// and 10:07 pm and started again at 5:07 am, so this is Caltrans' own night, with a margin in the
// morning. The readout itself follows the signs: the minutes come back the moment one posts them.
const AFTER_HOURS = [22 * 60, 5 * 60 + 30];   // minutes past midnight, local
const DIR_WORD = { WB: 'westbound', EB: 'eastbound' };

/**
 * What the Bay Bridge readout says. By day, while a sign posts the minutes,
 * the minutes (`mode: 'time'`), with a crash on the bridge in the line under
 * them. When no sign is posting, the bridge itself (`mode: 'status'`): a crash
 * or stall on it first, then lanes closed right now, else NO CLOSURES with the
 * next planned one; `after` is true from 10 pm to 5:30 am, when the board calls it
 * AFTER HOURS and puts the moon out. `text` may carry a line break.
 */
export function bridgeStatus(s, now, tz = 'UTC', cfg = null) {
  const head = { ...(cfg?.label && { label: cfg.label }), ...(cfg?.toLabel && { toLabel: cfg.toLabel }) };
  const clockLow = (t) => clockAt(t, tz).toLowerCase().replace(':00', '');
  // a planned window to the nearest five minutes: Caltrans books 10:01 pm and 6:59 am
  const plan = (t) => clockLow(Math.round(t / 300_000) * 300_000);
  // within half a day the time is enough ("until 5 am"); further off, the day too ("next: sun 10 pm")
  const when = (t) => {
    if (Math.abs(t - now) < 12 * HOUR) return plan(t);
    const p = zoneClock(t, tz), q = zoneClock(now, tz);
    const day = p.day === q.day ? 'today' : new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(t)).toLowerCase();
    return `${day} ${plan(t)}`;
  };
  const toSF = s.signs?.toSF || null;
  const incidents = s.incidents || [];
  const closures = s.closures || { now: [], planned: [] };
  const clock = zoneClock(now, tz), mins = Number(clock.hour) * 60 + Number(clock.minute);
  const after = mins >= AFTER_HOURS[0] || mins < AFTER_HOURS[1];
  const crash = incidents[0];
  const crashLine = crash && `${crash.text.toLowerCase()}${crash.at ? ` · reported ${clockLow(crash.at)}` : ''} (CHP via 511)`;
  if (toSF) {
    return { ...head, mode: 'time', after: false, text: `${toSF.mins} MIN`, level: crash ? crash.level : 0,
      sub: crashLine || `as posted on the ${toSF.route.replace('I-', '')} sign at ${toSF.near.toLowerCase()}` };
  }
  if (!s.signs && !s.closures && !s.incidents) return null;
  if (crash) return { ...head, mode: 'status', after, level: crash.level, text: `${crash.kind} ${crash.dir}`.trim(), sub: crashLine };
  // without a current read of the closures it can't say none are reported: the old dark readout
  if (!s.closures) return { ...head, mode: 'status', after, level: 0, text: '--', sub: 'no time posted on the signs right now; they post it by day' };
  const lanesNow = closures.now.filter((c) => !c.ramp && c.lanes > 0).sort((a, b) => b.lanes - a.lanes);
  if (lanesNow.length) {
    const c = lanesNow[0], all = c.of && c.lanes >= c.of;
    return { ...head, mode: 'status', after, level: all ? 2 : 1, text: `${all ? 'ALL LANES' : `${c.lanes} OF ${c.of} LANES`}\nCLOSED ${c.dir}`.trim(),
      sub: `${[`until ${when(c.until)}`, c.work, c.where].filter(Boolean).join(' · ')} (Caltrans)` };
  }
  const ramp = closures.now.find((c) => c.ramp);
  const next = closures.planned.find((c) => !c.ramp && c.lanes > 0);
  return { ...head, mode: 'status', after, level: 0, text: 'NO CLOSURES',
    sub: [`none reported by ${s.incidents ? 'Caltrans or CHP' : 'Caltrans'}`,
      ramp && `${DIR_WORD[ramp.dir] || ''} ${ramp.where.split(' to ').pop()} ramp closed`.trim(),
      next && `next: ${when(next.from)}, ${next.lanes} of ${next.of} lanes ${DIR_WORD[next.dir] || ''}`.trim(),
    ].filter(Boolean).join(' · ') };
}

// ── water: the tide (NOAA CO-OPS) ───────────────────────────────────────────
const utc = (t) => Date.parse(`${t.replace(' ', 'T')}:00Z`);

export function parseTide({ observed, predicted, datums, flood }, now) {
  const obs = (observed.data || []).filter((r) => r.v !== '').map((r) => [utc(r.t), Number(r.v)]);
  const pred = (predicted.predictions || []).map((r) => [utc(r.t), Number(r.v)]);
  const predAt = new Map(pred);
  const mllw = (datums.datums || []).find((d) => d.name === 'MLLW')?.value;
  const mhhw = (datums.datums || []).find((d) => d.name === 'MHHW')?.value;
  if (!obs.length || !pred.length || mllw == null) return null;
  const [obsT, obsV] = obs[obs.length - 1];
  const surge = predAt.has(obsT) ? obsV - predAt.get(obsT) : 0;
  const ahead = pred.filter(([t]) => t > now && t <= now + 24 * HOUR);
  const next = ahead.reduce((a, b) => (b[1] > a[1] ? b : a), ahead[0] || [null, null]);
  const past = obs.filter(([t]) => t > now - 24 * HOUR);
  const peak = past.reduce((a, b) => (b[1] > a[1] ? b : a), past[0] || [null, null]);
  const minor = flood.nos_minor != null ? flood.nos_minor - mllw : null;
  const moderate = flood.nos_moderate != null ? flood.nos_moderate - mllw : null;
  const expect = next[1] != null ? next[1] + surge : null;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  // A day of curve for the page's chart: what happened, then what's predicted, every 30 minutes.
  const thin = (rows) => rows.filter(([t]) => t % (30 * 60_000) === 0).map(([t, v]) => [t, r1(v)]);
  return {
    now: r1(obsV), at: obsT, surge: r1(surge),
    peak: { v: r1(peak[1]), t: peak[0] }, next: { v: r1(next[1]), t: next[0] }, expect: r1(expect),
    minor: r1(minor), moderate: r1(moderate), mhhw: mhhw != null ? r1(mhhw - mllw) : null,
    level: Math.max(level(expect, [minor != null ? minor - TIDE_NEAR : null, moderate]), level(peak[1], [minor, moderate])),
    series: {
      obs: thin(obs.filter(([t]) => t > now - 12 * HOUR)),
      pred: thin(pred.filter(([t]) => t > now - 12 * HOUR && t <= now + 12 * HOUR)),
    },
  };
}

// ── water: gauges (California Data Exchange Center) ─────────────────────────
// CDEC reports Pacific Standard Time all year.
const PST = -8 * HOUR;
// CDEC writes its dates unpadded ("2026-11-1 1:00"), in Pacific standard time all year; Date.parse
// reads only the padded form, so every hour before 10 and every day before the 10th came back
// NaN, and on 2026-11-01 the whole day did: a third of an inch fell in the hills unseen.
const cdecTime = (s) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - PST : NaN;
};
export function cdecSeries(rows) {
  return (rows || []).filter((r) => r.value != null && r.value > -9000)
    .map((r) => [cdecTime(r.date), Number(r.value)])
    .filter(([t]) => Number.isFinite(t))
    .sort((a, b) => a[0] - b[0]);
}
const valueAt = (series, when) => {
  let v = null;
  for (const [t, x] of series) { if (t <= when) v = x; else break; }
  return v;
};

/** A running rain total → inches in the last hour and day (never negative across the Oct 1 reset). */
export function parseRain(rows) {
  const s = cdecSeries(rows);
  if (!s.length) return null;
  const [t, v] = s[s.length - 1];
  const since = (h) => { const b = valueAt(s, t - h * HOUR); return b == null ? null : Math.max(0, Math.round((v - b) * 100) / 100); };
  const hour = since(1), day = since(24);
  return { kind: 'rain', at: t, hour, day, level: Math.max(level(hour, RAIN_HOUR), level(day, RAIN_DAY)) };
}

/** A creek's water level → now, the change over the last hour, and the two-day high. */
export function parseStage(rows) {
  const s = cdecSeries(rows);
  if (!s.length) return null;
  const [t, v] = s[s.length - 1];
  const before = valueAt(s, t - HOUR);
  const change = before == null ? null : Math.round((v - before) * 100) / 100;
  return { kind: 'stage', at: t, ft: v, change, high: Math.max(...s.map((x) => x[1])), level: level(change, CREEK_RISE) };
}

/** USGS Water Services Instantaneous Values (national creek stage 00065 or incremental rain 00045) → the same gauge shape. */
export function parseUsgs(json, kind = 'stage') {
  const raw = json?.value?.timeSeries?.[0]?.values?.[0]?.value || [];
  const s = raw.map((r) => [Date.parse(r.dateTime), Number(r.value)])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v) && v > -9000)
    .sort((a, b) => a[0] - b[0]);
  if (!s.length) return null;
  const [t, v] = s[s.length - 1];
  if (kind === 'rain') {
    const sum = (h) => Math.round(s.filter(([ts]) => ts > t - h * HOUR).reduce((acc, [, x]) => acc + Math.max(0, x), 0) * 100) / 100;
    const hour = sum(1), day = sum(24);
    return { kind: 'rain', by: 'USGS', at: t, hour, day, level: Math.max(level(hour, RAIN_HOUR), level(day, RAIN_DAY)) };
  }
  const before = valueAt(s, t - HOUR);
  const change = before == null ? null : Math.round((v - before) * 100) / 100;
  return { kind: 'stage', by: 'USGS', at: t, ft: v, change, high: Math.max(...s.map((x) => x[1])), level: level(change, CREEK_RISE) };
}

// ── El Niño (NOAA Climate Prediction Center's discussion page) ──────────────
const LONG_DATE = /\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/g;
// The page writes ñ, ° and % as entities (`El Ni&ntilde;o`, `&deg;C`, `83&#37;`).
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ntilde: 'ñ', Ntilde: 'Ñ', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

export function parseEnso(html) {
  const text = decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const m = /ENSO Alert System Status:\s*(.+?)\s+Synopsis:\s*(.+?\.)(?=\s+[A-Z])/.exec(text);
  if (!m) return null;
  const dates = text.match(LONG_DATE) || [];
  const nino = /([+-]?\d+\.\d)\s*°C in Niño-3\.4/.exec(text);
  return {
    status: m[1].trim().toUpperCase(),
    synopsis: m[2].trim(),
    nino34: nino ? Number(nino[1]) : null,
    issued: dates[0] || null,
    next: dates[1] || null,
  };
}

// ── earthquakes (USGS, within a radius of the city) ─────────────────────────
export function parseQuakes(json, now) {
  return (json.features || []).map(({ properties: p }) => ({
    mag: Math.round(p.mag * 10) / 10, place: String(p.place || '').toUpperCase(), t: p.time,
    level: now - p.time < 24 * HOUR ? (p.mag >= 5 ? 2 : p.mag >= 4 ? 1 : 0) : 0,
  })).sort((a, b) => b.t - a.t).slice(0, 3);
}

// ── the verdict ─────────────────────────────────────────────────────────────
/**
 * The board's one line: the most urgent thing true right now, or ALL CLEAR.
 * Sections that are missing say nothing, so a source being down can never
 * produce a false alarm, only a quieter board.
 */
export function verdict(s) {
  const pick = (lvl) => {
    const a = (s.alerts || []).find((x) => x.level === lvl);
    if (a) return a.event;
    if (s.airport?.level === lvl) return `${s.airport.code} ${s.airport.status}`;
    if (s.air?.level === lvl) return lvl === 2 ? 'UNHEALTHY AIR' : 'POOR AIR';
    const q = (s.quakes || []).find((x) => x.level === lvl);
    if (q) return `M${q.mag} EARTHQUAKE`;
    if (s.tide?.level === lvl) return lvl === 2 ? 'TIDAL FLOODING' : 'HIGH TIDE';
    const g = (s.gauges || []).find((x) => x?.level === lvl);
    if (g) return g.kind === 'rain' ? 'HEAVY RAIN' : 'CREEK RISING';
    if (lvl === 1 && s.bart?.level === 1) return `${s.bart.label || 'BART'} DELAYS`;
    if (lvl === 1 && (s.signs?.list || []).some((x) => x.level)) return 'FREEWAY INCIDENT';
    return null;
  };
  for (const lvl of [2, 1]) {
    const text = pick(lvl);
    if (text) return { text, level: lvl };
  }
  return { text: 'ALL CLEAR', level: 0 };
}

// ── the headlines: what's going on in the town ─────────────────────────────
// The board's top line is a short deck the page shows one card at a time,
// calmly: the verdict first, then up to HEADLINE_MORE things going on in the
// town, from the same open data, picked by the hour and by what is worth
// seeing (owner, 2026-10-30: "a calm cycle of useful data", "what's going on
// in the town?"). Two rules hold it:
//   - a warning (level 2) holds the board alone: nothing urgent cycles away;
//   - nothing repeats the row under it (the time, the temperature now, the
//     light, the air): the deck looks ahead, or further down the board.
// It is only a display: nothing personal (no "your next train"), nothing to
// press. Each card is { key, text, sub, level }, the text as short as a sign.
// Stale sections never reach here (buildPayload passes the trusted ones), so
// a card is never older than its source would allow.
export const HEADLINE_MORE = 3;
const HEADLINE_ORDER = ['quake', 'tide', 'sky', 'roads', 'calendar', 'bart'];
// one character each in js/dotmatrix.js, drawn by the board itself
export const SKY_ICONS = { thunder: '⚡', rain: '☂', fog: '≈', cloud: '☁', sun: '☀', moon: '☾' };
const GUSTS = 35;          // mph: a gust worth a card (the feed reads mph)
const RAIN_LIKELY = 50;    // % chance of rain in an hour that makes it likely
const BRIDGE_HOURS = [[6, 10], [15, 19]];   // the commute, when the bridge time earns a card

const clockAt = (t, tz, minutes = true) => {
  const p = zoneClock(t, tz);
  const h = Number(p.hour);
  return `${h % 12 || 12}${minutes ? `:${p.minute}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const skyClass = (code, pop) => (code >= 95 ? 'thunder'
  : (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (pop ?? 0) >= RAIN_LIKELY ? 'rain'
  : code === 45 || code === 48 ? 'fog' : code === 2 || code === 3 ? 'cloud' : 'sun');

/** The sky ahead: thunder, rain, gusts or fog in the next six hours, else the next part of the day. */
function skyCard(sky, now, tz) {
  const h = sky?.hours;
  if (!h?.rows?.length) return null;
  const rows = h.rows;
  const at = (i) => clockAt(h.from + i * HOUR, tz, false);
  const idx = Math.max(0, Math.floor((now - h.from) / HOUR));
  const soon = rows.slice(idx, idx + 7).map((r, k) => [idx + k, r]);
  const thunder = soon.find(([, r]) => r[2] >= 95);
  if (thunder) {
    return { text: `${thunder[0] === idx ? 'THUNDER NOW' : `THUNDER BY ${at(thunder[0])}`} ${SKY_ICONS.thunder}`,
      sub: 'thunderstorms in the next hours', level: 1, pri: 5 };
  }
  const wet = ([, pop, code]) => skyClass(code, pop) === 'rain';
  const rain = soon.find(([, r]) => wet(r));
  if (rain) {
    const peak = soon.reduce((a, b) => ((b[1][1] ?? 0) > (a[1][1] ?? 0) ? b : a));
    // Rain this hour, by the forecast, is a chance, not a fact: "RAIN NOW" read wrong from a dry window
    // (owner, 2026-11-01, 1 am: a drizzle code with a 5% chance). So the odds, the best of the next
    // three hours, and where they peak if that's later.
    if (rain[0] === idx) {
      const near = Math.max(...rows.slice(idx, idx + 3).map((r) => r[1] ?? 0));
      return { text: `CHANCE OF RAIN ${near}% ${SKY_ICONS.rain}`, level: 1, pri: 4,
        sub: (peak[1][1] ?? 0) > near ? `the next three hours · ${peak[1][1]}% around ${at(peak[0]).toLowerCase()}` : 'the next three hours' };
    }
    // Rain later reads the same way (owner, 2026-11-01, 5 am: "RAIN BY 6 AM" still read as a promise):
    // the best odds in the next six hours, and about when
    return { text: `CHANCE OF RAIN ${peak[1][1] ?? 0}% ${SKY_ICONS.rain}`, level: 1, pri: 4,
      sub: peak[0] === idx ? 'the next six hours' : `the next six hours · most likely around ${at(peak[0]).toLowerCase()}` };
  }
  const gust = soon.reduce((a, b) => ((b[1][4] ?? 0) > (a?.[1][4] ?? 0) ? b : a), null);
  if (gust && gust[1][4] >= GUSTS) {
    return { text: `GUSTS ${gust[1][4]} MPH BY ${at(gust[0])}`, sub: 'wind on the bay and the bridges', level: 1, pri: 3 };
  }
  const fog = soon.find(([, r]) => (r[3] ?? 0) >= 85);
  if (fog && fog[0] > idx && (rows[idx]?.[3] ?? 0) < 50) {
    return { text: `FOG BY ${at(fog[0])} ${SKY_ICONS.fog}`, sub: 'low cloud coming in', level: 0, pri: 3 };
  }
  // the next part of the day, not the hour the row below already shows
  const hour = Number(zoneClock(now, tz).hour);
  const part = hour < 11 ? ['THIS AFTERNOON', 12, 18, 'hi'] : hour < 16 ? ['TONIGHT', 18, 30, 'lo'] : ['TOMORROW', 33, 43, 'hi'];
  const span = rows.slice(part[1], part[2]).filter((r) => r[0] != null);
  if (!span.length) return null;
  const temps = span.map((r) => r[0]);
  const t = part[3] === 'hi' ? Math.max(...temps) : Math.min(...temps);
  const classes = span.map((r) => skyClass(r[2], r[1]));
  const kind = ['thunder', 'rain'].find((k) => classes.includes(k))
    || ['fog', 'cloud', 'sun'].map((k) => [k, classes.filter((c) => c === k).length]).sort((a, b) => b[1] - a[1])[0][0];
  const icon = part[0] === 'TONIGHT' && kind === 'sun' ? SKY_ICONS.moon : SKY_ICONS[kind];
  const word = skyWord(span.map((r) => r[2]).find((c) => skyClass(c, 0) === kind) ?? span[0][2]).toLowerCase()
    || (kind === 'rain' ? 'rain likely' : '');
  const chance = Math.max(...span.map((r) => r[1] ?? 0));
  return { text: `${part[0]} ${t}° ${icon}`, sub: [word, chance >= 20 ? `${chance}% chance of rain` : 'dry'].filter(Boolean).join(' · '),
    level: 0, pri: 2 };
}

/** The zone's offset from UTC at a moment, in minutes. */
const offsetAt = (t, tz) => {
  const p = zoneClock(t, tz);
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 60_000) * 60_000) / 60_000;
};
/** A change of the clocks in the week ahead, or the one just past. */
function clocksCard(now, tz) {
  const was = offsetAt(now - 18 * HOUR, tz), is = offsetAt(now, tz);
  if (was !== is) {
    return { text: `CLOCKS WENT ${is < was ? 'BACK' : 'FORWARD'}`, sub: is < was ? 'an hour back at 2 am' : 'an hour on at 2 am', level: 0, pri: 2 };
  }
  for (let k = 1; k <= 7 * 24; k++) {
    const t = now + k * HOUR;
    const off = offsetAt(t, tz);
    if (off === is) continue;
    const back = off < is;
    // After midnight on the day itself the weekday reads wrong ("CLOCKS BACK SUNDAY" at 12:21 am on
    // Sunday, seen live 2026-11-01): it happens at 2 am, so it says so.
    const sameDay = zoneClock(t, tz).day === zoneClock(now, tz).day;
    const when = sameDay ? 'AT 2 AM'
      : k <= 24 && Number(zoneClock(now, tz).hour) >= 12 ? 'TONIGHT'
      : new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(t)).toUpperCase();
    return { text: `CLOCKS ${back ? 'BACK' : 'FORWARD'} ${when}`,
      sub: back ? '2 am becomes 1 am · an hour more sleep' : '2 am becomes 3 am · an hour less sleep', level: 0, pri: 2 };
  }
  return null;
}

// The day itself, when it is one of these: a card of its own in the deck,
// in its colour (`tone`, the page's), its mark three cells wide (js/dotmatrix.js
// WIDE). By the calendar day in the city's zone (owner, 2026-10-30: "a special
// card for holidays with a glyph"). Lunar New Year moves with the moon and
// waits for a table of its dates.
const nthWeekday = (y, m, weekday, n) => 1 + ((weekday - new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 7) % 7) + (n - 1) * 7;
export const HOLIDAYS = [
  { on: (y, m, d) => m === 1 && d === 1, text: 'HAPPY NEW YEAR ✸', tone: 'gold' },
  { on: (y, m, d) => m === 2 && d === 14, text: "VALENTINE'S DAY ♥", tone: 'rose' },
  { on: (y, m, d) => m === 7 && d === 4, text: '4TH OF JULY ✸', tone: 'gold' },
  { on: (y, m, d) => m === 10 && d === 31, text: 'HAPPY HALLOWEEN 🎃', tone: 'pumpkin', sub: 'trick or treat' },
  { on: (y, m, d) => m === 11 && (d === 1 || d === 2), text: 'DIA DE LOS MUERTOS 💀', tone: 'marigold' },
  { on: (y, m, d) => m === 11 && d === nthWeekday(y, 11, 4, 4), text: 'HAPPY THANKSGIVING 🍁', tone: 'gold' },
  { on: (y, m, d) => m === 12 && d === 25, text: 'MERRY CHRISTMAS 🎄', tone: 'pine' },
  { on: (y, m, d) => m === 12 && d === 31, text: "NEW YEAR'S EVE ✸", tone: 'gold' },
];
// A moment the town is celebrating: a card of its own for a set stretch, from
// one instant to another (not a calendar day, as a holiday is), in its colour,
// flashing as it arrives (`flash`: the page strikes the sign; never under
// reduced motion). First: the Golden State Valkyries' first WNBA title, Game 7
// against Atlanta on Halloween night (owner, 2026-10-31: "the bay is nuts for
// them"; the logo is the team's mark, so the card carries a trophy instead).
// REVISIT Monday 2026-11-02: if it is still popping and a parade is set, move
// `until` to the end of the parade day; otherwise it goes Tuesday morning.
export const EVENTS = [];
function eventCard(now, events = EVENTS) {
  const e = (events || []).find((x) => now >= x.from && now < x.until);
  return e ? { key: 'event', text: e.text, level: 0, tone: e.tone, ...(e.flash && { flash: true }), ...(e.sub && { sub: e.sub }) } : null;
}
function holidayCard(now, tz) {
  const p = zoneClock(now, tz);
  const h = HOLIDAYS.find((x) => x.on(Number(p.year), Number(p.month), Number(p.day)));
  return h ? { key: 'holiday', text: h.text, level: 0, tone: h.tone, ...(h.sub && { sub: h.sub }) } : null;
}

/** The deck for the board's top line, verdict first. `record` is BART's day (recordDay), when there is one. */
export function headlines(s, v, now, tz = 'UTC', { record = null, events = EVENTS, bridgeLabel = 'BAY BRIDGE' } = {}) {
  const verdictCard = { key: 'verdict', text: v.text, level: v.level };
  if (v.level >= 2) return [verdictCard];
  const pool = [];
  const add = (key, card) => card && pool.push({ key, ...card });
  const hour = Number(zoneClock(now, tz).hour);

  add('sky', skyCard(s.sky, now, tz));
  // the tide when a flood alert is out or the tide panel is warm: the advisory is about this tide
  const tideAlert = (s.alerts || []).some((a) => /COASTAL FLOOD|TIDE/.test(a.event));
  if (s.tide?.next?.t > now && (s.tide.level >= 1 || tideAlert) && !/TIDE|TIDAL/.test(v.text)) {
    add('tide', { text: `HIGH TIDE ${clockAt(s.tide.next.t, tz)}`, sub: `${s.tide.next.v} ft · now ${s.tide.now} ft`, level: 0, pri: 3 });
  }
  // a quake felt nearby, for a few hours: "did you feel that?" (the verdict carries M4 and up)
  const q = (s.quakes || []).find((x) => now - x.t < 6 * HOUR);
  if (q && !/EARTHQUAKE/.test(v.text)) {
    add('quake', { text: `M${q.mag} QUAKE ${clockAt(q.t, tz)}`, sub: q.place.toLowerCase(), level: 0, pri: now - q.t < 2 * HOUR ? 4 : 2 });
  }
  if (s.signs?.toSF?.mins != null && BRIDGE_HOURS.some(([a, b]) => hour >= a && hour < b)) {
    const sf = s.signs.toSF;
    add('roads', { text: `${bridgeLabel} ${sf.mins} MIN`, sub: `to SF, as the ${sf.route} sign${sf.near ? ` at ${sf.near}` : ''} posts it`, level: 0, pri: 1.5 });
  }
  add('calendar', clocksCard(now, tz));
  // BART's day so far, once a couple of hours are in: one card, system-wide
  // only the quarter hours with trains running (b[2]): a ghost listing in a closed system counts for nothing
  const lit = (record?.bins || []).filter((b) => b && b[1] && b[2]);
  if (lit.length >= 8 && s.bart && !s.bart.closed) {
    const pct = Math.round((lit.reduce((t, b) => t + b[0], 0) / lit.reduce((t, b) => t + b[1], 0)) * 100);
    add('bart', { text: `${s.bart.label || 'BART'} ${pct}% ON TIME`, sub: 'today so far · trains within 5 min of the timetable', level: 0, pri: pct < 85 ? 2.5 : 1 });
  }

  const picked = pool.map((c, i) => [c, i]).sort((a, b) => b[0].pri - a[0].pri || a[1] - b[1]).slice(0, HEADLINE_MORE).map(([c]) => c);
  picked.sort((a, b) => HEADLINE_ORDER.indexOf(a.key) - HEADLINE_ORDER.indexOf(b.key));
  // an event, then the holiday, come straight after the verdict, and take none of the others' places
  const event = eventCard(now, events);
  const holiday = holidayCard(now, tz);
  return [verdictCard, ...(event ? [event] : []), ...(holiday ? [holiday] : []), ...picked.map(({ pri, ...c }) => c)];
}
