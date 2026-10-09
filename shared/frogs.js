/**
 * The frog chorus sequencer: frogs around a pond, each calling at its own
 * rate, and every call plays that frog's note. Where fireflies fall into
 * step, frogs do the opposite: a frog that hears a neighbour call shifts
 * its own next call away from it (the anti-phase coupling found in tree
 * frog choruses, where neighbours take turns so each can be heard). So
 * with enough avoidance, neighbours interlock — two alternate, more take
 * turns in a round, a crowded pond calling a little slower than any frog
 * would alone, as each makes room — and the chorus becomes a hocket
 * rather than a chord.
 * Frogs can also call in bouts, resting between them, which phrases the
 * line. Like the bouncing balls it's chosen per track within a pattern
 * and stored under that track's id (see song.js).
 *
 * Positions are in the unit square, and only distances matter: how far a
 * call is heard. Rates are calls per beat, so a tempo change keeps the
 * pond in time with the song.
 *
 *   {
 *     frogs: [{ id, x, y, note, rate }],
 *     avoidance,  // 0 = each to its own … 1 = a neighbour's call moves a frog's next call right away from it
 *     reach,      // how far a call is heard, in square-widths
 *     drift,      // 0 = steady rates … 1 = each cycle wobbles by up to ±15%
 *     bout,       // calls a frog makes in a row before resting; 0 = never rests
 *     rest,       // beats of rest between bouts
 *     restart,    // scatter every frog at the start of each pass through the pattern
 *     gate,       // note length, in steps
 *     quantize,   // 0 = free, else snap calls forward to this many steps
 *   }
 */

import { SongError } from './errors.js';

export const FROG_RADIUS = 0.035;
export const QUANTIZE = [0, 1, 2, 4];
export const FROG_LIMITS = Object.freeze({
  frogs: 12,
  rate: [0.125, 4],
  reach: [0.05, 1.5],
  bout: [0, 32],
  rest: [0.5, 16],
  gate: [0.25, 8],
});

// Four frogs round the pond, a C minor pentatonic spread, two calling on
// the beat and two at half that, so they settle into an off-beat round.
const DEFAULT_FROGS = [
  { id: 'g1', x: 0.3, y: 0.3, note: 48, rate: 1 },
  { id: 'g2', x: 0.7, y: 0.32, note: 55, rate: 1 },
  { id: 'g3', x: 0.72, y: 0.7, note: 60, rate: 0.5 },
  { id: 'g4', x: 0.28, y: 0.68, note: 63, rate: 0.5 },
];

/** Settings for a track that has just switched to frogs; `keys` are its instrument's named notes, if any. */
export function defaultFrogs(keys = null) {
  // A drum kit has no scale to spread; share its sounds out round the pond instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    frogs: DEFAULT_FROGS.map((f, i) => ({ ...f, note: drumNotes ? drumNotes[i % drumNotes.length] : f.note })),
    avoidance: 0.6,
    reach: 0.6,
    drift: 0.1,
    bout: 0,
    rest: 2,
    restart: false,
    gate: 1,
    quantize: 0,
  };
}

const ID = /^[a-z0-9]{1,24}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Validate one track's frog settings. */
export function normalizeFrogs(f) {
  if (f == null) return null;
  if (!isObj(f)) throw new SongError('bad frog settings');
  const fallback = defaultFrogs();
  const L = FROG_LIMITS;
  const r = FROG_RADIUS;

  if (f.frogs !== undefined && !Array.isArray(f.frogs)) throw new SongError('frogs must be a list');
  if ((f.frogs ?? []).length > L.frogs) throw new SongError(`too many frogs (max ${L.frogs})`);
  const ids = new Set();
  const frogs = (f.frogs ?? fallback.frogs)
    .filter((frog) => isObj(frog) && typeof frog.id === 'string' && ID.test(frog.id) && !ids.has(frog.id) && ids.add(frog.id))
    .map((frog) => ({
      id: frog.id,
      x: num(frog.x, r, 1 - r, 0.5),
      y: num(frog.y, r, 1 - r, 0.5),
      note: Math.round(num(frog.note, 0, 127, 60)),
      rate: num(frog.rate, ...L.rate, 1),
    }));

  return {
    frogs,
    avoidance: num(f.avoidance, 0, 1, fallback.avoidance),
    reach: num(f.reach, ...L.reach, fallback.reach),
    drift: num(f.drift, 0, 1, fallback.drift),
    bout: Math.round(num(f.bout, ...L.bout, fallback.bout)),
    rest: num(f.rest, ...L.rest, fallback.rest),
    restart: f.restart === true,
    gate: num(f.gate, ...L.gate, fallback.gate),
    quantize: QUANTIZE.includes(f.quantize) ? f.quantize : fallback.quantize,
  };
}
