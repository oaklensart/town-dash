// /city — the city board. Reads the board's snapshot every 20 s while the tab
// is visible (the engine's one timer stops while it is hidden), or /api/city
// once a minute when there is none, and draws it on the dot-matrix engine,
// which js/dotmatrix.js has already put on the page. BART's next trains count
// down here, by the second, between readings.
//
// The board starts dark and lights as the sources arrive. A panel warms
// (amber) for something worth a look and goes hot (red) for something to act
// on; the rest stays cold. Nothing is drawn that the payload did not say: a
// source still warming shows its dark grid, a stale one dims.

const { display, every, formatClock, widen, GLYPHS } = globalThis.DotMatrix;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATE = ['ok', 'warn', 'alert'];
const LABEL_FIT = { min: 1.6, max: 2 };   // a field label: the scoreboard's 2px, a touch less on a phone
const SUB_FIT = { min: 1.9, max: 4.2 };   // the 3-way split in NOW (AQI, barometer, wind)
const SMALL_FIT = { min: 2.2, max: 3 };   // small data: station names, minutes, alert names

/** Two lines, broken at the space nearest the middle, when one line would need dots under `minPitch` px in `room`. */
function breakIfLong(text, room, minPitch = LABEL_FIT.min) {
  if (text.length * 6 * minPitch <= room) return text;
  const mid = text.length / 2;
  const cut = [...text.matchAll(/ /g)].map((m) => m.index).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  return cut == null ? text : `${text.slice(0, cut)}\n${text.slice(cut + 1)}`;
}
const roomIn = (el) => {
  const cs = getComputedStyle(el);
  return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
};
const MIN = 60_000;
const READ_EVERY = 20_000;   // the snapshot's own pace for BART (workers/city/snapshot.js, LIVE_EVERY)

const dms = new Map();
/** The display living in element `id`, made the first time it is asked for. */
function dm(id, opts) {
  // Values and labels size their dots to the room they have, so nothing spills
  // out of a narrow column; a label may go down to 2.5px before it would.
  const cls = $(id).classList;
  const fit = cls.contains('dm--value') ? { min: 3, max: 8.5 }
    : cls.contains('dm--sub') ? SUB_FIT
    : cls.contains('dm--label') ? LABEL_FIT : null;
  if (!dms.has(id)) dms.set(id, display($(id), { state: 'off', fit, ...opts }));
  return dms.get(id);
}
const label = (id, text) => dm(id, { state: 'idle' }).state('idle').set(text);
const show = (id, on) => { $(id).hidden = !on; };
const heat = (id, lvl) => { $(id).dataset.heat = String(lvl || 0); };

let tz;
const hm = (t) => (t ? formatClock(new Date(t), 'hh:mm AP', tz) : '');
const dayHm = (t) => (t ? formatClock(new Date(t), 'DOW hh:mm AP', tz) : '');
const ago = (t) => {
  const m = Math.round((Date.now() - t) / MIN);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// ── the headline: a short deck, one card at a time ─────────────────────────
// The snapshot sends the deck (src/shared/city.js headlines): the verdict, then
// what's going on in the town. It is one sign: every card is drawn into the
// same grid of dots, sized for the longest, and the line under it keeps the
// height of its longest, so nothing on the page moves between cards. A card
// holds CARD_EVERY; its arrival is the board's own light-up, the one motion,
// and a warning holds the sign alone. The engine's one timer stops while the
// tab is hidden, and with reduced motion the cards change without lighting up.
// Only a display: nothing to press (owner, 2026-10-30).
const CARD_EVERY = 8000;
const still = matchMedia('(prefers-reduced-motion: reduce)');
let deck = [], deckAt = 0, sign = null, signShape = '', signNote = null;
// An event card (src/shared/city.js EVENTS, `flash`) flashes as it arrives: three
// strikes a second apart once its light-up is done, well under the three a
// second WCAG 2.3.1 allows, and none with reduced motion.
const FLASHES = 3, FLASH_EVERY = 950;
let flashTimers = [], flashKey = null;
function signLayout() {
  const room = $('c-verdict').parentElement.clientWidth || 1000;
  // measured as drawn: a sky mark is three cells (js/dotmatrix.js WIDE)
  const oneLine = deck.every((c) => [...widen(c.text)].length * 6 * 4 <= room);   // still at least a 4px pitch on one line
  const split = (t) => {
    if (oneLine) return t;
    const mid = t.length / 2;
    const cut = [...t.matchAll(/ /g)].map((m) => m.index).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    return cut == null ? t : `${t.slice(0, cut)}\n${t.slice(cut + 1)}`;
  };
  const bodies = deck.map((c) => split(widen(c.text)));
  const cols = Math.max(...bodies.flatMap((b) => b.split('\n').map((l) => [...l].length)));
  // centred at every width: a shorter card sits in the middle of the sign, as a headline does (owner, 2026-10-30)
  return { lines: oneLine ? 1 : 2, cols, align: 'center', bodies };
}
function drawSign(animate = 'light') {
  if (!deck.length) return;
  const { lines, cols, align, bodies } = signLayout();
  const shape = `${lines}|${cols}|${align}`;
  if (shape !== signShape) {
    sign?.destroy();
    sign = display($('c-verdict'), { lines, cols, align, fit: { min: 3, max: 14 } });
    $('c-verdict').classList.add('vfd');
    signShape = shape;
  }
  const card = deck[deckAt];
  // a holiday in its own colour (src/shared/city.js HOLIDAYS); every other card in the sign's
  $('c-verdict').dataset.tone = card.tone || '';
  sign.state(STATE[card.level] || 'ok').set(bodies[deckAt], { animate: still.matches ? 'none' : animate, label: card.text.toLowerCase() });
  // a quiet redraw (a resize, the minute's same deck) lets a flash run on; a new card stops it
  const lighting = animate !== 'none' && !still.matches;
  if (lighting || card.key !== flashKey) { flashTimers.forEach(clearTimeout); flashTimers = []; }
  flashKey = card.key;
  if (card.flash && lighting) {
    const lit = 300 + cols * lines * 32;   // the light-up's last cell (js/dotmatrix.js STEP_MS)
    for (let k = 0; k < FLASHES; k++) flashTimers.push(setTimeout(() => sign.strike(), lit + k * FLASH_EVERY));
  }
  $('c-sub').textContent = signNote || card.sub || '';
  $('c-pager').hidden = deck.length < 2;
  $('c-pager').innerHTML = deck.map((_, i) => `<i${i === deckAt ? ' class="on"' : ''}></i>`).join('');
}
// the line under the sign keeps the height of the deck's longest, so the page holds still
function holdSub() {
  const el = $('c-sub');
  el.style.minHeight = '';
  let h = 0;
  for (const c of deck) { el.textContent = signNote || c.sub || ''; h = Math.max(h, el.offsetHeight); }
  el.style.minHeight = `${h}px`;
}
function setHeadlines(cards) {
  const was = deck[deckAt]?.key;
  const says = JSON.stringify(cards);
  if (says === JSON.stringify(deck)) return drawSign('none');
  deck = cards;
  const i = deck.findIndex((c) => c.key === was);
  deckAt = deck[0]?.level >= 2 || i < 0 ? 0 : i;
  holdSub();
  drawSign();
}
every(CARD_EVERY, () => {
  if (deck.length < 2 || deck[0].level >= 2) return;
  deckAt = (deckAt + 1) % deck.length;
  drawSign();
});
// Re-decide one line or two whenever the board's width changes, not only on load.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => { if (deck.length) { holdSub(); drawSign('none'); } }).observe($('c-verdict').parentElement);
}

