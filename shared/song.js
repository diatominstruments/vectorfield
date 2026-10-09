import { registry, sanitizeParams } from 'gloaming-instruments';
import { SongError } from './errors.js';
import { DEFAULT_LOOK, normalizeStyle, normalizeVisuals } from './visuals.js';
import { normalizeBounce, defaultBounce } from './bounce.js';
import { normalizeTubules, defaultTubules } from './tubules.js';
import { normalizeAnts, defaultAnts } from './ants.js';
import { normalizeFireflies, defaultFireflies } from './fireflies.js';
import { normalizeBees, defaultBees } from './bees.js';
import { normalizeFrogs, defaultFrogs } from './frogs.js';
import { normalizeSandpile, defaultSandpile } from './sandpile.js';

export { SongError };

/**
 * The song document — everything a song is, stored as one JSON value:
 *
 *   {
 *     bpm: 120,
 *     tracks: [{ id, name, gain, mute,
 *                instrument: { id, version, params },
 *                effects: [{ uid, id, version, params }, ...] }],
 *     mix: { effects: [{ uid, id, version, params }, ...] },   // on the whole song
 *     patterns: [{ id, name, length,
 *                  notes: { [trackId]: [{ step, note, velocity, length }] },
 *                  sequencers: { [trackId]: 'bounce' | 'tubules' | 'ants' | 'fireflies'
 *                                           | 'bees' | 'frogs' | 'sandpile' },   // absent = steps
 *                  bounce: { [trackId]: { ... } },        // see bounce.js
 *                  tubules: { [trackId]: { ... } },       // see tubules.js
 *                  ants: { [trackId]: { ... } },          // see ants.js
 *                  fireflies: { [trackId]: { ... } },     // see fireflies.js
 *                  bees: { [trackId]: { ... } },          // see bees.js
 *                  frogs: { [trackId]: { ... } },         // see frogs.js
 *                  sandpile: { [trackId]: { ... } },      // see sandpile.js
 *                  automation: [{ id, track, effect?, param,
 *                                 points: [{ step, value }] }] }],
 *     arrangement: [{ id, pattern, visuals, style,     // blocks in play order
 *                     repeat, mute: [trackId], section,
 *                     follow: [{ to: blockId | null, weight }] }],
 *     loop: blockId | null,                            // where the song goes on from at its end
 *     look: { background, lineColor, ... },            // base visual style
 *   }
 *
 * Steps are sixteenth notes. `length` is in steps. Module entries use the
 * instrument library's own `{ id, version, params }` form, so any instrument
 * the library adds is storable here without changes. An effect entry also
 * carries a `uid`, unique in its chain, so automation can name one effect
 * however the chain is reordered.
 *
 * A pattern's automation lanes each sweep one number param of a track's
 * instrument, or with `effect` (a uid), of one of the track's effects,
 * through the pattern: `points` in step order, `value` in the param's own
 * units, with straight lines between them. Before the first point and
 * after the last the value holds; a lane with no points leaves the param
 * alone.
 *
 * An arrangement block plays one pattern; the same pattern may appear in any
 * number of blocks. A block also carries the visualizations shown while it
 * plays and an optional style override, which carries on through later
 * blocks until one changes the same setting — see visuals.js.
 *
 * A block plays its pattern `repeat` times, silencing the tracks in its
 * `mute`. A `section` name starts a section that runs until the next block
 * with one. When a block ends, the song goes on to the next block — or, if
 * the block has `follow` choices, to one of them picked at random by weight
 * (`to: null` ends the song). After the last block the song stops, unless
 * `loop` names a block to go back to.
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
  automationLanes: 4,    // per track, per pattern
  automationPoints: 64,  // per lane
  nameLength: 60,
  sectionLength: 40,
  repeat: 16,            // times a block plays its pattern
  follow: 8,             // choices for what plays after a block
  weight: 9,             // the most likely a choice can be
  bpm: [40, 300],
});

export const PATTERN_LENGTHS = [8, 16, 32, 64];

export const instrumentTypes = () =>
  [...registry.values()].filter((M) => M.kind === 'instrument');
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

export const newEffect = (effectId) => ({ uid: newId(), ...moduleEntry(effectId) });

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

export const SEQUENCERS = ['steps', 'bounce', 'tubules', 'ants', 'fireflies', 'bees', 'frogs', 'sandpile'];

/** The sequencers besides the step grid, each keeping its settings in a pattern field of its own name. */
export const GENERATIVE_SEQUENCERS = SEQUENCERS.filter((k) => k !== 'steps');

