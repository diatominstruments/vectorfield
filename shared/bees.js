/**
 * The bee sequencer: solitary bees (bumblebees, say — no hive, no dance)
 * foraging a patch of plants, and every flower a bee lands on plays its
 * note. Like the bouncing balls it's chosen per track within a pattern
 * and stored under that track's id (see song.js).
 *
 * A visit drains the flower's nectar, which refills slowly, and a bee
 * won't land on a flower with little in it: so no flower sounds twice in
 * quick succession, and the refill time sets how sparse the sequence is;
 * the bees' speed and the distances between plants set the gaps inside a
 * phrase. A full flower is landed on harder (louder) than a half-filled
 * one. Plants with no flower (`note` null) are where a bee rests: landing
 * there plays nothing, so they put silence into the line — the more so as
 * the flowers around them run dry, since a bee passes over drained
 * flowers and settles for a leaf. With nothing in reach worth visiting a
 * bee waits where it is. Having fed or rested, it flies on to a nearby
 * full flower, or with `whim` to any plant it could land on.
 *
 * Positions are in the unit square; speed is in square-widths per beat and
 * times in beats, so a tempo change keeps the patch in time with the song.
 *
 *   {
 *     plants: [{ id, x, y, note }],   // note null: no flower, a bee only rests here
 *     bees,        // how many
 *     speed,       // square-widths per beat
 *     feed,        // beats a bee spends on a flower before flying on
 *     rest,        // beats a bee spends on a plant with no flower
 *     refill,      // beats for a drained flower to fill again
 *     whim,        // 0 = the fullest flower near by … 1 = any plant it could land on, at random
 *     gate,        // note length, in steps
 *     quantize,    // 0 = free, else snap landings forward to this many steps
 *   }
 */

import { SongError } from './errors.js';
import { nextScaleNote } from './scale.js';

export const PLANT_RADIUS = 0.04;
export const NECTAR_ENOUGH = 0.25;   // the share of full a flower must be before a bee will land on it
export const QUANTIZE = [0, 1, 2, 4];
export const BEE_LIMITS = Object.freeze({
  plants: 16,
  bees: [1, 6],
  speed: [0.1, 4],
  feed: [0, 8],
  rest: [0, 16],
  refill: [0.5, 64],
  gate: [0.25, 8],
});

/** Whether a plant has a flower to play, or is just somewhere to rest. */
export const isFlower = (plant) => plant.note != null;

// C minor pentatonic in a loose ring, low: a patch for a bass line, with
// a couple of leafy plants among the flowers to rest on.
const DEFAULT_PLANTS = [
  { id: 'w1', x: 0.22, y: 0.3, note: 48 },
  { id: 'w2', x: 0.55, y: 0.18, note: 51 },
  { id: 'w3', x: 0.82, y: 0.42, note: 55 },
  { id: 'w4', x: 0.7, y: 0.78, note: 58 },
  { id: 'w5', x: 0.36, y: 0.82, note: 60 },
  { id: 'w6', x: 0.16, y: 0.58, note: 63 },
  { id: 'p1', x: 0.5, y: 0.52, note: null },
  { id: 'p2', x: 0.86, y: 0.14, note: null },
];

/** The note for a flower added to this patch: the next one up the scale, in the key of the lowest. */
export function nextFlowerNote(config, keys = null) {
  const notes = config.plants.filter(isFlower).map((p) => p.note);
  return nextScaleNote(notes, notes.length ? Math.min(...notes) : 48, keys);
}

/** Settings for a track that has just switched to bees; `keys` are its instrument's named notes, if any. */
export function defaultBees(keys = null) {
  // A drum kit has no scale to climb; spread its sounds around the patch instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    plants: DEFAULT_PLANTS.map((p, i) => ({ ...p, note: drumNotes && isFlower(p) ? drumNotes[i % drumNotes.length] : p.note })),
    bees: 2,
    speed: 0.5,
    feed: 1,
    rest: 2,
    refill: 8,
    whim: 0.2,
    gate: 2,
    quantize: 0,
  };
}

const ID = /^[a-z0-9]{1,24}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Validate one track's bee settings. */
export function normalizeBees(b) {
  if (b == null) return null;
  if (!isObj(b)) throw new SongError('bad bee settings');
  const fallback = defaultBees();
  const L = BEE_LIMITS;
  const r = PLANT_RADIUS;

  // Settings saved before plants without flowers listed `flowers`.
  const list = b.plants ?? b.flowers;
  if (list !== undefined && !Array.isArray(list)) throw new SongError('plants must be a list');
  if ((list ?? []).length > L.plants) throw new SongError(`too many plants (max ${L.plants})`);
  const ids = new Set();
  const plants = (list ?? fallback.plants)
    .filter((p) => isObj(p) && typeof p.id === 'string' && ID.test(p.id) && !ids.has(p.id) && ids.add(p.id))
    .map((p) => ({
      id: p.id,
      x: num(p.x, r, 1 - r, 0.5),
      y: num(p.y, r, 1 - r, 0.5),
      note: p.note === null ? null : Math.round(num(p.note, 0, 127, 60)),
    }));

  return {
    plants,
    bees: Math.round(num(b.bees, ...L.bees, fallback.bees)),
    speed: num(b.speed, ...L.speed, fallback.speed),
    feed: num(b.feed, ...L.feed, fallback.feed),
    rest: num(b.rest, ...L.rest, fallback.rest),
    refill: num(b.refill, ...L.refill, fallback.refill),
    whim: num(b.whim, 0, 1, fallback.whim),
    gate: num(b.gate, ...L.gate, fallback.gate),
    quantize: QUANTIZE.includes(b.quantize) ? b.quantize : fallback.quantize,
  };
}