// ── NOW ─────────────────────────────────────────────────────────────────────
// The strip reads as one sign: each readout fits its own tile, then every
// readout in a visual row takes the row's smallest pitch (--row-value,
// --row-label on the tile), so the four are one size and the lines under
// them sit level. A long one (SUNRISE IN 10H 49M) used to come out smaller
// than its neighbours and drop its line out of step (owner, 2026-10-31).
// The engine writes each fitted pitch on its host, so that is what is watched.
const nowTiles = [...document.querySelectorAll('.c-now > div:not(.c-now-split)')];
const splitTile = document.querySelector('.c-now-split');
let evenQueued = false;
function evenNow() {
  evenQueued = false;
  for (const kind of ['value', 'label']) {
    const rows = new Map();
    const tiles = nowTiles.map((tile) => {
      const own = parseFloat(tile.querySelector(`.dm--${kind}`)?.style.getPropertyValue('--dm-pitch'));
      const row = tile.offsetTop;
      if (own > 0) rows.set(row, Math.min(rows.get(row) ?? Infinity, own));
      return [tile, row];
    });
    for (const [tile, row] of tiles) {
      const p = rows.get(row);
      const v = p ? `${p.toFixed(2)}px` : '';
      if (tile.style.getPropertyValue(`--row-${kind}`) !== v) tile.style.setProperty(`--row-${kind}`, v);
    }
  }
  // the fourth tile's three readouts (AQI, barometer, wind): one pitch for all three values and one for all three labels
  if (splitTile) {
    for (const [cls, prop] of [['sub', '--sub-value'], ['label', '--sub-label']]) {
      const pitches = [...splitTile.querySelectorAll(`.dm--${cls}`)].map((el) => parseFloat(el.style.getPropertyValue('--dm-pitch'))).filter((x) => x > 0);
      const sv = pitches.length ? `${Math.min(...pitches).toFixed(2)}px` : '';
      if (splitTile.style.getPropertyValue(prop) !== sv) splitTile.style.setProperty(prop, sv);
    }
  }
  // the station names, the same way: one size for all eight (--names on the list),
  // where each fitting its own half of a phone made "12TH ST" bigger than "WEST OAKLAND"
  const list = $('bart-stations');
  const names = [...list.querySelectorAll('.c-tab-dm .dm')].map((el) => parseFloat(el.style.getPropertyValue('--dm-pitch'))).filter((x) => x > 0);
  const v = names.length ? `${Math.min(...names).toFixed(2)}px` : '';
  if (list.style.getPropertyValue('--names') !== v) list.style.setProperty('--names', v);
  // and the line squares' slot: as wide as the widest set of squares and mark, so the names line up
  // (a rect is zoomed on a large screen, js/town-scale.js, and the slot is written in the page's own px)
  const zoom = parseFloat(document.documentElement.style.zoom) || 1;
  const slot = Math.max(0, ...[...list.querySelectorAll('.c-pips')].map((el) => {
    const kids = [...el.children].filter((k) => k.getClientRects().length && getComputedStyle(k).position !== 'absolute');
    return kids.length ? (kids.at(-1).getBoundingClientRect().right - kids[0].getBoundingClientRect().left) / zoom : 0;
  }));
  const s = slot ? `${Math.ceil(slot)}px` : '';
  if (list.style.getPropertyValue('--pips') !== s) list.style.setProperty('--pips', s);
}
const queueEven = () => { if (!evenQueued) { evenQueued = true; requestAnimationFrame(evenNow); } };
if (typeof MutationObserver === 'function') {
  const mo = new MutationObserver(queueEven);
  for (const el of document.querySelectorAll('.c-now .dm--value, .c-now .dm--sub, .c-now .dm--label')) mo.observe(el, { attributes: true, attributeFilter: ['style'] });
  // the tabs are drawn later and redrawn, so the list is watched as a whole
  mo.observe($('bart-stations'), { attributes: true, attributeFilter: ['style'], subtree: true });
}
addEventListener('resize', queueEven);

let clocksBound = false;
function bindClocks(name) {
  if (clocksBound) return;
  clocksBound = true;
  dm('c-place', { state: 'idle' }).bind(() => `${name} · ${formatClock(new Date(), 'DOW DD MON', tz)}`, { every: MIN, align: true });
  label('n-time-l', 'TIME');
  dm('n-time', { animate: 'none' }).state('ok').bind(() => formatClock(new Date(), 'hh:mm', tz), { every: 1000, align: true });
  const meta = $('n-time-m');
  const zone = () => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' })
    .formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value || tz;
  every(MIN, () => { meta.textContent = `${formatClock(new Date(), 'AP', tz).toLowerCase()} · ${zone().toLowerCase()}`; }, { align: true });
}

// The wind's line in words ("mph · from the southwest") where it fits on one line, else its compass
// point ("mph · SW"): in half a phone's tile, and in a desk's row of four, the words ran to three lines
// (owner, 2026-11-01). Tried again on a resize, since the room changes and the words may fit after all.
let windLines = null;
function fitWind() {
  const el = $('n-wind-m');
  if (!windLines) return;
  el.textContent = windLines[0];
  if (el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 1.5) el.textContent = windLines[1];
}
addEventListener('resize', fitWind);
const WIND_FROM = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
function drawSky(sky) {
  label('n-temp-l', 'TEMP');
  label('n-baro-l', 'BARO');
  label('n-wind-l', 'WIND');
  if (!sky) return;
  dm('n-temp', { animate: 'count' }).state('ok').set(`${sky.temp}°${sky.unit}`);
  const t = sky.today || {};
  // The whole day on one line: someone out at 7:30 is often still out at 2.
  const range = t.hi != null ? `hi ${t.hi}° lo ${t.lo}°` : '';
  const extra = [t.uv != null && t.uv >= 3 && `uv ${t.uv}`, t.gust != null && t.gust >= 15 && `gusts ${t.gust}`].filter(Boolean);
  const fog = sky.lowCloud >= 70 ? 'low cloud on the hills' : '';
  $('n-temp-m').textContent = [sky.sky.toLowerCase(), range, ...extra, fog].filter(Boolean).join(' · ');
  // Barometer (inches of mercury and 3-hour tendency) and live 10m wind speed/direction
  if (sky.pressure?.inHg != null) {
    const inHg = sky.pressure.inHg.toFixed(2);
    const trend = sky.pressure.trend || 'steady';
    dm('n-baro', { animate: 'count' }).state(STATE[sky.pressure.level || 0])
      .set(inHg, { label: `barometer ${inHg} inches of mercury, ${trend}` });
    $('n-baro-m').textContent = `inHg · ${trend}`;
  } else {
    dm('n-baro', { animate: 'none' }).state('idle').set('--', { label: 'barometer warming' });
    $('n-baro-m').textContent = 'inHg';
  }
  // the unit sits in the line under it, as the barometer's inHg does: a number reads at a glance, and
  // "12 MPH" in half a tile would shrink all three readouts on a windy day
  if (sky.wind != null) {
    const w = sky.wind, dir = WIND_FROM[sky.windDir] || '';
    const gusty = sky.windGust != null && (sky.windGust >= 15 || sky.windGust >= w + 5);
    dm('n-wind', { animate: 'count' }).state(STATE[sky.windLevel || 0])
      .set(String(w), { label: `wind ${w} mph${dir ? ` from the ${dir}` : ''}` });
    const line = (from) => ['mph', w === 0 ? 'calm' : from, gusty && `gusts ${sky.windGust}`].filter(Boolean).join(' · ');
    windLines = [line(dir && `from the ${dir}`), line(sky.windDir)];
    fitWind();
  }
  sun = sky.sun;
  drawLight();
}

