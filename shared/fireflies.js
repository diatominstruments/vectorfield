/**
 * The firefly sequencer: fireflies in a field, each flashing at its own
 * rate, and every flash plays that firefly's note. A flash nudges the
 * fireflies within reach of it to flash sooner (pulse coupling, the
 * standard model of fireflies falling into step), so with enough coupling
 * neighbours lock together into chords; nearly-locked ones flash in quick
 * succession, rolling them into little runs, and drift keeps them from
 * settling for good. Like the bouncing balls it's chosen per track within
 * a pattern and stored under that track's id (see song.js).
 *
 * Positions are in the unit square, and only distances matter: how far a
 * firefly's flash reaches. Rates are flashes per beat, so a tempo change
 * keeps the field in time with the song.
 *
 *   {
 *     flies: [{ id, x, y, note, rate }],
 *     coupling,   // 0 = each to its own … 1 = a flash pulls neighbours hard towards it
 *     reach,      // how far a flash is seen, in square-widths
 *     drift,      // 0 = steady rates … 1 = each cycle wobbles by up to ±15%
 *     restart,    // scatter every firefly at the start of each pass through the pattern
 *     gate,       // note length, in steps
 *     quantize,   // 0 = free, else snap flashes forward to this many steps
 *   }
 */

import { SongError } from './errors.js';

export const FLY_RADIUS = 0.03;
export const QUANTIZE = [0, 1, 2, 4];
export const FIREFLY_LIMITS = Object.freeze({
  flies: 16,
  rate: [0.125, 4],
  reach: [0.05, 1.5],
  gate: [0.25, 8],
});

// A C minor ninth spread across the field, low in the middle, flashing
// about every two beats with a little spread so they start out of step.
const DEFAULT_FLIES = [
  { id: 'f1', x: 0.5, y: 0.5, note: 48, rate: 0.5 },
  { id: 'f2', x: 0.3, y: 0.32, note: 60, rate: 0.53 },
  { id: 'f3', x: 0.68, y: 0.3, note: 63, rate: 0.47 },
  { id: 'f4', x: 0.74, y: 0.66, note: 67, rate: 0.51 },
  { id: 'f5', x: 0.36, y: 0.72, note: 70, rate: 0.55 },
  { id: 'f6', x: 0.2, y: 0.52, note: 74, rate: 0.45 },
];

/** Settings for a track that has just switched to fireflies; `keys` are its instrument's named notes, if any. */
export function defaultFireflies(keys = null) {
  // A drum kit has no chord to stack; spread its sounds across the field instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    flies: DEFAULT_FLIES.map((f, i) => ({ ...f, note: drumNotes ? drumNotes[i % drumNotes.length] : f.note })),
    coupling: 0.3,
    reach: 0.5,
    drift: 0.2,
    restart: false,
    gate: 2,
    quantize: 0,
  };
}

const ID = /^[a-z0-9]{1,24}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Validate one track's firefly settings. */
export function normalizeFireflies(f) {
  if (f == null) return null;
  if (!isObj(f)) throw new SongError('bad firefly settings');
  const fallback = defaultFireflies();
  const L = FIREFLY_LIMITS;
  const r = FLY_RADIUS;

  if (f.flies !== undefined && !Array.isArray(f.flies)) throw new SongError('fireflies must be a list');
  if ((f.flies ?? []).length > L.flies) throw new SongError(`too many fireflies (max ${L.flies})`);
  const ids = new Set();
  const flies = (f.flies ?? fallback.flies)
    .filter((fly) => isObj(fly) && typeof fly.id === 'string' && ID.test(fly.id) && !ids.has(fly.id) && ids.add(fly.id))
    .map((fly) => ({
      id: fly.id,
      x: num(fly.x, r, 1 - r, 0.5),
      y: num(fly.y, r, 1 - r, 0.5),
      note: Math.round(num(fly.note, 0, 127, 60)),
      rate: num(fly.rate, ...L.rate, 0.5),
    }));

  return {
    flies,
    coupling: num(f.coupling, 0, 1, fallback.coupling),
    reach: num(f.reach, ...L.reach, fallback.reach),
    drift: num(f.drift, 0, 1, fallback.drift),
    restart: f.restart === true,
    gate: num(f.gate, ...L.gate, fallback.gate),
    quantize: QUANTIZE.includes(f.quantize) ? f.quantize : fallback.quantize,
  };
}
