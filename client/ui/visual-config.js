import { BANDS, DEFAULT_TRIGGERS, catalog, describe } from 'gloaming-kit';
import { html } from '../lib.js';
import { NO_3D_HINT, needs3D } from '../three.js';
import { STYLE_KEYS, DEFAULT_LOOK } from '../../shared/visuals.js';

// ---- names -------------------------------------------------------------------

/** A visualization's display name, from the kit's metadata; 'Unknown' if the kit lacks it. */
export const vizLabel = (id) => describe(id)?.label ?? 'Unknown';

const BAND_LABELS = {
  subBass: 'Sub bass', bass: 'Bass', lowMid: 'Low mids', mid: 'Mids', highMid: 'High mids', treble: 'Treble',
};
const bandLabel = (b) => BAND_LABELS[b] ?? b;
const TRIGGERS = DEFAULT_TRIGGERS.map((t) => t.name);
const triggerLabel = (t) => ({ bass: 'Bass hit', snare: 'Snare hit', hihat: 'Hi-hat hit' }[t] ?? `${t} hit`);

const STYLE_LABELS = {
  background: 'Background', lineColor: 'Line', accentColor: 'Accent', lineWidth: 'Line width', shadowBlur: 'Glow',
};

// ---- level specs ↔ form ----------------------------------------------------------
//
// The kit's spec language can express more than these controls do (sums,
// maxes, curves). Anything the form can't represent shows as "Custom" and
// is left untouched unless the user picks something else.

function readLevel(spec) {
  if (typeof spec === 'string') {
    if (spec === 'rms') return { source: 'rms' };
    if (spec in BANDS) return { source: `band:${spec}` };
  }
  if (typeof spec === 'number') return { source: 'const', value: spec };
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const mods = { gain: spec.gain ?? 1, smooth: spec.smooth ?? 0 };
    if (spec.band) return { source: `band:${spec.band}`, ...mods };
    if (spec.trigger) return { source: `trigger:${spec.trigger}`, ...mods, decay: spec.decay ?? 3 };
    if (spec.const !== undefined) return { source: 'const', value: spec.const };
    if (Array.isArray(spec.sum) && spec.sum.length === 1 && spec.sum[0] === 'rms') return { source: 'rms', ...mods };
  }
  return { source: 'custom' };
}

function writeLevel(form) {
  const [kind, name] = form.source.split(':');
  if (kind === 'const') return { const: form.value ?? 0.5 };
  const mods = {};
  if (form.gain !== undefined && form.gain !== 1) mods.gain = form.gain;
  if (form.smooth) mods.smooth = form.smooth;
  if (kind === 'band') return { band: name, ...mods };
  if (kind === 'trigger') return { trigger: name, decay: form.decay ?? 3, ...mods };
  if (kind === 'rms') return Object.keys(mods).length ? { sum: ['rms'], ...mods } : 'rms';
  return null;
}

function describeLevel(spec) {
  const { source } = readLevel(spec);
  const [kind, name] = source.split(':');
  if (kind === 'band') return bandLabel(name);
  if (kind === 'trigger') return triggerLabel(name);
  if (kind === 'rms') return 'Loudness';
  if (kind === 'const') return 'Constant';
  return 'Custom';
}

const eventName = (spec) => (typeof spec === 'string' ? spec : spec?.trigger);

// ---- controls ----------------------------------------------------------------

function Slider({ label, min, max, step = 0.01, value, unit = '', onInput }) {
  return html`
    <label class="slider">
      <span>${label}</span>
      <input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onInput(Number(e.target.value))} />
      <output>${Number(value).toFixed(step < 0.1 ? 2 : 1)}${unit}</output>
    </label>`;
}