// The light, recounted every minute from the day's sunrise and sunset, so the
// countdown moves between reads. Hours and minutes are spelled H and M: an
// "8:59" beside the clock's "9:41" reads as a time of day, not a time left.
let sun = null, lightBound = false;
const span = (ms) => {
  const m = Math.max(0, Math.round(ms / MIN));
  return m >= 60 ? `${Math.floor(m / 60)}H ${String(m % 60).padStart(2, '0')}M` : `${m}M`;
};
function drawLight() {
  if (!sun?.length) return;
  if (!lightBound) { lightBound = true; every(MIN, drawLight, { align: true }); }
  const now = Date.now(), H = 3_600_000;
  const day = sun.find((d) => now < d.set) || sun[sun.length - 1];
  let name, until, state = 'ok', meta;
  if (now < day.rise) {
    [name, until] = ['SUNRISE IN', day.rise];
    meta = `sunrise ${hm(day.rise)} · morning gold till ${hm(day.rise + H)}`;
  } else if (now < day.rise + H) {
    [name, until, state] = ['GOLDEN HOUR', day.rise + H, 'warn'];
    // the count is the gold left, so the line says when it ends (owner, 2026-10-30: "is 6M 6 minutes?")
    meta = `gold till ${hm(day.rise + H)}`;   // one line in a phone's half-width tile; sunset is hours off
  } else if (now < day.set - H) {
    [name, until] = ['DAYLIGHT LEFT', day.set];
    meta = `golden hour ${hm(day.set - H)} · sunset ${hm(day.set)}`;
  } else if (now < day.set) {
    [name, until, state] = ['GOLDEN HOUR', day.set, 'warn'];
    meta = `gold till sunset, ${hm(day.set)}`;
  } else {
    const next = sun.find((d) => now < d.rise);
    [name, until] = ['SUNRISE IN', next ? next.rise : day.rise + 24 * H];
    meta = `sunset was ${hm(day.set)} · sunrise ${hm(until)}`;
  }
  label('n-light-l', name);
  dm('n-light').state(state).set(span(until - now));
  $('n-light-m').textContent = meta.toLowerCase();
}

function drawAir(air) {
  label('n-air-l', 'AIR');
  if (!air) return;
  dm('n-air', { animate: 'count' }).state(STATE[air.level]).set(`AQI ${air.aqi}`);
  $('n-air-m').textContent = air.word.toLowerCase();
}

// ── MOVING ──────────────────────────────────────────────────────────────────
// BART reads on four steps of light, so the eye lands in order: the trains
// running (the number hot, its unit a step down), the stations as a calm menu
// (cool, no bloom, each with pips in its lines' colours), the one you picked
// (hot, struck when you pick it), and trouble (red, whatever else is lit).
const lineColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
function drawBart(b, tt) {
  show('p-bart', !!b);
  if (!b) return;
  heat('p-bart', b.level);
  bart = b;
  timetable = tt || null;
  const stations = b.stations || [];
  if (!stations.some((st) => st.code === picked)) picked = stations.find((st) => st.code === b.home)?.code || stations[0]?.code;
  headSays = '';   // a new reading redraws it, and lifts a stale dim
  drawBartHead();
  // a meet's times move every reading; only its call rebuilds the tabs. Every
  // transfer station's tab carries ⇄ in the colour of its call, so the
  // transfers read from any station picked: green is worth seeing too (owner,
  // 2026-10-30, after it hid while calm)
  if (changed('bart-stations', stations.map(({ departures, transfers, ...st }) => ({ ...st, lines: (departures || []).map((d) => d.color) })))) {
    stationDms.clear();
    $('bart-stations').innerHTML = stations.map((st, i) => {
      const pips = [...new Set((st.departures || []).map((d) => lineColor(d.color)).filter(Boolean))].slice(0, 4);
      const x = MEET[st.transfer]?.[0];
      return `<button type="button" class="c-tab" data-code="${esc(st.code)}" aria-pressed="false">`
        + `<span class="c-tab-name"><span class="c-pips" aria-hidden="true">${pips.map((c) => `<i style="--c:${c}"></i>`).join('')}`
        + `${x ? `<span class="dm--label c-tab-x" id="stx-${i}"></span>` : ''}</span>`
        + `<span class="c-tab-dm"><span class="dm--small bart" id="st-${i}"></span></span></span>`
        + `${st.issue ? `<span class="c-meta c-issue">${esc(st.issue)}</span>` : ''}</button>`;
    }).join('');
    stations.forEach((st, i) => {
      stationDms.set(st.code, display($(`st-${i}`), { state: 'ok', fit: { min: 1.9, max: SMALL_FIT.max },
        label: st.issue ? `${st.name}: ${st.issue}` : st.name }).set(st.name));
      if ($(`stx-${i}`)) display($(`stx-${i}`), { state: MEET[st.transfer][0], animate: 'none' }).set('⇄', { label: MEET[st.transfer][1].toLowerCase() });
    });
  }
  lightStations();
  drawDepartures();
  advisories = b.advisories || [];
  drawAdvisories();
}

// The big line is the trains running; while BART is shut, the word CLOSED,
// cold, because nothing is wrong. Shut means for the picked station: before
// its first train, or resting after its last (src/shared/city.js settleBart),
// not only once nothing is listed anywhere. One train stuck at "Leaving" in
// Milpitas kept that from coming all night, and the line counted BART's last
// trains down to 0 two hours after MacArthur's had gone (owner, 2026-10-31).
// In the hour before the picked station's
// first train it counts down to it instead, minutes and seconds, and steps up
// a level of light for the last ten: minutes to the first train is easy
// arithmetic while getting ready (owner, 2026-10-29). The time itself sits in
// the label above, from the timetable the snapshot keeps (workers/city/).
const OPENING = 60 * MIN, OPENING_HOT = 10 * MIN;
let headSays = '', headWas = '';
function drawBartHead() {
  if (!bart) return;
  const agency = bart.label || 'BART', unit = bart.unit || 'TRAINS';
  const t = beforeFirst();
  const left = t ? t.opens - (Date.now() + skew) : Infinity;
  const first = t ? formatClock(new Date(t.opens), 'hh:mm', tz) : '';
  const s = Math.ceil(left / 1000);
  const rests = (bart.stations || []).find((x) => x.code === picked)?.rests;
  const head = left <= OPENING ? ['count', `FIRST TRAIN ${first}`, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, left <= OPENING_HOT ? 'hot' : 'ok']
    : bart.closed || t || rests ? ['closed', t ? `FIRST TRAIN ${first}` : agency]
    : ['trains', agency, bart.trains];
  const says = JSON.stringify(head);
  if (says === headSays) return;
  const was = headWas;
  headSays = says;
  headWas = head[0];
  label('bart-l', head[1]);
  bigBart.n ??= display($('bart-n'), { animate: 'count', state: 'off' });
  bigBart.u ??= display($('bart-u'), { animate: 'none', state: 'off' });
  // an empty display still draws its dark cells: the one not in use steps aside
  $('bart-n').hidden = head[0] === 'closed';
  $('bart-u').hidden = head[0] === 'count';
  if (head[0] === 'count') {
    // a minute's label, not a second's: a screen reader is not read a clock
    bigBart.n.state(head[3]).set(head[2], { animate: 'none', label: `first train ${first}, in ${Math.ceil(left / MIN)} minutes` });
  } else if (head[0] === 'closed') {
    // every night once the last trains are in: nothing wrong, so nothing lit but the word
    bigBart.u.state('idle').set('CLOSED', { label: t ? `${agency} is closed; first train ${first}` : `${agency} is closed` });
  } else {
    const n = bart.trains;
    bigBart.n.state(n ? 'hot' : 'warn').set(n != null ? String(n) : '0', { animate: was === 'trains' ? 'count' : 'none', label: `${n ?? 0} ${agency} ${unit.toLowerCase()} running` });
    bigBart.u.state(n ? 'ok' : 'warn').set(unit, { label: '' });
  }
}

