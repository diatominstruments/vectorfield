import { registry, sanitizeParams } from 'gloaming-instruments';

/**
 * The song document — everything a song is, stored as one JSON value:
 *
 *   {
 *     bpm: 120,
 *     tracks: [{ id, name, gain, mute,
 *                instrument: { id, version, params },
 *                effects: [{ id, version, params }, ...] }],
 *     patterns: [{ id, name, length,
 *                  notes: { [trackId]: [{ step, note, velocity, length }] } }],
 *     arrangement: [patternId, ...],   // the song view: patterns in play order
 *   }
 *
 * Steps are sixteenth notes. `length` is in steps. Module entries use the
 * instrument library's own `{ id, version, params }` form, so any instrument
 * the library adds is storable here without changes.
 *
 * Both sides run normalizeSong(): the client so the editor only ever holds
 * a valid song, the server because it can't trust the client.
 */

export const LIMITS = Object.freeze({
  tracks: 16,
  effectsPerTrack: 8,
  patterns: 64,
  arrangement: 512,
  notesPerTrack: 1024,   // per pattern
  nameLength: 60,
  bpm: [40, 300],
});

export const PATTERN_LENGTHS = [8, 16, 32, 64];

/** Instruments the app can't offer yet. The sampler needs a sample library. */
const UNAVAILABLE = new Set(['sampler']);

export const instrumentTypes = () =>
  [...registry.values()].filter((M) => M.kind === 'instrument' && !UNAVAILABLE.has(M.id));
export const effectTypes = () =>
  [...registry.values()].filter((M) => M.kind === 'effect');

/** 'mono-synth' → 'Mono Synth', for modules that don't name themselves. */
export const moduleLabel = (M) =>
  M.label ?? M.id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export const newId = () => Math.random().toString(36).slice(2, 10);

export class SongError extends Error {}

export function moduleEntry(id, params = {}) {
  const M = registry.get(id);
  if (!M) throw new SongError(`unknown module '${id}'`);
  return { id, version: M.version, params: sanitizeParams(M, params) };
}

export function newTrack(instrumentId, name) {
  return {
    id: newId(),
    name: name ?? moduleLabel(registry.get(instrumentId)),
    gain: 0.8,
    mute: false,
    instrument: moduleEntry(instrumentId),
    effects: [],
  };
}

export function newPattern(name, length = 16) {
  return { id: newId(), name, length, notes: {} };
}

/** A fresh song: drums, bass and keys, with a four-on-the-floor to start from. */
export function defaultSong() {
  const drums = newTrack('drum-synth', 'Drums');
  const bass = newTrack('mono-synth', 'Bass');
  const keys = newTrack('fm-synth', 'Keys');
  keys.effects.push(moduleEntry('reverb'));
  const pattern = newPattern('Pattern 1');
  pattern.notes[drums.id] = [0, 4, 8, 12].map((step) => ({ step, note: 36, velocity: 1, length: 1 }));
  return { bpm: 120, tracks: [drums, bass, keys], patterns: [pattern], arrangement: [pattern.id] };
}

// ---- validation ----------------------------------------------------------------

const ID = /^[a-z0-9]{1,24}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const int = (x, lo, hi, fallback) => Math.round(num(x, lo, hi, fallback));
const name = (x, fallback) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, LIMITS.nameLength) : fallback);

function array(x, max, what) {
  if (!Array.isArray(x)) throw new SongError(`${what} must be a list`);
  if (x.length > max) throw new SongError(`too many ${what} (max ${max})`);
  return x;
}

function id(x, what) {
  if (typeof x !== 'string' || !ID.test(x)) throw new SongError(`bad ${what} id`);
  return x;
}

function module(entry, kind) {
  if (!isObj(entry)) throw new SongError(`bad ${kind}`);
  const M = registry.get(entry.id);
  if (!M || M.kind !== kind) throw new SongError(`unknown ${kind} '${entry.id}'`);
  // Keep the saved version: it records what the song was made with, so a
  // later library change can be detected rather than silently applied.
  const version = Number.isInteger(entry.version) ? entry.version : M.version;
  return { id: M.id, version, params: sanitizeParams(M, entry.params) };
}

/**
 * Validate and clean a song document. Structural problems (wrong shapes, bad
 * ids, unknown modules, over the limits) throw SongError; out-of-range values
 * are clamped; dangling references (notes for deleted tracks, arrangement
 * entries for deleted patterns) are dropped.
 */
export function normalizeSong(doc) {
  if (!isObj(doc)) throw new SongError('song must be an object');

  const tracks = array(doc.tracks, LIMITS.tracks, 'tracks').map((t, i) => {
    if (!isObj(t)) throw new SongError('bad track');
    return {
      id: id(t.id, 'track'),
      name: name(t.name, `Track ${i + 1}`),
      gain: num(t.gain, 0, 1, 0.8),
      mute: t.mute === true,
      instrument: module(t.instrument, 'instrument'),
      effects: array(t.effects ?? [], LIMITS.effectsPerTrack, 'effects').map((e) => module(e, 'effect')),
    };
  });
  const trackIds = new Set(tracks.map((t) => t.id));
  if (trackIds.size !== tracks.length) throw new SongError('duplicate track id');

  const patterns = array(doc.patterns, LIMITS.patterns, 'patterns').map((p, i) => {
    if (!isObj(p)) throw new SongError('bad pattern');
    const length = PATTERN_LENGTHS.includes(p.length) ? p.length : 16;
    const notes = {};
    for (const [trackId, list] of Object.entries(isObj(p.notes) ? p.notes : {})) {
      if (!trackIds.has(trackId)) continue;
      notes[trackId] = array(list, LIMITS.notesPerTrack, 'notes')
        .filter((n) => isObj(n) && Number.isInteger(n.step) && n.step >= 0 && n.step < length)
        .map((n) => ({
          step: n.step,
          note: int(n.note, 0, 127, 60),
          velocity: num(n.velocity, 0, 1, 0.8),
          length: int(n.length, 1, length - n.step, 1),
        }));
    }
    return { id: id(p.id, 'pattern'), name: name(p.name, `Pattern ${i + 1}`), length, notes };
  });
  const patternIds = new Set(patterns.map((p) => p.id));
  if (patternIds.size !== patterns.length) throw new SongError('duplicate pattern id');

  const arrangement = array(doc.arrangement ?? [], LIMITS.arrangement, 'arrangement entries')
    .filter((pid) => patternIds.has(pid));

  return { bpm: num(doc.bpm, ...LIMITS.bpm, 120), tracks, patterns, arrangement };
}

export const MAX_SONG_BYTES = 512 * 1024;
