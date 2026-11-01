// The city board's rules (src/shared/city.js), against the shapes each source
// really answers with (captured 2026-10-27), and the endpoint's switch.
import { describe, it, expect } from 'vitest';
import {
  skyWord, compassDir, parseSky, lightNow, parseAir, parseAlerts, parseBart, bartTime, stationName, parseAirport,
  parseSigns, parseTide, parseRain, parseStage, parseUsgs, cdecSeries, parseEnso, decodeEntities, parseQuakes, verdict,
  serviceDay, recordDay, RECORD_DAYS, bsaTime, BART_MEETS, BART_LEAD, BART_LATE_WITHIN, BART_STUCK, BART_HELD_AFTER, carryLeaving, parseTimetable, settleBart,
  headlines, HEADLINE_MORE, EVENTS, parseIncidents, parseClosures, bridgeStatus,
} from '../src/shared/city.js';
import { cityConfig, buildPayload, dueSources, liveSources, entriesFrom, SOURCES, FEED, buildSources, keepGauges } from '../src/api/city.js';

const HOUR = 3_600_000;

describe('sky and light', () => {
  it('names the sky from its weather code, and nothing for a code it does not know', () => {
    expect(skyWord(0)).toBe('CLEAR');
    expect(skyWord(45)).toBe('FOG');
    expect(skyWord(65)).toBe('HEAVY RAIN');
    expect(skyWord(1234)).toBe('');
  });
  it('turns the forecast’s local sunrise into an instant using its offset', () => {
    const sky = parseSky({
      utc_offset_seconds: -25200,
      current: { temperature_2m: 54.4, weather_code: 0, wind_speed_10m: 3.2, cloud_cover_low: 0 },
      daily: { sunrise: ['2026-10-28T07:30'], sunset: ['2026-10-28T18:14'] },
    });
    expect(sky).toMatchObject({ temp: 54, unit: 'F', sky: 'CLEAR', wind: 3, today: { hi: null } });
    const day = parseSky({ utc_offset_seconds: 0, current: { temperature_2m: 60, weather_code: 1, wind_speed_10m: 4 },
      daily: { sunrise: ['2026-10-28T07:30'], sunset: ['2026-10-28T18:14'], temperature_2m_max: [67.6], temperature_2m_min: [50.2],
        uv_index_max: [4.4], wind_gusts_10m_max: [18.9] } });
    expect(day.today).toEqual({ hi: 68, lo: 50, uv: 4, gust: 19 });
    expect(new Date(sky.sun[0].rise).toISOString()).toBe('2026-10-28T14:30:00.000Z');
  });
  it('knows golden hour: the hour after sunrise and the hour before sunset', () => {
    const sun = [{ rise: 10 * HOUR, set: 20 * HOUR }];
    expect(lightNow(sun, 8 * HOUR).phase).toBe('NIGHT');
    expect(lightNow(sun, 9.5 * HOUR)).toMatchObject({ phase: 'BLUE HOUR', next: 'SUNRISE' });
    expect(lightNow(sun, 10.5 * HOUR).phase).toBe('GOLDEN HOUR');
    expect(lightNow(sun, 15 * HOUR)).toMatchObject({ phase: 'DAYLIGHT', next: 'GOLDEN HOUR', at: 19 * HOUR });
    expect(lightNow(sun, 19.5 * HOUR)).toMatchObject({ phase: 'GOLDEN HOUR', next: 'SUNSET', at: 20 * HOUR });
  });
  it('reads wind bearing, gusts and sea-level barometer with 3-hour tendency from Open-Meteo', () => {
    expect(compassDir(0)).toBe('N');
    expect(compassDir(353)).toBe('N');
    expect(compassDir(45)).toBe('NE');
    expect(compassDir(295)).toBe('NW');
    expect(compassDir(null)).toBeNull();
    const hours = ['2026-11-01T02:00', '2026-11-01T03:00', '2026-11-01T04:00', '2026-11-01T05:00'];
    const base = (pNow, p3hAgo, wind = 3.2, gust = 6.7) => parseSky({
      utc_offset_seconds: -28800,
      current: { time: '2026-11-01T05:00', temperature_2m: 49.1, weather_code: 3, wind_speed_10m: wind,
        wind_direction_10m: 315, wind_gusts_10m: gust, pressure_msl: pNow, cloud_cover_low: 72 },
      daily: { sunrise: ['2026-11-01T06:34'], sunset: ['2026-11-01T17:10'] },
      hourly: { time: hours, pressure_msl: [p3hAgo, 1011.0, 1011.1, pNow] },
    });
    expect(base(1011.2, 1011.0)).toMatchObject({
      wind: 3, windDir: 'NW', windGust: 7,
      pressure: { inHg: 29.86, hpa: 1011, trend: 'steady', level: 0 },
    });
    expect(base(1014.5, 1012.0).pressure).toMatchObject({ inHg: 29.96, trend: 'rising', level: 0 });
    expect(base(1008.0, 1011.5).pressure).toMatchObject({ inHg: 29.77, trend: 'falling', level: 1 });
    expect(base(1011.2, 1011.0, 28, 38).windLevel).toBe(1);
    expect(base(1011.2, 1011.0, 42, 55).windLevel).toBe(2);
    const url = FEED.sky({ lat: 37.8, lon: -122.27, tz: 'America/Los_Angeles' });
    expect(url).toContain('wind_direction_10m,wind_gusts_10m,pressure_msl');
    expect(url).toContain('hourly=temperature_2m,precipitation_probability,weather_code,cloud_cover_low,wind_gusts_10m,pressure_msl');
  });
});

describe('air and alerts', () => {
  it('reads the US AQI bands, warm over 100 and hot over 150', () => {
    expect(parseAir({ current: { us_aqi: 36 } })).toEqual({ aqi: 36, word: 'GOOD', level: 0 });
    expect(parseAir({ current: { us_aqi: 120 } }).level).toBe(1);
    expect(parseAir({ current: { us_aqi: 160 } })).toMatchObject({ word: 'UNHEALTHY', level: 2 });
  });
  it('keeps the WHAT paragraph, and puts warnings ahead of advisories', () => {
    const a = parseAlerts({ features: [
      { properties: { event: 'Coastal Flood Advisory', ends: '2026-10-30T17:00:00-07:00',
        description: '* WHAT...Up to 2.1 ft of inundation\nabove ground level is possible.\n\n* WHERE...Bay Shoreline.' } },
      { properties: { event: 'Flash Flood Warning', headline: 'Flash Flood Warning until 3 AM' } },
      { properties: { event: 'Test Message' } },
    ] });
    expect(a.map((x) => [x.event, x.level])).toEqual([['FLASH FLOOD WARNING', 2], ['COASTAL FLOOD ADVISORY', 1]]);
    expect(a[1].what).toBe('Up to 2.1 ft of inundation above ground level is possible.');
  });
});

