// The dot-matrix engine (js/dotmatrix.js): the pure half, in Node. The drawing
// half is checked in a browser against docs/ideas/dotmatrix-specimen.html.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GLYPHS, WIDE, widen, layout, cellPath, gridPath, boardSize, countAt, formatClock, drift, PITCH_X, PITCH_Y,
} from '../js/dotmatrix.js';

const dots = (d) => (d.match(/M/g) || []).length;

describe('the glyphs', () => {
  it('every glyph is 5×7 of lit and unlit dots', () => {
    for (const [ch, g] of Object.entries(GLYPHS)) expect(g, ch).toMatch(/^[01]{35}$/);
  });
  it('no two glyphs are the same picture', () => {
    const seen = new Map();
    for (const [ch, g] of Object.entries(GLYPHS)) {
      expect(seen.get(g), `${ch} repeats ${seen.get(g)}`).toBeUndefined();
      seen.set(g, ch);
    }
  });
  it('carries what a city board and a freeway sign need', () => {
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:·.-$/%°+=\'",!?<>()&#↑↓⇄') {
      expect(GLYPHS[ch], ch).toBeDefined();
    }
    // the sky marks and the holidays' are three cells wide, each cell a glyph of its own
    for (const ch of ['☀', '☁', '☂', '⚡', '≈', '☾', '🎃', '♥', '✸', '🎄', '🍁', '💀', '🏆']) {
      expect([...WIDE[ch]], ch).toHaveLength(3);
      for (const piece of WIDE[ch]) expect(GLYPHS[piece], ch).toMatch(/^[01]{35}$/);
    }
  });
  it('draws a sky mark three cells wide, and anything measuring a line counts it so', () => {
    // one 5×7 cell made the cloud a low blob that read as cut off (owner, 2026-10-30)
    expect([...widen('64° ☁')]).toHaveLength(7);
    const [row] = layout('64° ☁');
    expect(row).toHaveLength(7);
    expect(row.slice(4)).toEqual([...WIDE['☁']]);
    expect(layout('64° ☁', { cols: 7, align: 'right' })[0]).toEqual(row);   // it fills, it doesn't spill
    expect([...widen('HAPPY HALLOWEEN 🎃')]).toHaveLength(19);   // an emoji outside the basic plane, still one mark
  });
});

describe('layout', () => {
  it('reads lowercase as uppercase and an unknown character as a blank cell', () => {
    expect(layout('oak~1')).toEqual([['O', 'A', 'K', ' ', '1']]);
  });
  it('pads to a fixed width on the side it is told, and cuts what will not fit', () => {
    expect(layout('42', { cols: 4, align: 'right' })[0].join('')).toBe('  42');
    expect(layout('42', { cols: 4, align: 'center' })[0].join('')).toBe(' 42 ');
    expect(layout('42', { cols: 4 })[0].join('')).toBe('42  ');
    expect(layout('CRASH BEFORE HWY 92', { cols: 16 })[0].join('')).toBe('CRASH BEFORE HWY');
  });
  it('lays out a three-line sign at the widest line, padding short and missing lines', () => {
    const g = layout('CRASH BEFORE\nHWY 92', { lines: 3 });
    expect(g).toHaveLength(3);
    expect(g.every((row) => row.length === 12)).toBe(true);
    expect(g[2].join('').trim()).toBe('');
  });
});