/**
 * Each track in a pattern picks its own sequencer: the step grid, bouncing
 * balls, microtubules, an ant colony, fireflies, bees, a frog chorus or a
 * sandpile. A track keeps its step
 * notes and the settings of every sequencer it has tried, whichever is
 * chosen, so switching back and forth never loses work.
 */
export function newPattern(name, length = 16) {
  return {
    id: newId(), name, length, notes: {}, sequencers: {},
    ...Object.fromEntries(GENERATIVE_SEQUENCERS.map((k) => [k, {}])),
    automation: [],
  };
}

/** Which sequencer a track uses in a pattern. */
export const sequencerOf = (pattern, trackId) => pattern.sequencers[trackId] ?? 'steps';

/**
 * The params of a module (instrument or effect) an automation lane can
 * sweep: numbers the library hasn't marked as rebuilding part of the graph.
 * Returns [name, spec] pairs.
 */
export function automatableParams(M) {
  return Object.entries(M.params).filter(([, spec]) => spec.type === 'number' && spec.automatable !== false);
}

/**
 * An instrument's keys, { note: label }, as these params set it up. A
 * sampler's sounds are the bank's it plays, which its static `keys` (the
 * default bank's) doesn't know. Null for instruments that play pitches.
 */
export function instrumentKeys(M, params) {
  const bank = M?.banks?.[params?.bank];
  return bank ? bank.keys : M?.keys ?? null;
}

/**
 * Whether a group of an instrument's params applies with these keys. A
 * sampler has a group for every sound in any of its banks; one shaping a
 * sound the bank it's playing doesn't have does nothing. Groups not tied
 * to a sound always apply.
 */
export const groupApplies = (group, keys) => !group.notes || !keys || group.notes.some((note) => note in keys);

/** The params of an instrument that do nothing as these params set it up: those for sounds its bank lacks. */
export function inapplicableParams(M, params) {
  const keys = instrumentKeys(M, params);
  return new Set((M.groups ?? []).filter((g) => !groupApplies(g, keys)).flatMap((g) => g.params));
}

/** The module entry a lane sweeps on its track: the instrument, or one effect; undefined once that effect is gone. */
export const laneTarget = (track, lane) =>
  (lane.effect ? track.effects.find((e) => e.uid === lane.effect) : track.instrument);

/**
 * A lane's value at `step` (fractional steps are fine): straight lines
 * between points, held flat before the first and after the last. Null for
 * a lane with no points.
 */
export function automationValue(points, step) {
  if (!points.length) return null;
  if (step <= points[0].step) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (step <= b.step) {
      const a = points[i - 1];
      return a.value + ((b.value - a.value) * (step - a.step)) / (b.step - a.step);
    }
  }
  return points.at(-1).value;
}

export function newBlock(patternId, visuals = []) {
  return { id: newId(), pattern: patternId, visuals, style: null, repeat: 1, mute: [], section: null, follow: [] };
}

export function newVisual(vizId) {
  return { id: newId(), viz: vizId, bind: {}, options: {} };
}

/**
 * A block's copy: same pattern, visuals, style and settings, fresh ids. The
 * copy continues its original's section rather than starting another.
 */
export function copyBlock(block) {
  return {
    ...structuredClone(block),
    id: newId(),
    visuals: block.visuals.map((v) => ({ ...structuredClone(v), id: newId() })),
    section: null,
  };
}