describe('BART', () => {
  const est = (minutes, delay = 0, hexcolor = '#ffff33') => ({ minutes, delay: String(delay), direction: 'North', hexcolor });
  const etd = { root: { station: [
    { abbr: '12TH', name: '12th St. Downtown City Center', etd: [{ destination: 'Antioch', estimate: [est('Leaving'), est('20')] }] },
    // 8:36 PM, 2026-10-27: Fruitvale's and Coliseum's Daly City trains 300 and 309 s late
    { abbr: 'FTVL', name: 'Fruitvale', etd: [{ destination: 'Daly City', estimate: [est('4', 300, '#0099cc')] }] },
    { abbr: 'COLS', name: 'Coliseum', etd: [{ destination: 'Daly City', estimate: [est('0', 309, '#0099cc')] }] },
    { abbr: 'LAKE', name: 'Lake Merritt', etd: [{ destination: 'Daly City', estimate: [est('7', 259)] }] },
    { abbr: 'ROCK', name: 'Rockridge', etd: [] },
  ] } };
  const bsa = { root: { bsa: [{ type: 'DELAY', description: { '#cdata-section': 'Expect 30-minute delays between Millbrae, SFO, and Daly City.' } }] } };
  const b = parseBart({ count: { root: { traincount: '40' } }, bsa, etd },
    { station: '12TH', stations: ['12TH', 'LAKE', 'FTVL', 'COLS', 'ROCK', 'MCAR'], names: { '12TH': '12th St' } });

  it('names a station the way the config says riders do, else by BART’s own name', () => {
    expect(stationName({ name: '12th St. Downtown City Center' }, '12TH', { '12TH': '12th St' })).toBe('12TH ST');
    expect(stationName({ name: 'Lake Merritt' }, 'LAKE')).toBe('LAKE MERRITT');
    expect(stationName(undefined, 'MCAR')).toBe('MCAR');
  });
  it('lights a station red when its trains run 5+ minutes late, and not at 4 min 19 s', () => {
    const by = Object.fromEntries(b.stations.map((s) => [s.code, s]));
    expect(by.FTVL).toMatchObject({ level: 2, issue: 'up to 5 min late' });
    // Coliseum's late train is at the platform: it has arrived, and no one there waits on it (owner, 2026-10-30)
    expect(by.COLS).toMatchObject({ level: 0, issue: null });
    expect(by.LAKE).toMatchObject({ level: 0, issue: null });
    expect(by['12TH'].level).toBe(0);
  });
  it('keeps how late each train runs beside its minutes, so the page can light the late ones', () => {
    // a red station says there is trouble; `lates` says which trains (owner, 2026-10-30)
    const mixed = { root: { station: [{ abbr: 'COLS', name: 'Coliseum', etd: [{ destination: 'Richmond',
      estimate: [est('Leaving', 0), est('12', 600), est('28', 0), est('48', 120)] }] }] } };
    const d = parseBart({ etd: mixed }, { stations: ['COLS'] }).stations[0].departures[0];
    expect(d.mins).toEqual([0, 12, 28]);
    expect(d.lates).toEqual([0, 600, 0]);   // the listed three, in step
    expect(d.late).toBe(600);
    // a reading BART sends that isn't a number drops out with its lateness, so the two never slip
    const odd = { root: { station: [{ abbr: 'COLS', name: 'Coliseum', etd: [{ destination: 'Richmond',
      estimate: [est('soon', 900), est('7', 0), est('27', 360)] }] }] } };
    expect(parseBart({ etd: odd }, { stations: ['COLS'] }).stations[0].departures[0]).toMatchObject({ mins: [7, 27], lates: [0, 360] });
  });
  it('only a train due within BART_LATE_WITHIN minutes makes its station late', () => {
    // 2026-10-30, a disruption: trains listed two hours out, 80 to 100 min late, reddened stations
    const at = (estimate) => parseBart({ etd: { root: { station: [{ abbr: 'COLS', name: 'Coliseum',
      etd: [{ destination: 'Dublin/Pleasanton', estimate }] }] } } }, { stations: ['COLS'] }).stations[0];
    expect(BART_LATE_WITHIN).toBe(30);
    expect(at([est('7', 0), est('59', 720), est('127', 6000)])).toMatchObject({ issue: null, level: 0 });
    expect(at([est('7', 0), est('30', 420), est('59', 720)])).toMatchObject({ issue: 'up to 7 min late', level: 2 });
    // the train an hour out still carries its lateness, for when it comes into range
    expect(at([est('7', 0), est('59', 720)]).departures[0].lates).toEqual([0, 720]);
  });
  describe('what BART lists that isn’t what it seems (4:48 pm 2026-10-30, Coliseum: NOW NOW NOW)', () => {
    const phantom = (minutes = '1') => ({ ...est(minutes, 0, '#0099cc'), color: 'BLUE', platform: '1', dynamicflag: '1' });
    const feed = (estimate, time = '04:47:33 PM PDT') => ({ root: { date: '10/30/2026', time, station: [{ abbr: 'COLS', name: 'Coliseum',
      etd: [{ destination: 'Dublin/Pleasanton', abbreviation: 'DUBL', estimate }] }] } });
    const at = (time) => bartTime('10/30/2026', time);
    const read = (estimate, time, prev) => parseBart({ etd: feed(estimate, time) }, { stations: ['COLS'] }, at(time), prev);

    it('one train listed three times is one train', () => {
      const b = read([phantom(), phantom(), phantom(), { ...est('10', 851, '#0099cc'), color: 'BLUE', platform: '1' }], '04:47:33 PM PDT');
      expect(b.stations[0].departures[0].mins).toEqual([1, 10]);
      expect(b.quirks.twins).toEqual([['COLS', 'DUBL', 'BLUE', '1', '1', 3, 3]]);   // logged: listed 3, all flagged
    });
    it('a train still at "1" after BART_STUCK is held short of the platform, flagged or not', () => {
      const first = read([phantom()], '04:44:00 PM PDT');
      expect(first.ones).toEqual({ 'COLS|DUBL|BLUE': at('04:44:00 PM PDT') });
      expect(first.stations[0].departures[0].stuck).toBeUndefined();
      const soon = read([phantom()], '04:46:30 PM PDT', first);   // 2.5 min: a held train may yet come
      expect(soon.stations[0].departures[0].stuck).toBeUndefined();
      const later = read([phantom(), { ...est('10', 851, '#0099cc'), color: 'BLUE', platform: '1' }], '04:47:33 PM PDT', soon);
      expect(BART_STUCK).toBe(180_000);
      expect(later.ones['COLS|DUBL|BLUE']).toBe(at('04:44:00 PM PDT'));   // carried from the first reading
      expect(later.stations[0].departures[0]).toMatchObject({ mins: [1, 10], stuck: [true, false] });
      expect(later.quirks.stuck).toEqual([['COLS', 'DUBL', 'BLUE', at('04:44:00 PM PDT'), true]]);
      // and a real train held there just the same
      const real = { ...est('1', 0, '#0099cc'), color: 'BLUE', platform: '1', dynamicflag: '0' };
      expect(read([real], '04:47:33 PM PDT', first).stations[0].departures[0].stuck).toEqual([true]);
    });
    it('without the last reading nothing is held: one reading can’t tell a stuck "1" from a fresh one', () => {
      expect(read([phantom()], '04:47:33 PM PDT', null).stations[0].departures[0].stuck).toBeUndefined();
    });
    it('a held train says nothing to BART’s day: its timing is unknown', () => {
      const first = read([phantom()], '04:44:00 PM PDT');
      expect(first.sample).toMatchObject({ on: 1, n: 1 });
      expect(read([phantom()], '04:47:33 PM PDT', first).sample).toBeNull();
    });
    it('the moment a line went to "1" is let go once it moves on', () => {
      const first = read([phantom()], '04:44:00 PM PDT');
      expect(read([phantom('8')], '04:47:33 PM PDT', first).ones).toEqual({});
    });
  });
  it('a station with no departures listed, or missing from the feed, is an issue too', () => {
    const by = Object.fromEntries(b.stations.map((s) => [s.code, s]));
    expect(by.ROCK.issue).toBe('no departures listed');
    expect(by.MCAR).toMatchObject({ name: 'MCAR', issue: 'no departures listed' });
  });
  it('a station an advisory names is an issue, by full or short name, in two words that fit under it', () => {
    const named = parseBart({ etd, bsa: { root: { bsa: [{ type: 'DELAY', description: 'Elevator out of service at Lake Merritt.' }] } } },
      { stations: ['LAKE'] });
    expect(named.stations[0].issue).toBe('BART advisory');
    expect(named.advisories[0].text).toBe('Elevator out of service at Lake Merritt.');
  });
  it('an advisory keeps all it says and when BART posted it; BART’s “nothing to report” is not one', () => {
    // 2026-10-30: the board read "1 advisory", and opened to "No advisories issued."
    for (const none of ['No advisories issued.', 'No delays reported.']) {
      expect(parseBart({ etd, bsa: { root: { bsa: [{ description: { '#cdata-section': none } }] } } }, {}).advisories).toEqual([]);
    }
    const delay = { type: 'DELAY', posted: 'Fri Oct 30 2026 03:52 PM PDT', description: { '#cdata-section':
      'BART is recovering from an earlier problem. There is a 20-minute delay on the San Francisco line due to an earlier equipment problem on a train at Embarcadero.  ' } };
    expect(parseBart({ etd, bsa: { root: { bsa: [delay] } } }, {}).advisories).toEqual([{ delay: true, posted: Date.parse('2026-10-30T22:52:00Z'),
      text: 'BART is recovering from an earlier problem. There is a 20-minute delay on the San Francisco line due to an earlier equipment problem on a train at Embarcadero.' }]);
    expect(bsaTime('Sun Nov 01 2026 01:30 AM PST')).toBe(Date.parse('2026-11-01T09:30:00Z'));
    expect(bsaTime('No time provided.')).toBeNull();
  });
  it('each watched station carries its own next departures, for the page’s tabs', () => {
    const ftvl = b.stations.find((s) => s.code === 'FTVL');
    expect(ftvl.departures).toEqual([expect.objectContaining({ dest: 'DALY CITY', mins: [4], late: 300 })]);
    expect(b.home).toBe('12TH');
  });
  it('a station keeps every destination, not just the soonest five', () => {
    const dests = ['RICHMOND', 'ANTIOCH', 'MILLBRAE', 'SF AIRPORT', 'PITTSBURG/BAY POINT', 'BERRYESSA'];
    const busy = { root: { station: [{ abbr: '19TH', name: 'Downtown',
      etd: dests.map((destination, i) => ({ destination, estimate: [{ minutes: String(i * 3 + 1), direction: 'North', hexcolor: '#ff9933' }] })) }] } };
    const st = parseBart({ etd: busy }, { stations: ['19TH'] }).stations[0];
    expect(st.departures.map((d) => d.dest)).toEqual(dests);
  });
  it('lists the chosen station’s departures soonest first, LEAVING as 0', () => {
    expect(b.trains).toBe(40);
    expect(b.station).toBe('12TH ST. DOWNTOWN CITY CENTER');
    expect(b.departures[0]).toMatchObject({ dest: 'ANTIOCH', mins: [0, 20] });
    expect(b.level).toBe(1);
  });

  // The page counts each train down between readings, from `at`.
  it('reads BART’s own stamp, to the second, in daylight and standard time', () => {
    expect(bartTime('10/28/2026', '05:17:32 PM PDT')).toBe(Date.parse('2026-10-29T00:17:32Z'));
    expect(bartTime('12/01/2026', '12:05:09 AM PST')).toBe(Date.parse('2026-12-01T08:05:09Z'));
    expect(bartTime('12/01/2026', '12:30:00 PM PST')).toBe(Date.parse('2026-12-01T20:30:00Z'));
    expect(bartTime(undefined, '05:17:32 PM PDT')).toBeNull();
    expect(bartTime('10/28/2026', '17:17')).toBeNull();
  });
  it('stamps each train with when it reaches the platform: the reading, its whole minutes, less BART’s lead', () => {
    const stamp = Date.parse('2026-10-29T00:17:32Z');
    const read = parseBart({ etd: { root: { ...etd.root, date: '10/28/2026', time: '05:17:32 PM PDT' } } },
      { station: '12TH', stations: ['FTVL'] }, stamp + 900);   // read a moment after BART stamped it
    expect(read.asOf).toBe(stamp);
    expect(read.departures[0].at).toEqual([stamp, stamp + 20 * 60_000 - BART_LEAD]);   // LEAVING is now
    expect(read.stations[0].departures[0].at).toEqual([stamp + 4 * 60_000 - BART_LEAD]);
  });
  it('without a believable stamp, the moment it was read stands in', () => {
    const now = Date.parse('2026-10-29T00:30:00Z');
    expect(parseBart({ etd }, { station: '12TH' }, now).asOf).toBe(now);
    const far = { root: { ...etd.root, date: '10/28/2026', time: '05:17:32 PM PDT' } };   // 12 minutes off
    expect(parseBart({ etd: far }, { station: '12TH' }, now).asOf).toBe(now);
  });
});

describe('BART at night', () => {
  // Once the last trains are in, BART lists no departures anywhere. Read as
  // trouble, that lit all eight stations red and put BART DELAYS on the board
  // every night; it is no trouble, so it is a quiet board.
  const bsa = { root: { bsa: [{ type: 'DELAY', description: 'Expect 30-minute delays starting at 9pm each night.' }] } };
  const cfg = { station: '12TH', stations: ['WOAK', '12TH', '19TH', 'MCAR'] };
  for (const [shape, etd] of [
    ['no station list at all', { root: { date: '10/30/2026', time: '02:10:00 AM PDT', message: { warning: 'No data matched your criteria.' } } }],
    ['stations with nothing listed', { root: { station: [{ abbr: '12TH', name: '12th St', etd: [] }, { abbr: 'MCAR', name: 'MacArthur' }] } }],
  ]) {
    it(`is closed, not in trouble: ${shape}`, () => {
      const b = parseBart({ count: { root: { traincount: '0' } }, bsa, etd }, cfg);
      expect(b.closed).toBe(true);
      expect(b.stations.every((st) => st.issue === null && st.level === 0)).toBe(true);
      expect(b.level).toBe(0);                                  // not even the standing night advisory
      expect(b.sample).toBeNull();                              // nothing for the day's record
      expect(verdict({ bart: b })).toEqual({ text: 'ALL CLEAR', level: 0 });
    });
  }
  it('a train left listed after BART’s count says none run is a ghost: nothing for the day’s record (2026-11-01, 3 am)', () => {
    const etd = { root: { station: [{ abbr: 'COLS', name: 'Coliseum', etd: [{ destination: 'Richmond', estimate: [{ minutes: '12', delay: '900', color: 'ORANGE' }] }] }] } };
    expect(parseBart({ count: { root: { traincount: '0' } }, etd }, { stations: ['COLS'] }).sample).toBeNull();
    expect(parseBart({ count: { root: { traincount: '3' } }, etd }, { stations: ['COLS'] }).sample).toMatchObject({ on: 0, n: 1 });
  });
  it('one quiet station while the rest of the system runs is still an issue', () => {
    const etd = { root: { station: [
      { abbr: '12TH', name: '12th St', etd: [{ destination: 'Antioch', estimate: [{ minutes: '4', delay: '0' }] }] },
      { abbr: 'ROCK', name: 'Rockridge', etd: [] },
    ] } };
    const b = parseBart({ etd }, { stations: ['12TH', 'ROCK'] });
    expect(b.closed).toBe(false);
    expect(b.stations[1].issue).toBe('no departures listed');
  });
});

