/**
 * The microtubule sequencer, modelled on dynamic instability: tubules grow
 * out from a centre (the centrosome) into a round cell, and each one
 * randomly flips between growing and collapsing. The cell is divided into
 * zones — concentric rings, each cut into equal sections like slices of a
 * pie — and every zone is tuned to a note. Tubules grow in straight lines,
 * so each stays in one section all its life and only moves between rings,
 * while tubules pointing different ways play different notes. Like the
 * bouncing balls it's chosen per track within a pattern and stored under
 * that track's id (see song.js).
 *
 * Rings are numbered from the centre out and share the space between the
 * core and the cell edge equally; sections are numbered clockwise from
 * twelve o'clock. One radius, with four rings:
 *
 *     centre  core │ ring 0 │ ring 1 │ ring 2 │ ring 3 │ edge
 *       0     CORE                                       1
 *
 * What sounds, by `sound`:
 *   'tip'     a growing tubule sounds the zone its tip is in; collapsing ones are silent
 *   'whole'   a tubule sounds every zone it passes through, as a chord, as
 *             long as it reaches into them — collapsing, its notes drop out
 *             from the outside in
 *
 * Distances are in cell radii (the edge is 1) and rates are per beat, so a
 * tempo change keeps the drone in proportion with the song. The switches
 * are Poisson processes, so `catastrophe`, `rescue` and `nucleation` are
 * the chance per beat of each event — their inverses are the average
 * waits. A tubule that reaches the edge stalls there, still sounding, until
 * a catastrophe.
 *
 *   {
 *     sections,      // 1, 2, 3, 4 or 6 zones per ring
 *     rings: [[MIDI note per section]],   // 1–8 rings, from the centre outwards
 *     sound,         // 'tip' | 'whole', above
 *     count,         // most tubules alive at once
 *     growth,        // growing speed, radii per beat
 *     shrink,        // collapsing speed, radii per beat (in cells, much faster than growth)
 *     catastrophe,   // chance per beat that a growing tubule starts to collapse
 *     rescue,        // chance per beat that a collapsing one starts growing again
 *     nucleation,    // chance per beat, per free slot, that a new tubule starts
 *     hold,          // true: notes sound for as long as the tubule reaches the zone
 *     gate,          // otherwise: each ring a tip grows into plays notes this many steps long
 *   }
 */

import { SongError } from './errors.js';

export const CORE = 0.08;   // centrosome radius: tips inside it are in no ring yet
export const SECTIONS = [1, 2, 3, 4, 6];
export const SOUNDS = ['tip', 'whole'];
export const TUBULE_LIMITS = Object.freeze({
  rings: [1, 8],
  count: [1, 16],
  growth: [0.01, 0.5],
  shrink: [0.02, 2],
  catastrophe: [0, 0.5],
  rescue: [0, 1],
  nucleation: [0.02, 2],
  gate: [0.25, 16],
});

// Everything from C minor pentatonic plus the ninth, so any mix of zones
// agrees: low and open in the middle, where every tubule passes, rising
// towards the edge that fewer reach. Sections clockwise from the top.
const DEFAULT_RINGS = [
  [48, 51, 55, 46],
  [55, 58, 62, 60],
  [63, 67, 70, 65],
];

/** Which ring a tip `length` out from the centre is in, or -1 inside the core. */
export function ringAt(length, rings) {
  if (length < CORE) return -1;
  return Math.min(rings - 1, Math.floor(((length - CORE) / (1 - CORE)) * rings));
}

/** The distance from the centre where ring `i` of `rings` begins. */
export const ringStart = (i, rings) => CORE + (i / rings) * (1 - CORE);

/** Which section a tubule at `angle` (radians, clockwise from three o'clock, as on a canvas) is in. */
export function sectionAt(angle, sections) {
  const turn = (((angle + Math.PI / 2) / (2 * Math.PI)) % 1 + 1) % 1;
  return Math.min(sections - 1, Math.floor(turn * sections));
}

/** Where section `i` of `sections` begins, as a canvas angle. */
export const sectionStart = (i, sections) => (i / sections) * 2 * Math.PI - Math.PI / 2;

/**
 * One ring's notes re-cut into `sections`: each new section takes the note
 * of the old one under its middle, so the tuning stays where it was.
 */
export function resection(ring, sections) {
  return Array.from({ length: sections }, (_, i) => ring[Math.floor(((i + 0.5) / sections) * ring.length)]);
}

/** Settings for a track that has just switched to microtubules; `keys` are its instrument's named notes, if any. */
export function defaultTubules(keys = null) {
  // A drum kit has no chord to stack; spread its sounds across the zones instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    sections: 4,
    rings: drumNotes
      ? DEFAULT_RINGS.map((ring, r) => ring.map((_, s) => drumNotes[(r * ring.length + s) % drumNotes.length]))
      : DEFAULT_RINGS.map((ring) => [...ring]),
    sound: 'tip',
    count: 5,
    growth: 0.08,
    shrink: 0.4,
    catastrophe: 0.06,
    rescue: 0.1,
    nucleation: 0.25,
    hold: !drumNotes,
    gate: 4,
  };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const note = (n) => Math.round(num(n, 0, 127, 60));

/** Validate one track's microtubule settings. */
export function normalizeTubules(t) {
  if (t == null) return null;
  if (!isObj(t)) throw new SongError('bad microtubule settings');
  const fallback = defaultTubules();
  const L = TUBULE_LIMITS;

  // Rings without a section count were saved before rings had sections: one each.
  const sections = SECTIONS.includes(t.sections) ? t.sections : t.rings?.length ? 1 : fallback.sections;
  if (t.rings !== undefined && !Array.isArray(t.rings)) throw new SongError('rings must be a list');
  if ((t.rings?.length ?? 0) > L.rings[1]) throw new SongError(`too many rings (max ${L.rings[1]})`);
  // Settings saved before rings had sections held one note per ring.
  const rings = t.rings?.length
    ? t.rings.map((ring) => {
      const notes = Array.isArray(ring) && ring.length ? ring.map(note) : [note(ring)];
      return notes.length === sections ? notes : resection(notes, sections);
    })
    : fallback.rings.map((ring) => resection(ring, sections));

  return {
    sections,
    rings,
    sound: SOUNDS.includes(t.sound) ? t.sound : 'tip',
    count: Math.round(num(t.count, ...L.count, fallback.count)),
    growth: num(t.growth, ...L.growth, fallback.growth),
    shrink: num(t.shrink, ...L.shrink, fallback.shrink),
    catastrophe: num(t.catastrophe, ...L.catastrophe, fallback.catastrophe),
    rescue: num(t.rescue, ...L.rescue, fallback.rescue),
    nucleation: num(t.nucleation, ...L.nucleation, fallback.nucleation),
    hold: t.hold !== false,
    gate: num(t.gate, ...L.gate, fallback.gate),
  };
}
