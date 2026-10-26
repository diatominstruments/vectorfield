/**
 * The visual side of a song, validated without importing gloaming-kit (which
 * is browser-only). Everything here is plain data the kit consumes as-is:
 *
 *   look:  the song's base style — { background, lineColor, accentColor,
 *          peakColor, palette, peakAbove, lineWidth, shadowBlur, halo,
 *          atmosphere }
 *   finish: the song's finishing pass — { preset, ...settings }; see
 *          normalizeFinish()
 *   each arrangement block may carry
 *     visuals: [{ id, viz, bind, options,      kit timeline entries
 *                 place?, clip?, blend?, opacity?, style?, transition?, fade?,
 *                 trail? }]
 *     style:   partial look, overriding the song's from that block on,
 *              until a later block changes the same setting
 *     transition, fade: how visuals come and go, also carried on from
 *              that block until a later block changes it (null: unset)
 *     finish:  a partial finish, carried on the same way; one that names a
 *              preset starts again from it
 *
 * `bind` maps a visualization's input slots to signal specs, in the kit's
 * own closed spec language (see gloaming-kit src/signals.js). Visualization
 * ids and slot names aren't checked against the kit here; the kit ignores
 * ones it doesn't know, with a warning.
 *
 * The optional entry fields are the kit's `universal` ones (gloaming-kit
 * src/placement.js): a region of the canvas, a clip shape, a blend mode, an
 * opacity (a number or a signal spec), a style of the entry's own over the
 * block's, and a transition and fade length that win over the block's. The
 * kit's `trail` (how much of each frame's drawing lingers into the next)
 * joins them. They're left out of a visual entirely while unset.
 */

import { SongError } from './errors.js';

// Mirrors of the kit's BANDS, DEFAULT_TRIGGERS, TIMING_TRIGGERS, CLIPS,
// BLENDS and TRANSITIONS. The editor reads the real ones from the kit; these
// only bound what a saved song may name.
export const BAND_NAMES = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'treble'];
export const TRIGGER_NAMES = ['sub', 'bass', 'tom', 'snare', 'clap', 'hihat', 'onset', 'loud', 'lull'];
// Fired by the song's timing rather than heard, and always available.
export const TIMING_TRIGGER_NAMES = ['beat', 'downbeat', 'phrase', 'section', 'drop'];
export const CLIP_NAMES = ['rect', 'circle', 'ellipse', 'left', 'right', 'top', 'bottom', 'none'];
export const BLEND_NAMES = [
  'source-over', 'source-in', 'source-out', 'source-atop',
  'destination-over', 'destination-in', 'destination-out', 'destination-atop',
  'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
];
export const TRANSITION_NAMES = ['fade', 'cut', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'iris'];
// The kit's lfo shapes and hold picks, which aren't exported.
export const LFO_SHAPES = ['sine', 'triangle', 'saw', 'square'];
export const HOLD_PICKS = ['random', 'impact', 'cycle', 'toggle'];
// Nor are these: measures of the sound's colour, read like a band; how a
// trigger envelope falls; and the moments of the song's timing that pulses
// and rises land on.
export const TIMBRE_NAMES = ['centroid', 'flatness'];
export const ENVELOPE_SHAPES = ['linear', 'exp', 'smooth', 'spring'];
export const MOMENTS = ['beat', 'bar', 'phrase', 'section', 'drop'];

export const VISUAL_LIMITS = Object.freeze({
  perBlock: 6, bindSlots: 16, options: 24, optionLength: 120, specDepth: 4, specParts: 8, gridSize: 32,
});

/** A placed region: fractions of the canvas, degrees, and a flip. Unset fields are the whole canvas. */
export const PLACE_DEFAULTS = Object.freeze({ x: 0, y: 0, w: 1, h: 1, rotate: 0, flip: 'none' });
const PLACE_RANGES = { x: [-1, 2], y: [-1, 2], w: [0.01, 2], h: [0.01, 2], rotate: [-180, 180] };
const FLIPS = ['x', 'y', 'xy'];

/** The most of each frame an entry's trail may keep: one that kept everything would never clear. */
export const MAX_TRAIL = 0.98;

/** Seconds a transition takes when nothing sets it (the kit's own default), and the most it may. */
export const DEFAULT_FADE = 0.6;
export const MAX_FADE = 10;