describe('BART’s day', () => {
  const x = (minutes, delay = 0, color = 'YELLOW', cancelflag = '0') => ({ minutes, delay: String(delay), color, cancelflag });
  it('samples the next train to each destination at every station, on time within five minutes', () => {
    const etd = { root: { station: [
      { abbr: 'MCAR', etd: [{ destination: 'Antioch', estimate: [x('22', 678), x('31')] }, { destination: 'Richmond', estimate: [x('10', 0, 'ORANGE')] }] },
      { abbr: 'DUBL', etd: [{ destination: 'Daly City', estimate: [x('3', 299, 'BLUE'), x('23', 900, 'BLUE')] }] },
      { abbr: 'BAYF', etd: [{ destination: 'Berryessa', estimate: [x('5', 0, 'ORANGE', '1')] }] },   // cancelled
    ] } };
    // only the next train counts: Daly City's late second train does not
    expect(parseBart({ etd }).sample).toEqual({ on: 2, n: 4, late: { YELLOW: 1, ORANGE: 1 } });
  });

  const tz = 'America/Los_Angeles';
  it('runs the service day from 3 am to 3 am in the city’s zone, in 15-minute bins', () => {
    expect(serviceDay(Date.parse('2026-10-29T10:00:00Z'), tz)).toEqual({ day: '2026-10-29', bin: 0 });    // 3:00 am PDT
    expect(serviceDay(Date.parse('2026-10-29T09:59:00Z'), tz)).toEqual({ day: '2026-10-28', bin: 95 });   // 2:59 am: last night's
    expect(serviceDay(Date.parse('2026-10-29T15:20:00Z'), tz)).toEqual({ day: '2026-10-29', bin: 21 });   // 8:20 am
    expect(serviceDay(Date.parse('2026-12-01T11:00:00Z'), tz)).toEqual({ day: '2026-12-01', bin: 0 });    // 3:00 am PST
  });
  it('adds each minute into its bin, and keeps the most trains seen running', () => {
    const at = Date.parse('2026-10-29T15:20:00Z');
    let { record, done } = recordDay(null, { trains: 38, sample: { on: 90, n: 100, late: { RED: 10 } } }, at, tz);
    ({ record, done } = recordDay(record, { trains: 41, sample: { on: 95, n: 100, late: {} } }, at + 60_000, tz));
    expect(done).toBeNull();
    expect(record.day).toBe('2026-10-29');
    expect(record.bins[21]).toEqual([185, 200, 41]);
    expect(record.bins.filter(Boolean)).toHaveLength(1);
    expect(record.late).toEqual({ RED: 10 });
  });
  it('a minute with no reading (a failed read, or BART closed) counts nothing', () => {
    const { record } = recordDay(null, null, Date.parse('2026-10-29T15:20:00Z'), tz);
    expect(record.bins.every((b) => b === null)).toBe(true);
    expect(recordDay(record, { trains: 0, sample: null }, Date.parse('2026-10-29T15:21:00Z'), tz).record.bins.every((b) => b === null)).toBe(true);
  });
  it('at 3 am files the day just run, and keeps its score with the last 35', () => {
    const bins = Array(96).fill(null);
    bins[8] = [40, 50, 30];     // 5:00 am, the first trains
    bins[85] = [10, 10, 12];    // 12:15 am, the last
    const days = Array.from({ length: RECORD_DAYS }, (_, i) => ({ day: `old-${i}`, score: 0.9 }));
    const { record, done } = recordDay({ day: '2026-10-28', bins, late: { YELLOW: 7, ORANGE: 2 }, days },
      { trains: 5, sample: { on: 3, n: 3, late: {} } }, Date.parse('2026-10-29T10:01:00Z'), tz);
    expect(done).toMatchObject({ day: '2026-10-28', score: 0.833, first: 8, last: 85, trains: 30, worstLine: 'YELLOW', binMinutes: 15 });
    expect(done.bins[8]).toBe(0.8);
    expect(record.day).toBe('2026-10-29');
    expect(record.bins[0]).toEqual([3, 3, 5]);                 // the new day's first minute
    expect(record.days).toHaveLength(RECORD_DAYS);
    expect(record.days.at(-1)).toEqual({ day: '2026-10-28', score: 0.833 });
    expect(record.days[0].day).toBe('old-1');                  // the oldest falls off
  });
  it('a day with nothing counted (the Worker was down) files nothing', () => {
    const { done, record } = recordDay({ day: '2026-10-27', bins: Array(96).fill(null), late: {}, days: [] }, null,
      Date.parse('2026-10-29T15:20:00Z'), tz);
    expect(done).toBeNull();
    expect(record.days).toEqual([]);
  });
});

describe('BART’s timetable', () => {
  // BART's stnsched for one station, cut to a morning, an evening-only line and the night's last trains.
  const it_ = (time, line, head) => ({ '@origTime': time, '@line': line, '@trainHeadStation': head });
  const sched = { root: { station: { abbr: 'MCAR', item: [
    it_('05:03 AM', 'ROUTE 4', 'OAK Airport / Berryessa/North San Jose'), it_('05:10 AM', 'ROUTE 7', 'SF / SFO Airport / Millbrae'),
    it_('05:14 AM', 'ROUTE 1', 'San Francisco International Airport'), it_('05:18 AM', 'ROUTE 3', 'Richmond'),
    it_('05:25 AM', 'ROUTE 4', 'OAK Airport / Berryessa/North San Jose'), it_('08:03 PM', 'ROUTE 1', "San Francisco Int'l Airport/Millbrae"),
    it_('12:51 AM', 'ROUTE 4', 'OAK Airport / Berryessa/North San Jose'), it_('12:52 AM', 'ROUTE 3', 'Richmond'),
  ] } } };
  const t = parseTimetable(sched, '2026-10-30', 'America/Los_Angeles');
  it('names each destination the way the live feed does, in its line’s colour, first train first', () => {
    expect(t.first).toEqual([
      ['BERRYESSA', '#ff9933', Date.parse('2026-10-30T12:03:00Z')], ['SFO/MILLBRAE', '#ff0000', Date.parse('2026-10-30T12:10:00Z')],
      ['SF AIRPORT', '#ffff33', Date.parse('2026-10-30T12:14:00Z')], ['RICHMOND', '#ff9933', Date.parse('2026-10-30T12:18:00Z')],
    ]);   // the evening's first SFO/Millbrae yellow is no help at 4 am
    expect(t.opens).toBe(Date.parse('2026-10-30T12:03:00Z'));
  });
  it('puts the trains after midnight on the next calendar day: the last train is the day’s, not the morning’s', () => {
    expect(t.last).toBe(Date.parse('2026-10-31T07:52:00Z'));
  });
  it('takes the zone’s own offset on the day, across the end of daylight time', () => {
    const winter = parseTimetable(sched, '2026-11-02', 'America/Los_Angeles');
    expect(winter.opens).toBe(Date.parse('2026-11-02T13:03:00Z'));
  });
  it('and on the day the clocks go back: the morning is standard time, the night before was daylight', () => {
    // 2026-11-01: 2 am PDT became 1 am PST. A morning train on the day itself
    // read an hour early (the offset was taken before the change).
    const sunday = parseTimetable(sched, '2026-11-01', 'America/Los_Angeles');
    expect(sunday.opens).toBe(Date.parse('2026-11-01T13:03:00Z'));   // 5:03 am PST
    expect(sunday.last).toBe(Date.parse('2026-11-02T08:52:00Z'));    // 12:52 am PST, Monday
    const saturday = parseTimetable(sched, '2026-10-31', 'America/Los_Angeles');
    expect(saturday.last).toBe(Date.parse('2026-11-01T07:52:00Z'));  // 12:52 am PDT, before the change
  });
  it('and on the day they go forward', () => {
    const spring = parseTimetable(sched, '2027-03-14', 'America/Los_Angeles');
    expect(spring.opens).toBe(Date.parse('2027-03-14T12:03:00Z'));   // 5:03 am PDT
  });
  it('a day with no trains is null', () => {
    expect(parseTimetable({ root: { station: { item: [] } } }, '2026-10-30', 'UTC')).toBeNull();
  });

  const quiet = (now, departures = []) => settleBart({
    closed: false, advisories: [], level: 1,
    stations: [{ code: 'MCAR', issue: departures.length ? null : 'no departures listed', level: departures.length ? 0 : 2, departures }],
  }, { day: '2026-10-30', stations: { MCAR: t } }, now);
  it('a station listing nothing before its first train, or after its last, is resting, not in trouble', () => {
    expect(quiet(Date.parse('2026-10-30T11:40:00Z'))).toMatchObject({ level: 0, stations: [{ issue: null, level: 0 }] });
    expect(quiet(Date.parse('2026-10-31T08:05:00Z'))).toMatchObject({ level: 0, stations: [{ issue: null }] });
  });
  it('in service hours, listing nothing is still an issue', () => {
    expect(quiet(Date.parse('2026-10-30T19:00:00Z'))).toMatchObject({ level: 1, stations: [{ issue: 'no departures listed' }] });
  });
  it('a resting station says so, for the big line’s CLOSED, while BART still lists a train elsewhere', () => {
    // the night of 2026-10-30: a train at Milpitas sat at "Leaving" from 2:16 to 4:31 am, so
    // `closed` never came and the line counted trains down long after MacArthur's last had gone
    const night = Date.parse('2026-10-31T09:30:00Z');   // 2:30 am, past MacArthur's 12:52
    expect(quiet(night).stations[0]).toMatchObject({ rests: true, issue: null });
    expect(quiet(Date.parse('2026-10-30T11:40:00Z')).stations[0].rests).toBe(true);   // 4:40 am, before the 5:03
    expect(quiet(Date.parse('2026-10-30T19:00:00Z')).stations[0].rests).toBeUndefined();
    // the last train running late, past the timetable's last: still listed, so still counted
    const late = quiet(night, [{ dest: 'RICHMOND', mins: [3], at: [night + 180_000], lates: [1500] }]);
    expect(late.stations[0].rests).toBeUndefined();
  });
  it('a station BART has left out of its feed overnight keeps its name, from the timetable', () => {
    const b = { closed: true, advisories: [], level: 0, stations: [{ code: 'MCAR', name: 'MCAR', issue: null, departures: [] }] };
    expect(settleBart(b, { stations: { MCAR: { ...t, name: 'MacArthur' } } }, Date.now()).stations[0].name).toBe('MACARTHUR');
  });
  it('without a timetable for the station, the board reads as it always did', () => {
    const b = { closed: false, advisories: [], level: 1, stations: [{ code: 'WOAK', issue: 'no departures listed', departures: [] }] };
    expect(settleBart(b, { stations: {} }, Date.now())).toBe(b);
  });
});

