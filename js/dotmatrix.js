// OAKLENS OS — the dot-matrix engine. MIT.
//
// One part for every vacuum-fluorescent line on any surface: the console's
// clock, a scoreboard, a city's readouts, a freeway sign. It grew from
// js/console/matrix.js and a fork of it that learned to light a line a cell
// at a time; this is the two joined, so the next reader is a config, not a
// copy:
//
//   - 5×7 glyphs, with the unlit dots of every cell drawn (a number waiting
//     to light shows as a dark grid, never as holes);
//   - each cell its own lit path, so only the cells that changed are touched
//     and a line can light left to right the way a station sign refreshes;
//   - numbers that count to their value and brighten as they go;
//   - one state on the host (off · idle · ok · hot · warn · alert · stale),
//     and the colour, dot size, shape and glow are all CSS (css/dotmatrix.css);
//   - physical light: each line falls off from its top row to its bottom, and
//     each character carries a fixed small drift in brightness, so a line
//     reads as lamps rather than print (strengths in CSS); `strike()` flares
//     a display once, the way a lamp overshoots when switched on;
//   - sources: text, a clock in any time zone, anything you can poll, a JSON
//     feed shared by every display reading it, all run by ONE timer that
//     stops while the tab is hidden. A source that fails keeps the last true
//     value and goes stale; it never invents one.
//
// Dots are filled squares (circles on a host with data-shape="round"), so they
// draw the same in every engine, whatever paints them.
//
// The top half (glyphs, layout, paths, counting, the clock) is pure and runs in
// Node; tests/dotmatrix.test.js holds it. The bottom half draws.

// ── glyphs ────────────────────────────────────────────────────────────────
// Row-major, 5 wide by 7 tall, '1' is a lit dot. The letters, digits and
// `: · . - $ /` are matrix.js's and its fork's, unchanged; the rest were
// added here for readouts (55°, 82%, ↑ 0.4, +1.1) and freeway signs (2 LEFT
// LNS OPEN, I-880 & 980), ⇄, the rail interchange mark, for transfers, and
// six marks for the sky (☀ ☁ ☂ ⚡ ≈ ☾) for the town board's headlines.
export const GLYPHS = {
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110',
  4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11100100101000110001100011001011100',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100011000101010001000010000100', Z: '11111000010001000100010001000011111',
  ':': '00000011000110000000011000110000000', '·': '00000000000000001100011000000000000',
  '.': '00000000000000000000000000110001100', '-': '00000000000000011111000000000000000',
  '$': '00100011111010001110001011111000100', '/': '00001000010001000100010001000010000',
  '%': '11001110100001000100010000101110011', '°': '01100100101001001100000000000000000',
  '+': '00000001000010011111001000010000000', '=': '00000000001111100000111110000000000',
  "'": '00100001000100000000000000000000000', '"': '01010010100000000000000000000000000',
  ',': '00000000000000000000011000010001000', '!': '00100001000010000100001000000000100',
  '?': '01110100010000100010001000000000100', '>': '10000010000010000010001000100010000',
  '<': '00001000100010001000001000001000001', '(': '00010001000100001000010000010000010',
  ')': '01000001000001000010000100010001000', '&': '01100100101010001000101011001001101',
  '#': '01010010101111101010111110101001010', '↑': '00100011101010100100001000010000100',
  '↓': '00100001000010000100101010111000100', '⇄': '00010111110001000000010001111101000',
  // the sky, for the board's headlines: each mark three cells wide (WIDE, below)
  '\uE000': '00001000000000111001000010000000001', '\uE001': '00100111111111111111111111111100100', '\uE002': '10000000001000010011100000000010000',   // sun
  '\uE003': '00000001110111111111111110111100000', '\uE004': '01110011111111111111111111111100000', '\uE005': '00000100001100011110111111111000000',   // cloud
  '\uE006': '00000001110111111111000000010001000', '\uE007': '01110011111111111111000000100010001', '\uE008': '00000100001100011110000001000000000',   // rain
  '\uE009': '00000001110111111111000000000000000', '\uE00A': '01110011111111111111001100110011000', '\uE00B': '00000100001100011110000000000000000',   // thunder
  '\uE00C': '00000111010000001111000001110100000', '\uE00D': '00000111100000001111000001111000000', '\uE00E': '00000111100000010111000001111000000',   // fog
  '\uE00F': '00000000000000100001000010000000000', '\uE010': '01110110001000010000100001100001110', '\uE011': '00000000100000010000000000001000000',   // moon
  // the holidays, for the headline's holiday card (src/shared/city.js HOLIDAYS)
  '\uE012': '00000001110110001111011010111000111', '\uE013': '00110110111111111111010100000011111', '\uE014': '00000111000011011110101100111011100',   // pumpkin
  '\uE015': '00011001110011100011000010000000000', '\uE016': '10001110111111111111111110111000100', '\uE017': '11000111001110011000100000000000000',   // heart
  '\uE018': '00010000010000001111000000000100010', '\uE019': '00100001001000100100100010010000100', '\uE01A': '01000100000000011110000001000001000',   // burst
  '\uE01B': '00000000000000000001000110011100000', '\uE01C': '00100011101111111111111111111100100', '\uE01D': '00000000000000010000110001110000000',   // tree
  '\uE01E': '00000000100001100001001110000100000', '\uE01F': '00100011100111011111111111111100100', '\uE020': '00000010001100010000111001000000000',   // leaf
  '\uE021': '00000000010001000011000010000000000', '\uE022': '11111111110111001110110111111110101', '\uE023': '00000100000100011000100000000000000',   // skull
  // a win, for the board's event cards (src/shared/city.js EVENTS): a goblet in the middle
  // cell, its handles the side cells' brackets (drawn across three cells, it fell apart)
  // a crescent moon in one cell, thick on its back and tapering to the horns: the town board's after-hours ornament
  '\uE027': '00111011001100011000110000110000111',
  '\uE024': '00001000100001000001000000000000000', '\uE025': '11111111111111101110001000010001110', '\uE026': '10000010000100010000000000000000000',   // trophy
};