// The picked station's timetable while its first train is still to come
// (src/shared/city.js parseTimetable): its first trains and when it opens.
let timetable = null;
function beforeFirst(now = Date.now() + skew) {
  const t = timetable?.stations?.[picked];
  return t && now < t.opens ? t : null;
}
const afterLast = (now = Date.now() + skew) => {
  const t = timetable?.stations?.[picked];
  return !!t && now > t.last;
};

// BART's advisories, each with when BART posted it. A delay is BART saying why
// the system is slow and since when ("equipment problem on a train at
// Embarcadero", "police activity", "a medical emergency"): whether it is about
// to grind, so it shows without a tap, in full, its time first (owner,
// 2026-10-30). The rest are mostly standing notices (planned work, a nightly
// slowdown): read once, then known, so they rest as one quiet line and open on
// a tap (owner, 2026-10-29: "not an immediate right now message").
let advisories = [], advOpen = false;
const advItem = (a) => `<span class="c-adv-item">${a.posted ? `<span class="c-adv-time">${esc(hm(a.posted).toLowerCase())}</span>` : ''}${esc(a.text)}</span>`;
function drawAdvisories() {
  if (!changed('bart-adv', [advisories, advOpen])) return;
  const agency = bart?.label || 'BART';
  if (!advisories.length) { $('bart-m').textContent = `no advisories from ${agency}`; return; }
  const delays = advisories.filter((a) => a.delay), notices = advisories.filter((a) => !a.delay);
  const n = notices.length;
  $('bart-m').innerHTML = delays.map(advItem).join('')
    + (n ? `<button type="button" aria-expanded="${advOpen}"><span class="dm--small" id="bart-adv-g"></span>`
      + `${n}${delays.length ? ' more' : ''} ${n === 1 ? 'advisory' : 'advisories'} from ${esc(agency)}</button>`
      + (advOpen ? notices.map(advItem).join('') : '') : '');
  if (n) display($('bart-adv-g'), { state: 'ok', animate: 'none' }).set(advOpen ? '-' : '+', { label: '' });
}
$('bart-m').addEventListener('click', (e) => {
  if (!e.target.closest('button')) return;
  advOpen = !advOpen;
  drawAdvisories();
});

// The departures under the stations are for the one you pick; the page
// remembers it on this device (a convenience: forgetting it costs a tap).
let bart = null, picked = null;
const bigBart = {}, stationDms = new Map();
try { picked = localStorage.getItem('city-station'); } catch {}
$('bart-stations').addEventListener('click', (e) => {
  const tab = e.target.closest('.c-tab');
  if (!tab || tab.dataset.code === picked) return;
  picked = tab.dataset.code;
  try { localStorage.setItem('city-station', picked); } catch {}
  more = xfer = false;
  lightStations();
  stationDms.get(picked)?.strike();
  drawBartHead();
  drawDepartures({ animate: 'light' });
});
// The plus under the rows opens the shelf, and the minus closes it; only the
// rows it brings light up.
$('bart-rows').addEventListener('click', (e) => {
  if (!e.target.closest('.c-more')) return;
  more = !more;
  xfer = false;   // one drawer: the plus and the transfers share it
  drawDepartures({ animate: more ? 'light' : 'none', from: ROWS });
});
let xferWas = null, xferKnown = false;   // the key's last call; whether this device has opened the shelf
try { xferKnown = localStorage.getItem('city-xfer') === '1'; } catch {}
$('bart-xfer-btn').addEventListener('click', () => {
  xfer = !xfer;
  if (xfer && !xferKnown) { xferKnown = true; try { localStorage.setItem('city-xfer', '1'); } catch {} }
  more = false;
  drawDepartures({ animate: xfer ? 'light' : 'none', from: Infinity, meets: xfer });
});

/** Trouble burns red whatever else is true; the picked station runs hot; the rest rest. */
function lightStations() {
  for (const st of bart?.stations || []) {
    stationDms.get(st.code)?.state(st.issue ? 'alert' : st.code === picked ? 'hot' : 'ok');
  }
  for (const tab of $('bart-stations').querySelectorAll('.c-tab')) tab.setAttribute('aria-pressed', String(tab.dataset.code === picked));
}

// The next trains count down here between readings, so a number never sits
// while the train it names pulls in. Each carries `at`, when it reaches the
// platform (src/shared/city.js, parseBart), and shows the minutes to it
// rounded up, the way BART's platform signs count. At zero it reads NOW and
// holds for HOLD, about as long as a train stands at the platform; then it is
// taken off and the next one moves up. It leans on the expected time: BART
// keeps a train listed for a minute after it rolls, so a newer reading that
// still has one at the platform doesn't put it back, unless it has stood
// there long enough to be held (`held`, carried by the snapshot): then it
// reads NOW until it goes (owner, 2026-10-29; in amber until 2026-10-30, when
// every NOW became the board's blue: a train at the platform has arrived).
const HOLD = 45_000;
let skew = 0;   // how far this device's clock runs behind the snapshot's, when it does
const minsLeft = (at, now) => {
  const left = at - now;
  return left > 0 ? Math.ceil(left / MIN) : left > -HOLD ? 0 : null;
};
const departuresNow = (deps, now = Date.now() + skew) => deps
  .map((d) => {
    if (!d.at) return { ...d, left: d.mins, ats: [], lates: d.lates || [] };
    // each number keeps its train's time beside it, so a transfer can find it
    // (`ats`), how late that train runs (`lates`), and whether it is stuck at
    // "1" short of the platform (`stuck`, src/shared/city.js BART_STUCK): that
    // one reads 1 and never counts on to NOW, because it isn't coming now
    const kept = d.at.map((a, k) => [d.stuck?.[k] ? 1 : k === 0 && d.held ? 0 : minsLeft(a, now), a, d.lates?.[k] || 0, !!d.stuck?.[k]])
      .filter(([m]) => m != null);
    return { ...d, left: kept.map(([m]) => m), ats: kept.map(([, a]) => a), lates: kept.map(([, , s]) => s), stuck: kept.map(([, , , x]) => x) };
  })
  .filter((d) => d.left.length)
  .sort((a, b) => a.left[0] - b.left[0]);

// A train this late lights its own countdown red: the same line BART draws,
// and the one that turns the station's name red ("up to 10 min late"), so the
// name says there is trouble and the numbers say which trains (owner,
// 2026-10-30). Only once it is due within LATE_WITHIN minutes, as for the
// station: a late train an hour out lights as it comes into range.
// src/shared/city.js, BART_LATE_SECONDS and BART_LATE_WITHIN.
const LATE = 300;
const LATE_WITHIN = 30;
// A train at the platform (NOW) is no longer late to anyone here: it has arrived.
const isLate = (d, k) => (d.lates?.[k] || 0) >= LATE && d.left?.[k] > 0 && d.left[k] <= LATE_WITHIN;

// Where three lines meet a station lists six destinations, and four make eight. The board
// shows ROWS of them, soonest first; the rest wait behind a plus, unlabelled,
// with one square per train it holds in that train's line colour. Holding back
// a single train would cost the row it saves, so that one is simply shown.
const ROWS = 5;
let more = false;   // the shelf is open; a new station closes it
let xfer = false;   // the transfers shelf is open; so does a new station, and so does the plus
let shown = '';   // what the rows say now, so the count redraws only when a number changes
// Before the picked station's first train its rows are the timetable's: each
// destination's first train as a clock time, so someone up at 4 am knows the
// exact time. A row turns into the usual countdown FIRST_LIVE before its
// train, once the live feed lists that train; until then the time stands
// (the timetable is a promise, the departures are the fact).
const FIRST_LIVE = 15 * MIN;
function firstRows(t, live, now = Date.now() + skew) {
  return t.first.map(([dest, color, at]) => {
    const d = at - now <= FIRST_LIVE && live.find((x) => x.dest === dest && (!color || !x.color || x.color === color));
    return d || { dest, color, clock: formatClock(new Date(at), 'hh:mm', tz) };
  });
}