describe('a train at the platform', () => {
  const asOf = Date.parse('2026-10-30T07:00:00Z');
  const read = (at, mins) => ({ asOf: at, stations: [{ code: 'MCAR', departures: [{ dest: 'RICHMOND', color: '#ff9933', mins, at: mins.map((m) => at + m * 60_000) }] }] });
  it('keeps the moment it was first seen there from the last snapshot', () => {
    const first = carryLeaving(read(asOf, [0, 20]), null);
    expect(first.stations[0].departures[0]).toMatchObject({ since: asOf, held: false, at: [asOf, asOf + 20 * 60_000] });
    const later = carryLeaving(read(asOf + 40_000, [0, 20]), first);
    expect(later.stations[0].departures[0]).toMatchObject({ since: asOf, held: false, at: [asOf, asOf + 40_000 + 20 * 60_000] });
  });
  it('one still there past BART_HELD_AFTER reads as held', () => {
    const first = carryLeaving(read(asOf, [0]), null);
    expect(carryLeaving(read(asOf + BART_HELD_AFTER + 1000, [0]), first).stations[0].departures[0].held).toBe(true);
  });
  it('a train a transfer is waiting on is held from the start: BART stands it for the train coming in', () => {
    // MacArthur at 7:44 am, 2026-10-30: the SF train at the platform, the Richmond train two minutes out
    const Y = (mm) => ({ minutes: mm, delay: '0', color: 'YELLOW', hexcolor: '#ffff33' }), O = (mm) => ({ minutes: mm, delay: '0', color: 'ORANGE', hexcolor: '#ff9933' });
    const etd = { root: { station: [{ abbr: 'MCAR', etd: [
      { destination: 'SF Airport', abbreviation: 'SFIA', estimate: [Y('Leaving'), Y('11')] },
      { destination: 'Berryessa', abbreviation: 'BERY', estimate: [O('2'), O('22')] },
    ] }] } };
    const st = carryLeaving(parseBart({ etd }, { stations: ['MCAR'] }, asOf), null).stations[0];
    expect(st.transfers.find((x) => x.name === 'richmond › sf')).toMatchObject({ status: 'here', waiting: true, dest: 'SF AIRPORT' });
    expect(st.departures.find((d) => d.dest === 'SF AIRPORT')).toMatchObject({ held: true, since: asOf });
    expect(st.departures.find((d) => d.dest === 'BERRYESSA').held).toBeUndefined();
  });
  it('a train counting down is left as it is, and the next at the platform starts its own moment', () => {
    const counting = carryLeaving(read(asOf, [3]), null);
    expect(counting.stations[0].departures[0].since).toBeUndefined();
    expect(carryLeaving(read(asOf + 20_000, [0]), counting).stations[0].departures[0].since).toBe(asOf + 20_000);
  });
});

describe('the headlines: what’s going on in the town', () => {
  const tz = 'America/Los_Angeles';
  const midnight = Date.parse('2026-10-30T07:00:00Z');   // Friday 30 Oct, local midnight (PDT)
  const at = (h) => midnight + h * 3_600_000;
  // 48 hours from local midnight: [temp, rain %, code, low cloud %, gusts]
  const sky = (edit = () => {}) => {
    const rows = Array.from({ length: 48 }, (_, i) => [52 + (i % 24 >= 12 && i % 24 < 18 ? 14 : 0), 0, 1, 10, 12]);
    edit(rows);
    return { hours: { from: midnight, rows } };
  };
  const calm = { text: 'ALL CLEAR', level: 0 };
  const keys = (deck) => deck.map((c) => c.key);
  const card = (deck, key) => deck.find((c) => c.key === key);

  it('a warning holds the board alone: nothing urgent cycles away', () => {
    expect(headlines({ sky: sky() }, { text: 'TSUNAMI WARNING', level: 2 }, at(9), tz)).toEqual([{ key: 'verdict', text: 'TSUNAMI WARNING', level: 2 }]);
  });
  it('the verdict comes first, then the sky ahead, never the hour the row below shows', () => {
    const morning = headlines({ sky: sky() }, calm, at(8), tz);
    expect(morning[0]).toEqual({ key: 'verdict', text: 'ALL CLEAR', level: 0 });
    expect(card(morning, 'sky')).toMatchObject({ text: 'THIS AFTERNOON 66° ☀', level: 0 });
    expect(card(headlines({ sky: sky() }, calm, at(13), tz), 'sky').text).toBe('TONIGHT 52° ☾');
    expect(card(headlines({ sky: sky() }, calm, at(19), tz), 'sky').text).toBe('TOMORROW 66° ☀');
  });
  it('rain or thunder in the next six hours takes the sky’s place, worth a look', () => {
    const rainAt3 = sky((r) => { r[15][1] = 70; r[15][2] = 61; });
    expect(card(headlines({ sky: rainAt3 }, calm, at(11), tz), 'sky')).toMatchObject({ text: 'CHANCE OF RAIN 70% ☂', sub: 'the next six hours · most likely around 3 pm', level: 1 });
    // 5:21 am 2026-11-01: the best odds were this hour's, so no "around 5 am" at 5:21
    const later = sky((r) => { r[11][1] = 18; r[12][1] = 15; r[12][2] = 61; });
    expect(card(headlines({ sky: later }, calm, at(11), tz), 'sky')).toMatchObject({ text: 'CHANCE OF RAIN 18% ☂', sub: 'the next six hours' });
    const raining = sky((r) => { for (let i = 9; i < 13; i++) { r[i][1] = 90; r[i][2] = 63; } });
    expect(card(headlines({ sky: raining }, calm, at(9), tz), 'sky')).toMatchObject({ text: 'CHANCE OF RAIN 90% ☂', sub: 'the next three hours' });
    // tonight's case: a drizzle code at 5%, the odds climbing later
    const drizzle = sky((r) => { r[9][1] = 5; r[9][2] = 51; r[10][1] = 13; r[11][1] = 36; r[12][1] = 61; });
    expect(card(headlines({ sky: drizzle }, calm, at(9), tz), 'sky')).toMatchObject({ text: 'CHANCE OF RAIN 36% ☂', sub: 'the next three hours · 61% around 12 pm' });
    const storm = sky((r) => { r[14][2] = 95; r[13][1] = 80; });
    expect(card(headlines({ sky: storm }, calm, at(10), tz), 'sky').text).toBe('THUNDER BY 2 PM ⚡');
  });
  it('the tide when a flood alert is out: the advisory is about this tide', () => {
    const tide = { now: 4.7, next: { v: 6.9, t: at(15) + 6 * 60_000 }, level: 0 };
    const alerts = [{ event: 'COASTAL FLOOD ADVISORY', level: 1 }];
    expect(card(headlines({ sky: sky(), tide, alerts }, { text: 'COASTAL FLOOD ADVISORY', level: 1 }, at(9), tz), 'tide'))
      .toMatchObject({ text: 'HIGH TIDE 3:06 PM', sub: '6.9 ft · now 4.7 ft' });
    expect(card(headlines({ sky: sky(), tide }, calm, at(9), tz), 'tide')).toBeUndefined();
  });
  it('a quake for a few hours after, unless the verdict already says it', () => {
    const quakes = [{ mag: 3.1, place: '4 KM NE OF PACIFICA, CA', t: at(8) + 42 * 60_000 }];
    expect(card(headlines({ sky: sky(), quakes }, calm, at(9), tz), 'quake')).toMatchObject({ text: 'M3.1 QUAKE 8:42 AM', sub: '4 km ne of pacifica, ca' });
    expect(card(headlines({ sky: sky(), quakes }, calm, at(16), tz), 'quake')).toBeUndefined();
    expect(card(headlines({ sky: sky(), quakes }, { text: 'M3.1 EARTHQUAKE', level: 1 }, at(9), tz), 'quake')).toBeUndefined();
  });
  it('the Bay Bridge time only in the commute', () => {
    const signs = { toSF: { mins: 21, near: 'Oakland', route: 'I-580' } };
    expect(card(headlines({ sky: sky(), signs }, calm, at(8), tz), 'roads')).toMatchObject({ text: 'BAY BRIDGE 21 MIN' });
    expect(card(headlines({ sky: sky(), signs }, calm, at(12), tz), 'roads')).toBeUndefined();
  });
  it('a holiday is a card of its own on the day, straight after the verdict, in its colour', () => {
    const halloween = headlines({}, calm, at(24 + 9), tz);   // Saturday 31 Oct
    expect(halloween[1]).toEqual({ key: 'holiday', text: 'HAPPY HALLOWEEN 🎃', level: 0, tone: 'pumpkin', sub: 'trick or treat' });
    expect(card(halloween, 'calendar')).toBeTruthy();   // it takes none of the others' places
    expect(card(headlines({}, calm, at(9), tz), 'holiday')).toBeUndefined();
    expect(card(headlines({}, { text: 'TSUNAMI WARNING', level: 2 }, at(24 + 9), tz), 'holiday')).toBeUndefined();   // a warning holds the sign alone
    // by the calendar day in the city: Thanksgiving is the fourth Thursday
    const day = (iso) => card(headlines({}, calm, Date.parse(iso), tz), 'holiday')?.text;
    expect(day('2026-11-26T20:00:00Z')).toBe('HAPPY THANKSGIVING 🍁');
    expect(day('2027-11-25T20:00:00Z')).toBe('HAPPY THANKSGIVING 🍁');
    expect(day('2026-11-19T20:00:00Z')).toBeUndefined();
    expect(day('2026-12-26T07:30:00Z')).toBe('MERRY CHRISTMAS 🎄');   // 11:30 pm on the 25th, local
    expect(day('2026-11-02T20:00:00Z')).toBe('DIA DE LOS MUERTOS 💀');
  });
  it('an event is a card of its own for its stretch, before the holiday, flashing, in its colour', () => {
    const fixture = EVENTS.length ? EVENTS : [{
      from: Date.parse('2026-10-31T23:00:00Z'), until: Date.parse('2026-11-03T14:00:00Z'),
      text: 'VALKYRIES WIN THE FINALS 🏆', sub: '68–63 over atlanta in game 7 · their first wnba title',
      tone: 'valkyrie', flash: true,
    }];
    const at2 = (iso) => headlines({}, calm, Date.parse(iso), tz, { events: fixture });
    const win = { key: 'event', text: 'VALKYRIES WIN THE FINALS 🏆', level: 0, tone: 'valkyrie', flash: true,
      sub: '68–63 over atlanta in game 7 · their first wnba title' };
    expect(card(at2('2026-10-31T16:00:00Z'), 'event')).toBeUndefined();          // 9 am Halloween: not won yet
    const night = at2('2026-11-01T03:00:00Z');                                     // 8 pm Halloween, local
    expect(night[1]).toEqual(win);
    expect(night[2]).toMatchObject({ key: 'holiday', text: 'HAPPY HALLOWEEN 🎃' });  // and the holiday still has its night
    expect(card(at2('2026-11-03T13:59:00Z'), 'event')).toEqual(win);              // 5:59 am Tuesday
    expect(card(at2('2026-11-03T14:00:00Z'), 'event')).toBeUndefined();          // 6 am Tuesday: gone
    expect(card(headlines({}, { text: 'TSUNAMI WARNING', level: 2 }, Date.parse('2026-11-01T03:00:00Z'), tz), 'event')).toBeUndefined();
  });
  it('the clocks: the week before they change, the evening before, and the morning after', () => {
    expect(card(headlines({}, calm, at(9), tz), 'calendar')).toMatchObject({ text: 'CLOCKS BACK SUNDAY' });
    expect(card(headlines({}, calm, at(24 + 15), tz), 'calendar').text).toBe('CLOCKS BACK TONIGHT');
    expect(card(headlines({}, calm, at(48 + 0.35), tz), 'calendar').text).toBe('CLOCKS BACK AT 2 AM');   // 12:21 am on the day
    expect(card(headlines({}, calm, at(48 + 9), tz), 'calendar').text).toBe('CLOCKS WENT BACK');
    expect(card(headlines({}, calm, at(24 * 9), tz), 'calendar')).toBeUndefined();
  });
  it('BART’s day once a couple of hours are in, one card for the whole system', () => {
    const record = { bins: [...Array(20).fill(null), ...Array(8).fill([89, 100, 50])] };
    expect(card(headlines({ bart: { closed: false } }, calm, at(9), tz, { record }), 'bart')).toMatchObject({ text: 'BART 89% ON TIME' });
    expect(card(headlines({ bart: { closed: false } }, calm, at(9), tz, { record: { bins: [[90, 100, 50]] } }), 'bart')).toBeUndefined();
    // quarter hours counted with no trains running (b[2] = 0) are ghosts, and neither score nor reach the two hours
    const ghosts = { bins: [...Array(8).fill([0, 4, 0]), ...Array(8).fill([89, 100, 50])] };
    expect(card(headlines({ bart: { closed: false } }, calm, at(9), tz, { record: ghosts }), 'bart')).toMatchObject({ text: 'BART 89% ON TIME' });
    expect(card(headlines({ bart: { closed: false } }, calm, at(9), tz, { record: { bins: Array(8).fill([0, 4, 0]) } }), 'bart')).toBeUndefined();
  });
  it('at most the verdict and three more, in a fixed order', () => {
    const deck = headlines({
      sky: sky(), tide: { now: 4.7, next: { v: 6.9, t: at(15) }, level: 1 }, signs: { toSF: { mins: 21, near: '', route: 'I-580' } },
      quakes: [{ mag: 2.6, place: 'X', t: at(8) }], bart: { closed: false },
    }, calm, at(9), tz, { record: { bins: Array(10).fill([95, 100, 50]) } });
    expect(deck).toHaveLength(1 + HEADLINE_MORE);
    expect(keys(deck)).toEqual(['verdict', 'quake', 'tide', 'sky']);
  });
});

