import { BANDS, DEFAULT_TRIGGERS, Glyph, catalog, describe } from 'gloaming-kit';
import { useEffect, useRef, useState } from 'preact/hooks';
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
const TRIGGER_LABELS = {
  sub: 'Sub drop', bass: 'Bass hit', tom: 'Tom hit', snare: 'Snare hit', clap: 'Clap hit', hihat: 'Hi-hat hit',
  onset: 'Any hit', loud: 'Loud surge', lull: 'Quiet passage',
};
const triggerLabel = (t) => TRIGGER_LABELS[t] ?? `${t} hit`;

const STYLE_LABELS = {
  background: 'Background', lineColor: 'Line', accentColor: 'Accent', peakColor: 'Peak',
  peakAbove: 'Peak above', lineWidth: 'Line width', shadowBlur: 'Glow',
};

/** The peak colour a look starts from when it's switched on. */
const PEAK_ON = '#ffffff';

/** A number shown to the precision its slider steps in: 28, 1.4, 0.028. */
const fmt = (value, step) => Number(value).toFixed(step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

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
      <output>${fmt(value, step)}${unit}</output>
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

// Shared by every grid editor, so mirroring stays on while moving between visuals.
const mirror = { h: false, v: false };

/** A drawing's cells on a width × height canvas, row-major; cropped or padded with empty. */
function gridCells(rows, width, height, levels) {
  const cells = new Uint8Array(width * height);
  const glyph = Glyph.parse(rows, levels);
  if (glyph) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells[y * width + x] = glyph.get(x, y);
    }
  }
  return cells;
}

const gridRows = (cells, width, height) => Array.from({ length: height }, (_, y) => Array.from(
  cells.subarray(y * width, (y + 1) * width), (c) => (c ? String(c) : '.'),
).join(''));

/**
 * A click-to-draw canvas for a `kind: 'grid'` option (the Glyphs'
 * drawing). Clicking a cell steps it up a strength and back to empty;
 * dragging paints the strength the first cell got; shift- or right-click
 * erases. Mirroring paints the reflected cells too. The drawing is handed
 * over on release rather than per cell, since a changed option makes a new
 * instance that crossfades in.
 */
function GlyphField({ name, def, value, onChange }) {
  const levels = def.levels ?? 2;
  const saved = value !== undefined ? Glyph.parse(value, levels) : null;
  // The declared canvas, widened if a saved drawing is bigger.
  const width = Math.max(def.width, saved?.width ?? 0);
  const height = Math.max(def.height, saved?.height ?? 0);
  const shown = value ?? def.default;

  const [cells, setCells] = useState(() => gridCells(shown, width, height, levels));
  const [mirrored, setMirrored] = useState({ ...mirror });
  const paint = useRef(null);   // { level, cells } while a stroke is in progress
  const gridEl = useRef(null);

  // Follow changes made elsewhere (another panel, a reload), not mid-stroke.
  const shownKey = `${width}x${height}:${JSON.stringify(shown)}`;
  useEffect(() => {
    if (!paint.current) setCells(gridCells(shown, width, height, levels));
  }, [shownKey]);

  const cellAt = (e) => {
    const r = gridEl.current.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * height);
    return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
  };
  const set = (next, x, y, level) => {
    const xs = mirrored.h ? [x, width - 1 - x] : [x];
    const ys = mirrored.v ? [y, height - 1 - y] : [y];
    for (const cx of xs) for (const cy of ys) next[cy * width + cx] = level;
  };

  const down = (e) => {
    const at = cellAt(e);
    if (!at) return;
    e.preventDefault();
    gridEl.current.setPointerCapture(e.pointerId);
    const [x, y] = at;
    const next = cells.slice();
    const level = e.button === 2 || e.shiftKey ? 0 : (next[y * width + x] + 1) % (levels + 1);
    set(next, x, y, level);
    paint.current = { level, cells: next };
    setCells(next);
  };
  const move = (e) => {
    const stroke = paint.current;
    const at = stroke && cellAt(e);
    if (!at) return;
    const i = at[1] * width + at[0];
    if (stroke.cells[i] === stroke.level && !mirrored.h && !mirrored.v) return;
    stroke.cells = stroke.cells.slice();
    set(stroke.cells, at[0], at[1], stroke.level);
    setCells(stroke.cells);
  };
  const up = () => {
    const stroke = paint.current;
    if (!stroke) return;
    paint.current = null;
    onChange(gridRows(stroke.cells, width, height));
  };

  const toggle = (axis) => {
    mirror[axis] = !mirror[axis];
    setMirrored({ ...mirror });
  };
  const clear = () => {
    const empty = new Uint8Array(width * height);
    setCells(empty);
    onChange(gridRows(empty, width, height));
  };
  const empty = !cells.some(Boolean);

  return html`
    <div class="field glyph-field">
      <span>${name}</span>
      <div class="glyph-editor">
        <div class="glyph-grid" ref=${gridEl} role="img" aria-label=${`${name} drawing, ${width} by ${height} cells`}
          style=${{ gridTemplateColumns: `repeat(${width}, 1fr)`, aspectRatio: `${width} / ${height}` }}
          onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
          onContextMenu=${(e) => e.preventDefault()}>
          ${Array.from(cells, (level, i) => html`
            <span key=${i} class=${level ? 'on' : ''} style=${level ? { '--w': level / levels } : null} />`)}
        </div>
        <div class="glyph-tools">
          <button class="ghost" aria-pressed=${mirrored.h} title="Mirror left–right" onClick=${() => toggle('h')}>⇆</button>
          <button class="ghost" aria-pressed=${mirrored.v} title="Mirror top–bottom" onClick=${() => toggle('v')}>⇅</button>
          <button class="ghost" disabled=${empty} onClick=${clear}>Clear</button>
          <button class="ghost" disabled=${value === undefined} title="Back to the visualization's own drawing"
            onClick=${() => onChange('')}>Default</button>
        </div>
        <p class="muted glyph-help">
          ${empty
            ? 'Empty, so the visualization draws its default until you add cells.'
            : `Click to step a cell through ${levels} strengths; drag to paint; shift- or right-click to erase.`}
        </p>
      </div>
    </div>`;
}