// The sky marks (and the holidays' and the events'), drawn three cells wide like a wide sign graphic, the gaps
// between cells and all: one 5×7 cell made the cloud a low blob that read as
// cut off (owner, 2026-10-30). Each is written as one character and laid out
// as three, so whatever measures a line must widen it first.
export const WIDE = {
  '☀': '\uE000\uE001\uE002',
  '☁': '\uE003\uE004\uE005',
  '☂': '\uE006\uE007\uE008',
  '⚡': '\uE009\uE00A\uE00B',
  '≈': '\uE00C\uE00D\uE00E',
  '☾': '\uE00F\uE010\uE011',
  '🎃': '\uE012\uE013\uE014',
  '♥': '\uE015\uE016\uE017',
  '✸': '\uE018\uE019\uE01A',
  '🎄': '\uE01B\uE01C\uE01D',
  '🍁': '\uE01E\uE01F\uE020',
  '💀': '\uE021\uE022\uE023',
  '🏆': '\uE024\uE025\uE026',
};
const WIDE_CHARS = new RegExp(`[${Object.keys(WIDE).join('')}]`, 'gu');
export const widen = (text) => String(text ?? '').replace(WIDE_CHARS, (ch) => WIDE[ch]);

// A cell is 5 dots and a gap; a line is 7 dots and two blank rows.
export const PITCH_X = 6;
export const PITCH_Y = 9;

/**
 * Text as a grid of characters: `lines` rows of `cols` cells. Lowercase reads
 * as uppercase; a character the matrix does not carry draws as a blank cell,
 * never a wrong one. With no `cols`, the widest line sets it.
 */
export function layout(text, { cols = null, lines = null, align = 'left' } = {}) {
  let rows = widen(String(text ?? '').toUpperCase()).split('\n');
  if (lines != null) rows = rows.slice(0, lines).concat(Array(Math.max(0, lines - rows.length)).fill(''));
  const width = cols ?? Math.max(1, ...rows.map(r => [...r].length));
  return rows.map(r => {
    let chars = [...r].slice(0, width);
    const pad = width - chars.length;
    if (align === 'right') chars = Array(pad).fill(' ').concat(chars);
    else if (align === 'center') chars = Array(pad >> 1).fill(' ').concat(chars, Array(pad - (pad >> 1)).fill(' '));
    else chars = chars.concat(Array(pad).fill(' '));
    return chars.map(ch => (GLYPHS[ch] ? ch : ' '));
  });
}