/**
 * Take a block out of the song, along with the loop and follow choices
 * that lead to it. Mutates `doc`.
 */
export function removeBlock(doc, index) {
  const [gone] = doc.arrangement.splice(index, 1);
  if (doc.loop === gone.id) doc.loop = null;
  for (const b of doc.arrangement) b.follow = b.follow.filter((f) => f.to !== gone.id);
}

/**
 * The index of the block that plays after block `index` has finished: one
 * of its follow choices, picked by weight with `random()` in [0, 1), or else
 * the next block; past the last block, the loop block. -1 when the song
 * ends there.
 */
export function nextBlock(song, index, random = Math.random) {
  const indexOf = (id) => song.arrangement.findIndex((b) => b.id === id);
  const choices = (song.arrangement[index]?.follow ?? []).filter((f) => f.to === null || indexOf(f.to) >= 0);
  if (choices.length) {
    let r = random() * choices.reduce((sum, f) => sum + f.weight, 0);
    const pick = choices.find((f) => (r -= f.weight) < 0) ?? choices.at(-1);
    return pick.to === null ? -1 : indexOf(pick.to);
  }
  if (index + 1 < song.arrangement.length) return index + 1;
  return song.loop ? indexOf(song.loop) : -1;
}

/**
 * How a song plays through: 'once' straight through, 'loops' forever from
 * its loop block, or 'varies' when follow choices pick the way.
 */
export function playOrder(song) {
  if (song.arrangement.some((b) => b.follow.length)) return 'varies';
  return song.loop && song.arrangement.some((b) => b.id === song.loop) ? 'loops' : 'once';
}

/**
 * The sections of the song, in order: runs of blocks that start at a block
 * with a section name and carry on until the next. Blocks before the first
 * name form an unnamed run. Returns [{ name, from, to }] with block indices,
 * `to` exclusive.
 */
export function sections(song) {
  const runs = [];
  song.arrangement.forEach((block, i) => {
    if (!runs.length || block.section) runs.push({ name: block.section, from: i, to: i + 1 });
    else runs.at(-1).to = i + 1;
  });
  return runs;
}

/** The section each block belongs to: its name, or null. */
export const sectionOf = (song, index) =>
  sections(song).find((s) => index >= s.from && index < s.to)?.name ?? null;

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

/**
 * The style overrides in effect during each block. Each setting a block
 * changes carries on through later blocks until one changes it again;
 * settings no block has changed yet come from the song look. Returns, per
 * block, the accumulated overrides, or null while there are none.
 */
export function stylesInEffect(song) {
  let current = null;
  return song.arrangement.map((block) => {
    if (block.style) current = { ...current, ...block.style };
    return current;
  });
}

/**
 * Start and end of each arrangement block, in seconds, laid end to end in
 * arrangement order with its repeats. A song that loops or follows choices
 * doesn't play in this order, but this is still where each block sits on
 * its timeline, and the engine's song time jumps around it.
 */
export function blockTimes(song) {
  const byId = new Map(song.patterns.map((p) => [p.id, p]));
  const stepSeconds = 60 / song.bpm / 4;
  let t = 0;
  return song.arrangement.map((block) => {
    const start = t;
    t += byId.get(block.pattern).length * (block.repeat ?? 1) * stepSeconds;
    return { start, end: t };
  });
}

/**
 * A fresh song: a blank canvas. No tracks and no visuals, just one empty
 * pattern placed once in the arrangement, ready to build on.
 */
