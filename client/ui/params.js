import { describe, matches, sanitizeParams } from 'gloaming-instruments';
import { html } from '../lib.js';
import { instrumentKeys, groupApplies } from '../../shared/song.js';

/**
 * A module's display metadata (labels, units, groups, presets…), as the
 * library describes it. describe() builds fresh JSON each call, so cache it.
 */
const infoCache = new Map();
export function moduleInfo(M) {
  if (!infoCache.has(M)) infoCache.set(M, describe(M));
  return infoCache.get(M);
}

// What an instrument's keys are, and which of its groups of params apply,
// depend on the sampler bank it plays; song.js decides, so automation is
// pruned by the same rule the panels follow.
export { instrumentKeys };

/** The groups of a module's params that apply as these params set it up. */
export function moduleGroups(M, params) {
  const keys = instrumentKeys(M, params);
  return moduleInfo(M).groups.filter((group) => groupApplies(group, keys));
}

/**
 * A group's name for display: a section shaping one key of a kit is named
 * after the sound on it ('Sub kick'), not the slot it sits on ('Low tom').
 */
export const groupLabel = (group, keys) =>
  (group.notes?.length === 1 && keys?.[group.notes[0]]) || group.label;

// ---- values ------------------------------------------------------------------

const num3 = (v) => {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
};

/** A value for display: ms under a second, kHz over 1000 Hz, fractions as %, named marks by name. */
export function formatValue(spec, v) {
  if (spec.type === 'choice') return spec.labels?.[v] ?? v;
  if (spec.marks?.length) {
    const near = spec.marks.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a));
    return Math.abs(near.value - v) < 0.05 ? near.label : `≈ ${near.label}`;
  }
  const sign = spec.center != null && v > spec.center ? '+' : '';
  switch (spec.unit) {
    case 's': return v < 1 ? `${num3(v * 1000)} ms` : `${num3(v)} s`;
    case 'Hz': return v >= 1000 ? `${num3(v / 1000)} kHz` : `${num3(v)} Hz`;
    case '%': return `${Math.round(v * 100)}%`;
    case '×': return `×${num3(v)}`;
    case undefined: return sign + num3(v);
    default: return `${sign}${num3(v)} ${spec.unit}`;
  }
}

/** A number param's value at `x` along its range (0..1), following the schema's scale hint. */
export const toValue = (spec, x) => (spec.scale === 'log'
  ? spec.min * (spec.max / spec.min) ** x
  : spec.min + (spec.max - spec.min) * x);
/** Where a value sits along its param's range, 0..1: the inverse of toValue. */
export const toSlider = (spec, v) => (spec.scale === 'log'
  ? Math.log(v / spec.min) / Math.log(spec.max / spec.min)
  : (v - spec.min) / (spec.max - spec.min));

/** Every preset, plus the module's defaults as 'Default'. */
const presetsOf = (info) => ({ Default: {}, ...info.presets });

/** The preset these params exactly match, if any. */
function currentPreset(M, presets, params) {
  return Object.keys(presets).find((name) => {
    const full = sanitizeParams(M, presets[name]);
    return Object.entries(full).every(([k, v]) => params[k] === v);
  }) ?? '';
}

// ---- panel ---------------------------------------------------------------------

/**
 * Controls for any instrument or effect, built from the library's display
 * metadata — so a module added to the library gets a proper panel with no
 * app change. Params come in their groups, with graphs for groups that are
 * envelopes or filters, a preset menu, and readable names, values and
 * tooltips. Double-click a slider to reset it.
 *
 * `onChange(values)` receives the params to change, as { name: value }.
 * `compact` shows just the module's primary params, for collapsed cards.
 */
export function ParamPanel({ module: M, params, onChange, compact = false }) {
  const info = moduleInfo(M);
  const keys = instrumentKeys(M, params);
  const groups = moduleGroups(M, params);

  if (compact) {
    // Out of their groups, labels need the group to make sense: 'Kick tune', not 'Tune'.
    const primary = groups.flatMap((group) => group.params
      .filter((name) => info.params[name].primary)
      .map((name) => {
        const spec = info.params[name];
        const heading = groupLabel(group, keys);
        const label = spec.label.toLowerCase().startsWith(heading.toLowerCase())
          ? spec.label : `${heading} ${spec.label.toLowerCase()}`;
        return [name, { ...spec, label }];
      }));
    return html`
      <div class="params compact">
        ${primary.map(([name, spec]) => html`<${ParamRow} key=${name} name=${name} spec=${spec} params=${params} onChange=${onChange} />`)}
      </div>`;
  }

  const presets = presetsOf(info);
  const presetNames = Object.keys(presets);
  const preset = currentPreset(M, presets, params);
  // One group named like its module ('Filter' in a Filter) needs no heading.
  const headings = groups.length > 1;

  return html`
    <div class="params">
      ${presetNames.length > 1 && html`
        <label class="preset">
          <span>Preset</span>
          <select value=${preset} onChange=${(e) => e.target.value && onChange(sanitizeParams(M, presets[e.target.value]))}>
            ${!preset && html`<option value="" disabled>Custom</option>`}
            ${presetNames.map((name) => html`<option value=${name}>${name}</option>`)}
          </select>
        </label>`}
      ${groups.map((group) => html`
        <section class="group" key=${group.id}>
          ${headings && html`<h4>${groupLabel(group, keys)}</h4>`}
          <${RoleGraph} group=${group} params=${params} />
          ${group.params.map((name) => html`
            <${ParamRow} key=${name} name=${name} spec=${info.params[name]} params=${params} onChange=${onChange} />`)}
        </section>`)}
    </div>
  `;
}