// 'color' is #rrggbb; 'color?' may also be null, which for peakColor means
// off (the kit draws no third colour). 'stops?' is a palette: PALETTE_STOPS
// colours from the low end of the ramp to the high, or null for none (the
// kit then ramps from lineColor to accentColor). Numbers are [min, max, step].
export const STYLE_KEYS = {
  background: 'color',
  lineColor: 'color',
  accentColor: 'color',
  peakColor: 'color?',
  palette: 'stops?',
  peakAbove: [0, 1, 0.05],
  lineWidth: [0.5, 8, 0.5],
  shadowBlur: [0, 40, 0.5],
  halo: [0, 1, 0.05],
  atmosphere: [0, 1, 0.05],
};
export const PALETTE_STOPS = [2, 7];

// The kit's own defaults, so a song that never sets them looks as it would.
export const DEFAULT_LOOK = Object.freeze({
  background: '#0a0a12',
  lineColor: '#7fffd4',
  accentColor: '#ff5d8f',
  peakColor: null,
  palette: null,
  peakAbove: 0.8,
  lineWidth: 2,
  shadowBlur: 0,
  halo: 1,
  atmosphere: 0.6,
});

const COLOR = /^#[0-9a-f]{6}$/i;
const VIZ_ID = /^[a-z0-9-]{1,40}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clampNum = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** A style patch: known keys only, colours as #rrggbb, numbers clamped. Null when empty. */
export function normalizeStyle(style, { complete = false } = {}) {
  const out = {};
  if (isObj(style)) {
    for (const [key, rule] of Object.entries(STYLE_KEYS)) {
      const v = style[key];
      if ((rule === 'color?' || rule === 'stops?') && v === null) out[key] = null;
      else if (rule === 'stops?') {
        const ok = Array.isArray(v) && v.length >= PALETTE_STOPS[0] && v.length <= PALETTE_STOPS[1]
          && v.every((c) => typeof c === 'string' && COLOR.test(c));
        if (ok) out[key] = v.map((c) => c.toLowerCase());
      } else if (typeof rule === 'string' ? typeof v === 'string' && COLOR.test(v) : typeof v === 'number' && Number.isFinite(v)) {
        out[key] = typeof rule === 'string' ? v.toLowerCase() : clampNum(v, rule[0], rule[1]);
      }
    }
  }
  if (complete) return { ...DEFAULT_LOOK, ...out };
  return Object.keys(out).length ? out : null;
}

// Numeric keys a spec object may carry, bounded. `decay` and `attack` shape
// a trigger envelope or pulse; `rate`-like keys belong to their source but
// are bounded here too.
const MODIFIERS = {
  smooth: [0, 5], curve: [0.1, 8], gain: [-10, 10], offset: [-10, 10], quantize: [0, 64], decay: [0.1, 50],
  phase: [0, 1], seed: [0, 9999], steps: [2, 64], initial: [-10, 10],
  attack: [0, 4], seconds: [0.05, 60], ease: [0.1, 8], release: [0, 10],
};
const COMBINERS = ['sum', 'max', 'min', 'mul'];
// Beats in a cycle of `beat`, or between numbered pulses.
const BEATS = [0.25, 64];
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isLevelName = (x) => x === 'rms' || BAND_NAMES.includes(x);
const isEventName = (x) => TRIGGER_NAMES.includes(x) || TIMING_TRIGGER_NAMES.includes(x);