function drawDepartures({ animate = 'none', from = 0, meets: lightMeets = false } = {}) {
  if (!bart) return;
  drawBartHead();
  const st = (bart.stations || []).find((x) => x.code === picked);
  const t = beforeFirst();
  const live = departuresNow(st?.departures || bart.departures || []);
  const all = t ? firstRows(t, live) : live;
  const fold = all.length > ROWS + 1;
  const deps = fold && !more ? all.slice(0, ROWS) : all;
  const held = fold && !more ? all.slice(ROWS) : [];
  const meets = meetsNow(st?.transfers || []);
  // With the transfers shelf open, a meet gone wrong (missed, or the train you
  // step onto running late) lights that train in the rows too, in the call's
  // colour: how long you'll wait is then the number that matters, for a
  // rideshare, a call to work, or just waiting (owner, 2026-10-30). Only with
  // the shelf open: on the board alone, a red train would alarm a rider who
  // isn't changing trains.
  const waits = xfer ? meets.filter((m) => (m.status === 'missed' || m.status === 'late') && m.leave && m.dest) : [];
  const waitFor = (d, k) => waits.find((m) => m.dest === d.dest && m.leave === d.ats?.[k]);
  const lates = (d) => (d.left || []).slice(0, 3).map((_, k) => isLate(d, k));
  // a late train behind the plus lights the plus: the station's red has to be findable
  const heldLate = held.some((d) => lates(d).includes(true));
  const says = JSON.stringify([picked, fold && more, deps.map((d) => [d.dest, d.color, d.left, d.clock, d.held, lates(d), d.stuck]), held.map((d) => d.color),
    heldLate, xfer, meets.map((m) => [m.status, m.in, m.out]), waits.map((m) => [m.dest, m.leave])]);
  if (says === shown && animate === 'none') return;
  shown = says;
  // one line on a phone, West Oakland and the transfer mark included
  $('bart-from').textContent = !st ? '' : t ? `first trains from ${st.name.toLowerCase()}` : `leaving ${st.name.toLowerCase()}, in minutes`;
  drawMeets(meets, lightMeets ? animate : 'none');
  // the next train is the number that matters: it runs hot, the ones after it cool
  $('bart-rows').innerHTML = deps.map((d, r) =>
    `<li><span><i class="c-line" style="--line-color:${lineColor(d.color) || 'var(--faint)'}"></i>${esc(d.dest.toLowerCase())}</span>`
    + `<span class="c-mins">${d.clock ? `<span class="dm--small bart" data-t="${d.clock}" data-r="${r}"></span>`
      : d.left.slice(0, 3).map((m, k) => `<span class="dm--small bart" data-m="${m === 0 ? 'NOW' : m}" data-k="${k}" data-r="${r}"${k === 0 && d.held ? ' data-h' : ''}${d.stuck?.[k] ? ' data-s' : ''}`
        + `${isLate(d, k) ? ` data-l="${Math.round(d.lates[k] / 60)}"` : ''}`
        + `${waitFor(d, k) ? ` data-w="${MEET[waitFor(d, k).status][0]}"` : ''}></span>`).join('')}</span></li>`).join('')
    || `<li><span class="c-meta">${bart.closed ? 'no trains until morning' : afterLast() ? 'no more trains tonight' : 'no departures listed'}</span></li>`;
  if (fold) {
    $('bart-rows').insertAdjacentHTML('beforeend', `<li class="c-more"><button type="button" aria-expanded="${more}"`
      + ` aria-label="${more ? 'Fewer trains' : `${held.length} more trains${heldLate ? ', one or more running late' : ''}`}"><span class="dm--small bart"></span>`
      + `${held.map((d) => `<i style="--c:${lineColor(d.color) || 'var(--faint)'}"></i>`).join('')}</button></li>`);
    display($('bart-rows').querySelector('.c-more .dm--small'), { state: heldLate ? 'alert' : 'ok', animate: 'none' }).set(more ? '-' : '+', { label: '' });
  }
  for (const el of $('bart-rows').querySelectorAll('[data-m]')) {
    const r = Number(el.dataset.r);
    const lit = r >= from ? animate : 'none';
    // NOW is always the board's own blue: the train is here, and late, held
    // or a transfer's wait no longer changes what to do (owner, 2026-10-30).
    // Otherwise a train running late: red, whatever else it is; the train a
    // broken transfer waits for, in the call's colour; stuck at "1" short of
    // the platform: amber
    const now = el.dataset.m === 'NOW';
    const state = now ? 'hot' : el.dataset.l != null ? 'alert' : el.dataset.w
      || (el.dataset.s != null ? 'warn' : el.dataset.k === '0' ? 'hot' : 'ok');
    const notes = [el.dataset.l != null && `running ${el.dataset.l} min late`, !now && el.dataset.w && 'the transfer you will catch',
      el.dataset.h != null && 'held at the platform', el.dataset.s != null && 'held short of the platform'].filter(Boolean);
    const label = notes.length ? `${el.dataset.m === 'NOW' ? 'now' : el.dataset.m}, ${notes.join(', ')}` : null;
    display(el, { state, cols: 3, align: 'right', animate: lit })
      .set(el.dataset.m, { delay: lit === 'light' ? (r - from) * 70 : 0, ...(label && { label }) });
  }
  // a time is a promise, not a count: it rests cool
  for (const el of $('bart-rows').querySelectorAll('[data-t]')) {
    const r = Number(el.dataset.r);
    display(el, { state: 'ok', cols: 5, align: 'right', animate: r >= from ? animate : 'none' })
      .set(el.dataset.t, { delay: animate === 'light' ? (r - from) * 70 : 0, label: `first train ${el.dataset.t}` });
  }
}

// Transfers: the meets BART plans at this station (src/shared/city.js,
// BART_MEETS). What the parser called stands; the page only ages the numbers.
// Nothing but the lamps: the headline says the word, and each meet is one
// number, when the train you step onto leaves, in the colour of the call. The
// train you arrive on is already in the rows above, so it isn't repeated here;
// a sentence under each, or a second number, was more than a glance has
// (owner, 2026-10-29). Each word is what the train you step onto is doing:
// AT STATION and ARRIVING, not "held", which needed explaining to someone
// already at the transfer station; and both are green, because a transfer
// standing there for you is good news, as a train a little early is (owner,
// 2026-10-30). Amber is kept for the band that really may go either way.
const MEET = {
  go: ['go', 'TRANSFERS ON TIME', 'on time'], tight: ['warn', 'TRANSFER TIGHT', 'tight'],
  here: ['go', 'TRANSFER AT STATION', 'at the station'], arriving: ['go', 'TRANSFER ARRIVING', 'arriving as you do'],
  late: ['warn', 'TRANSFER LATE', 'late'], missed: ['alert', 'TRANSFER MISSED', 'missed'], open: ['ok', 'TRANSFERS', ''],
};
const MEET_ORDER = ['missed', 'late', 'tight', 'here', 'arriving', 'go', 'open'];
const meetsNow = (meets, now = Date.now() + skew) => meets.map((m) => {
  // a train the reading has at the platform is there until a newer reading says
  // otherwise: it isn't aged out between readings, or the shelf read "--" and
  // dropped a meet mid-transfer (7:44 am, 2026-10-30)
  const into = m.arrived ? 0 : minsLeft(m.arrive, now);
  if (into == null) return null;   // your train has gone through: the next reading has the next meet
  // the train's own time, never one that counts on a hold: the safest number (owner, 2026-10-30)
  return { ...m, in: into, out: m.waiting ? 0 : m.leave ? minsLeft(m.leave, now) : null };
}).filter(Boolean);

