/**
 * The ant colony sequencer: ants forage across a web of tuned nodes that
 * the user draws, and every node an ant reaches plays its note. Like the
 * bouncing balls it's chosen per track within a pattern and stored under
 * that track's id (see song.js).
 *
 * Ants leave the nest and wander the paths until they find the food, then
 * carry it home along the way they came, laying scent on every path as
 * they go: more on shorter journeys. Outbound ants prefer paths with more
 * scent, and scent fades, so the colony settles on a favourite route — a
 * motif that sounds out from the nest and back in reverse — while ants
 * that stray keep it changing. Without food, ants just roam.
 *
 * Ants walk at a steady speed, so a path's length on the canvas is the
 * time between its two notes: the drawing is the rhythm.
 *
 * Positions are in the unit square; speed is in square-widths per beat and
 * evaporation per beat, so a tempo change keeps the colony in proportion
 * with the song.
 *
 *   {
 *     nodes: [{ id, x, y, note }],
 *     paths: [[nodeId, nodeId]],   // two-way; one between any two nodes
 *     nest,                        // node id the ants live at, or null: no ants
 *     food,                        // node id they forage for, or null: they roam
 *     ants,                        // how many
 *     speed,                       // square-widths per beat
 *     evaporation,                 // share of scent that fades per beat
 *     adventure,                   // 0 = follow the scent … 1 = wander at random
 *     gate,                        // note length, in steps
 *     quantize,                    // 0 = free, else snap notes forward to this many steps
 *   }
 */

import { SongError } from './errors.js';
import { nextScaleNote } from './scale.js';

export const NODE_RADIUS = 0.035;
export const QUANTIZE = [0, 1, 2, 4];
export const ANT_LIMITS = Object.freeze({
  nodes: 16,
  paths: 40,
  ants: [1, 8],
  speed: [0.1, 4],
  evaporation: [0, 1],
  gate: [0.25, 8],
});

// C minor pentatonic, nest to food: the shortest routes climb a fifth or
// an octave, the longer ones wander through the rest.
const DEFAULT_NODES = [
  { id: 'n1', x: 0.14, y: 0.5, note: 60 },
  { id: 'n2', x: 0.38, y: 0.24, note: 63 },
  { id: 'n3', x: 0.36, y: 0.76, note: 65 },
  { id: 'n4', x: 0.63, y: 0.3, note: 67 },
  { id: 'n5', x: 0.62, y: 0.72, note: 70 },
  { id: 'n6', x: 0.86, y: 0.5, note: 72 },
];
const DEFAULT_PATHS = [['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n5'], ['n4', 'n6'], ['n5', 'n6'], ['n2', 'n5'], ['n4', 'n5']];

/** One string for a path, the same whichever end it's named from. */
export const pathKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** The note for a node added to this web: the next one up the scale, in the key of the nest. */
export function nextNote(config, keys = null) {
  const notes = config.nodes.map((n) => n.note);
  return nextScaleNote(notes, config.nodes.find((n) => n.id === config.nest)?.note ?? notes[0], keys);
}

/** Settings for a track that has just switched to ants; `keys` are its instrument's named notes, if any. */
export function defaultAnts(keys = null) {
  // A drum kit has no scale to climb; spread its sounds across the web instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    nodes: DEFAULT_NODES.map((n, i) => ({ ...n, note: drumNotes ? drumNotes[i % drumNotes.length] : n.note })),
    paths: DEFAULT_PATHS.map((p) => [...p]),
    nest: 'n1',
    food: 'n6',
    ants: 3,
    speed: 1,
    evaporation: 0.15,
    adventure: 0.2,
    gate: 1,
    quantize: 1,
  };
}

const ID = /^[a-z0-9]{1,24}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Validate one track's ant colony settings. Paths to missing nodes, and repeats, are dropped. */
export function normalizeAnts(a) {
  if (a == null) return null;
  if (!isObj(a)) throw new SongError('bad ant colony settings');
  const fallback = defaultAnts();
  const L = ANT_LIMITS;
  const r = NODE_RADIUS;

  if (a.nodes !== undefined && !Array.isArray(a.nodes)) throw new SongError('nodes must be a list');
  if ((a.nodes ?? []).length > L.nodes) throw new SongError(`too many nodes (max ${L.nodes})`);
  if (a.paths !== undefined && !Array.isArray(a.paths)) throw new SongError('paths must be a list');
  if ((a.paths ?? []).length > L.paths) throw new SongError(`too many paths (max ${L.paths})`);

  const ids = new Set();
  const nodes = (a.nodes ?? fallback.nodes)
    .filter((n) => isObj(n) && typeof n.id === 'string' && ID.test(n.id) && !ids.has(n.id) && ids.add(n.id))
    .map((n) => ({
      id: n.id,
      x: num(n.x, r, 1 - r, 0.5),
      y: num(n.y, r, 1 - r, 0.5),
      note: Math.round(num(n.note, 0, 127, 60)),
    }));

  const seen = new Set();
  const paths = (a.paths ?? (a.nodes ? [] : fallback.paths))
    .filter((p) => Array.isArray(p) && p.length === 2 && p[0] !== p[1] && ids.has(p[0]) && ids.has(p[1]))
    .filter((p) => !seen.has(pathKey(...p)) && seen.add(pathKey(...p)))
    .map(([from, to]) => [from, to]);

  const nest = ids.has(a.nest) ? a.nest : a.nodes ? null : fallback.nest;
  const food = ids.has(a.food) && a.food !== nest ? a.food : a.nodes ? null : fallback.food;

  return {
    nodes,
    paths,
    nest,
    food,
    ants: Math.round(num(a.ants, ...L.ants, fallback.ants)),
    speed: num(a.speed, ...L.speed, fallback.speed),
    evaporation: num(a.evaporation, ...L.evaporation, fallback.evaporation),
    adventure: num(a.adventure, 0, 1, fallback.adventure),
    gate: num(a.gate, ...L.gate, fallback.gate),
    quantize: QUANTIZE.includes(a.quantize) ? a.quantize : fallback.quantize,
  };
}
