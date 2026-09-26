/**
 * The visual side of a song, validated without importing gloaming-kit (which
 * is browser-only). Everything here is plain data the kit consumes as-is:
 *
 *   look:  the song's base style — { background, lineColor, accentColor,
 *          lineWidth, shadowBlur }
 *   each arrangement block may carry
 *     visuals: [{ id, viz, bind, options }]   kit timeline entries
 *     style:   partial look, overriding the song's from that block on,
 *              until a later block changes the same setting
 *
 * `bind` maps a visualization's input slots to signal specs, in the kit's
 * own closed spec language (see gloaming-kit src/signals.js). Visualization
 * ids and slot names aren't checked against the kit here; the kit ignores
 * ones it doesn't know, with a warning.
 */

import { SongError } from './errors.js';

// Mirrors of the kit's BANDS and DEFAULT_TRIGGERS names. The editor reads
// the real ones from the kit; these only bound what a saved song may name.
export const BAND_NAMES = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'treble'];
export const TRIGGER_NAMES = ['bass', 'snare', 'hihat'];

export const VISUAL_LIMITS = Object.freeze({ perBlock: 6, bindSlots: 16, options: 8, specDepth: 4, specParts: 8 });

export const STYLE_KEYS = {
  background: 'color',
  lineColor: 'color',
  accentColor: 'color',
  lineWidth: [0.5, 8],
  shadowBlur: [0, 40],
};

export const DEFAULT_LOOK = Object.freeze({
  background: '#0a0a12',
  lineColor: '#7fffd4',
  accentColor: '#ff5d8f',
  lineWidth: 2,
  shadowBlur: 0,
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
      if (rule === 'color' ? typeof v === 'string' && COLOR.test(v) : typeof v === 'number' && Number.isFinite(v)) {
        out[key] = rule === 'color' ? v.toLowerCase() : clampNum(v, ...rule);
      }
    }
  }
  if (complete) return { ...DEFAULT_LOOK, ...out };
  return Object.keys(out).length ? out : null;
}

const MODIFIERS = { smooth: [0, 5], curve: [0.1, 8], gain: [-10, 10], decay: [0.1, 50] };

/** A level or event spec, in the kit's closed language. Throws on anything else. */
export function normalizeSpec(spec, depth = 0) {
  if (depth > VISUAL_LIMITS.specDepth) throw new SongError('signal spec nested too deeply');
  if (typeof spec === 'number') {
    if (!Number.isFinite(spec)) throw new SongError('bad signal constant');
    return clampNum(spec, -10, 10);
  }
  if (typeof spec === 'string') {
    if (spec === 'rms' || BAND_NAMES.includes(spec) || TRIGGER_NAMES.includes(spec)) return spec;
    throw new SongError(`unknown signal '${spec.slice(0, 20)}'`);
  }
  if (Array.isArray(spec)) {
    if (spec.length > VISUAL_LIMITS.specParts) throw new SongError('signal sum too long');
    return spec.map((s) => normalizeSpec(s, depth + 1));
  }
  if (!isObj(spec)) throw new SongError('bad signal spec');

  const out = {};
  if (typeof spec.band === 'string' && BAND_NAMES.includes(spec.band)) out.band = spec.band;
  else if (typeof spec.trigger === 'string' && TRIGGER_NAMES.includes(spec.trigger)) out.trigger = spec.trigger;
  else if (typeof spec.const === 'number' && Number.isFinite(spec.const)) out.const = clampNum(spec.const, -10, 10);
  else if (Array.isArray(spec.sum) || Array.isArray(spec.max)) {
    const key = Array.isArray(spec.sum) ? 'sum' : 'max';
    if (spec[key].length > VISUAL_LIMITS.specParts) throw new SongError('signal list too long');
    out[key] = spec[key].map((s) => normalizeSpec(s, depth + 1));
  } else {
    throw new SongError('signal spec has no source');
  }
  for (const [key, range] of Object.entries(MODIFIERS)) {
    if (typeof spec[key] === 'number' && Number.isFinite(spec[key])) out[key] = clampNum(spec[key], ...range);
  }
  if (spec.clamp === true) out.clamp = true;
  return out;
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
    if (typeof value === 'string' && value.length <= 32) options[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) options[key] = value;
    else if (typeof value === 'boolean') options[key] = value;
  }
  return {
    id: typeof v.id === 'string' && /^[a-z0-9]{1,24}$/.test(v.id) ? v.id : newId(),
    viz: v.viz,
    bind,
    options,
  };
}

export function normalizeVisuals(list, newId) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new SongError('visuals must be a list');
  if (list.length > VISUAL_LIMITS.perBlock) throw new SongError(`too many visuals on one block (max ${VISUAL_LIMITS.perBlock})`);
  return list.map((v) => normalizeVisual(v, newId));
}
