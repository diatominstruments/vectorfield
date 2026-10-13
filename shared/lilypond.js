/**
 * The lily pond sequencer: a light rain on a pond, and every drop that
 * strikes a lily pad plays that pad's note — accented when the pad is in
 * flower. Drops into open water only ripple, so how much of the pond the
 * pads cover sets how busy the line is, and a pad's size sets how often it
 * sounds against the others. Like the bouncing balls it's chosen per track
 * within a pattern and stored under that track's id (see song.js).
 *
 * The rain can fall over the whole pond, or in a shower that the wind
 * drifts across it, playing whichever pads it passes over. It can fall
 * evenly or come and go in gusts, and it can repeat: the same drops in the
 * same places every pass through the pattern, so a rain you like can be
 * kept (`seed` says which rain).
 *
 * Positions and sizes are in the unit square; density is drops per beat
 * and wind is pond-widths per beat, so a tempo change keeps the rain in
 * time with the song.
 *
 *   {
 *     pads: [{ id, x, y, size (radius), note, flower }],
 *     density,    // drops per beat, all told
 *     evenness,   // 0 = drops fall at random moments … 1 = evenly spaced, like a drip
 *     gusts,      // 0 = steady rain … 1 = it comes and goes, from nothing to twice as heavy
 *     shower,     // how wide the rain falls, as a share of the pond's width; 1 = everywhere
 *     wind,       // how fast a shower drifts, in pond-widths per beat
 *     repeat,     // the same rain every pass through the pattern
 *     seed,       // which rain, when it repeats
 *     gate,       // note length, in steps
 *     quantize,   // 0 = free, else snap drops forward to this many steps
 *   }
 */

import { SongError } from './errors.js';

export const QUANTIZE = [0, 1, 2, 4];
export const MAX_SEED = 2 ** 31 - 1;
export const LILY_LIMITS = Object.freeze({
  pads: 16,
  size: [0.04, 0.2],
  density: [0.5, 64],
  shower: [0.1, 1],
  wind: [0, 0.5],
  gate: [0.25, 8],
});

// C minor pentatonic scattered over the pond, about a fifth of it covered,
// the C and G above middle C in flower.
const DEFAULT_PADS = [
  { id: 'p1', x: 0.24, y: 0.28, size: 0.1, note: 48, flower: false },
  { id: 'p2', x: 0.6, y: 0.18, size: 0.08, note: 55, flower: false },
  { id: 'p3', x: 0.82, y: 0.44, size: 0.09, note: 60, flower: true },
  { id: 'p4', x: 0.56, y: 0.6, size: 0.11, note: 63, flower: false },
  { id: 'p5', x: 0.26, y: 0.72, size: 0.09, note: 67, flower: true },
  { id: 'p6', x: 0.8, y: 0.82, size: 0.07, note: 70, flower: false },
  { id: 'p7', x: 0.12, y: 0.5, size: 0.06, note: 72, flower: false },
];

/** A new seed, for a new rain. */
export const newSeed = () => Math.floor(Math.random() * MAX_SEED);

/**
 * Settings for a track that has just switched to the lily pond; `keys` are
 * its instrument's named notes, if any. Each pond gets a rain of its own,
 * so two tracks repeating theirs don't fall in step.
 */
export function defaultLilyPond(keys = null) {
  // A drum kit has no scale to spread; share its sounds out over the pads instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    pads: DEFAULT_PADS.map((p, i) => ({ ...p, note: drumNotes ? drumNotes[i % drumNotes.length] : p.note })),
    density: 8,
    evenness: 0,
    gusts: 0.3,
    shower: 1,
    wind: 0.1,
    repeat: false,
    seed: newSeed(),
    gate: 1,
    quantize: 1,
  };
}

const ID = /^[a-z0-9]{1,24}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Validate one track's lily pond. */
export function normalizeLilyPond(f) {
  if (f == null) return null;
  if (!isObj(f)) throw new SongError('bad lily pond settings');
  const fallback = defaultLilyPond();
  const L = LILY_LIMITS;

  if (f.pads !== undefined && !Array.isArray(f.pads)) throw new SongError('lily pads must be a list');
  if ((f.pads ?? []).length > L.pads) throw new SongError(`too many lily pads (max ${L.pads})`);
  const ids = new Set();
  const pads = (f.pads ?? fallback.pads)
    .filter((pad) => isObj(pad) && typeof pad.id === 'string' && ID.test(pad.id) && !ids.has(pad.id) && ids.add(pad.id))
    .map((pad) => {
      // A pad stays in the pond, however big.
      const size = num(pad.size, ...L.size, 0.08);
      return {
        id: pad.id,
        x: num(pad.x, size, 1 - size, 0.5),
        y: num(pad.y, size, 1 - size, 0.5),
        size,
        note: Math.round(num(pad.note, 0, 127, 60)),
        flower: pad.flower === true,
      };
    });

  return {
    pads,
    density: num(f.density, ...L.density, fallback.density),
    evenness: num(f.evenness, 0, 1, fallback.evenness),
    gusts: num(f.gusts, 0, 1, fallback.gusts),
    shower: num(f.shower, ...L.shower, fallback.shower),
    wind: num(f.wind, ...L.wind, fallback.wind),
    repeat: f.repeat === true,
    seed: Math.round(num(f.seed, 0, MAX_SEED, fallback.seed)),
    gate: num(f.gate, ...L.gate, fallback.gate),
    quantize: QUANTIZE.includes(f.quantize) ? f.quantize : fallback.quantize,
  };
}