// One dot, filling 0.8 of its cell: a square, or a circle for an LED sign.
// Filled shapes, never zero-length strokes with caps: WebKit draws a capped
// zero-length stroke as a diamond once it is painted with a gradient (the
// depth below), where Blink draws a square. Measured 2026-10-27 in Safari:
// a 0.8 square cap under a gradient covered 7,488 px where 6,400 were due.
const DOTS = {
  square: (x, y) => `M${x + 0.1} ${y + 0.1}h.8v.8h-.8z`,
  round: (x, y) => `M${x + 0.1} ${y + 0.5}a.4 .4 0 1 0 .8 0a.4 .4 0 1 0 -.8 0z`,
};
const dotAt = (shape) => DOTS[shape] || DOTS.square;

/** The lit dots of one character at (col, line), each a filled square (or circle). */
export function cellPath(ch, col, line = 0, shape = 'square') {
  const g = GLYPHS[ch];
  if (!g) return '';
  const dot = dotAt(shape);
  let d = '';
  for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) {
    if (g[r * 5 + k] === '1') d += dot(col * PITCH_X + k, line * PITCH_Y + r);
  }
  return d;
}

const gridCache = new Map();
/** Every dot of a cols × lines board, lit or not: the unlit grid under the type. */
export function gridPath(cols, lines = 1, shape = 'square') {
  const key = `${cols}x${lines}:${shape}`;
  if (!gridCache.has(key)) {
    const dot = dotAt(shape);
    let d = '';
    for (let l = 0; l < lines; l++) for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) d += dot(c * PITCH_X + k, l * PITCH_Y + r);
    }
    gridCache.set(key, d);
  }
  return gridCache.get(key);
}

/**
 * A cell's fixed luminance drift, 0 (as bright as the board) to 1 (the
 * dimmest it may be): real lamps are never matched, and a line where every
 * character burns identically reads as type printed on glass. Fixed per
 * position, so a character never flickers as it changes; the CSS sets how
 * much it shows (`--dm-drift`).
 */
export function drift(col, line = 0) {
  const x = Math.sin(col * 12.9898 + line * 78.233 + 4.1) * 43758.5453;
  return Math.round((x - Math.floor(x)) * 100) / 100;
}

/** The board's size in dots, for the viewBox and the CSS. */
export function boardSize(cols, lines = 1) {
  return { w: Math.max(1, cols * PITCH_X - 1), h: lines * PITCH_Y - 2 };
}

// ── counting ──────────────────────────────────────────────────────────────
const NUMBER = /[-+]?\d+(?:\.\d+)?/;

/**
 * The text at `t` (0 → 1) of counting from `from` to `to`: the first number in
 * `to` runs from the first number in `from` (or zero) on an ease-out, keeping
 * `to`'s decimals, sign and width, and everything around it is `to`'s from the
 * start. Text with no number is `to` at once.
 */
export function countAt(from, to, t) {
  const m = NUMBER.exec(to);
  if (!m || t >= 1) return to;
  const target = parseFloat(m[0]);
  const fm = NUMBER.exec(from ?? '');
  const start = fm ? parseFloat(fm[0]) : 0;
  const decimals = (m[0].split('.')[1] || '').length;
  const eased = 1 - Math.pow(1 - Math.max(0, t), 3);
  let n = (start + (target - start) * eased).toFixed(decimals);
  if (/^\+/.test(m[0]) && parseFloat(n) >= 0) n = '+' + n;
  n = n.padStart(m[0].length, ' ');
  return to.slice(0, m.index) + n + to.slice(m.index + m[0].length);
}