describe('paths', () => {
  it('lights a glyph’s dots at its cell and line, each a filled 0.8 square', () => {
    expect(dots(cellPath('1', 0))).toBe(10);
    expect(cellPath('-', 2, 1)).toBe(
      [0, 1, 2, 3, 4].map((k) => `M${2 * PITCH_X + k + 0.1} ${PITCH_Y + 3 + 0.1}h.8v.8h-.8z`).join(''));
    expect(cellPath(' ', 0)).toBe('');
  });
  it('draws no dot as a stroke: a capped zero-length stroke turns to a diamond in WebKit', () => {
    for (const shape of ['square', 'round']) {
      expect(cellPath('8', 0, 0, shape)).not.toMatch(/h0|v0/);
      expect(cellPath('8', 0, 0, shape)).toMatch(/z$/);
    }
    expect(dots(cellPath('8', 0, 0, 'round'))).toBe(dots(cellPath('8', 0)));
    expect(gridPath(2, 1, 'round')).not.toBe(gridPath(2, 1));
  });
  it('the unlit grid is every dot of the board, and is cached', () => {
    expect(dots(gridPath(16, 3))).toBe(16 * 3 * 35);
    expect(gridPath(16, 3)).toBe(gridPath(16, 3));
  });
  it('sizes the board in dots: a gap between cells, two blank rows between lines', () => {
    expect(boardSize(5, 1)).toEqual({ w: 29, h: 7 });
    expect(boardSize(16, 3)).toEqual({ w: 95, h: 25 });
  });
});

describe('the lamps’ drift', () => {
  it('is fixed per position, so a character never flickers as it changes', () => {
    expect(drift(3, 1)).toBe(drift(3, 1));
  });
  it('stays within 0 to 1, and varies across a line', () => {
    const line = Array.from({ length: 24 }, (_, c) => drift(c, 0));
    expect(line.every((d) => d >= 0 && d <= 1)).toBe(true);
    expect(new Set(line).size).toBeGreaterThan(12);
  });
});

describe('counting to a number', () => {
  it('starts from the old number and lands exactly on the new one', () => {
    expect(countAt('12/81', '74/81', 0)).toBe('12/81');
    expect(countAt('12/81', '74/81', 1)).toBe('74/81');
    const mid = countAt('12/81', '74/81', 0.5);
    expect(Number(mid.split('/')[0])).toBeGreaterThan(12);
    expect(Number(mid.split('/')[0])).toBeLessThan(74);
  });
  it('keeps the new value’s decimals, sign and width, so the line never jumps', () => {
    expect(countAt('', '8.6 FT', 0.5)).toMatch(/^\d\.\d FT$/);
    expect(countAt('-0.3', '+1.1', 1)).toBe('+1.1');
    expect(countAt('', '74/81', 0.01)).toMatch(/^ \d\/81$/);
  });
  it('runs only forward in time, never past the target', () => {
    let last = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const n = parseFloat(countAt('0', '100', t));
      expect(n).toBeGreaterThanOrEqual(last);
      expect(n).toBeLessThanOrEqual(100);
      last = n;
    }
  });
  it('text without a number is shown as it is', () => {
    expect(countAt('OK', 'CLOSED', 0.3)).toBe('CLOSED');
  });
});

describe('the clock', () => {
  const d = new Date('2026-10-28T03:08:05Z'); // 20:08 on the 27th in Los Angeles' time zone
  it('reads the city’s time, not the viewer’s', () => {
    expect(formatClock(d, 'DOW DD MON · HH:mm', 'America/Los_Angeles')).toBe('TUE 27 OCT · 20:08');
    expect(formatClock(d, 'HH:mm', 'Asia/Tokyo')).toBe('12:08');
  });
  it('has a 12-hour face and seconds', () => {
    expect(formatClock(d, 'hh:mm:ss AP', 'America/Los_Angeles')).toBe('8:08:05 PM');
    expect(formatClock(new Date('2026-10-28T07:05:00Z'), 'hh:mm AP', 'America/Los_Angeles')).toBe('12:05 AM');
  });
});

describe('a part, not a page', () => {
  const SRC = readFileSync(new URL('../js/dotmatrix.js', import.meta.url), 'utf8');
  it('imports nothing, so any surface (and any project) can carry it as one file', () => {
    expect(SRC).not.toMatch(/^\s*import\s/m);
  });
  it('holds no colours: the look is css/dotmatrix.css', () => {
    expect(SRC).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
  });
});