/** A level or event spec, in the kit's closed language. Throws on anything else. */
export function normalizeSpec(spec, depth = 0) {
  if (depth > VISUAL_LIMITS.specDepth) throw new SongError('signal spec nested too deeply');
  if (typeof spec === 'number') {
    if (!Number.isFinite(spec)) throw new SongError('bad signal constant');
    return clampNum(spec, -10, 10);
  }
  if (typeof spec === 'string') {
    if (isLevelName(spec) || TIMBRE_NAMES.includes(spec) || isEventName(spec)) return spec;
    throw new SongError(`unknown signal '${spec.slice(0, 20)}'`);
  }
  if (Array.isArray(spec)) {
    if (spec.length > VISUAL_LIMITS.specParts) throw new SongError('signal sum too long');
    return spec.map((s) => normalizeSpec(s, depth + 1));
  }
  if (!isObj(spec)) throw new SongError('bad signal spec');

  const out = {};
  const combiner = COMBINERS.find((key) => Array.isArray(spec[key]));
  if (BAND_NAMES.includes(spec.band) || TIMBRE_NAMES.includes(spec.band)) out.band = spec.band;
  else if (isLevelName(spec.relative)) out.relative = spec.relative;
  else if (isLevelName(spec.intensity)) out.intensity = spec.intensity;
  else if (isEventName(spec.trigger)) {
    out.trigger = spec.trigger;
    if (ENVELOPE_SHAPES.includes(spec.shape)) out.shape = spec.shape;
  } else if (isNum(spec.const)) out.const = clampNum(spec.const, -10, 10);
  else if (combiner) {
    if (spec[combiner].length > VISUAL_LIMITS.specParts) throw new SongError('signal list too long');
    out[combiner] = spec[combiner].map((s) => normalizeSpec(s, depth + 1));
  } else if (isNum(spec.lfo)) {
    out.lfo = clampNum(spec.lfo, 0, 20);
    if (LFO_SHAPES.includes(spec.shape)) out.shape = spec.shape;
  } else if (spec.progress === true) {
    out.progress = true;
  } else if (isEventName(spec.hold)) {
    out.hold = spec.hold;
    // A pick is one of the named ways, or a level spec read at the hit.
    if (HOLD_PICKS.includes(spec.pick)) out.pick = spec.pick;
    else if (spec.pick !== undefined) out.pick = normalizeSpec(spec.pick, depth + 1);
  } else if (isNum(spec.beat)) {
    out.beat = clampNum(spec.beat, ...BEATS);
    if (LFO_SHAPES.includes(spec.shape)) out.shape = spec.shape;
  } else if (MOMENTS.includes(spec.pulse) || isNum(spec.pulse)) {
    out.pulse = isNum(spec.pulse) ? clampNum(spec.pulse, ...BEATS) : spec.pulse;
    if (spec.accent === true) out.accent = true;
  } else if (MOMENTS.includes(spec.rise)) {
    out.rise = spec.rise;
  } else if (spec.energy === true || spec.energy === 'section') {
    out.energy = spec.energy;
  } else {
    throw new SongError('signal spec has no source');
  }
  for (const [key, range] of Object.entries(MODIFIERS)) {
    if (isNum(spec[key])) out[key] = clampNum(spec[key], ...range);
  }
  if (spec.invert === true) out.invert = true;
  if (spec.clamp === true) out.clamp = true;
  return out;
}

const GRID_ROW = /^[\x20-\x7e]*$/;

/**
 * A `kind: 'grid'` option (a glyph drawing) as string rows, one character
 * per cell; rows given as number arrays become digit strings. Null if it
 * isn't a grid. The kit reads the characters; here they're only bounded.
 */
function normalizeGrid(value) {
  const max = VISUAL_LIMITS.gridSize;
  if (!Array.isArray(value) || !value.length || value.length > max) return null;
  const rows = value.map((row) => (Array.isArray(row)
    ? row.map((c) => (typeof c === 'number' && Number.isFinite(c) ? String(clampNum(Math.round(c), 0, 9)) : '.')).join('')
    : row));
  return rows.every((row) => typeof row === 'string' && row.length <= max && GRID_ROW.test(row)) ? rows : null;
}