// ── the clock ─────────────────────────────────────────────────────────────
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * A date as matrix text in a time zone (default: the viewer's). Tokens:
 * YYYY MON DD DOW · HH (24 h) hh (12 h, no zero) mm ss AP. A city's board
 * passes its own zone so a visitor on the far side of the world reads the city's time.
 */
export function formatClock(date, fmt = 'HH:mm', timeZone) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date)) p[type] = value;
  const h = Number(p.hour) % 24;
  const two = n => String(n).padStart(2, '0');
  const tokens = {
    YYYY: p.year, MON: MON[Number(p.month) - 1], DD: two(p.day),
    DOW: p.weekday.slice(0, 3).toUpperCase(), HH: two(h), hh: String(h % 12 || 12),
    mm: two(p.minute), ss: two(p.second), AP: h < 12 ? 'AM' : 'PM',
  };
  return fmt.replace(/YYYY|MON|DOW|DD|HH|hh|mm|ss|AP/g, t => tokens[t]);
}

// ── the one timer ─────────────────────────────────────────────────────────
// Every source on a page shares it: one setTimeout armed for the next job due,
// none at all while the tab is hidden, and everything overdue runs the moment
// it is visible again.
const jobs = new Set();
let timer = null;
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function arm() {
  clearTimeout(timer);
  timer = null;
  if (!jobs.size || hidden()) return;
  let next = Infinity;
  for (const j of jobs) next = Math.min(next, j.next);
  timer = setTimeout(runDue, Math.max(0, next - Date.now()));
}

function runDue() {
  const now = Date.now();
  for (const j of jobs) {
    if (j.next > now + 4) continue;
    j.next = j.align ? Math.ceil((now + 1) / j.ms) * j.ms : now + j.ms;
    try { j.fn(now); } catch (e) { console.error('[dotmatrix]', e); }
  }
  arm();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!hidden()) for (const j of jobs) j.next = Math.min(j.next, Date.now());
    arm();
  });
}

/**
 * Run `fn` now and every `ms`; `align` lands each run on the wall-clock edge
 * (a minute clock turns over on the minute). Returns a stop function. The
 * first run happens even in a hidden tab (a page opened in the background is
 * ready when it is looked at); after that, nothing runs until it is visible.
 */
export function every(ms, fn, { align = false } = {}) {
  const now = Date.now();
  const job = { ms, fn, align, next: align ? Math.ceil((now + 1) / ms) * ms : now + ms };
  jobs.add(job);
  setTimeout(() => {
    if (!jobs.has(job)) return;
    try { fn(Date.now()); } catch (e) { console.error('[dotmatrix]', e); }
  }, 0);
  arm();
  return () => { jobs.delete(job); arm(); };
}

// ── shared feeds ──────────────────────────────────────────────────────────
// Ten displays reading one URL make one request: a fetch younger than the
// asker's interval is everyone's.
const feeds = new Map();