describe('BART transfers', () => {
  // BART's own departures at MacArthur and 19th St, 10:08:17 PM 2026-10-29:
  // one reading that holds every call a meet can make.
  const e = (minutes, delay, color, hexcolor) => ({ minutes, delay: String(delay), color, hexcolor, cancelflag: '0', direction: 'North' });
  const Y = (m, d = 0) => e(m, d, 'YELLOW', '#ffff33'), O = (m, d = 0) => e(m, d, 'ORANGE', '#ff9933');
  const etd = { root: { date: '10/29/2026', time: '10:08:17 PM PDT', station: [
    { abbr: 'MCAR', name: 'MacArthur', etd: [
      { destination: 'Antioch', abbreviation: 'ANTC', estimate: [Y('22', 678), Y('31'), Y('51')] },
      { destination: 'Berryessa', abbreviation: 'BERY', estimate: [O('18'), O('38'), O('58')] },
      { destination: 'Richmond', abbreviation: 'RICH', estimate: [O('10'), O('30'), O('50')] },
      { destination: 'SFO/Millbrae', abbreviation: 'MLBR', estimate: [Y('16'), Y('36'), Y('56')] },
    ] },
    { abbr: '19TH', name: '19th St. Oakland', etd: [
      { destination: 'Antioch', abbreviation: 'ANTC', estimate: [Y('19', 712), Y('27'), Y('47')] },
      { destination: 'Berryessa', abbreviation: 'BERY', estimate: [O('3'), O('22'), O('42')] },
      { destination: 'Richmond', abbreviation: 'RICH', estimate: [O('6'), O('26'), O('46')] },
      { destination: 'SFO/Millbrae', abbreviation: 'MLBR', estimate: [Y('Leaving', 74), Y('19'), Y('39')] },
    ] },
    { abbr: '12TH', name: '12th St. Oakland City Center', etd: [{ destination: 'Richmond', abbreviation: 'RICH', estimate: [O('3')] }] },
  ] } };
  const stamp = Date.parse('2026-10-30T05:08:17Z');
  const b = parseBart({ etd }, { stations: ['12TH', '19TH', 'MCAR'] }, stamp);
  const at = (code) => b.stations.find((st) => st.code === code);
  const meet = (code, name) => at(code).transfers.find((m) => m.name === name);
  const m = (n) => stamp + n * 60_000 - BART_LEAD;

  it('plans meets only where BART does: MacArthur and 19th St', () => {
    expect(Object.keys(BART_MEETS).sort()).toEqual(['19TH', 'MCAR']);
    expect(at('12TH').transfers).toBeUndefined();
  });
  // Far out, a call answers one question: is the train you step onto on time.
  it('on time: the train you step onto leaves inside the timetable’s gap', () => {
    expect(meet('MCAR', 'antioch › san jose')).toMatchObject({ status: 'go', arrive: m(16), leave: m(18), colors: ['#ffff33', '#ff9933'] });
  });
  it('far out, a train due just before yours is the meet, judged on its own time', () => {
    // MacArthur's SF train leaves on its own time (`strict`): due out before yours is TIGHT however far out
    // (called on time far out it was missed two times in three, every record to 2026-10-30)
    expect(meet('MCAR', 'richmond › sf')).toMatchObject({ status: 'tight', arrive: m(18), leave: m(16) });
  });
  it('late but still meeting yours is on time: the meet is all that matters to a rider on the train', () => {
    const one = { root: { station: [{ abbr: '19TH', etd: [
      { destination: 'Antioch', abbreviation: 'ANTC', estimate: [Y('8')] }, { destination: 'Richmond', abbreviation: 'RICH', estimate: [O('9', 600), O('29')] },
    ] }] } };
    expect(parseBart({ etd: one }, { stations: ['19TH'] }, stamp).stations[0].transfers[0]).toMatchObject({ name: 'sf › richmond', status: 'go', leave: m(9) });
  });
  it('late: the train you will catch is running 5+ minutes late, and you wait on it', () => {
    expect(meet('19TH', 'san jose › antioch')).toMatchObject({ status: 'late', arrive: m(6), leave: m(19), late: 712 });
  });
  it('missed, on evidence at any distance: yours runs 12 minutes late, so the Richmond train goes 13 before it', () => {
    expect(meet('19TH', 'sf › richmond')).toMatchObject({ status: 'missed', arrive: m(19), left: m(6), leave: m(26), late: 712 });
  });
  it('the station carries its worst meet, for the glyph and the tab', () => {
    expect(at('MCAR').transfer).toBe('tight');
    expect(at('19TH').transfer).toBe('missed');
  });

  // Inside the meet's window (five minutes at MacArthur, three at 19th St) it also says whether you make it.
  const close = (yours, theirs) => parseBart({ etd: { root: { station: [{ abbr: 'MCAR', etd: [
    { abbreviation: 'BERY', estimate: yours.map((x) => O(x)) }, { abbreviation: 'MLBR', estimate: theirs.map((x) => Y(x)) },
  ] }] } } }, { stations: ['MCAR'] }, stamp).stations[0].transfers.find((x) => x.name === 'richmond › sf');
  // 19th St's san jose › antioch: yours the Richmond train, the one you step onto the Antioch train
  const close19 = (yours, theirs) => parseBart({ etd: { root: { station: [{ abbr: '19TH', etd: [
    { abbreviation: 'RICH', estimate: yours.map((x) => O(x)) }, { abbreviation: 'ANTC', estimate: theirs.map((x) => Y(x)) },
  ] }] } } }, { stations: ['19TH'] }, stamp).stations[0].transfers.find((x) => x.name === 'san jose › antioch');
  // Each call says what the train you step onto is doing (owner, 2026-10-30: "held" needed explaining).
  it('arriving: due out within BART’s hold of yours getting in, so about the same moment', () => {
    expect(close(['2'], ['1', '21'])).toMatchObject({ status: 'arriving', arrive: m(2), leave: m(1) });
  });
  it('here: standing at the platform as yours comes in', () => {
    expect(close(['2'], ['Leaving', '21'])).toMatchObject({ status: 'here', leave: stamp });
  });
  // Not rigid (owner, on the platform): it generally waits up to three minutes, and at five or more it goes.
  it('at the platform, it generally waits up to three minutes: at the station', () => {
    expect(close19(['3'], ['Leaving', '23'])).toMatchObject({ status: 'here', leave: stamp });
  });
  it('a little early is on time: due there ahead of yours within three minutes, it waits', () => {
    // 19th St at 8:14 am, 2026-10-30: the Antioch train in 1, the Richmond train in 3, read TIGHT
    expect(close19(['3'], ['1', '21'])).toMatchObject({ status: 'go', leave: m(1), waiting: false });
    expect(close19(['4'], ['2', '22'])).toMatchObject({ status: 'go', leave: m(2) });
  });
  it('a meet keeps its own hold: MacArthur’s SF train waits under two minutes, so two ahead is tight', () => {
    // the rush of 2026-10-30: four of five missed at about two minutes, each called on time
    expect(BART_MEETS.MCAR.find((x) => x.name === 'richmond › sf').hold).toBe(1.5);
    expect(close(['3'], ['1', '21'])).toMatchObject({ status: 'tight', leave: m(1) });
    expect(close(['2'], ['Leaving', '22'])).toMatchObject({ status: 'here', leave: stamp });
    expect(close(['3'], ['Leaving', '23'])).toMatchObject({ status: 'tight', leave: stamp });
  });
  it('tight: due out before yours gets in by three to five minutes: it may wait, it may not', () => {
    expect(close(['5'], ['1', '21'])).toMatchObject({ status: 'tight', leave: m(1) });
  });
  it('a train that goes long before yours, with yours on time, was never your meet: the next one, shown not judged', () => {
    expect(close(['12'], ['4', '24'])).toMatchObject({ status: 'open', leave: m(24), left: null });
  });
  it('the night’s last connection is never called missed: BART holds it', () => {
    expect(close(['5'], ['1'])).toMatchObject({ status: 'tight', leave: m(1) });
  });
  it('your train at the platform keeps its meet while the train you step onto is still to leave', () => {
    // MacArthur at 6:43 am, 2026-10-30, as the owner's phone had it: the yellow from Antioch in, the Berryessa in 3
    const st = parseBart({ etd: { root: { station: [{ abbr: 'MCAR', etd: [
      { destination: 'SF Airport', abbreviation: 'SFIA', estimate: [Y('Leaving'), Y('12'), Y('21')] },
      { destination: 'Berryessa', abbreviation: 'BERY', estimate: [O('3'), O('23'), O('43')] },
    ] }] } } }, { stations: ['MCAR'] }, stamp).stations[0];
    expect(st.transfers.find((x) => x.name === 'antioch › san jose')).toMatchObject({ status: 'go', arrive: stamp, leave: m(3), dest: 'BERRYESSA', arrived: true, waiting: false });
    // the other way the yellow stands at the platform 2½ minutes before the Richmond train gets in: past MacArthur's hold
    expect(st.transfers.find((x) => x.name === 'richmond › sf')).toMatchObject({ status: 'tight', arrive: m(3), leave: stamp, arrived: false, waiting: true });
    expect(st.transfer).toBe('tight');
  });
  it('MacArthur’s SF train leaves on its own time: due within a minute after yours is a toss, two after is on time', () => {
    // (strict, 2026-10-30) estimates in whole minutes can't tell 30 s after from 30 s before, and it waits 1.5 min at most
    expect(close(['12'], ['12'])).toMatchObject({ status: 'tight', arrive: m(12), leave: m(12) });
    expect(close(['12'], ['14'])).toMatchObject({ status: 'go', leave: m(14) });
    expect(close(['3'], ['5'])).toMatchObject({ status: 'go' });
    // 19th St's meets keep the lenient reading: a little early is on time there
    expect(close19(['12'], ['11'])).toMatchObject({ status: 'go' });
  });
  it('both at the platform at once: the transfer is at the station', () => {
    expect(close(['Leaving', '20'], ['Leaving', '21'])).toMatchObject({ status: 'here', arrive: stamp, leave: stamp });
  });
  it('once the train you step onto has gone, your train at the platform hands on to the meet after it', () => {
    expect(close(['Leaving', '20'], ['21'])).toMatchObject({ status: 'go', arrive: m(20), leave: m(21) });
  });
  it('a long wait nobody is late for is shown, not judged', () => {
    const one = { root: { station: [{ abbr: '19TH', etd: [
      { abbreviation: 'ANTC', estimate: [Y('8')] }, { abbreviation: 'RICH', estimate: [O('2'), O('20')] },
    ] }] } };
    expect(parseBart({ etd: one }, { stations: ['19TH'] }, stamp).stations[0].transfers[0]).toMatchObject({ status: 'open', leave: m(20) });
  });
  it('a meet with a line not running is left out, and a red SFO train is not one from Antioch', () => {
    const one = { root: { station: [{ abbr: 'MCAR', etd: [
      { abbreviation: 'SFIA', estimate: [e('4', 0, 'RED', '#ff0000')] }, { abbreviation: 'BERY', estimate: [O('6')] },
    ] }] } };
    const st = parseBart({ etd: one }, { stations: ['MCAR'] }, stamp).stations[0];
    expect(st.transfers).toEqual([]);   // richmond › sf has no yellow to step onto; antioch › san jose no yellow to arrive on
    expect(st.transfer).toBeNull();
  });
});

