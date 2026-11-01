// Bridge module so `src/api/city.js` reads `board.config.js` without edits.
import { BOARD } from '../../board.config.js';

export const CONFIG = {
  location: {
    name: BOARD.name,
    coords: BOARD.coords,
  },
  timezone: BOARD.timezone || 'America/Los_Angeles',
  city: {
    path: '/',
    airport: BOARD.airport || null,
    tide: BOARD.tide || null,
    elnino: Boolean(BOARD.elnino),
    bart: BOARD.bart || null,
    signs: BOARD.signs || null,
    bridge: BOARD.bridge || null,
    gauges: BOARD.gauges || [],
    events: BOARD.events || [],
    pipes: BOARD.pipes || {},
    snapshotUrl: BOARD.snapshotUrl || '',
  },
};

export default CONFIG;