function ParamRow({ name, spec, params, onChange }) {
  const value = params[name];
  const active = matches(spec.activeWhen, params);
  const set = (v) => onChange({ [name]: v });
  const tip = [spec.description, !active && 'Has no effect with the current settings.'].filter(Boolean).join(' ');

  let control;
  if (spec.type === 'choice' && spec.values.length <= 4) {
    // A few choices read better as buttons than hidden in a menu.
    control = html`
      <div class="segmented" role="radiogroup" aria-label=${spec.label}>
        ${spec.values.map((v) => html`
          <button type="button" role="radio" aria-checked=${v === value} class=${v === value ? 'on' : ''}
            onClick=${() => set(v)}>${spec.labels?.[v] ?? v}</button>`)}
      </div>`;
  } else if (spec.type === 'choice') {
    control = html`
      <select value=${value} onChange=${(e) => set(e.target.value)} aria-label=${spec.label}>
        ${spec.values.map((v) => html`<option value=${v}>${spec.labels?.[v] ?? v}</option>`)}
      </select>`;
  } else {
    // Named marks (and a center) become tick marks on the slider.
    const ticks = [...(spec.marks ?? []).map((m) => m.value), ...(spec.center != null ? [spec.center] : [])];
    const listId = ticks.length ? `ticks-${name}-${ticks.join('_')}` : undefined;
    const x = toSlider(spec, value);
    const c = spec.center != null ? toSlider(spec, spec.center) : 0;
    control = html`
      <input type="range" min="0" max="1000" value=${x * 1000} list=${listId} aria-label=${spec.label}
        class=${spec.center != null ? 'centered' : ''}
        style=${`--from: ${Math.min(x, c) * 100}%; --to: ${Math.max(x, c) * 100}%`}
        onInput=${(e) => set(toValue(spec, e.target.value / 1000))}
        onDblClick=${() => set(spec.default)} />
      ${listId && html`<datalist id=${listId}>${ticks.map((t) => html`<option value=${toSlider(spec, t) * 1000} />`)}</datalist>`}`;
  }

  return html`
    <div class=${`param ${spec.type} ${active ? '' : 'inactive'}`} title=${tip}>
      <span class="label">${spec.label}</span>
      ${control}
      ${spec.type === 'number' && html`<output>${formatValue(spec, value)}</output>`}
    </div>
  `;
}

// ---- role graphs ---------------------------------------------------------------
//
// A group's role says what it is, and its bind maps the role's slots to
// params (or fixed { value }s), so one drawing serves every module.

function RoleGraph({ group, params }) {
  const draw = { envelope: envelopePath, filter: filterPath }[group.role];
  if (!draw) return null;
  const slot = (name) => {
    const b = group.bind?.[name];
    return typeof b === 'string' ? params[b] : b?.value;
  };
  const d = draw(slot);
  return html`
    <svg class="graph" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
      <path class="fill" d=${`${d} L200,40 L0,40 Z`} />
      <path d=${d} />
    </svg>`;
}

// Stage widths on a square-root scale, so 2 ms and 2 s both stay visible.
function envelopePath(slot) {
  const w = (t) => Math.sqrt(t ?? 0);
  const a = w(slot('attack'));
  const d = w(slot('decay'));
  const r = w(slot('release'));
  const s = slot('sustain') ?? (slot('decay') == null ? 1 : 0);
  const hold = slot('release') == null ? 0 : 0.6;
  const end = a + d + hold + r;
  const scale = 200 / (end || 1);
  const y = (level) => 38 - level * 35;
  const pts = [[0, 0], [a, 1], [a + d, s], [a + d + hold, s], [end, 0]];
  // An envelope with no release holds its sustain level to the end.
  if (slot('release') == null) pts.pop();
  return 'M' + pts.map(([px, l]) => `${(px * scale).toFixed(1)},${y(l).toFixed(1)}`).join(' L');
}

// The browser's own biquad math, on a filter that's never connected.
let mathCtx;
const FREQS = Float32Array.from({ length: 100 }, (_, i) => 20 * 1000 ** (i / 99));
function filterPath(slot) {
  mathCtx ??= new OfflineAudioContext(1, 1, 44100);
  const biquad = new BiquadFilterNode(mathCtx, { type: slot('type') ?? 'lowpass', frequency: slot('cutoff'), Q: slot('resonance') ?? 1 });
  const mag = new Float32Array(FREQS.length);
  biquad.getFrequencyResponse(FREQS, mag, new Float32Array(FREQS.length));
  const y = (m) => Math.min(39, Math.max(1, 22 - 20 * Math.log10(m || 1e-6) * 0.6));
  return 'M' + [...mag].map((m, i) => `${(i * 200 / 99).toFixed(1)},${y(m).toFixed(1)}`).join(' L');
}