describe('the airport', () => {
  const xml = '<AIRPORT_STATUS_INFORMATION><Delay_type><Name>General Arrival/Departure Delay Info</Name>'
    + '<Arrival_Departure_Delay_List><Delay><ARPT>MIA</ARPT><Reason>RWY:Construction</Reason></Delay>'
    + '</Arrival_Departure_Delay_List></Delay_type><Delay_type><Name>Ground Stop Programs</Name>'
    + '<Ground_Stop_List><Program><ARPT>OAK</ARPT><Reason>thunderstorms</Reason></Program></Ground_Stop_List>'
    + '</Delay_type></AIRPORT_STATUS_INFORMATION>';
  it('an airport the FAA does not list is normal', () => {
    expect(parseAirport(xml, 'SFO')).toMatchObject({ status: 'NORMAL', level: 0 });
  });
  it('reads a ground stop, and does not mistake OAKX for OAK', () => {
    expect(parseAirport(xml, 'OAK')).toMatchObject({ status: 'GROUND STOP', level: 2, reason: 'thunderstorms' });
    expect(parseAirport(xml.replace('<ARPT>OAK<', '<ARPT>OAKX<'), 'OAK').status).toBe('NORMAL');
  });
});

describe('freeway signs', () => {
  const sign = (route, lines, { lat = '37.78', lon = '-122.22', display = '1 Page (Normal)', inService = 'true' } = {}) => ({ cms: {
    inService, location: { route, direction: 'South', nearbyPlace: 'Downtown', latitude: lat, longitude: lon },
    message: { display, phase1: { phase1Line1: lines[0] || '', phase1Line2: lines[1] || '', phase1Line3: lines[2] || '' } },
  } });
  const json = { data: [
    sign('I-880', ['CRASH BEFORE', 'HWY 92', '2 LEFT LNS OPEN']),
    sign('I-880', ['CRASH BEFORE', 'HWY 92', '2 LEFT LNS OPEN']),            // the same message on a second sign
    sign('I-580', ['HWY 13    11 MIN', 'RTE 24    16 MIN', 'SM BRIDGE 71 MIN']),
    sign('I-880', ['SIGN TEST', 'ABCDEFGHIJKLMNOP', '1234567890123456']),
    sign('I-880', [], { display: 'Blank' }),
    sign('US-101', ['FULL CLOSURE', 'NOV 6']),
    sign('I-580', ['DUBLIN 18 MIN'], { lat: '37.70', lon: '-121.80' }),     // outside the box
  ] };
  const out = parseSigns(json, { routes: ['I-880', 'I-580'], box: [37.70, -122.33, 37.86, -122.05] });
  it('keeps each message once, drops tests, blanks, other roads and other towns', () => {
    expect(out.list.map((s) => s.lines[0])).toEqual(['CRASH BEFORE', 'HWY 13    11 MIN']);
  });
  it('an incident is worth a look; a travel time is not', () => {
    expect(out.list.map((s) => s.level)).toEqual([1, 0]);
  });
  it('a picture is not a message: its draw command is dropped, and a sign showing only one is not shown', () => {
    const pics = parseSigns({ data: [
      sign('I-880', ['G1,1,1,F5F9']),                                          // as the 880 sign posted it, 2026-10-29
      sign('I-880', ['[g2,1,1]', 'BUCKLE UP']),
    ] }, { routes: ['I-880'] });
    expect(pics.list.map((s) => s.lines)).toEqual([['BUCKLE UP']]);
  });
  it('reads the minutes to SF the sign nearest the bridge is posting, and nothing when none is', () => {
    expect(out.toSF).toBeNull();
    const withSF = parseSigns({ data: [
      sign('I-580', ['SF DWNTWN 10 MIN', 'CARQ BRDG 20 MIN', 'WALNUT CR 14 MIN'], { lon: '-122.20' }),
      sign('I-880', ['SF  DWNTWN  12 MIN'], { lon: '-122.28' }),               // nearer the bridge
      sign('I-580', ['SFO 25 MIN'], { lon: '-122.30' }),                       // the airport, not the city
    ] }, { routes: ['I-880', 'I-580'], box: [37.70, -122.33, 37.86, -122.05] });
    expect(withSF.toSF).toEqual({ mins: 12, near: 'Downtown', route: 'I-880' });
  });
});