/**
 * One declared option, as the kit describes it: an enum, a free-form
 * string or number, or a grid drawing. Clearing it (empty string) falls back to the
 * visualization's own default.
 */
function OptionField({ name, def, value, onChange }) {
  if (def.kind === 'grid') return html`<${GlyphField} name=${name} def=${def} value=${value} onChange=${onChange} />`;
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
    // A song saved before an option became a number may hold one of its old
    // names ('fast'); the kit still reads those, so show it as is.
    const numeric = value !== undefined && Number.isFinite(Number(value));
    const shown = numeric ? Number(value) : def.default ?? min;
    return html`
      <label class="field">
        <span>${name}</span>
        <input type="range" min=${min} max=${max} step=${step} value=${shown} onInput=${(e) => onChange(Number(e.target.value))} />
        <output>${value !== undefined && !numeric ? value : fmt(shown, step)}</output>
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
  // Not `??`: a null peakColor is a setting (off), not a missing one.
  const value = (key) => [style?.[key], inherited?.[key]].find((v) => v !== undefined) ?? DEFAULT_LOOK[key];
  const peakOff = value('peakColor') === null;
  const control = (key, rule) => {
    if (rule === 'color?') {
      return html`
        <span class="optional-color">
          <input type="checkbox" checked=${!peakOff} aria-label=${`${STYLE_LABELS[key]} on`}
            onChange=${(e) => onChange(key, e.target.checked ? PEAK_ON : null)} />
          <input type="color" value=${value(key) ?? PEAK_ON} disabled=${value(key) === null}
            onInput=${(e) => onChange(key, e.target.value)} />
        </span>`;
    }
    if (rule === 'color') return html`<input type="color" value=${value(key)} onInput=${(e) => onChange(key, e.target.value)} />`;
    const [min, max, step] = rule;
    return html`<input type="range" min=${min} max=${max} step=${step} value=${value(key)}
      disabled=${key === 'peakAbove' && peakOff} onInput=${(e) => onChange(key, Number(e.target.value))} />`;
  };
  const shown = (key, rule) => {
    const v = value(key);
    if (typeof rule === 'string') return v ?? 'off';
    return fmt(v, rule[2]);
  };

  return html`
    <div class="panel look-panel">
      <header><h3>${title}</h3></header>
      ${hint && html`<p class="muted hint">${hint}</p>`}
      ${Object.entries(STYLE_KEYS).map(([key, rule]) => {
        const overridden = isBlock && style?.[key] !== undefined;
        return html`
          <label class=${`field ${overridden ? 'overridden' : ''}`} key=${key}>
            <span>${STYLE_LABELS[key]}</span>
            ${control(key, rule)}
            <output>${shown(key, rule)}</output>
            ${isBlock && html`<button class="ghost reset" disabled=${!overridden} onClick=${(e) => { e.preventDefault(); onChange(key, undefined); }}
              title="Use the song look">↺</button>`}
          </label>`;
      })}
    </div>`;
}