export function defaultSong() {
  const pattern = newPattern('Pattern 1');
  return {
    bpm: 120,
    tracks: [],
    mix: { effects: [] },
    patterns: [pattern],
    arrangement: [newBlock(pattern.id)],
    loop: null,
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

// Songs saved before effects had uids get fresh ones, as does a uid used
// twice in one chain.
function effectChain(list, what) {
  const uids = new Set();
  return array(list, LIMITS.effectsPerTrack, what).map((e) => {
    const clean = module(e, 'effect');
    const uid = typeof e.uid === 'string' && ID.test(e.uid) && !uids.has(e.uid) ? e.uid : newId();
    uids.add(uid);
    return { uid, ...clean };
  });
}

// Each generative sequencer: where its settings live on a pattern, and how
// to clean or start them.
const GENERATIVE = {
  bounce: { normalize: normalizeBounce, fresh: defaultBounce },
  tubules: { normalize: normalizeTubules, fresh: defaultTubules },
  ants: { normalize: normalizeAnts, fresh: defaultAnts },
  fireflies: { normalize: normalizeFireflies, fresh: defaultFireflies },
  bees: { normalize: normalizeBees, fresh: defaultBees },
  frogs: { normalize: normalizeFrogs, fresh: defaultFrogs },
  sandpile: { normalize: normalizeSandpile, fresh: defaultSandpile },
};

// Returns { sequencers, ...settings }: the track → sequencer choices, and
// each generative sequencer's settings by track.
function normalizeSequencers(p, trackIds) {
  const sequencers = {};
  const settings = Object.fromEntries(GENERATIVE_SEQUENCERS.map((k) => [k, {}]));

  // Songs saved when the sequencer was chosen for the whole pattern held one
  // bounce config naming its track; it becomes that track's.
  if (isObj(p.bounce) && typeof p.bounce.track === 'string') {
    const { track, ...config } = p.bounce;
    if (trackIds.has(track)) {
      settings.bounce[track] = normalizeBounce(config);
      if (p.kind === 'bounce') sequencers[track] = 'bounce';
    }
    return { sequencers, ...settings };
  }

  for (const [kind, { normalize }] of Object.entries(GENERATIVE)) {
    for (const [trackId, config] of Object.entries(isObj(p[kind]) ? p[kind] : {})) {
      const clean = trackIds.has(trackId) ? normalize(config) : null;
      if (clean) settings[kind][trackId] = clean;
    }
  }
  for (const [trackId, kind] of Object.entries(isObj(p.sequencers) ? p.sequencers : {})) {
    if (!trackIds.has(trackId) || !Object.hasOwn(GENERATIVE, kind)) continue;
    sequencers[trackId] = kind;
    settings[kind][trackId] ??= GENERATIVE[kind].fresh();
  }
  return { sequencers, ...settings };
}

// Songs saved before patterns had automation have none. A lane goes if its
// track or effect has gone, or its param isn't one that module can sweep
// (the instrument was changed) or one for a sound its sampler bank doesn't
// have (the bank was changed); a second lane on the same param goes too.
// Points are kept in step order, one per step, inside the pattern.
function normalizeAutomation(lanes, length, trackOf) {
  const seen = new Set();
  const laneIds = new Set();
  const perTrack = new Map();
  return array(lanes ?? [], LIMITS.automationLanes * LIMITS.tracks, 'automation lanes')
    .filter((lane) => isObj(lane) && trackOf.has(lane.track))
    .filter((lane) => {
      const count = (perTrack.get(lane.track) ?? 0) + 1;
      if (count > LIMITS.automationLanes) throw new SongError(`too many automation lanes on one track (max ${LIMITS.automationLanes})`);
      perTrack.set(lane.track, count);
      return true;
    })
    .map((lane) => {
      const effect = typeof lane.effect === 'string' ? lane.effect : undefined;
      const entry = laneTarget(trackOf.get(lane.track), { effect });
      const M = entry && registry.get(entry.id);
      const spec = M && !inapplicableParams(M, entry.params).has(lane.param)
        && automatableParams(M).find(([n]) => n === lane.param)?.[1];
      const key = `${lane.track}:${effect ?? ''}:${lane.param}`;
      if (!spec || seen.has(key)) return null;
      seen.add(key);
      const laneId = typeof lane.id === 'string' && ID.test(lane.id) && !laneIds.has(lane.id) ? lane.id : newId();
      laneIds.add(laneId);
      const steps = new Set();
      const points = array(lane.points ?? [], LIMITS.automationPoints, 'automation points')
        .filter((pt) => isObj(pt) && Number.isInteger(pt.step) && pt.step >= 0 && pt.step <= length)
        .sort((a, b) => a.step - b.step)
        .filter((pt) => !steps.has(pt.step) && steps.add(pt.step))
        .map((pt) => ({ step: pt.step, value: num(pt.value, spec.min, spec.max, spec.default) }));
      return { id: laneId, track: lane.track, ...(effect && { effect }), param: lane.param, points };
    })
    .filter(Boolean);
}

/**
 * Bring every pattern's automation back in line after an edit that can
 * strand it: a track deleted, an instrument changed, an effect removed, a
 * pattern shortened. Mutates `doc`.
 */
export function pruneAutomation(doc) {
  const trackOf = new Map(doc.tracks.map((t) => [t.id, t]));
  for (const p of doc.patterns) p.automation = normalizeAutomation(p.automation, p.length, trackOf);
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
      effects: effectChain(t.effects ?? [], 'effects'),
    };
  });
  // Songs saved before the main mix had effects have no `mix`.
  const mix = {
    effects: effectChain(isObj(doc.mix) ? doc.mix.effects ?? [] : [], 'mix effects'),
  };
  const trackIds = new Set(tracks.map((t) => t.id));
  const trackOf = new Map(tracks.map((t) => [t.id, t]));
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
    const { sequencers, ...settings } = normalizeSequencers(p, trackIds);
    const automation = normalizeAutomation(p.automation, length, trackOf);
    return { id: id(p.id, 'pattern'), name: name(p.name, `Pattern ${i + 1}`), length, notes, sequencers, ...settings, automation };
  });
  const patternIds = new Set(patterns.map((p) => p.id));
  if (patternIds.size !== patterns.length) throw new SongError('duplicate pattern id');

  // Songs saved before blocks carried visuals stored bare pattern ids;
  // songs saved before blocks had repeats, mutes, sections and follow
  // choices get the defaults.
  const blockIds = new Set();
  const arrangement = array(doc.arrangement ?? [], LIMITS.arrangement, 'arrangement entries')
    .map((b) => (typeof b === 'string' ? newBlock(b) : b))
    .filter((b) => isObj(b) && patternIds.has(b.pattern))
    .map((b) => {
      const blockId = typeof b.id === 'string' && ID.test(b.id) && !blockIds.has(b.id) ? b.id : newId();
      blockIds.add(blockId);
      return {
        id: blockId,
        pattern: b.pattern,
        visuals: normalizeVisuals(b.visuals, newId),
        style: normalizeStyle(b.style),
        repeat: int(b.repeat, 1, LIMITS.repeat, 1),
        mute: [...new Set(Array.isArray(b.mute) ? b.mute : [])].filter((t) => trackIds.has(t)),
        section: typeof b.section === 'string' && b.section.trim() ? b.section.trim().slice(0, LIMITS.sectionLength) : null,
        follow: b.follow,
      };
    });
  // Follow choices can point anywhere in the arrangement, so they're
  // checked once every block's id is settled.
  for (const block of arrangement) {
    const seen = new Set();
    block.follow = array(block.follow ?? [], LIMITS.follow, 'follow choices')
      .filter((f) => isObj(f) && (f.to === null || blockIds.has(f.to)) && !seen.has(f.to) && seen.add(f.to))
      .map((f) => ({ to: f.to, weight: int(f.weight, 1, LIMITS.weight, 1) }));
  }

  return {
    bpm: num(doc.bpm, ...LIMITS.bpm, 120),
    tracks,
    mix,
    patterns,
    arrangement,
    loop: blockIds.has(doc.loop) ? doc.loop : null,
    look: normalizeStyle(doc.look, { complete: true }),
  };
}

export const MAX_SONG_BYTES = 512 * 1024;