describe('the Bay Bridge when the signs post no time', () => {
  const tz = 'America/Los_Angeles';
  const bridge = { route: 'I-80', box: [37.78, -122.392, 37.84, -122.295] };
  const night = Date.parse('2026-11-01T06:30:00Z');   // 10:30 pm, local (still daylight time)
  // 511's traffic events, as the API sends them (abridged)
  const events = { events: [
    { event_type: 'INCIDENT', status: 'ACTIVE', severity: 'Major', created: '2026-11-01T05:30Z',
      headline: 'CHP : Traffic Collision on I-80 Westbound east of Treasure Island Rd (San Francisco). Right shoulder affected. Expect delays.',
      roads: [{ name: 'I-80 W', direction: 'Westbound' }], geography: { type: 'Point', coordinates: [-122.361552, 37.813697] } },
    { event_type: 'INCIDENT', status: 'ACTIVE', severity: 'Moderate', created: '2026-11-01T04:36Z',
      headline: 'CHP : Vehicle fire on I-280 Southbound south of Cesar Chavez St (San Francisco). Lane blocked. Expect delays.',
      roads: [{ name: 'I-280 S', direction: 'Southbound' }], geography: { type: 'Point', coordinates: [-122.392204, 37.750228] } },
    { event_type: 'CONSTRUCTION', status: 'ACTIVE', headline: 'Caltrans : Long-term construction on I-80 Eastbound exiting at Treasure Island Rd.',
      roads: [{ name: 'I-80 E', direction: 'Eastbound' }], geography: { type: 'Point', coordinates: [-122.364334, 37.810654] } },
  ] };
  // Caltrans' lane closures, as cwwp2 sends them (abridged)
  const lcs = (o) => ({ lcs: {
    location: { travelFlowDirection: o.dir,
      begin: { beginRoute: o.route || 'I-80', beginLocationName: o.from, beginLatitude: String(o.lat ?? 37.80), beginLongitude: String(o.lon ?? -122.37) },
      end: { endLocationName: o.to, endLatitude: String(o.lat ?? 37.80), endLongitude: String(o.lon ?? -122.37) } },
    closure: { closureTimestamp: { closureStartDate: o.start[0], closureStartTime: o.start[1], closureEndDate: o.end[0], closureEndTime: o.end[1] },
      facility: o.facility || 'Mainline', typeOfWork: o.work || 'Bridge Construction', lanesClosed: o.lanes, totalExistingLanes: String(o.of),
      code1097: { isCode1097: String(!!o.started) }, code1098: { isCode1098: String(!!o.ended) } },
  } });
  const closuresJson = { data: [
    lcs({ dir: 'West', from: 'SAS TOWER', to: 'SFOBB TOWER 2 (W-2)', lanes: 'LShoulder, 1, 2, 3', of: 5, start: ['2026-11-01', '22:01:00'], end: ['2026-11-02', '05:01:00'] }),
    lcs({ dir: 'East', from: 'Route 80', to: 'Treasure Island', facility: 'Off Ramp', lanes: 'All', of: 1, start: ['2023-06-22', '23:01:00'], end: ['2026-12-31', '23:59:00'], started: true }),
    lcs({ dir: 'South', route: 'SR-1', from: 'Taylor St', to: 'Kent Ave', lanes: '1', of: 2, lat: 38.33, lon: -123.04, start: ['2026-11-01', '09:00:00'], end: ['2026-11-01', '15:00:00'], started: true }),
  ] };

  it('takes CHP’s incidents on the bridge only, in a sign’s words', () => {
    const inc = parseIncidents(events, bridge);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ kind: 'CRASH', dir: 'WB', level: 2,
      text: 'Traffic Collision on I-80 Westbound east of Treasure Island Rd · Right shoulder affected' });
  });
  it('reduces Caltrans’ closures to the span: started and not ended now, the rest planned; a ramp kept apart', () => {
    const c = parseClosures(closuresJson, bridge, night, tz);
    expect(c.now).toHaveLength(1);
    expect(c.now[0]).toMatchObject({ dir: 'EB', ramp: true });
    expect(c.planned).toHaveLength(1);
    expect(c.planned[0]).toMatchObject({ dir: 'WB', lanes: 3, of: 5, ramp: false });   // a shoulder is not a lane
    expect(c.planned[0].from).toBe(Date.parse('2026-11-02T06:01:00Z'));                 // 10:01 pm Pacific, after the clocks go back
  });
  it('after hours: a crash first, then lanes closed now, else NO CLOSURES with the next planned', () => {
    const incidents = parseIncidents(events, bridge), closures = parseClosures(closuresJson, bridge, night, tz);
    const blank = { list: [], toSF: null };
    expect(bridgeStatus({ signs: blank, incidents, closures }, night, tz)).toMatchObject({ mode: 'status', after: true, level: 2, text: 'CRASH WB' });
    const calm = bridgeStatus({ signs: blank, incidents: [], closures }, night, tz);
    expect(calm).toMatchObject({ text: 'NO CLOSURES', level: 0 });
    expect(calm.sub).toBe('none reported by Caltrans or CHP · eastbound treasure island ramp closed · next: sun 10 pm, 3 of 5 lanes westbound');
    const crews = bridgeStatus({ signs: blank, incidents: [], closures: { now: [{ ...closures.planned[0] }], planned: [] } },
      Date.parse('2026-11-02T07:00:00Z'), tz);
    expect(crews).toMatchObject({ text: '3 OF 5 LANES\nCLOSED WB', level: 1 });
    expect(crews.sub).toMatch(/^until 5 am · bridge construction/);
  });
  it('by day the signs’ minutes stand, with a crash under them; AFTER HOURS only from 10 pm to 5:30 am', () => {
    const incidents = parseIncidents(events, bridge);
    const day = bridgeStatus({ signs: { list: [], toSF: { mins: 14, near: 'Oakland', route: 'I-580' } }, incidents }, night, tz);
    expect(day).toMatchObject({ mode: 'time', after: false, text: '14 MIN', level: 2 });
    expect(day.sub).toMatch(/^traffic collision on i-80 westbound/);
    const at = (iso) => bridgeStatus({ signs: { list: [], toSF: null }, closures: { now: [], planned: [] } }, Date.parse(iso), tz).after;
    expect(at('2026-11-02T20:00:00Z')).toBe(false);   // noon: a blank sign by day is just BAY BRIDGE
    expect(at('2026-11-03T05:59:00Z')).toBe(false);   // 9:59 pm
    expect(at('2026-11-03T06:00:00Z')).toBe(true);    // 10 pm
    expect(at('2026-11-03T13:29:00Z')).toBe(true);    // 5:29 am
    expect(at('2026-11-03T13:30:00Z')).toBe(false);   // 5:30 am
  });
  it('never claims what it can’t see: no closures read, no NO CLOSURES; no 511 key, no CHP', () => {
    expect(bridgeStatus({ signs: { list: [], toSF: null } }, night, tz)).toMatchObject({ text: '--' });
    expect(bridgeStatus({ signs: { list: [], toSF: null }, closures: { now: [], planned: [] } }, night, tz).sub).toBe('none reported by Caltrans');
    expect(bridgeStatus({}, night, tz)).toBeNull();
  });
  it('reads 511 only with its key, and no key reaches the sources page', () => {
    const c = { lat: 37.8, lon: -122.27, tz, bridge: { district: 4, ...bridge } };
    expect(SOURCES.incidents.on(c)).toBe(false);
    expect(SOURCES.closures.on(c)).toBe(true);
    const keyed = { ...c, keys: { traffic511: 'SECRET-511-KEY' } };
    expect(SOURCES.incidents.on(keyed)).toBe(true);
    const list = JSON.stringify(buildSources(keyed));
    expect(list).toContain('511 SF Bay');
    expect(list).not.toContain('SECRET-511-KEY');
    expect(cityConfig({ city: {}, location: { coords: [37.8, -122.27] } }, { TRAFFIC_511_KEY: 'k' }).keys.traffic511).toBe('k');
  });
});

describe('the tide', () => {
  const now = Date.parse('2026-10-28T04:00:00Z');
  const at = (h) => new Date(now + h * HOUR).toISOString().slice(0, 16).replace('T', ' ');
  const tide = (observedHigh, nextHigh, surge) => parseTide({
    observed: { data: [{ t: at(-12), v: String(observedHigh) }, { t: at(-6), v: '2.0' }, { t: at(0), v: String(0.1 + surge) }] },
    predicted: { predictions: [{ t: at(-6), v: '1.5' }, { t: at(0), v: '0.1' }, { t: at(9), v: String(nextHigh) }] },
    datums: { datums: [{ name: 'MLLW', value: 3.33 }, { name: 'MHHW', value: 9.93 }] },
    flood: { nos_minor: 11.83, nos_moderate: 12.75 },
  }, now);
  it('converts NOAA’s flood levels to feet above mean lower low water', () => {
    expect(tide(7, 7, 0)).toMatchObject({ minor: 8.5, moderate: 9.4, mhhw: 6.6 });
  });
  it('is calm when the next high, with the surge, stays well under minor flooding', () => {
    expect(tide(7, 7, 0.2).level).toBe(0);
  });
  it('is worth a look half a foot early, or when the last day already reached it', () => {
    expect(tide(7, 7.4, 0.7)).toMatchObject({ expect: 8.1, level: 1 });   // 2026-10-27 evening
    expect(tide(8.62, 6.5, 0).level).toBe(1);                               // the noon peak
  });
  it('is hot at moderate flooding', () => {
    expect(tide(7, 9.0, 0.6).level).toBe(2);
  });
});

describe('gauges', () => {
  const rows = (vals, stepMin, kind = 'RAIN') => vals.map((v, i) => ({
    date: new Date(Date.parse('2026-01-04T12:00:00Z') - 8 * HOUR + (i - vals.length + 1) * stepMin * 60_000)
      .toISOString().slice(0, 16).replace('T', ' '), value: v, sensorType: kind,
  }));
  it('rain: a running total becomes the last hour and the last day', () => {
    const r = parseRain(rows([...Array(24).fill(5), 5.3, 5.9], 60));
    expect(r).toMatchObject({ hour: 0.6, day: 0.9, level: 2 });
  });
  it('rain: the Oct 1 reset reads as no rain, not a negative total, and gaps are dropped', () => {
    expect(parseRain(rows([12, 12, -9999, 0, 0], 60))).toMatchObject({ hour: 0, level: 0 });
  });
  it('reads CDEC’s unpadded dates (2026-11-01: "2026-11-1 1:00" came back NaN, and the night’s rain with it)', () => {
    const night = [['2026-10-31 2:00', 0.58], ['2026-10-31 23:00', 0.58], ['2026-11-1 0:00', 0.58], ['2026-11-1 1:00', 0.74], ['2026-11-1 2:00', 0.91]]
      .map(([date, value]) => ({ date, value, sensorType: 'RAIN' }));
    expect(cdecSeries(night).map(([t]) => new Date(t).toISOString())).toEqual(
      ['2026-10-31T10:00:00.000Z', '2026-11-01T07:00:00.000Z', '2026-11-01T08:00:00.000Z', '2026-11-01T09:00:00.000Z', '2026-11-01T10:00:00.000Z']);
    expect(parseRain(night)).toMatchObject({ hour: 0.17, day: 0.33 });
  });
  it('a creek: its level, the hour’s rise, and the two-day high', () => {
    expect(parseStage(rows([1, 1, 1, 1, 1.5, 2.1], 15))).toMatchObject({ ft: 2.1, change: 1.1, high: 2.1, level: 1 });
  });
});

describe('the gauges when CDEC is slow', () => {
  const gauges = [{ label: 'HILLS SOUTH' }, { label: 'HILLS NORTH' }];
  const last = [{ label: 'HILLS SOUTH', kind: 'rain', at: 1, hour: 0, day: 0.1, level: 0 }, { label: 'HILLS NORTH', kind: 'rain', at: 1, hour: 0, day: 0, level: 0 }];
  it('a gauge that didn’t answer keeps its last reading, never "missing" over a good one', () => {
    const now = { label: 'HILLS SOUTH', kind: 'rain', at: 2, hour: 0.04, day: 0.14, level: 0 };
    expect(keepGauges([now, null], last, gauges)).toEqual([now, last[1]]);
    expect(keepGauges([now, null], null, gauges)[1]).toEqual({ label: 'HILLS NORTH', missing: true });
  });
  it('none answering is a failure, so the last answer stays and goes stale', () => {
    expect(() => keepGauges([null, null], last, gauges)).toThrow();
  });
});

describe('El Niño', () => {
  it('decodes the page’s entities before reading it', () => {
    expect(decodeEntities('El Ni&ntilde;o 83&#37; +2.1&deg;C &#x2b;')).toBe('El Niño 83% +2.1°C +');
  });
  it('reads the status, the synopsis, Niño-3.4 and both dates', () => {
    const e = parseEnso('<b>ENSO Alert System Status:</b> El Ni&ntilde;o Advisory<br><b>Synopsis:</b> El Ni&ntilde;o continues to strengthen (greater than an 83&#37; chance). Indices reached +2.1&deg;C in Ni&ntilde;o-3.4. issued 8 October 2026 … next 12 November 2026');
    expect(e).toEqual({ status: 'EL NIÑO ADVISORY', synopsis: 'El Niño continues to strengthen (greater than an 83% chance).',
      nino34: 2.1, issued: '8 October 2026', next: '12 November 2026' });
  });
  it('a page that changed shape reads as nothing, not as a guess', () => {
    expect(parseEnso('<p>maintenance</p>')).toBeNull();
  });
});