// The transfer key is one display: a frame of dots (its corners left dark, so
// it reads rounded), the mark, and the plus, a minus when open, all on one
// grid of KEY_W × KEY_H dots with the unlit ones showing, like every lamp here.
const KEY_W = 16, KEY_H = 11;
const keyDot = (x, y) => `M${x + 0.1} ${y + 0.1}h.8v.8h-.8z`;   // the engine's square dot
const keyGlyph = (ch, x0, y0) => {
  const g = GLYPHS[ch] || '';
  let d = '';
  for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r * 5 + k] === '1') d += keyDot(x0 + k, y0 + r);
  return d;
};
let keyGrid = '', keyFrame = '';
for (let y = 0; y < KEY_H; y++) for (let x = 0; x < KEY_W; x++) {
  keyGrid += keyDot(x, y);
  const edgeX = x === 0 || x === KEY_W - 1, edgeY = y === 0 || y === KEY_H - 1;
  if ((edgeX || edgeY) && !(edgeX && edgeY)) keyFrame += keyDot(x, y);
}
let keySays = '';
function drawKey(state, open) {
  const host = $('bart-xfer-g');
  host.dataset.state = state;
  if (keySays === String(open)) return;
  keySays = String(open);
  host.innerHTML = `<svg class="dm-svg" viewBox="0 0 ${KEY_W} ${KEY_H}" aria-hidden="true">`
    + `<path class="dm-off" d="${keyGrid}"/><path class="c-key-frame" d="${keyFrame}"/>`
    + `<path class="c-key-mark" d="${keyGlyph('⇄', 2, 2)}"/><path class="c-key-plus" d="${keyGlyph(open ? '-' : '+', 9, 2)}"/></svg>`;
}
function strikeKey() {
  const host = $('bart-xfer-g');
  host.classList.remove('dm-strike');
  void host.offsetWidth;   // restart the flare if it is still running
  host.classList.add('dm-strike');
}

function drawMeets(meets, animate) {
  const btn = $('bart-xfer-btn');
  btn.hidden = !meets.length;
  $('bart-xfer').hidden = !(xfer && meets.length);
  if (!meets.length) return;
  const worst = MEET_ORDER.find((s) => meets.some((m) => m.status === s));
  const [state, head] = MEET[worst];
  btn.setAttribute('aria-expanded', String(xfer));
  btn.setAttribute('aria-label', `Transfers here: ${head.toLowerCase()}`);
  drawKey(state, xfer);
  // One flare, never a loop: when the call changes, and once a visit until this
  // device has opened the shelf, so the key says it can be pressed.
  if (state !== xferWas && (xferWas || !xferKnown)) strikeKey();
  xferWas = state;
  if (!xfer) return;
  dm('bart-xfer-h', { fit: { min: 1.6, max: SMALL_FIT.max } }).state(state).set(head, { animate, label: head.toLowerCase() });
  $('bart-xfer-rows').innerHTML = meets.map((m, r) => {
    const [ms, , word] = MEET[m.status];
    const out = m.out == null ? 'later' : m.out === 0 ? 'now' : `in ${m.out} min`;
    return `<li aria-label="${esc(`${m.name.replace('›', 'to')}: the connecting train leaves ${out}${word ? `, ${word}` : ''}`)}">`
      + `<span>${m.colors.map((c) => `<i class="c-line" style="--line-color:${lineColor(c) || 'var(--faint)'}"></i>`).join('')}${esc(m.name)}</span>`
      + `<span class="c-meet" aria-hidden="true"><span class="dm--small" data-x="${m.out == null ? '--' : m.out === 0 ? 'NOW' : m.out}" data-s="${ms}" data-r="${r}"></span></span></li>`;
  }).join('');
  for (const el of $('bart-xfer-rows').querySelectorAll('[data-x]')) {
    display(el, { state: el.dataset.s, cols: 3, align: 'right', animate })
      .set(el.dataset.x, { delay: animate === 'light' ? Number(el.dataset.r) * 70 : 0 });
  }
}

function drawAirport(a) {
  show('p-airport', !!a);
  if (!a) return;
  heat('p-airport', a.level);
  label('airport-l', `${a.code} AIRPORT`);
  dm('airport-v').state(STATE[a.level]).set(a.status);
  $('airport-m').textContent = a.level
    ? [a.reason, a.delay && `delays ${a.delay}`].filter(Boolean).join(' · ').toLowerCase()
    : 'no delays or ground stops reported to the FAA';
}

// The bridge readout (src/shared/city.js bridgeStatus, in the payload as
// `bridge`): the minutes the freeway signs post by day; when none is posting,
// the bridge itself (a crash, lanes closed, or none reported), up to two lines
// across the panel, and from 10 pm to 5:30 am AFTER HOURS with the moon out. Its
// display is made again only when its shape changes (one line or two, a
// phone's centring), so a minute's read doesn't relight it.
let bridgeDm = null, bridgeShape = '', moonDm = null;
const phone = matchMedia('(max-width: 600px)');
// The readout never runs under BRIDGE_PITCH: where the moon beside it would
// squeeze it (a narrow panel: an iPad on its side), the moon goes above, and
// a line that still doesn't fit breaks in two. Measured, not guessed: on a
// 1024px screen the moon at its side pushed NO CLOSURES 13px out of the panel.
const BRIDGE_PITCH = 3.6, MOON_W = 5 * 5 + 14;   // the moon: one cell of 5px dots, and its gap
const MOON = '\uE027';   // js/dotmatrix.js: the crescent
// Off for now (owner, 2026-11-01: "it's trying to fit in too much right now, we'll come back to it"):
// the glyph, its styles and where it would sit all stay, so turning it back on is this line.
const SHOW_MOON = false;
const pitchFor = (room, text) => room / (Math.max(...text.split('\n').map((l) => [...widen(l)].length)) * 6 - 1);
function drawBridge(b) {
  show('bridge', !!b);
  if (!b) return;
  const name = b.label || 'BAY BRIDGE', to = b.toLabel || 'TO SF';
  label('bridge-l', b.mode === 'time' ? `${name} · ${to}` : b.after ? `${name} · AFTER HOURS` : name);
  const row = $('bridge-v').closest('.c-bridge-row') || $('bridge-v').parentElement;
  const full = roomIn(row);
  // Where the moon goes is the panel's width's call, not the message's, so it doesn't hop between
  // states: beside the text, only where even the longest message ("4 OF 5 LANES") keeps
  // BRIDGE_PITCH; above it on a phone, where everything stacks. A wider screen with a narrow panel
  // (an iPad on its side) has no room either way and goes without (owner, 2026-10-31: "just too
  // many lines and is forced"); AFTER HOURS stays in the label.
  const beside = pitchFor(full - MOON_W, '4 OF 5 LANES') >= BRIDGE_PITCH;
  const moon = SHOW_MOON && b.mode === 'status' && b.after && (phone.matches || beside);
  const stacked = phone.matches;
  row.classList.toggle('is-stacked', !!stacked);
  const room = moon && !stacked ? full - MOON_W : full;
  const text = b.text.includes('\n') || pitchFor(room, b.text) >= BRIDGE_PITCH ? b.text : breakIfLong(b.text, room, BRIDGE_PITCH);
  const lines = text.split('\n').length, align = phone.matches ? 'center' : 'left';
  const shape = `${lines}|${align}`;
  if (shape !== bridgeShape) {
    bridgeDm?.destroy();
    // two lines a step smaller than one, as a sign sets a longer message
    bridgeDm = display($('bridge-v'), { state: 'off', lines, align, fit: { min: 2.4, max: lines > 1 ? 6 : 8.5 } });
    bridgeShape = shape;
  }
  const quiet = text === '--';
  bridgeDm.state(quiet ? 'idle' : STATE[b.level] || 'ok')
    .set(text, { animate: b.mode === 'time' ? 'count' : 'light', label: `${name.toLowerCase()}: ${b.text.replace('\n', ' ').toLowerCase()}` });
  $('bridge-moon').hidden = !moon;
  if (moon) moonDm ??= display($('bridge-moon'), { state: 'ok', animate: 'none' }).set(MOON, { label: '' });
  $('bridge-m').textContent = b.sub;
}
// a width change can move the moon or break the line: drawn again, without lighting up
if (typeof ResizeObserver === 'function') {
  let bridgeW = 0;
  new ResizeObserver(([e]) => {
    const wd = Math.round(e.contentRect.width);
    if (lastBridge && wd !== bridgeW) { bridgeW = wd; drawBridge(lastBridge); }
  }).observe(document.querySelector('.c-bridge-row') || $('bridge-v'));
}
let lastBridge = null;
phone.addEventListener?.('change', () => { if (lastBridge) drawBridge(lastBridge); });