function normalizeVisual(v, newId) {
  if (!isObj(v) || typeof v.viz !== 'string' || !VIZ_ID.test(v.viz)) throw new SongError('bad visual');
  const bind = {};
  const bindEntries = Object.entries(isObj(v.bind) ? v.bind : {});
  if (bindEntries.length > VISUAL_LIMITS.bindSlots) throw new SongError('too many bindings');
  for (const [slot, spec] of bindEntries) {
    if (KEY.test(slot)) bind[slot] = normalizeSpec(spec);
  }
  const options = {};
  const optionEntries = Object.entries(isObj(v.options) ? v.options : {});
  if (optionEntries.length > VISUAL_LIMITS.options) throw new SongError('too many options');
  for (const [key, value] of optionEntries) {
    if (!KEY.test(key)) continue;
    if (typeof value === 'string' && value.length <= VISUAL_LIMITS.optionLength) options[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) options[key] = value;
    else if (typeof value === 'boolean') options[key] = value;
    else if (Array.isArray(value)) {
      const grid = normalizeGrid(value);
      if (grid) options[key] = grid;
    }
  }
  const out = {
    id: typeof v.id === 'string' && /^[a-z0-9]{1,24}$/.test(v.id) ? v.id : newId(),
    viz: v.viz,
    bind,
    options,
  };
  const place = normalizePlace(v.place);
  if (place) out.place = place;
  if (CLIP_NAMES.includes(v.clip)) out.clip = v.clip;
  if (BLEND_NAMES.includes(v.blend) && v.blend !== 'source-over') out.blend = v.blend;
  if (isNum(v.opacity)) {
    if (v.opacity < 1) out.opacity = clampNum(v.opacity, 0, 1);
  } else if (v.opacity != null) {
    out.opacity = normalizeSpec(v.opacity);
  }
  const style = normalizeStyle(v.style);
  if (style) out.style = style;
  const transition = normalizeTransition(v.transition);
  if (transition) out.transition = transition;
  const fade = normalizeFade(v.fade);
  if (fade !== null) out.fade = fade;
  if (isNum(v.trail)) out.trail = clampNum(v.trail, 0, MAX_TRAIL);
  return out;
}

/** A region of the canvas, keeping only what differs from the whole of it. Null when that's nothing. */
export function normalizePlace(place) {
  if (!isObj(place)) return null;
  const out = {};
  for (const [key, range] of Object.entries(PLACE_RANGES)) {
    if (isNum(place[key]) && place[key] !== PLACE_DEFAULTS[key]) out[key] = clampNum(place[key], ...range);
  }
  if (FLIPS.includes(place.flip)) out.flip = place.flip;
  return Object.keys(out).length ? out : null;
}

/** A transition name the kit knows, or null. */
export const normalizeTransition = (t) => (TRANSITION_NAMES.includes(t) ? t : null);

/** A transition's length in seconds, or null. */
export const normalizeFade = (f) => (isNum(f) ? clampNum(f, 0, MAX_FADE) : null);

export function normalizeVisuals(list, newId) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new SongError('visuals must be a list');
  if (list.length > VISUAL_LIMITS.perBlock) throw new SongError(`too many visuals on one block (max ${VISUAL_LIMITS.perBlock})`);
  return list.map((v) => normalizeVisual(v, newId));
}

// ---- the finishing pass ------------------------------------------------------

// Mirrors of the kit's FINISH_PRESETS names and TONEMAPS. 'off' is ours: on
// the song it draws straight to the screen, on a block it leaves the frame
// alone (the kit's 'none').
export const FINISH_PRESET_NAMES = ['clean', 'neon', 'film', 'none', 'off'];
export const TONEMAP_NAMES = ['rolloff', 'agx', 'aces', 'none'];

// The kit's numeric finish settings, [min, max, step].
export const FINISH_KEYS = {
  bloom: [0, 3, 0.05],
  bloomThreshold: [0, 4, 0.05],
  bloomRadius: [0, 1, 0.05],
  headroom: [1, 8, 0.1],
  exposure: [0.1, 4, 0.05],
  saturation: [0, 2, 0.05],
  vignette: [0, 1, 0.01],
  grain: [0, 0.2, 0.005],
};

/** The kit's own default, so a song that never sets one looks as it would. */
export const DEFAULT_FINISH = Object.freeze({ preset: 'clean' });

/**
 * A finish: a preset and any settings changed from it, `{ preset?, tonemap?,
 * bloom?, … }`. Known keys only, numbers clamped. With `complete` (the
 * song's) it always names a preset; otherwise null when empty.
 */
export function normalizeFinish(finish, { complete = false } = {}) {
  const out = {};
  if (isObj(finish)) {
    if (FINISH_PRESET_NAMES.includes(finish.preset)) out.preset = finish.preset;
    if (TONEMAP_NAMES.includes(finish.tonemap)) out.tonemap = finish.tonemap;
    for (const [key, [lo, hi]] of Object.entries(FINISH_KEYS)) {
      if (isNum(finish[key])) out[key] = clampNum(finish[key], lo, hi);
    }
  }
  if (complete) return { preset: DEFAULT_FINISH.preset, ...out };
  return Object.keys(out).length ? out : null;
}