describe('the verdict', () => {
  const now = Date.now();
  it('is ALL CLEAR with nothing worth a look', () => {
    expect(verdict({ air: { level: 0 }, airport: { level: 0, code: 'OAK', status: 'NORMAL' }, alerts: [] })).toEqual({ text: 'ALL CLEAR', level: 0 });
  });
  it('a warning outranks an advisory, and an advisory outranks the rest', () => {
    expect(verdict({ alerts: [{ event: 'COASTAL FLOOD ADVISORY', level: 1 }], tide: { level: 1 } }).text).toBe('COASTAL FLOOD ADVISORY');
    expect(verdict({ alerts: [{ event: 'COASTAL FLOOD ADVISORY', level: 1 }], airport: { code: 'OAK', status: 'GROUND STOP', level: 2 } }))
      .toEqual({ text: 'OAK GROUND STOP', level: 2 });
  });
  it('names a big quake, heavy rain and BART trouble', () => {
    expect(verdict(parseQuakes({ features: [{ properties: { mag: 4.6, place: 'near Berkeley', time: now - HOUR } }] }, now)
      .reduce((s, q) => ({ quakes: [...(s.quakes || []), q] }), {})).text).toBe('M4.6 EARTHQUAKE');
    expect(verdict({ gauges: [{ kind: 'rain', level: 2 }] }).text).toBe('HEAVY RAIN');
    expect(verdict({ bart: { level: 1 } }).text).toBe('BART DELAYS');
  });
  it('a source that is missing says nothing, so it can never raise a false alarm', () => {
    expect(verdict({})).toEqual({ text: 'ALL CLEAR', level: 0 });
  });
});

describe('the switch', () => {
  it('no city block, or no real coordinates, means no board', () => {
    expect(cityConfig({ location: { coords: [37.8, -122.27] } })).toBeNull();
    expect(cityConfig({ city: {}, location: { coords: [0, 0] } })).toBeNull();
    expect(cityConfig({ city: { airport: 'OAK' }, location: { name: 'HOMETOWN', coords: [37.8, -122.27] }, timezone: 'America/Los_Angeles' }))
      .toMatchObject({ airport: 'OAK', lat: 37.8, lon: -122.27, name: 'HOMETOWN', tz: 'America/Los_Angeles' });
  });
});

describe('the payload, shared by /api/city and the scheduled snapshot', () => {
  const c = { airport: 'OAK', lat: 37.8, lon: -122.27, name: 'HOMETOWN', tz: 'America/Los_Angeles' };
  const now = Date.parse('2026-10-28T04:00:00Z');
  it('refreshes only what is due, most overdue first, within the budget', () => {
    const entries = { sky: { data: {}, ts: now - 60_000 }, alerts: { data: [], ts: now - 10 * 60_000 } };
    const due = dueSources(entries, c, now, 3);
    expect(due).toHaveLength(3);
    expect(due).not.toContain('sky');                              // a minute old, fresh for ten
    expect(due.slice(0, 2).every((n) => !entries[n])).toBe(true);  // never read beats overdue
    expect(dueSources(entries, c, now, 99)).toContain('alerts');   // three minutes is its limit
  });
  it('BART is live: read on every scheduled run, outside the budget', () => {
    expect(liveSources(c)).toEqual([]);                            // no key, no BART
    const withBart = { ...c, bart: { key: 'k' } };
    expect(liveSources(withBart)).toEqual(['bart']);
    expect(dueSources({}, withBart, now, 99, ['bart'])).not.toContain('bart');
  });
  it('only sources the config asks for are on the board', () => {
    const names = Object.keys(buildPayload({}, c, now).sections);
    expect(names).toContain('airport');
    expect(names).not.toContain('bart');                           // no key, no BART
    expect(names.every((n) => SOURCES[n])).toBe(true);
  });
  it('a source too old to vouch for shows, but cannot drive the verdict', () => {
    const p = buildPayload({ alerts: { data: [{ event: 'FLOOD WARNING', level: 2 }], ts: now - 60 * 60_000 } }, c, now);
    expect(p.stale).toEqual(['alerts']);
    expect(p.sections.alerts[0].event).toBe('FLOOD WARNING');
    expect(p.verdict).toEqual({ text: 'ALL CLEAR', level: 0 });
  });
  it('carries its own state: the snapshot can be read back into the entries it was built from', () => {
    const entries = { airport: { data: { code: 'OAK', status: 'NORMAL', level: 0 }, ts: now - 1000 } };
    expect(entriesFrom(JSON.parse(JSON.stringify(buildPayload(entries, c, now))))).toEqual(entries);
    expect(entriesFrom(null)).toEqual({});
  });
});

describe('the sources page’s list', () => {
  const c = { lat: 37.8, lon: -122.27, name: 'HOMETOWN', tz: 'America/Los_Angeles', airport: 'OAK', tide: '9414750',
    bart: { key: 'SECRET-KEY-1234', station: '12TH' }, signs: { district: 4 }, elnino: true,
    gauges: [{ label: 'HILLS SOUTH', kind: 'rain', station: 'OSO', sensor: 2, dur: 'H' }] };
  const list = buildSources(c, 'https://cdn.example/city/now.json');
  it('follows the board: now, moving, watching, then the board’s own data', () => {
    expect(list.map((s) => s.section)).toEqual(['NOW', 'MOVING', 'WATCHING', 'THE BOARD']);
    expect(list[1].items.map((i) => i.by)).toEqual(['BART', 'BART', 'FAA', 'Caltrans']);   // departures, then the timetable
    expect(list[3].items[0].data).toBe('https://cdn.example/city/now.json');
  });
  it('never carries a key: BART links its documentation, not a request', () => {
    expect(JSON.stringify(list)).not.toContain('SECRET-KEY-1234');
  });
  it('cites the feed the board actually reads, and only what this config turns on', () => {
    const urls = list.flatMap((s) => s.items.map((i) => i.data || i.page));
    expect(urls.every((u) => /^https:\/\/|^\/api\/city$/.test(u))).toBe(true);
    expect(list[2].items.map((i) => i.by)).toContain('CDEC OSO');
    const bare = buildSources({ lat: 37.8, lon: -122.27, tz: 'UTC' });
    expect(bare.flatMap((s) => s.items.map((i) => i.by))).not.toContain('BART');
  });
});

describe('blank pipes and national gauges (for other towns)', () => {
  const t0 = Date.parse('2026-11-01T12:00:00Z');
  const usgsJson = (pts) => ({ value: { timeSeries: [{ values: [{ value: pts.map(([dtMin, v]) => ({
    dateTime: new Date(t0 + dtMin * 60_000).toISOString(), value: String(v),
  })) }] }] } });

  it('reads a USGS creek gauge (00065) and rain gauge (00045) in the same shape as CDEC', () => {
    const stage = parseUsgs(usgsJson([[-120, 1.2], [-60, 1.4], [-15, 2.0], [0, 2.6]]), 'stage');
    expect(stage).toMatchObject({ ft: 2.6, change: 1.2, high: 2.6, level: 1, by: 'USGS' });
    const rain = parseUsgs(usgsJson([[-180, 0.1], [-60, 0.2], [-30, 0.35], [0, 0.25]]), 'rain');
    expect(rain).toMatchObject({ hour: 0.6, day: 0.9, level: 2, by: 'USGS' });
    expect(FEED.usgs({ usgs: '11169025', kind: 'stage' })).toContain('sites=11169025&parameterCd=00065');
    expect(FEED.usgs({ usgs: '11169025', kind: 'rain' })).toContain('sites=11169025&parameterCd=00045');
  });
  it('lets another city turn off Oakland’s timed transfers or name its own crossing and rail system', () => {
    const etd = { root: { station: [{ abbr: 'MCAR', name: 'MacArthur', etd: [
      { destination: 'SF Airport', abbreviation: 'SFIA', estimate: [{ minutes: '10', delay: '0', color: 'YELLOW', hexcolor: '#ffff33' }] },
      { destination: 'Berryessa', abbreviation: 'BERY', estimate: [{ minutes: '12', delay: '0', color: 'ORANGE', hexcolor: '#ff9933' }] },
    ] }] } };
    expect(parseBart({ etd }, { stations: ['MCAR'], meets: {} }).stations[0].transfers).toBeUndefined();
    expect(verdict({ bart: { level: 1, label: 'CALTRAIN' } }).text).toBe('CALTRAIN DELAYS');
    const b = bridgeStatus({ signs: { list: [], toSF: { mins: 11, near: 'Foster City', route: 'SR-92' } } }, t0, 'America/Los_Angeles',
      { label: 'SAN MATEO BRIDGE', toLabel: 'TO HAYWARD' });
    expect(b).toMatchObject({ text: '11 MIN', label: 'SAN MATEO BRIDGE', toLabel: 'TO HAYWARD' });
  });
  it('accepts custom pipes in config and cites them on the sources page', () => {
    const c = {
      lat: 37.56, lon: -122.32, name: 'SAN MATEO', tz: 'America/Los_Angeles',
      gauges: [{ label: 'SAN FRANCISQUITO', kind: 'stage', usgs: '11164500' }],
      pipes: {
        bart: {
          ttl: 60_000, stale: 300_000, live: true,
          load: async () => ({ label: 'CALTRAIN', unit: 'TRAINS', trains: 14, closed: false, level: 0, advisories: [], stations: [] }),
          cite: { section: 'MOVING', what: 'Caltrain', how: 'Departures', by: '511 SF Bay', page: 'https://511.org/' },
        },
        bridge: {
          ttl: 120_000, stale: 600_000,
          load: async () => ({ mode: 'time', after: false, level: 0, text: '14 MIN', sub: 'via sr-92', label: 'SAN MATEO BRIDGE', toLabel: 'TO EAST BAY' }),
          cite: { section: 'MOVING', what: 'San Mateo Bridge', how: 'Crossing time', by: 'Caltrans', page: 'https://quickmap.dot.ca.gov/' },
        },
      },
    };
    expect(liveSources(c)).toEqual(['bart']);
    const p = buildPayload({
      bart: { data: { label: 'CALTRAIN', trains: 14, level: 0 }, ts: t0 - 1000 },
      bridge: { data: { mode: 'time', level: 0, text: '14 MIN', label: 'SAN MATEO BRIDGE' }, ts: t0 - 1000 },
    }, c, t0);
    expect(p.sections.bart.label).toBe('CALTRAIN');
    expect(p.sections.bridge).toMatchObject({ text: '14 MIN', label: 'SAN MATEO BRIDGE' });
    const sources = buildSources(c);
    const moving = sources.find((s) => s.section === 'MOVING').items;
    const watching = sources.find((s) => s.section === 'WATCHING').items;
    expect(moving.map((i) => i.what)).toContain('Caltrain');
    expect(moving.map((i) => i.what)).toContain('San Mateo Bridge');
    expect(watching.map((i) => i.by)).toContain('USGS 11164500');
  });
});