/** The JSON at `url`, fetched at most once per `maxAge` ms across the page. */
export function fetchShared(url, maxAge = 60_000) {
  const hit = feeds.get(url);
  if (hit && Date.now() - hit.at < maxAge) return hit.promise;
  const promise = fetch(url, { headers: { accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  feeds.set(url, { at: Date.now(), promise });
  promise.catch(() => { if (feeds.get(url)?.promise === promise) feeds.delete(url); });
  return promise;
}

// ── drawing ───────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
const STATES = ['off', 'idle', 'ok', 'hot', 'go', 'warn', 'alert', 'stale'];
let boards = 0;   // a page-unique id for each display's light falloff
const STEP_MS = 32;     // per cell as a line lights, and per frame of a count
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

class Display {
  constructor(host, { cols = null, lines = 1, align = 'left', state = 'ok', animate = 'light', label = null, live = false, fit = null } = {}) {
    Object.assign(this, { host, cols, lines, align, animate, label, text: '', shown: '' });
    // `fit` sizes the dots to the width of the host's container, between
    // `min` and `max` px of pitch: a verdict line that reads at 14px on a
    // desk and still fits a phone.
    this.fit = fit ? { min: 3, max: 14, ...(fit === true ? {} : fit) } : null;
    // The dot's shape is geometry, so it is read once, from the host's data-shape.
    this.shape = host.dataset.shape === 'round' ? 'round' : 'square';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'dm-svg');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    this.off = this.svg.appendChild(document.createElementNS(NS, 'path'));
    this.off.setAttribute('class', 'dm-off');
    this.lit = this.svg.appendChild(document.createElementNS(NS, 'g'));
    this.lit.setAttribute('class', 'dm-lit');
    this.cells = [];   // [line][col] → { path, ch }
    host.classList.add('dm');
    if (live) host.setAttribute('aria-live', 'polite');
    host.replaceChildren(this.svg);
    this.state(state);
    this._size(cols ?? 1);
    if (this.fit && typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this._fit());
      this._ro.observe(host.parentElement || host);
    }
  }

  _fit() {
    if (!this.fit) return;
    // The room is the container's content box: clientWidth counts its padding too.
    const box = this.host.parentElement || this.host;
    const pad = getComputedStyle(box);
    const room = box.clientWidth - parseFloat(pad.paddingLeft || 0) - parseFloat(pad.paddingRight || 0);
    if (!(room > 0)) return;
    const pitch = Math.max(this.fit.min, Math.min(this.fit.max, room / this.w));
    this.host.style.setProperty('--dm-pitch', `${pitch.toFixed(2)}px`);
  }

  // Grow or shrink the board; the grid path is cached per size.
  _size(cols) {
    if (this.cells.length === this.lines && this.cells[0]?.length === cols) return;
    const { w, h } = boardSize(cols, this.lines);
    this.w = w;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.host.style.setProperty('--dm-w', w);
    this.host.style.setProperty('--dm-h', h);
    this.off.setAttribute('d', gridPath(cols, this.lines, this.shape));
    this.lit.replaceChildren();
    // Depth: each line's light falls off from its top row to its bottom one,
    // the way a lamp behind a diffuser is brightest nearest the source. One
    // gradient per line, in the dots' own colour, its strength in CSS.
    this.id ??= `dm${++boards}`;
    const defs = this.lit.appendChild(document.createElementNS(NS, 'defs'));
    for (let l = 0; l < this.lines; l++) {
      const g = defs.appendChild(document.createElementNS(NS, 'linearGradient'));
      g.setAttribute('id', `${this.id}-${l}`);
      g.setAttribute('gradientUnits', 'userSpaceOnUse');
      g.setAttribute('x1', '0'); g.setAttribute('x2', '0');
      g.setAttribute('y1', String(l * PITCH_Y)); g.setAttribute('y2', String(l * PITCH_Y + 7));
      for (const [offset, cls] of [['0', 'dm-top'], ['1', 'dm-bottom']]) {
        const stop = g.appendChild(document.createElementNS(NS, 'stop'));
        stop.setAttribute('offset', offset);
        stop.setAttribute('class', cls);
      }
    }
    this.cells = Array.from({ length: this.lines }, (_, l) => Array.from({ length: cols }, (_, c) => {
      const path = this.lit.appendChild(document.createElementNS(NS, 'path'));
      path.style.fill = `url(#${this.id}-${l})`;
      path.style.setProperty('--h', String(drift(c, l)));
      return { path, ch: ' ' };
    }));
    this._fit();
  }

  /** Light only the cells whose character changed; `order` staggers them. */
  _paint(text, { stagger = false, delay = 0 } = {}) {
    const grid = layout(text, { cols: this.cols, lines: this.lines, align: this.align });
    this._size(grid[0].length);
    let n = 0;
    grid.forEach((row, l) => row.forEach((ch, c) => {
      const cell = this.cells[l][c];
      if (cell.ch === ch) return;
      cell.ch = ch;
      cell.path.setAttribute('d', cellPath(ch, c, l, this.shape));
      if (stagger && ch !== ' ' && !reduced() && cell.path.animate) {
        cell.path.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 300, delay: delay + n++ * STEP_MS, easing: 'steps(3, end)', fill: 'backwards' });
      }
    }));
    this.shown = text;
  }

  /**
   * Show `value`. `animate`: 'light' (changed cells light left to right),
   * 'count' (the number runs to its value and brightens), or 'none'.
   */
  set(value, { animate = this.animate, label = this.label, delay = 0 } = {}) {
    const text = String(value ?? '');
    const from = this.text;
    this.text = text;
    this.svg.setAttribute('aria-label', label ?? text.replace(/\n/g, ' · '));
    clearTimeout(this._count);
    this.host.style.removeProperty('--dm-lit');
    if (animate === 'count' && !reduced() && NUMBER.test(text) && from !== text) {
      const ms = Math.min(1100, 260 + Math.abs(parseFloat(NUMBER.exec(text)[0])) * 11);
      const t0 = Date.now() + delay;
      const tick = () => {
        const t = Math.max(0, Math.min(1, (Date.now() - t0) / ms));
        this.host.style.setProperty('--dm-lit', (0.12 + 0.88 * Math.pow(t, 0.7)).toFixed(3));
        this._paint(countAt(from, text, t));
        if (t < 1) this._count = setTimeout(tick, STEP_MS);
        else this.host.style.removeProperty('--dm-lit');
      };
      this._count = setTimeout(tick, delay);
      return this;
    }
    this._paint(text, { stagger: animate === 'light', delay });
    return this;
  }

  /** off · idle · ok · hot · warn · alert · stale — the colour and light are CSS's. */
  state(s) {
    if (!STATES.includes(s)) throw new Error(`dotmatrix: unknown state "${s}"`);
    this.current = s;
    this.host.dataset.state = s;
    return this;
  }

  /**
   * Keep this display fed. `read` returns the text (or a promise of it) and
   * may return { text, state } to set both. It runs now and every `every` ms
   * on the shared timer. When it throws or rejects, the last true value stays
   * and, once nothing has succeeded for `staleAfter` ms, the display goes
   * stale; the next success puts its state back.
   */
  bind(read, { every: ms = 60_000, staleAfter = ms * 3, align = false } = {}) {
    this.unbind();
    let lastGood = Date.now(), before = this.current;
    const run = async () => {
      try {
        const v = await read();
        const { text, state } = typeof v === 'object' && v !== null ? v : { text: v };
        lastGood = Date.now();
        if (this.current === 'stale') this.state(before);
        if (state) this.state(state);
        if (text != null && String(text) !== this.text) this.set(text);
      } catch (e) {
        if (Date.now() - lastGood >= staleAfter && this.current !== 'stale') { before = this.current; this.state('stale'); }
      }
    };
    this._stop = every(ms, run, { align });
    return this;
  }

  unbind() { this._stop?.(); this._stop = null; return this; }

  /**
   * A strike: the display flares past its colour toward white and settles,
   * the way a lamp overshoots when it is switched on. For the moment a
   * reader picks something. No motion under reduced motion (it is CSS).
   */
  strike() {
    this.host.classList.remove('dm-strike');
    void this.host.offsetWidth;   // restart the animation if it is still running
    this.host.classList.add('dm-strike');
    return this;
  }

  /** Stop its source and its resize watch; the drawing stays where it is. */
  destroy() { this.unbind(); this._ro?.disconnect(); clearTimeout(this._count); }
}

/** A display drawn into `host`. See Display for the options. */
export function display(host, opts) {
  return new Display(host, opts);
}

/** A clock source for display.bind: `clock('DOW DD MON · HH:mm', 'America/Los_Angeles')`. */
export function clock(fmt = 'HH:mm', timeZone) {
  return () => formatClock(new Date(), fmt, timeZone);
}

/** A JSON source for display.bind: `feed('/api/city', d => d.bart.trains, 60_000)`. */
export function feed(url, pick, maxAge = 60_000) {
  return () => fetchShared(url, maxAge).then(pick);
}

// A page with no import map (a public page under a strict CSP cannot carry an
// inline one) loads this file as its own versioned <script type="module"> and
// reads the engine from here; module scripts run in document order, so a page
// script listed after it always finds it.
if (typeof globalThis !== 'undefined') {
  globalThis.DotMatrix = Object.freeze({ display, every, clock, feed, fetchShared, formatClock, layout, widen, GLYPHS });
}
