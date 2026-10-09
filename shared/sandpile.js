/**
 * The sandpile sequencer, modelled on the abelian sandpile (the textbook
 * case of self-organised criticality): grains of sand drop one at a time
 * onto a square grid of cells, and any cell holding four grains topples,
 * passing one to each neighbour — which may topple them in turn, and so
 * on in an avalanche that spreads outwards wave by wave from where it
 * started. Grains falling off the edge are lost. The cells are in rings
 * round the drop cell, each ring tuned to a note, and every ring with a
 * cell toppling in a wave plays its note (once, however many): so an
 * avalanche sounds as a run climbing (or falling) away from the drop, one
 * wave every `spread` beats. Most grains do nothing, some
 * set off a cell or two, and now and then one brings down half the pile:
 * long quiet stretches and sudden fills, in every size. Like the bouncing
 * balls it's chosen per track within a pattern and stored under that
 * track's id (see song.js).
 *
 * The pile starts near the edge of toppling (random grains in every cell),
 * since an empty one would take hundreds of grains to get going. Rates and
 * spreads are in beats, so a tempo change keeps the pile in time with the
 * song.
 *
 *   {
 *     size,       // cells per side (odd, so the middle is a cell)
 *     drop: [column, row],   // the cell grains land on
 *     scatter,    // 0 = every grain on the drop cell … 1 = every grain somewhere at random
 *     rate,       // grains per beat
 *     spread,     // beats from one wave of an avalanche to the next; 0 = all at once
 *     notes: [MIDI note per ring out from the drop cell, `size` of them: as many as a corner drop needs],
 *     gate,       // note length, in steps
 *     quantize,   // 0 = free, else snap topples forward to this many steps
 *   }
 */

import { SongError } from './errors.js';
import { nextScaleNote } from './scale.js';

export const SIZES = [5, 7, 9, 11];
export const TOPPLE_AT = 4;   // grains a cell holds before it topples
export const QUANTIZE = [0, 1, 2, 4];
export const SANDPILE_LIMITS = Object.freeze({
  rate: [0.125, 16],
  spread: [0, 1],
  gate: [0.25, 8],
});

// C minor pentatonic climbing away from the middle.
const DEFAULT_NOTES = [48, 51, 55, 58, 60, 63, 67, 70, 72, 75, 79];

/** Which ring a cell is in: how many cells out from the drop cell, counting diagonals as one. */
export const ringOf = (column, row, [dc, dr]) => Math.max(Math.abs(column - dc), Math.abs(row - dr));

/** The furthest ring any cell is from the drop cell. */
export const ringCount = (size, drop) => 1 + Math.max(...[0, size - 1].flatMap((c) => [0, size - 1].map((r) => ringOf(c, r, drop))));

/** `notes` cut or grown to `n`, climbing on up the scale from where it ends. */
export function retune(notes, n, keys = null) {
  const out = notes.slice(0, n);
  while (out.length < n) out.push(nextScaleNote(out, out[0] ?? 48, keys));
  return out;
}

/** Settings for a track that has just switched to the sandpile; `keys` are its instrument's named notes, if any. */
export function defaultSandpile(keys = null) {
  // A drum kit has no scale to climb; spread its sounds out across the rings instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  const size = 7;
  return {
    size,
    drop: [3, 3],
    scatter: 0.15,
    rate: 2,
    spread: 0.25,
    notes: DEFAULT_NOTES.slice(0, size).map((n, i) => (drumNotes ? drumNotes[i % drumNotes.length] : n)),
    gate: 1,
    quantize: 0,
  };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const note = (n) => Math.round(num(n, 0, 127, 60));

/** Validate one track's sandpile settings. */
export function normalizeSandpile(s) {
  if (s == null) return null;
  if (!isObj(s)) throw new SongError('bad sandpile settings');
  const fallback = defaultSandpile();
  const L = SANDPILE_LIMITS;

  const size = SIZES.includes(s.size) ? s.size : fallback.size;
  const middle = (size - 1) / 2;
  const drop = Array.isArray(s.drop) ? s.drop.slice(0, 2).map((v) => Math.round(num(v, 0, size - 1, middle))) : [middle, middle];
  if (drop.length < 2) drop.push(middle);
  if (s.notes !== undefined && !Array.isArray(s.notes)) throw new SongError('sandpile notes must be a list');
  const notes = retune((s.notes ?? fallback.notes).map(note), size);

  return {
    size,
    drop,
    scatter: num(s.scatter, 0, 1, fallback.scatter),
    rate: num(s.rate, ...L.rate, fallback.rate),
    spread: num(s.spread, ...L.spread, fallback.spread),
    notes,
    gate: num(s.gate, ...L.gate, fallback.gate),
    quantize: QUANTIZE.includes(s.quantize) ? s.quantize : fallback.quantize,
  };
}