function drawSigns(signs, routes) {
  show('p-signs', !!signs);
  if (!signs) return;
  const agency = signs.agency || 'Caltrans';
  signs = signs.list || signs;
  heat('p-signs', signs.some((s) => s.level) ? 1 : 0);
  label('signs-l', `SIGNS${routes ? ` · ${routes.join(' ').replace(/I-/g, '')}` : ''}`);
  $('signs').innerHTML = signs.slice(0, 4).map((s) =>
    `<div class="c-sign"><span class="dm" data-shape="round" data-text="${esc(s.lines.join('\n'))}"></span><span class="c-cap">${esc(`${s.route} ${s.dir} · ${s.near}`)}</span></div>`).join('');
  for (const el of $('signs').querySelectorAll('[data-text]')) {
    display(el, { state: 'warn', cols: 16, lines: 3, align: 'center', fit: { min: 1.8, max: 3.6 } }).set(el.dataset.text);
  }
  $('signs-m').textContent = signs.length ? `what the ${agency} message signs say right now` : 'every message sign here is blank: nothing posted';
}

// ── WATCHING ────────────────────────────────────────────────────────────────
function drawAlerts(alerts) {
  show('p-alerts', !!(alerts && alerts.length));
  if (!alerts?.length) return;
  heat('p-alerts', Math.max(...alerts.map((a) => a.level)));
  label('alerts-l', 'WEATHER ALERTS · NWS');
  $('alerts').innerHTML = alerts.map((a) =>
    `<li class="c-one"><span class="dm--small" data-event="${esc(a.event)}" data-level="${a.level}"></span><span class="c-meta">${esc(a.what)}${a.until ? ` · until ${esc(dayHm(Date.parse(a.until)).toLowerCase())}` : ''}</span></li>`).join('');
  const room = roomIn($('alerts'));
  for (const el of $('alerts').querySelectorAll('[data-event]')) {
    const text = breakIfLong(el.dataset.event, room, SMALL_FIT.min);
    display(el, { state: STATE[el.dataset.level], fit: SMALL_FIT, lines: text.split('\n').length }).set(text);
  }
}