function LevelSlot({ slot, def, spec, onChange }) {
  const bound = spec !== undefined;
  const form = bound ? readLevel(spec) : null;
  const change = (patch) => onChange(writeLevel({ ...form, ...patch }));

  const pick = (source) => {
    if (source === 'default') return onChange(undefined);
    if (source === 'custom') return;
    onChange(writeLevel({ source }));
  };

  return html`
    <div class="slot">
      <label class="slot-head">
        <span class="slot-name">${slot}</span>
        <select value=${bound ? form.source : 'default'} aria-label=${`${slot} source`} onChange=${(e) => pick(e.target.value)}>
          <option value="default">Default (${describeLevel(def.default)})</option>
          <optgroup label="Frequency band">
            ${Object.keys(BANDS).map((b) => html`<option value=${`band:${b}`}>${bandLabel(b)}</option>`)}
          </optgroup>
          <option value="rms">Loudness</option>
          <optgroup label="Hit envelope">
            ${TRIGGERS.map((t) => html`<option value=${`trigger:${t}`}>${triggerLabel(t)}</option>`)}
          </optgroup>
          <option value="const">Constant</option>
          ${bound && form.source === 'custom' && html`<option value="custom">Custom</option>`}
        </select>
      </label>
      ${bound && form.source === 'const' && html`
        <${Slider} label="value" min="0" max="1" value=${form.value ?? 0.5} onInput=${(value) => change({ value })} />`}
      ${bound && !['const', 'custom'].includes(form.source) && html`
        <${Slider} label="gain" min="0" max="3" value=${form.gain ?? 1} onInput=${(gain) => change({ gain })} />
        <${Slider} label="smooth" min="0" max="0.5" value=${form.smooth ?? 0} unit="s" onInput=${(smooth) => change({ smooth })} />`}
      ${bound && form.source.startsWith('trigger:') && html`
        <${Slider} label="decay" min="0.5" max="12" step="0.1" value=${form.decay ?? 3} unit="/s" onInput=${(decay) => change({ decay })} />`}
    </div>`;
}

function EventSlot({ slot, def, spec, onChange }) {
  return html`
    <div class="slot">
      <label class="slot-head">
        <span class="slot-name">${slot}</span>
        <select value=${spec === undefined ? 'default' : eventName(spec)} aria-label=${`${slot} trigger`}
          onChange=${(e) => onChange(e.target.value === 'default' ? undefined : e.target.value)}>
          <option value="default">Default (${triggerLabel(eventName(def.default))})</option>
          ${TRIGGERS.map((t) => html`<option value=${t}>${triggerLabel(t)}</option>`)}
        </select>
      </label>
    </div>`;
}

/**
 * One declared option, as the kit describes it: an enum, or a free-form
 * string or number. Clearing it (empty string) falls back to the
 * visualization's own default.
 */
function OptionField({ name, def, value, onChange }) {
  if (def.kind === 'enum') {
    return html`
      <label class="field">
        <span>${name}</span>
        <select value=${value ?? ''} onChange=${(e) => onChange(e.target.value)}>
          <option value="">Default${def.default !== undefined ? ` (${def.default})` : ''}</option>
          ${def.values.map((v) => html`<option value=${v}>${v}</option>`)}
        </select>
      </label>`;
  }
  if (def?.kind === 'number') {
    const { min = 0, max = 1, step = 0.01 } = def;
    const shown = value ?? def.default ?? min;
    return html`
      <label class="field">
        <span>${name}</span>
        <input type="range" min=${min} max=${max} step=${step} value=${shown} onInput=${(e) => onChange(Number(e.target.value))} />
        <output>${Number(shown).toFixed(step < 0.1 ? 2 : 1)}</output>
        <button class="ghost reset" disabled=${value === undefined} onClick=${(e) => { e.preventDefault(); onChange(''); }}
          title="Use the default">↺</button>
      </label>`;
  }
  if (def?.kind === 'string') {
    return html`
      <label class="field">
        <span>${name}</span>
        <input type="text" value=${value ?? ''} placeholder=${def.default ?? ''} maxLength=${Math.min(def.maxLength ?? 32, 32)}
          onInput=${(e) => onChange(e.target.value)} />
      </label>`;
  }
  return null;
}

/**
 * Settings for one visualization instance: its type, what drives each of
 * its declared input slots, and its declared options. Generated from the
 * kit's own description of the visualization, so kit additions need no
 * changes here.
 */
