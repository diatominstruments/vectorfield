import { registry, sanitizeParams } from 'gloaming-instruments';
import { SongError } from './errors.js';
import { DEFAULT_LOOK, normalizeStyle, normalizeVisuals } from './visuals.js';
import { normalizeBounce, defaultBounce } from './bounce.js';

export { SongError };

/**
 * The song document — everything a song is, stored as one JSON value:
 *
 *   {
 *     bpm: 120,
 *     tracks: [{ id, name, gain, mute,
 *                instrument: { id, version, params },
 *                effects: [{ id, version, params }, ...] }],
 *     mix: { effects: [{ id, version, params }, ...] },   // on the whole song
 *     patterns: [{ id, name, length,
 *                  notes: { [trackId]: [{ step, note, velocity, length }] },
 *                  sequencers: { [trackId]: 'bounce' },   // absent = steps
 *                  bounce: { [trackId]: { ... } } }],     // see bounce.js
 *     arrangement: [{ id, pattern, visuals, style }],   // blocks in play order
 *     look: { background, lineColor, ... },            // base visual style
 *   }
 *
 * Steps are sixteenth notes. `length` is in steps. Module entries use the
 * instrument library's own `{ id, version, params }` form, so any instrument
 * the library adds is storable here without changes.
 *
 * An arrangement block plays one pattern; the same pattern may appear in any
 * number of blocks. A block also carries the visualizations shown while it
 * plays and an optional style override — see visuals.js.
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

export const SEQUENCERS = ['steps', 'bounce'];

/**
 * Each track in a pattern picks its own sequencer: the step grid, or
 * bouncing balls. A track keeps both its step notes and its bounce settings
 * whichever is chosen, so switching back and forth never loses work.
 */
export function newPattern(name, length = 16) {
  return { id: newId(), name, length, notes: {}, sequencers: {}, bounce: {} };
}

/** Which sequencer a track uses in a pattern. */
export const sequencerOf = (pattern, trackId) => pattern.sequencers[trackId] ?? 'steps';

export function newBlock(patternId, visuals = []) {
  return { id: newId(), pattern: patternId, visuals, style: null };
}

export function newVisual(vizId) {
  return { id: newId(), viz: vizId, bind: {}, options: {} };
}

/** A block's copy: same pattern, visuals and style, fresh ids. */
export function copyBlock(block) {
  return {
    ...structuredClone(block),
    id: newId(),
    visuals: block.visuals.map((v) => ({ ...structuredClone(v), id: newId() })),
  };
}

/**
 * The visuals on screen during each block. A block with none of its own
 * continues the most recent block that has some, so a section keeps its
 * visuals until the next block that sets new ones. Returns, per block,
 * `{ visuals, source }`: the list in effect and the index of the block it
 * belongs to (-1 before any block has visuals).
 */
export function visualsInEffect(song) {
  let current = { visuals: [], source: -1 };
  return song.arrangement.map((block, i) => {
    if (block.visuals.length) current = { visuals: block.visuals, source: i };
    return current;
  });
}

/** Start and end of each arrangement block, in seconds. */
export function blockTimes(song) {
  const byId = new Map(song.patterns.map((p) => [p.id, p]));
  const stepSeconds = 60 / song.bpm / 4;
  let t = 0;
  return song.arrangement.map((block) => {
    const start = t;
    t += byId.get(block.pattern).length * stepSeconds;
    return { start, end: t };
  });
}

/** A fresh song: drums, bass and keys, with a four-on-the-floor to start from. */
export function defaultSong() {
  const drums = newTrack('drum-synth', 'Drums');
  const bass = newTrack('mono-synth', 'Bass');
  const keys = newTrack('fm-synth', 'Keys');
  keys.effects.push(moduleEntry('reverb'));
  const pattern = newPattern('Pattern 1');
  pattern.notes[drums.id] = [0, 4, 8, 12].map((step) => ({ step, note: 36, velocity: 1, length: 1 }));
  return {
    bpm: 120,
    tracks: [drums, bass, keys],
    mix: { effects: [] },
    patterns: [pattern],
    arrangement: [newBlock(pattern.id, [newVisual('eq-bars')])],
    look: { ...DEFAULT_LOOK },
  };
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

function normalizeSequencers(p, trackIds) {
  const sequencers = {};
  const bounce = {};

  // Songs saved when the sequencer was chosen for the whole pattern held one
  // bounce config naming its track; it becomes that track's.
  if (isObj(p.bounce) && typeof p.bounce.track === 'string') {
    const { track, ...config } = p.bounce;
    if (trackIds.has(track)) {
      bounce[track] = normalizeBounce(config);
      if (p.kind === 'bounce') sequencers[track] = 'bounce';
    }
    return { sequencers, bounce };
  }

  for (const [trackId, config] of Object.entries(isObj(p.bounce) ? p.bounce : {})) {
    const clean = trackIds.has(trackId) ? normalizeBounce(config) : null;
    if (clean) bounce[trackId] = clean;
  }
  for (const [trackId, kind] of Object.entries(isObj(p.sequencers) ? p.sequencers : {})) {
    if (!trackIds.has(trackId) || kind !== 'bounce') continue;
    sequencers[trackId] = 'bounce';
    bounce[trackId] ??= defaultBounce();
  }
  return { sequencers, bounce };
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
  // Songs saved before the main mix had effects have no `mix`.
  const mix = {
    effects: array(isObj(doc.mix) ? doc.mix.effects ?? [] : [], LIMITS.effectsPerTrack, 'mix effects')
      .map((e) => module(e, 'effect')),
  };
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
    const { sequencers, bounce } = normalizeSequencers(p, trackIds);
    return { id: id(p.id, 'pattern'), name: name(p.name, `Pattern ${i + 1}`), length, notes, sequencers, bounce };
  });
  const patternIds = new Set(patterns.map((p) => p.id));
  if (patternIds.size !== patterns.length) throw new SongError('duplicate pattern id');

  // Songs saved before blocks carried visuals stored bare pattern ids.
  const blockIds = new Set();
  const arrangement = array(doc.arrangement ?? [], LIMITS.arrangement, 'arrangement entries')
    .map((b) => (typeof b === 'string' ? newBlock(b) : b))
    .filter((b) => isObj(b) && patternIds.has(b.pattern))
    .map((b) => {
      const blockId = typeof b.id === 'string' && ID.test(b.id) && !blockIds.has(b.id) ? b.id : newId();
      blockIds.add(blockId);
      return { id: blockId, pattern: b.pattern, visuals: normalizeVisuals(b.visuals, newId), style: normalizeStyle(b.style) };
    });

  return {
    bpm: num(doc.bpm, ...LIMITS.bpm, 120),
    tracks,
    mix,
    patterns,
    arrangement,
    look: normalizeStyle(doc.look, { complete: true }),
  };
}

export const MAX_SONG_BYTES = 512 * 1024;