const NS = 'http://www.w3.org/2000/svg';
function tideChart(t) {
  const box = $('tide-chart');
  const pts = [...t.series.obs, ...t.series.pred];
  if (!pts.length) { box.replaceChildren(); return; }
  const now = Date.now(), x0 = now - 12 * 3_600_000, x1 = now + 12 * 3_600_000;
  const vals = pts.map((p) => p[1]).concat(t.minor ?? []);
  const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
  const W = 300, H = 96;
  const X = (ms) => ((ms - x0) / (x1 - x0)) * W, Y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Tide over the last and next 12 hours${t.minor != null ? `, with minor flooding at ${t.minor} feet` : ''}`);
  const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); return el; };
  const line = (rows) => rows.map(([ms, v], i) => `${i ? 'L' : 'M'}${X(ms).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  // No text inside: the chart stretches to its width, which would stretch type with it. The legend is below.
  if (t.minor != null) add('line', { class: 'flood', x1: 0, x2: W, y1: Y(t.minor), y2: Y(t.minor), 'vector-effect': 'non-scaling-stroke' });
  add('path', { class: 'pred', d: line(t.series.pred), 'vector-effect': 'non-scaling-stroke' });
  add('path', { class: 'obs', d: line(t.series.obs), 'vector-effect': 'non-scaling-stroke' });
  add('line', { class: 'now', x1: X(now), x2: X(now), y1: 0, y2: H, 'vector-effect': 'non-scaling-stroke' });
  const legend = document.createElement('p');
  legend.className = 'c-legend';
  legend.innerHTML = `<span class="k obs"></span>measured <span class="k pred"></span>predicted${t.minor != null ? ` <span class="k flood"></span>minor flooding, ${t.minor} ft` : ''} <span class="k now"></span>now`;
  box.replaceChildren(svg, legend);
}

function drawTide(t) {
  show('p-tide', !!t);
  if (!t) return;
  heat('p-tide', t.level);
  label('tide-l', t.next?.t ? `NEXT HIGH · ${dayHm(t.next.t)}` : 'TIDE');
  dm('tide-v', { animate: 'count' }).state(STATE[t.level]).set(t.expect != null ? `${t.expect} FT` : `${t.now} FT`);
  tideChart(t);
  $('tide-m').textContent = [
    t.expect != null && `${t.next.v} ft predicted, about ${t.expect} with the water running ${t.surge >= 0 ? '+' : ''}${t.surge} ft over prediction`,
    t.peak?.v != null && `last 24 h peak ${t.peak.v} ft at ${dayHm(t.peak.t).toLowerCase()}`,
    t.minor != null && `NOAA's minor flooding starts at ${t.minor} ft`,
  ].filter(Boolean).join(' · ');
}

function drawRain(gauges) {
  show('p-rain', !!gauges);
  if (!gauges) return;
  heat('p-rain', Math.max(0, ...gauges.map((g) => g.level || 0)));
  const allStage = gauges.every((g) => g.kind === 'stage');
  label('rain-l', allStage ? 'CREEKS · STAGE' : 'RAIN · LAST 24 H');
  $('rain').innerHTML = gauges.map((g, i) =>
    `<li><span>${esc(g.label.toLowerCase())}</span><span class="dm--value" id="rain-${i}"></span></li>`).join('');
  gauges.forEach((g, i) => {
    const el = $(`rain-${i}`);
    el.style.setProperty('--dm-pitch', '5px');
    const d = display(el, { state: g.missing ? 'stale' : STATE[g.level || 0], animate: 'count' });
    if (g.kind === 'stage') d.set(g.missing || g.ft == null ? '--' : `${g.ft} FT`);
    else d.set(g.missing || g.day == null ? '--' : `${g.day.toFixed(2)}"`);
  });
  const by = [...new Set(gauges.map((g) => g.by || 'CDEC'))].join(' / ');
  const kindWord = allStage ? 'water gauges' : 'rain gauges';
  const hour = gauges.filter((g) => g.kind === 'rain' && g.hour != null).map((g) => `${g.label.toLowerCase()} ${g.hour.toFixed(2)}" last hour`);
  $('rain-m').textContent = hour.length ? `${hour.join(' · ')} · ${by} ${kindWord}` : `${by} ${kindWord}`;
}

// El Niño changes once a month, so it is a line of type, not a lamp.
function drawElNino(e) {
  const el = $('c-enso');
  el.hidden = !e;
  if (!e) return;
  el.textContent = [e.status.toLowerCase().replace(/^el niño/, 'El Niño').replace(/^la niña/, 'La Niña'),
    e.nino34 != null && `Niño-3.4 at ${e.nino34 > 0 ? '+' : ''}${e.nino34}°C`,
    e.next && `NOAA's next update ${e.next}`].filter(Boolean).join(' · ');
  el.title = e.synopsis;
}

function drawQuakes(q, radius) {
  show('p-quakes', !!q);
  if (!q) return;
  heat('p-quakes', Math.max(0, ...q.map((x) => x.level)));
  label('quakes-l', `QUAKES · ${radius || 100} KM`);
  $('quakes').innerHTML = q.length
    ? q.map((x, i) => `<li><span>${esc(x.place.toLowerCase())} · ${esc(ago(x.t))}</span><span class="dm--small" id="q-${i}"></span></li>`).join('')
    : '<li><span class="c-meta">nothing at M2.5 or above</span></li>';
  q.forEach((x, i) => display($(`q-${i}`), { state: STATE[x.level] }).set(`M${x.mag}`));
}

function drawWatchSummary(s, open) {
  const bits = [
    !s.alerts?.length && 'no weather alerts',
    s.tide && `next high ${s.tide.next?.v ?? s.tide.now} ft`,
    s.gauges && (s.gauges.some((g) => g.day) ? 'rain in the hills' : 'no rain'),
    s.elnino && `El Niño ${s.elnino.status.replace(/^EL NI[ÑN]O\s*/, '').toLowerCase()}`,
    s.quakes && (s.quakes.length ? `quakes to M${Math.max(...s.quakes.map((x) => x.mag))}` : 'no quakes'),
  ].filter(Boolean);
  $('watch-calm').textContent = bits.join(' · ');
  $('watch').querySelector('summary').setAttribute('aria-label', `Watching${bits.length ? `: ${bits.join(', ')}` : ''}`);
  if (open) $('watch').open = true;
  watchKey();
}
// The watching tier has no title: closed, it is the board's plus and its calm
// line; open, the minus that folds it again.
const watchKey = () => dm('watch-g', { animate: 'none' }).state('ok').set($('watch').open ? '-' : '+', { label: '' });
$('watch').addEventListener('toggle', watchKey);

// Panels built from a list redraw only when their data changed, or every
// minute's read would replay their light-up.
const lastDrawn = {};
function changed(key, data) {
  const j = JSON.stringify(data ?? null);
  if (lastDrawn[key] === j) return false;
  lastDrawn[key] = j;
  return true;
}

// Which displays each source feeds, so a stale source dims exactly its own.
const FEEDS = {
  sky: ['n-temp', 'n-light', 'n-baro', 'n-wind'], air: ['n-air'], airport: ['airport-v'],
  tide: ['tide-v'], elnino: ['elnino-v'],
};

// ── the payload ─────────────────────────────────────────────────────────────
// Where the board comes from. First the snapshot the city Worker writes to the
// CDN every 20 s (workers/city/): reading it is not a request to the site's
// Worker, so a thousand viewers cost what one does. If there is none, or it is
// more than ten minutes old (that Worker stopped), ask the site itself.
const CDN = document.querySelector('meta[name="cdn-base"]')?.content || '';
// `?api` skips the snapshot: for checking the fallback, or a change before the snapshot Worker has it.
let snapshot = /^https:/.test(CDN) && !new URLSearchParams(location.search).has('api');
let viaApi = false;   // the last read was the site's own Worker, not the snapshot
async function read() {
  viaApi = false;
  if (snapshot) {
    try {
      const res = await fetch(`${CDN}/city/now.json`, { cache: 'no-cache' });
      if (res.ok) {
        const p = await res.json();
        if (p?.ok && Date.now() - p.now < 10 * MIN) return p;
      } else if (res.status === 404) snapshot = false;
    } catch {
      snapshot = false;   // blocked or unreachable: don't ask again this visit
    }
  }
  viaApi = true;
  const res = await fetch('/api/city', { cache: 'no-store' });
  if (res.status === 404) return { none: true };
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

let warmTries = 0, lastOk = 0;
async function load() {
  let p;
  try {
    p = await read();
    if (p.none) { $('c-sub').textContent = 'This site has no city board configured.'; return; }
  } catch {
    if (Date.now() - lastOk > 5 * MIN) for (const d of dms.values()) if (d.current !== 'off') d.state('stale');
    signNote = lastOk ? `Can't reach the board right now. Last read ${ago(lastOk)}.` : "Can't reach the board right now.";
    $('c-sub').textContent = signNote;
    return;
  }
  signNote = null;
  lastOk = Date.now();
  skew = Math.max(0, p.now - lastOk);   // the snapshot can't be from the future: this clock is behind
  tz = p.tz;
  const s = p.sections;
  bindClocks(p.name);
  const top = (s.alerts || []).find((a) => a.level === p.verdict.level);
  const verdictSub = top ? top.what
    : p.verdict.level ? 'Worth a look below.' : `Nothing in ${p.name ? p.name.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'the city'} needs you right now.`;
  // the deck, or the verdict alone from a board that sends none (/api/city before it, an old snapshot)
  setHeadlines((p.headlines?.length ? p.headlines : [{ key: 'verdict', ...p.verdict }])
    .map((c) => (c.key === 'verdict' ? { ...c, sub: verdictSub } : c)));
  drawSky(s.sky);
  drawAir(s.air);
  drawBart(s.bart, p.timetable);
  drawAirport(s.airport);
  // an older payload carries no `bridge`: the signs' minutes, or the dark readout
  lastBridge = p.bridge !== undefined ? p.bridge : s.signs ? (s.signs.toSF
    ? { mode: 'time', after: false, level: 0, text: `${s.signs.toSF.mins} MIN`, sub: `as posted on the ${s.signs.toSF.route.replace('I-', '')} sign at ${s.signs.toSF.near.toLowerCase()}` }
    : { mode: 'status', after: false, level: 0, text: '--', sub: 'no time posted on the signs right now; they post it by day' }) : null;
  drawBridge(lastBridge);
  if (changed('signs', s.signs)) drawSigns(s.signs, CITY_ROUTES(s.signs?.list));
  // The alert the verdict already shouts is not repeated below it.
  const below = (s.alerts || []).filter((a) => a.event !== p.verdict.text);
  if (changed('alerts', below)) drawAlerts(below);
  drawTide(s.tide);
  if (changed('gauges', s.gauges)) drawRain(s.gauges);
  drawElNino(s.elnino);   // one line at the foot of WATCHING: it changes once a month
  if (changed('quakes', s.quakes)) drawQuakes(s.quakes);
  const watchHot = below.length || [s.tide, ...(s.gauges || []), ...(s.quakes || [])].some((x) => x?.level);
  drawWatchSummary(s, watchHot);
  for (const n of p.stale || []) for (const id of FEEDS[n] || []) dms.get(id)?.state('stale');
  if (p.stale?.includes('bart')) { bigBart.n?.state('stale'); bigBart.u?.state('stale'); }
  $('c-read').textContent = ` · last read ${hm(p.now).toLowerCase()}` + (p.stale?.length ? ` · not current: ${p.stale.join(', ')}` : '');
  $('city').setAttribute('aria-busy', String(p.warming.length > 0));
  // A cold board fills in over a few quick reads, then settles to one a minute.
  if (p.warming.length && warmTries++ < 6) setTimeout(load, 3000);
}
const CITY_ROUTES = (signs) => (signs?.length ? [...new Set(signs.map((x) => x.route))].sort() : null);

// The snapshot is a file on the CDN: reading it every 20 s costs the site
// nothing. /api/city is a request to the site's Worker, so it stays at one a minute.
every(READ_EVERY, () => { if (!viaApi || Date.now() - lastOk >= MIN - READ_EVERY / 2) load(); });
every(1000, () => drawDepartures());