export function VisualPanel({ visual, blockLabel, onChange, onRemove, onMove, canMove }) {
  const info = describe(visual.viz);

  const setBind = (slot, spec) => onChange((v) => {
    if (spec === undefined || spec === null) delete v.bind[slot];
    else v.bind[slot] = spec;
  });
  const setOption = (key, value) => onChange((v) => {
    if (value === '') delete v.options[key];
    else v.options[key] = value;
  });

  const inputs = info?.inputs ?? [];
  const options = info?.options ?? [];

  return html`
    <div class="panel visual-panel">
      <header>
        <h3>${vizLabel(visual.viz)} <small>${blockLabel}</small></h3>
        <div class="panel-actions">
          <button class="ghost" disabled=${!canMove.left} onClick=${() => onMove(-1)} aria-label="Move earlier (drawn below)">←</button>
          <button class="ghost" disabled=${!canMove.right} onClick=${() => onMove(1)} aria-label="Move later (drawn on top)">→</button>
          <button class="ghost danger" onClick=${onRemove}>Remove</button>
        </div>
      </header>

      <label class="field">
        <span>Visualization</span>
        <select value=${visual.viz} onChange=${(e) => { const viz = e.target.value; onChange((v) => { v.viz = viz; v.bind = {}; v.options = {}; }); }}>
          ${!info && html`<option value=${visual.viz}>Unknown (${visual.viz})</option>`}
          ${catalog().map((group) => html`
            <optgroup label=${group.label}>
              ${group.visualizations.map((d) => html`
                <option value=${d.id} disabled=${needs3D(d.id) && d.id !== visual.viz}>${d.label}${needs3D(d.id) ? ' (needs 3D)' : ''}</option>`)}
            </optgroup>`)}
        </select>
      </label>
      ${info?.description && html`<p class="hint muted">${info.description}</p>`}

      ${!info && html`<p class="error">This visualization isn't in the installed gloaming-kit.</p>`}
      ${needs3D(visual.viz) && html`<p class="hint muted">${NO_3D_HINT} ${info.fallback
        ? `Showing ${vizLabel(info.fallback)} in its place.`
        : 'It has no 2D version, so nothing is drawn in its place.'}</p>`}

      ${inputs.length > 0 && html`
        <h4>Driven by</h4>
        ${inputs.map((def) => (def.kind === 'event'
          ? html`<${EventSlot} key=${def.name} slot=${def.name} def=${def} spec=${visual.bind[def.name]} onChange=${(s) => setBind(def.name, s)} />`
          : html`<${LevelSlot} key=${def.name} slot=${def.name} def=${def} spec=${visual.bind[def.name]} onChange=${(s) => setBind(def.name, s)} />`))}`}
      ${info && inputs.length === 0 && html`<p class="muted">This visualization reads the audio directly and has no inputs to route.</p>`}

      ${options.length > 0 && html`
        <h4>Options</h4>
        ${options.map((def) => html`
          <${OptionField} key=${def.name} name=${def.name} def=${def} value=${visual.options[def.name]} onChange=${(v) => setOption(def.name, v)} />`)}`}
    </div>`;
}

/**
 * Style editor. For the song look, every key has a value. For a block, keys
 * inherit from the song look until changed; changed keys can be reset.
 */
export function LookPanel({ title, hint, style, inherited, onChange }) {
  const isBlock = Boolean(inherited);
  const value = (key) => style?.[key] ?? inherited?.[key] ?? DEFAULT_LOOK[key];

  return html`
    <div class="panel look-panel">
      <header><h3>${title}</h3></header>
      ${hint && html`<p class="muted hint">${hint}</p>`}
      ${Object.entries(STYLE_KEYS).map(([key, rule]) => {
        const overridden = isBlock && style?.[key] !== undefined;
        return html`
          <label class=${`field ${overridden ? 'overridden' : ''}`} key=${key}>
            <span>${STYLE_LABELS[key]}</span>
            ${rule === 'color'
              ? html`<input type="color" value=${value(key)} onInput=${(e) => onChange(key, e.target.value)} />`
              : html`<input type="range" min=${rule[0]} max=${rule[1]} step="0.5" value=${value(key)}
                  onInput=${(e) => onChange(key, Number(e.target.value))} />`}
            <output>${rule === 'color' ? value(key) : value(key)}</output>
            ${isBlock && html`<button class="ghost reset" disabled=${!overridden} onClick=${(e) => { e.preventDefault(); onChange(key, undefined); }}
              title="Use the song look">↺</button>`}
          </label>`;
      })}
    </div>`;
}
