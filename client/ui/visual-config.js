import {
  BANDS, BLENDS, CLIPS, DEFAULT_TRIGGERS, Glyph, PALETTES, TIMING_TRIGGERS, TRANSITIONS, catalog, describe, registry,
} from 'gloaming-kit';
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib.js';
import { NO_3D_HINT, needs3D } from '../three.js';
import { applyFinish } from './visual-canvas.js';
import {
  STYLE_KEYS, DEFAULT_LOOK, DEFAULT_FADE, FINISH_KEYS, HOLD_PICKS, LFO_SHAPES, MAX_FADE, MAX_TRAIL, MOMENTS, PALETTE_STOPS,
  PLACE_DEFAULTS, TIMBRE_NAMES, TONEMAP_NAMES, VISUAL_LIMITS, normalizePlace,
} from '../../shared/visuals.js';

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
  beat: 'Each beat', downbeat: 'Downbeat', phrase: 'Phrase start', section: 'Section change', drop: 'Drop',
};
const triggerLabel = (t) => TRIGGER_LABELS[t] ?? `${t} hit`;

// Measures of the sound's colour, read like a band.
const TIMBRE_LABELS = { centroid: 'Brightness', flatness: 'Noisiness' };
const TIMBRE_HINTS = {
  centroid: 'How bright the sound is: low for dark pads, high for hats and air. Jumpy, so give it some smoothing',
  flatness: 'How noisy rather than tonal the sound is: low for pure tones, rising with hats, crashes and distortion',
};
const timbreLabel = (t) => TIMBRE_LABELS[t] ?? t;

const STYLE_LABELS = {
  background: 'Background', lineColor: 'Line', accentColor: 'Accent', peakColor: 'Peak', palette: 'Palette',
  peakAbove: 'Peak above', lineWidth: 'Line width', shadowBlur: 'Glow', halo: 'Halo', atmosphere: 'Atmosphere',
};
// The air behind everything is drawn once for the whole frame, so a visual can't have its own.
const ENTRY_OMITS = ['atmosphere'];
const PALETTE_NAMES = Object.keys(PALETTES);
const sameStops = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const FINISH_PRESET_LABELS = { clean: 'Clean', neon: 'Neon', film: 'Film', none: 'Plain', off: 'Off' };
const FINISH_PRESET_HINTS = {
  clean: 'A soft glow on bright light, highlights that roll off, a light vignette',
  neon: 'Lines as lit tubes: a strong, wide glow, a little more colour, a touch of grain',
  film: 'Graded: deep blacks and contrast, a wide halo, grain, a heavier vignette',
  none: 'The frame as drawn',
  off: 'The frame as drawn, with no finishing pass',
};
const FINISH_LABELS = {
  bloom: 'Bloom', bloomThreshold: 'Bloom from', bloomRadius: 'Bloom spread', headroom: 'Headroom',
  exposure: 'Exposure', saturation: 'Saturation', vignette: 'Vignette', grain: 'Grain',
};
const FINISH_HINTS = {
  bloom: 'How strongly bright light glows',
  bloomThreshold: 'How bright light must be to glow; lower, and mid-tones glow too',
  bloomRadius: 'How far the glow spreads',
  headroom: 'How much hotter than white the brightest parts read, so they glow harder than colours do',
  exposure: 'Brightness of the whole frame',
  saturation: 'Colourfulness: 0 grey, 1 as drawn',
  vignette: 'How dark the corners go',
  grain: 'Film grain, strongest in the mid-tones',
};
const TONEMAP_LABELS = { rolloff: 'Roll off', aces: 'ACES', agx: 'AgX', none: 'Clip' };
const TONEMAP_HINTS = {
  rolloff: 'Colours as drawn; light past white burns toward white with its hue held',
  aces: 'Filmic: deeper blacks, more contrast and colour',
  agx: 'Filmic: flatter and less saturated; suits scenes more than line art',
  none: 'Light past white clips',
};

const TRANSITION_LABELS = {
  fade: 'Fade', cut: 'Cut', 'wipe-left': 'Wipe left', 'wipe-right': 'Wipe right', 'wipe-up': 'Wipe up',
  'wipe-down': 'Wipe down', iris: 'Iris',
};
const transitionLabel = (t) => TRANSITION_LABELS[t] ?? t;

const CLIP_LABELS = {
  rect: 'Rectangle', circle: 'Circle', ellipse: 'Ellipse', left: 'Left half', right: 'Right half',
  top: 'Top half', bottom: 'Bottom half', none: 'None',
};

// The kit's blend modes by what they do to what's beneath; any it adds
// later land in "Other".
const BLEND_GROUPS = [
  ['Lighten', ['lighter', 'screen', 'lighten', 'color-dodge']],
  ['Darken', ['multiply', 'darken', 'color-burn']],
  ['Contrast', ['overlay', 'soft-light', 'hard-light']],
  ['Invert', ['difference', 'exclusion']],
  ['Colour', ['hue', 'saturation', 'color', 'luminosity']],
  ['Mask', ['source-atop', 'source-in', 'source-out', 'destination-over', 'destination-in', 'destination-out', 'destination-atop', 'xor', 'copy']],
];
const BLEND_LABELS = { lighter: 'Add', 'destination-out': 'Knock out', 'destination-over': 'Behind' };
const blendLabel = (b) => BLEND_LABELS[b] ? `${BLEND_LABELS[b]} (${b})` : b;

/** The peak colour a look starts from when it's switched on. */
const PEAK_ON = '#ffffff';

/** A number shown to the precision its slider steps in: 28, 1.4, 0.028. */
const fmt = (value, step) => Number(value).toFixed(step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));

// ---- level specs ↔ form ----------------------------------------------------------
//
// The kit's spec language can express more than these controls do (sums,
// maxes, products). Anything the form can't represent shows as "Custom" and
// is left untouched unless the user picks something else.

const MEASURES = { level: 'Level', relative: 'Relative', intensity: 'Sustained' };
const MEASURE_HINTS = {
  level: 'How loud it is right now',
  relative: 'Against its own recent quiet and peaks, so it moves as much in a quiet passage as a loud one',
  intensity: 'Slow, absolute loudness: big in loud passages, small in quiet ones',
};
const RESPONSES = { envelope: 'Envelope', hold: 'Hold per hit' };
const RESPONSE_HINTS = {
  envelope: 'Jumps on each hit, then decays',
  hold: 'Each hit picks a new value, held until the next',
};
const PICKS = { random: 'Random', impact: 'Hit strength', cycle: 'Steps in turn', toggle: 'On, off' };
const SHAPES = { sine: 'Sine', triangle: 'Triangle', saw: 'Saw', square: 'Square' };
const FALLS = { linear: 'Steady', exp: 'Fast, then trailing', smooth: 'Eased', spring: 'Spring' };
const FALL_HINTS = {
  linear: 'Falls at a steady rate',
  exp: 'Falls fast, then trails off',
  smooth: 'Eases away and settles',
  spring: 'Overshoots below zero and rings to rest, like something struck',
};

// The song's own time (see shared/timing.js): its beats, bars, phrases,
// sections and drops, known ahead rather than heard.
const TIMING_SOURCES = { beat: 'Beat cycle', pulse: 'Pulse', rise: 'Build-up', energy: 'Energy' };
const TIMING_HINTS = {
  beat: 'Climbs from 0 to 1 through each beat, bar or phrase, in time with the song',
  pulse: 'Jumps to 1 on each beat, bar or section and falls away. Never late: the song knows where its beats fall',
  rise: 'Climbs to 1 in the seconds before the next drop or section, then lets go',
  energy: 'How full the song is here, against its fullest',
};
const CYCLES = { 1: 'Beat', 2: 'Half bar', 4: 'Bar', 8: 'Two bars', 16: 'Phrase' };
const MOMENT_LABELS = { beat: 'Beat', bar: 'Bar', phrase: 'Phrase', section: 'Section', drop: 'Drop' };
const ENERGY_OF = { song: 'Moment to moment', section: 'Whole section' };
const MODIFIERS = ['invert', 'smooth', 'curve', 'gain', 'offset', 'quantize', 'clamp'];

const modsOf = (spec) => ({
  invert: Boolean(spec.invert), smooth: spec.smooth ?? 0, curve: spec.curve ?? 1, gain: spec.gain ?? 1,
  offset: spec.offset ?? 0, quantize: spec.quantize ?? 0, clamp: Boolean(spec.clamp),
});

function readLevel(spec) {
  if (typeof spec === 'number') return { source: 'const', value: spec };
  if (typeof spec === 'string') {
    if (spec === 'rms') return { source: 'rms', measure: 'level' };
    if (spec in BANDS) return { source: `band:${spec}`, measure: 'level' };
    if (TIMBRE_NAMES.includes(spec)) return { source: `timbre:${spec}`, measure: 'level' };
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { source: 'custom' };

  const level = (name, measure) => ({
    source: name === 'rms' ? 'rms' : TIMBRE_NAMES.includes(name) ? `timbre:${name}` : `band:${name}`, measure,
  });
  let form;
  let own;   // the keys the form has a control for, besides the modifiers
  if (spec.band !== undefined) [form, own] = [level(spec.band, 'level'), ['band']];
  else if (spec.relative !== undefined) [form, own] = [level(spec.relative, 'relative'), ['relative']];
  else if (spec.intensity !== undefined) [form, own] = [level(spec.intensity, 'intensity'), ['intensity']];
  else if (spec.trigger !== undefined) {
    [form, own] = [{
      source: `trigger:${spec.trigger}`, response: 'envelope', decay: spec.decay ?? 3, attack: spec.attack ?? 0, fall: spec.shape ?? 'linear',
    }, ['trigger', 'decay', 'attack', 'shape']];
  } else if (spec.hold !== undefined && (spec.pick === undefined || HOLD_PICKS.includes(spec.pick))) {
    [form, own] = [{ source: `trigger:${spec.hold}`, response: 'hold', pick: spec.pick ?? 'random', steps: spec.steps ?? 4 }, ['hold', 'pick', 'steps']];
  } else if (spec.lfo !== undefined) [form, own] = [{ source: 'lfo', rate: spec.lfo, shape: spec.shape ?? 'sine' }, ['lfo', 'shape']];
  else if (spec.progress) [form, own] = [{ source: 'progress' }, ['progress']];
  else if (String(spec.beat) in CYCLES) [form, own] = [{ source: 'beat', cycle: spec.beat, shape: spec.shape ?? 'saw' }, ['beat', 'shape']];
  else if (MOMENTS.includes(spec.pulse)) {
    [form, own] = [{
      source: 'pulse', on: spec.pulse, decay: spec.decay ?? 8, attack: spec.attack ?? 0, accent: Boolean(spec.accent),
    }, ['pulse', 'decay', 'attack', 'accent']];
  } else if (MOMENTS.includes(spec.rise)) {
    [form, own] = [{
      source: 'rise', into: spec.rise, seconds: spec.seconds ?? 4, ease: spec.ease ?? 2, release: spec.release ?? 0.5,
    }, ['rise', 'seconds', 'ease', 'release']];
  } else if (spec.energy !== undefined) [form, own] = [{ source: 'energy', of: spec.energy === 'section' ? 'section' : 'song' }, ['energy']];
  else if (spec.const !== undefined && Object.keys(spec).length === 1) return { source: 'const', value: spec.const };
  else if (Array.isArray(spec.sum) && spec.sum.length === 1 && spec.sum[0] === 'rms') [form, own] = [level('rms', 'level'), ['sum']];
  else return { source: 'custom' };
  // A key the form can't show would be lost on the next edit, so the whole spec is custom instead.
  if (Object.keys(spec).some((k) => !own.includes(k) && !MODIFIERS.includes(k))) return { source: 'custom' };
  return { ...form, ...modsOf(spec) };
}

function writeLevel(form) {
  const [kind, name] = form.source.split(':');
  if (kind === 'const') return form.value ?? 0.5;
  let spec;
  if (kind === 'band' || kind === 'rms') {
    const measure = form.measure ?? 'level';
    if (measure !== 'level') spec = { [measure]: kind === 'rms' ? 'rms' : name };
    else spec = kind === 'rms' ? { sum: ['rms'] } : { band: name };
  } else if (kind === 'timbre') {
    spec = { band: name };
  } else if (kind === 'trigger') {
    if (form.response === 'hold') {
      spec = { hold: name };
      if (form.pick && form.pick !== 'random') spec.pick = form.pick;
      if (form.pick === 'cycle') spec.steps = form.steps ?? 4;
    } else {
      spec = { trigger: name, decay: form.decay ?? 3 };
      if (form.attack) spec.attack = form.attack;
      if (form.fall && form.fall !== 'linear') spec.shape = form.fall;
    }
  } else if (kind === 'lfo') {
    spec = { lfo: form.rate ?? 0.1 };
    if (form.shape && form.shape !== 'sine') spec.shape = form.shape;
  } else if (kind === 'progress') {
    spec = { progress: true };
  } else if (kind === 'beat') {
    spec = { beat: Number(form.cycle ?? 4) };
    if (form.shape && form.shape !== 'saw') spec.shape = form.shape;
  } else if (kind === 'pulse') {
    const on = form.on ?? 'beat';
    spec = { pulse: on, decay: form.decay ?? 8 };
    if (form.attack) spec.attack = form.attack;
    if (form.accent && on === 'beat') spec.accent = true;
  } else if (kind === 'rise') {
    spec = { rise: form.into ?? 'drop', seconds: form.seconds ?? 4 };
    if (form.ease !== undefined && form.ease !== 2) spec.ease = form.ease;
    if (form.release !== undefined && form.release !== 0.5) spec.release = form.release;
  } else if (kind === 'energy') {
    spec = { energy: form.of === 'section' ? 'section' : true };
  } else {
    return null;
  }
  // Modifiers, only where they change something.
  if (form.invert) spec.invert = true;
  if (form.smooth) spec.smooth = form.smooth;
  if (form.curve !== undefined && form.curve !== 1) spec.curve = form.curve;
  if (form.gain !== undefined && form.gain !== 1) spec.gain = form.gain;
  if (form.offset) spec.offset = form.offset;
  if (form.quantize) spec.quantize = form.quantize;
  if (form.clamp) spec.clamp = true;
  // Plain loudness is just its name.
  return spec.sum && Object.keys(spec).length === 1 ? 'rms' : spec;
}

/** The source a spec part reads, briefly: 'Treble', 'Snare', 'Song position'. */
function sourceName(spec) {
  if (typeof spec === 'number') return String(spec);
  if (typeof spec === 'string') {
    if (spec === 'rms') return 'Loudness';
    if (spec in BANDS) return bandLabel(spec);
    if (TIMBRE_NAMES.includes(spec)) return timbreLabel(spec);
    return triggerLabel(spec).replace(/ hit$/, '');
  }
  if (Array.isArray(spec)) return describeSpec({ sum: spec });
  if (!spec || typeof spec !== 'object') return 'Custom';
  const name = spec.band ?? spec.relative ?? spec.intensity;
  if (name !== undefined) return sourceName(name);
  if (spec.trigger !== undefined || spec.hold !== undefined) return sourceName(spec.trigger ?? spec.hold);
  if (spec.const !== undefined) return String(spec.const);
  if (spec.lfo !== undefined) return 'Oscillator';
  if (spec.progress) return 'Song position';
  if (spec.beat !== undefined) return `${CYCLES[spec.beat] ?? `${spec.beat}-beat`} cycle`;
  if (spec.pulse !== undefined) return `${MOMENT_LABELS[spec.pulse] ?? `${spec.pulse}-beat`} pulse`;
  if (spec.rise !== undefined) return `Build-up to ${(MOMENT_LABELS[spec.rise] ?? spec.rise).toLowerCase()}`;
  if (spec.energy !== undefined) return spec.energy === 'section' ? 'Section energy' : 'Energy';
  return describeSpec(spec);
}

/**
 * A spec in a few words, for a slot's default and for custom specs:
 * 'Mids, sustained', 'Loudness, relative', 'Mids + Snare + Clap'.
 */
function describeSpec(spec) {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    if (spec.relative !== undefined) return `${sourceName(spec.relative)}, relative`;
    if (spec.intensity !== undefined) return `${sourceName(spec.intensity)}, sustained`;
    if (spec.hold !== undefined) return `${sourceName(spec.hold)}, held`;
    if (spec.trigger !== undefined) return triggerLabel(spec.trigger);
    const joins = { sum: ' + ', max: ' or ', min: ' and ', mul: ' × ' };
    for (const [key, join] of Object.entries(joins)) {
      if (Array.isArray(spec[key])) return [...new Set(spec[key].map(sourceName))].join(join);
    }
  }
  if (Array.isArray(spec)) return describeSpec({ sum: spec });
  return sourceName(spec);
}

const eventName = (spec) => (typeof spec === 'string' ? spec : spec?.trigger);

// ---- controls ----------------------------------------------------------------

function Slider({ label, min, max, step = 0.01, value, unit = '', format, disabled, onInput }) {
  return html`
    <label class="slider">
      <span>${label}</span>
      <input type="range" min=${min} max=${max} step=${step} value=${value} disabled=${disabled}
        onInput=${(e) => onInput(Number(e.target.value))} />
      <output>${format ? format(value) : `${fmt(value, step)}${unit}`}</output>
    </label>`;
}

function Choice({ label, value, options, titles, onChange }) {
  return html`
    <label class="slider">
      <span>${label}</span>
      <select value=${value} title=${titles?.[value]} onChange=${(e) => onChange(e.target.value)}>
        ${Object.entries(options).map(([v, text]) => html`<option value=${v} title=${titles?.[v]}>${text}</option>`)}
      </select>
    </label>`;
}

function Toggle({ label, checked, title, onChange }) {
  return html`
    <label class="slider" title=${title}>
      <span>${label}</span>
      <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    </label>`;
}

/** The rarer shaping of a level, folded away until it's used. */
function Shaping({ form, change }) {
  const shaped = form.invert || form.curve !== 1 || form.offset || form.quantize || form.clamp;
  const [open, setOpen] = useState(Boolean(shaped));
  return html`
    <details class="slot-more" open=${open} onToggle=${(e) => setOpen(e.currentTarget.open)}>
      <summary>More shaping${shaped ? ' •' : ''}</summary>
      <${Toggle} label="invert" checked=${form.invert} title="1 − the level, so quiet reads high" onChange=${(invert) => change({ invert })} />
      <${Slider} label="curve" min="0.25" max="4" step="0.05" value=${form.curve} onInput=${(curve) => change({ curve })} />
      <${Slider} label="offset" min="-1" max="1" value=${form.offset} onInput=${(offset) => change({ offset })} />
      <${Slider} label="steps" min="0" max="16" step="1" value=${form.quantize}
        format=${(q) => (q ? String(q) : 'off')} onInput=${(quantize) => change({ quantize })} />
      <${Toggle} label="clamp" checked=${form.clamp} title="Keep the level between 0 and 1" onChange=${(clamp) => change({ clamp })} />
    </details>`;
}

/** What a level slot reads from: a band, a hit, something that moves on its own, or a constant. */
function LevelSlot({ slot, def, spec, defaultLabel, onChange }) {
  const bound = spec !== undefined;
  const form = bound ? readLevel(spec) : null;
  const kind = form?.source.split(':')[0];
  const change = (patch) => onChange(writeLevel({ ...form, ...patch }));

  // Moving between bands keeps the measure and shaping, and between hits the response.
  const family = (source) => (source === 'rms' || source.startsWith('band:') || source.startsWith('timbre:') ? 'sound' : source.split(':')[0]);
  const pick = (source) => {
    if (source === 'default') return onChange(undefined);
    if (source === 'custom') return;
    onChange(writeLevel(form && family(form.source) === family(source) ? { ...form, source } : { source }));
  };
  const live = bound && !['const', 'custom'].includes(kind);

  return html`
    <div class="slot">
      <label class="slot-head">
        <span class="slot-name">${slot}</span>
        <select value=${bound ? form.source : 'default'} aria-label=${`${slot} source`} onChange=${(e) => pick(e.target.value)}>
          <option value="default">Default (${defaultLabel ?? describeSpec(def.default)})</option>
          <optgroup label="Frequency band">
            ${Object.keys(BANDS).map((b) => html`<option value=${`band:${b}`}>${bandLabel(b)}</option>`)}
          </optgroup>
          <option value="rms">Loudness</option>
          <optgroup label="Sound colour">
            ${TIMBRE_NAMES.map((t) => html`<option value=${`timbre:${t}`} title=${TIMBRE_HINTS[t]}>${timbreLabel(t)}</option>`)}
          </optgroup>
          <optgroup label="Hits">
            ${TRIGGERS.map((t) => html`<option value=${`trigger:${t}`}>${triggerLabel(t)}</option>`)}
          </optgroup>
          <optgroup label="Song moments">
            ${TIMING_TRIGGERS.map((t) => html`<option value=${`trigger:${t}`}>${triggerLabel(t)}</option>`)}
          </optgroup>
          <optgroup label="In time with the song">
            ${Object.entries(TIMING_SOURCES).map(([v, text]) => html`<option value=${v} title=${TIMING_HINTS[v]}>${text}</option>`)}
          </optgroup>
          <optgroup label="Moves on its own">
            <option value="lfo">Slow oscillator</option>
            <option value="progress">Song position</option>
          </optgroup>
          <option value="const">Constant</option>
          ${bound && kind === 'custom' && html`<option value="custom">Custom (${describeSpec(spec)})</option>`}
        </select>
      </label>
      ${(kind === 'band' || kind === 'rms') && html`
        <${Choice} label="measure" value=${form.measure} options=${MEASURES} titles=${MEASURE_HINTS} onChange=${(measure) => change({ measure })} />`}
      ${kind === 'trigger' && html`
        <${Choice} label="response" value=${form.response} options=${RESPONSES} titles=${RESPONSE_HINTS} onChange=${(response) => change({ response })} />`}
      ${kind === 'trigger' && form.response === 'envelope' && html`
        <${Slider} label="decay" min="0.5" max="12" step="0.1" value=${form.decay} unit="/s" onInput=${(decay) => change({ decay })} />
        <${Choice} label="fall" value=${form.fall} options=${FALLS} titles=${FALL_HINTS} onChange=${(fall) => change({ fall })} />
        <${Slider} label="attack" min="0" max="1" step="0.01" value=${form.attack} unit="s" onInput=${(attack) => change({ attack })} />`}
      ${kind === 'trigger' && form.response === 'hold' && html`
        <${Choice} label="new value" value=${form.pick} options=${PICKS} onChange=${(p) => change({ pick: p })} />
        ${form.pick === 'cycle' && html`
          <${Slider} label="steps" min="2" max="12" step="1" value=${form.steps} onInput=${(steps) => change({ steps })} />`}`}
      ${kind === 'lfo' && html`
        <${Slider} label="rate" min="0.01" max="2" step="0.01" value=${form.rate} unit=" Hz" onInput=${(rate) => change({ rate })} />
        <${Choice} label="shape" value=${form.shape} options=${SHAPES} onChange=${(shape) => change({ shape })} />`}
      ${kind === 'beat' && html`
        <${Choice} label="each" value=${form.cycle} options=${CYCLES} onChange=${(cycle) => change({ cycle })} />
        <${Choice} label="shape" value=${form.shape} options=${SHAPES} onChange=${(shape) => change({ shape })} />`}
      ${kind === 'pulse' && html`
        <${Choice} label="each" value=${form.on} options=${MOMENT_LABELS} onChange=${(on) => change({ on })} />
        <${Slider} label="decay" min="1" max="20" step="0.5" value=${form.decay} unit="/s" onInput=${(decay) => change({ decay })} />
        <${Slider} label="lead-in" min="0" max="2" step="0.01" value=${form.attack} unit="s" onInput=${(attack) => change({ attack })} />
        ${form.on === 'beat' && html`
          <${Toggle} label="accent" checked=${form.accent} title="Bigger on the beats that land harder"
            onChange=${(accent) => change({ accent })} />`}`}
      ${kind === 'rise' && html`
        <${Choice} label="into" value=${form.into} options=${MOMENT_LABELS} onChange=${(into) => change({ into })} />
        <${Slider} label="length" min="0.5" max="16" step="0.5" value=${form.seconds} unit="s" onInput=${(seconds) => change({ seconds })} />
        <${Slider} label="ease" min="0.5" max="4" step="0.1" value=${form.ease} onInput=${(ease) => change({ ease })} />
        <${Slider} label="release" min="0" max="2" step="0.05" value=${form.release} unit="s" onInput=${(release) => change({ release })} />`}
      ${kind === 'energy' && html`
        <${Choice} label="of" value=${form.of} options=${ENERGY_OF} onChange=${(of) => change({ of })} />`}
      ${kind === 'const' && html`
        <${Slider} label="value" min="0" max="1" value=${form.value ?? 0.5} onInput=${(value) => change({ value })} />`}
      ${live && html`
        <${Slider} label="gain" min="0" max="3" value=${form.gain} onInput=${(gain) => change({ gain })} />
        <${Slider} label=${form.response === 'hold' ? 'glide' : 'smooth'} min="0" max="2" value=${form.smooth} unit="s"
          onInput=${(smooth) => change({ smooth })} />
        <${Shaping} form=${form} change=${change} />`}
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
          <optgroup label="Hits">
            ${TRIGGERS.map((t) => html`<option value=${t}>${triggerLabel(t)}</option>`)}
          </optgroup>
          <optgroup label="Song moments">
            ${TIMING_TRIGGERS.map((t) => html`<option value=${t}>${triggerLabel(t)}</option>`)}
          </optgroup>
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
 * The `seed` every visualization takes: which roll of its random choices it
 * makes. A number to type, or Reroll for a new one; the same seed with the
 * same settings draws the same picture every time.
 */
function SeedField({ def, value, onChange }) {
  const { min = 0, max = 9999 } = def;
  const numeric = value !== undefined && Number.isFinite(Number(value));
  const shown = numeric ? Number(value) : def.default ?? min;
  const reroll = () => {
    let next;
    do next = min + Math.floor(Math.random() * (max - min + 1)); while (next === shown && max > min);
    onChange(next);
  };
  const typed = (e) => {
    if (e.target.value === '') return onChange('');
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  };
  return html`
    <label class="field seed-field">
      <span>seed</span>
      <input type="number" min=${min} max=${max} step="1" value=${shown} onChange=${typed} />
      <button class="ghost" title="Another roll of its random choices, with the same settings"
        onClick=${(e) => { e.preventDefault(); reroll(); }}>Reroll</button>
      <button class="ghost reset" disabled=${value === undefined} onClick=${(e) => { e.preventDefault(); onChange(''); }}
        title="Use the default">↺</button>
    </label>`;
}

/**
 * One declared option, as the kit describes it: an enum, a free-form
 * string or number, or a grid drawing. Clearing it (empty string) falls back to the
 * visualization's own default.
 */
function OptionField({ name, def, value, onChange }) {
  if (def.kind === 'grid') return html`<${GlyphField} name=${name} def=${def} value=${value} onChange=${onChange} />`;
  if (name === 'seed' && def.kind === 'number') return html`<${SeedField} def=${def} value=${value} onChange=${onChange} />`;
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
        <input type="text" value=${value ?? ''} placeholder=${def.default ?? ''}
          maxLength=${Math.min(def.maxLength ?? 32, VISUAL_LIMITS.optionLength)}
          onInput=${(e) => onChange(e.target.value)} />
      </label>`;
  }
  return null;
}

// ---- entry fields: placement, blending, colours, transition ------------------

/** The keys a visual has beyond its viz, bindings and options; see shared/visuals.js. */
const ENTRY_KEYS = ['place', 'clip', 'blend', 'opacity', 'style', 'transition', 'fade', 'trail'];

/** Whether a visual has been changed from its visualization's defaults at all. */
export const hasSettings = (v) => Object.keys(v.bind).length > 0 || Object.keys(v.options).length > 0
  || ENTRY_KEYS.some((key) => v[key] !== undefined);

/** A part of a panel that folds away, open to begin with when it holds settings. */
function Section({ title, active, children }) {
  const [open, setOpen] = useState(Boolean(active));
  return html`
    <details class="panel-section" open=${open} onToggle=${(e) => setOpen(e.currentTarget.open)}>
      <summary><h4>${title}${active && html`<span class="set" title="Changed from the defaults"> •</span>`}</h4></summary>
      ${children}
    </details>`;
}

// Where on the canvas a visual can go in one click; sliders do the rest.
const REGIONS = {
  whole: ['Whole', {}],
  left: ['Left', { w: 0.5 }],
  right: ['Right', { x: 0.5, w: 0.5 }],
  top: ['Top', { h: 0.5 }],
  bottom: ['Bottom', { y: 0.5, h: 0.5 }],
  centre: ['Centre', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }],
};
const FLIP_LABELS = { none: 'None', x: 'Left–right', y: 'Top–bottom', xy: 'Both' };

/**
 * Where a visual draws (a region of the canvas, turned and flipped), what
 * shape it shows through, how it combines with what's beneath, and how
 * much of it shows. Region, clip and blend make it a new instance, which
 * crossfades in; opacity eases.
 */
function PlacementFields({ visual, set }) {
  const place = { ...PLACE_DEFAULTS, ...visual.place };
  const setPlace = (patch) => set('place', normalizePlace({ ...visual.place, ...patch }) ?? undefined);
  const region = Object.keys(REGIONS).find((key) => ['x', 'y', 'w', 'h']
    .every((k) => place[k] === (REGIONS[key][1][k] ?? PLACE_DEFAULTS[k])));

  return html`
    <div class="field">
      <span>Region</span>
      <div class="region-presets" role="group" aria-label="Region">
        ${Object.entries(REGIONS).map(([key, [label, r]]) => html`
          <button key=${key} class="ghost" aria-pressed=${region === key}
            onClick=${() => setPlace({ x: 0, y: 0, w: 1, h: 1, ...r })}>${label}</button>`)}
      </div>
    </div>
    <${Slider} label="left" min="0" max="1" value=${place.x} onInput=${(x) => setPlace({ x })} />
    <${Slider} label="top" min="0" max="1" value=${place.y} onInput=${(y) => setPlace({ y })} />
    <${Slider} label="width" min="0.05" max="1" value=${place.w} onInput=${(w) => setPlace({ w })} />
    <${Slider} label="height" min="0.05" max="1" value=${place.h} onInput=${(h) => setPlace({ h })} />
    <${Slider} label="rotate" min="-180" max="180" step="1" value=${place.rotate} unit="°" onInput=${(rotate) => setPlace({ rotate })} />
    <${Choice} label="flip" value=${place.flip} options=${FLIP_LABELS} onChange=${(flip) => setPlace({ flip })} />

    <label class="field">
      <span>Clip</span>
      <select value=${visual.clip ?? ''} onChange=${(e) => set('clip', e.target.value || undefined)}>
        <option value="">Default (${visual.place ? 'rectangle' : 'none'})</option>
        ${CLIPS.map((c) => html`<option value=${c}>${CLIP_LABELS[c] ?? c}</option>`)}
      </select>
    </label>
    <label class="field">
      <span>Blend</span>
      <select value=${visual.blend ?? ''} onChange=${(e) => set('blend', e.target.value && e.target.value !== 'source-over' ? e.target.value : undefined)}>
        <option value="">Normal</option>
        ${BLEND_GROUPS.map(([label, modes]) => html`
          <optgroup label=${label}>
            ${modes.filter((b) => BLENDS.includes(b)).map((b) => html`<option value=${b}>${blendLabel(b)}</option>`)}
          </optgroup>`)}
        ${BLENDS.some((b) => b !== 'source-over' && !BLEND_GROUPS.some(([, modes]) => modes.includes(b))) && html`
          <optgroup label="Other">
            ${BLENDS.filter((b) => b !== 'source-over' && !BLEND_GROUPS.some(([, modes]) => modes.includes(b)))
              .map((b) => html`<option value=${b}>${b}</option>`)}
          </optgroup>`}
      </select>
    </label>
    <${LevelSlot} slot="Opacity" def=${{ default: 1 }} defaultLabel="Full" spec=${visual.opacity}
      onChange=${(spec) => set('opacity', spec === 1 ? undefined : spec)} />`;
}

/**
 * How visuals come on and go off: a transition and how long it takes.
 * `value` holds what this level sets; `inherited` what it falls back to.
 * Shows what's in effect, with ↺ to go back to the fallback.
 */
function TransitionFields({ value, inherited, resetTitle, onChange }) {
  const own = (key) => value[key] !== undefined && value[key] !== null;
  const transition = own('transition') ? value.transition : inherited.transition ?? 'fade';
  const fade = own('fade') ? value.fade : inherited.fade ?? DEFAULT_FADE;
  const reset = (key) => html`
    <button class="ghost reset" disabled=${!own(key)} title=${resetTitle}
      onClick=${(e) => { e.preventDefault(); onChange(key, undefined); }}>↺</button>`;
  return html`
    <label class=${`field ${own('transition') ? 'overridden' : ''}`}>
      <span>Transition</span>
      <select value=${transition} onChange=${(e) => onChange('transition', e.target.value)}>
        ${TRANSITIONS.map((t) => html`<option value=${t}>${transitionLabel(t)}</option>`)}
      </select>
      <output></output>
      ${reset('transition')}
    </label>
    <label class=${`field ${own('fade') ? 'overridden' : ''}`}>
      <span>Length</span>
      <input type="range" min="0" max=${MAX_FADE} step="0.05" value=${fade} disabled=${transition === 'cut'}
        onInput=${(e) => onChange('fade', Number(e.target.value))} />
      <output>${transition === 'cut' ? '—' : `${fmt(fade, 0.05)}s`}</output>
      ${reset('fade')}
    </label>`;
}

/**
 * Settings for one visualization instance: its type, what drives each of
 * its declared input slots, and its declared options, generated from the
 * kit's own description of the visualization, so kit additions need no
 * changes here; then the fields every visualization takes (the kit's
 * `universal` ones): placement and blending, colours of its own, and how it
 * comes and goes.
 *
 * `look` is the look in effect on the visual's block, which its own colours
 * start from, and `transition` the block's transition in effect.
 */
export function VisualPanel({ visual, blockLabel, look, transition, onChange, onRemove, onMove, canMove, onDuplicate, canDuplicate }) {
  const info = describe(visual.viz);

  const setBind = (slot, spec) => onChange((v) => {
    if (spec === undefined || spec === null) delete v.bind[slot];
    else v.bind[slot] = spec;
  });
  const setOption = (key, value) => onChange((v) => {
    if (value === '') delete v.options[key];
    else v.options[key] = value;
  });
  const set = (key, value) => onChange((v) => {
    if (value === undefined) delete v[key];
    else v[key] = value;
  });
  const setStyle = (key, value) => onChange((v) => {
    const style = { ...v.style };
    if (value === undefined) delete style[key]; else style[key] = value;
    if (Object.keys(style).length) v.style = style; else delete v.style;
  });

  const inputs = info?.inputs ?? [];
  const options = info?.options ?? [];
  const trailDefault = registry.get(visual.viz)?.trail ?? 0;
  const trail = visual.trail ?? trailDefault;
  const trailText = (t) => (t ? fmt(t, 0.01) : 'off');
  const placed = ['place', 'clip', 'blend', 'opacity'].some((key) => visual[key] !== undefined);

  return html`
    <div class="panel visual-panel">
      <header>
        <h3>${vizLabel(visual.viz)} <small>${blockLabel}</small></h3>
        <div class="panel-actions">
          <button class="ghost" disabled=${!canMove.left} onClick=${() => onMove(-1)} aria-label="Move earlier (drawn below)">←</button>
          <button class="ghost" disabled=${!canMove.right} onClick=${() => onMove(1)} aria-label="Move later (drawn on top)">→</button>
          <button class="ghost" disabled=${!canDuplicate} onClick=${onDuplicate}
            title=${canDuplicate ? 'Another of this visual on the block, with the same settings: place the two apart' : `A block holds up to ${VISUAL_LIMITS.perBlock} visuals`}>Duplicate</button>
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

      ${info && html`
        <${Section} title="Placement and blending" active=${placed}>
          <p class="hint muted">Where on the canvas it draws, through what shape, and how it mixes with the visuals beneath it.</p>
          <${PlacementFields} visual=${visual} set=${set} />
        <//>
        <${Section} title="Colours" active=${visual.style !== undefined}>
          <p class="hint muted">This visual's own colours, over the block's look. The page behind stays the block's background.</p>
          <${LookFields} style=${visual.style} inherited=${look} entry resetTitle="Use the block's look" onChange=${setStyle} />
        <//>
        <${Section} title="Afterglow" active=${visual.trail !== undefined}>
          <p class="hint muted">How much of each frame's drawing lingers into the next, so the figure leaves a trail, like phosphor or a long exposure: 0.7 a glint, 0.9 about a quarter of a second, 0.97 a long smear.</p>
          <label class=${`field ${visual.trail !== undefined ? 'overridden' : ''}`}>
            <span>Trail</span>
            <input type="range" min="0" max=${MAX_TRAIL} step="0.01" value=${trail} onInput=${(e) => set('trail', Number(e.target.value))} />
            <output>${trailText(trail)}</output>
            <button class="ghost reset" disabled=${visual.trail === undefined} title=${`Use the default (${trailText(trailDefault)})`}
              onClick=${(e) => { e.preventDefault(); set('trail', undefined); }}>↺</button>
          </label>
        <//>
        <${Section} title="Transition" active=${visual.transition !== undefined || visual.fade !== undefined}>
          <p class="hint muted">How this visual comes on and goes off, in place of the block's transition.</p>
          <${TransitionFields} value=${visual} inherited=${transition} resetTitle="Use the block's transition" onChange=${set} />
        <//>`}
    </div>`;
}

/**
 * The look's fields. For the song look, every key has a value. Elsewhere
 * keys inherit from `inherited` until changed; changed keys can be reset.
 */
function LookFields({ style, inherited, entry = false, resetTitle, onChange }) {
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

  return Object.entries(STYLE_KEYS).filter(([key]) => !(entry && ENTRY_OMITS.includes(key))).map(([key, rule]) => {
    const overridden = isBlock && style?.[key] !== undefined;
    if (rule === 'stops?') {
      return html`<${PaletteField} key=${key} value=${value(key)} line=${value('lineColor')} accent=${value('accentColor')}
        entry=${entry} overridden=${overridden} isBlock=${isBlock} resetTitle=${resetTitle} onChange=${onChange} />`;
    }
    return html`
      <label class=${`field ${overridden ? 'overridden' : ''}`} key=${key}>
        <span>${STYLE_LABELS[key]}</span>
        ${control(key, rule)}
        <output>${shown(key, rule)}</output>
        ${isBlock && html`<button class="ghost reset" disabled=${!overridden} onClick=${(e) => { e.preventDefault(); onChange(key, undefined); }}
          title=${resetTitle}>↺</button>`}
      </label>`;
  });
}

/**
 * A look's palette: none (the kit ramps from line to accent), one of the
 * kit's named palettes, or stops of its own. A named palette is a whole
 * look, so picking one sets the line, accent, peak and (except on a visual)
 * background colours too; they can be changed after.
 */
function PaletteField({ value, line, accent, entry, overridden, isBlock, resetTitle, onChange }) {
  const named = PALETTE_NAMES.find((n) => sameStops(PALETTES[n].palette, value));
  const choice = value === null ? 'none' : named ?? 'custom';
  const pick = (name) => {
    if (name === 'none') return onChange('palette', null);
    if (name === 'custom') return onChange('palette', value ?? [line, accent]);
    const p = PALETTES[name];
    for (const key of ['lineColor', 'accentColor', 'peakColor', ...(entry ? [] : ['background'])]) onChange(key, p[key]);
    onChange('palette', [...p.palette]);
  };
  const [min, max] = PALETTE_STOPS;
  const edit = (e, stops) => { e.preventDefault(); onChange('palette', stops); };
  return html`
    <label class=${`field ${overridden ? 'overridden' : ''}`}>
      <span>Palette</span>
      <select value=${choice} title=${PALETTES[choice]?.description} onChange=${(e) => pick(e.target.value)}>
        <option value="none" title="No palette: figures ramp from the line colour to the accent">None</option>
        <optgroup label="Named">
          ${PALETTE_NAMES.map((n) => html`<option value=${n} title=${PALETTES[n].description}>${PALETTES[n].label}</option>`)}
        </optgroup>
        <option value="custom">Custom</option>
      </select>
      <output></output>
      ${isBlock && html`<button class="ghost reset" disabled=${!overridden} onClick=${(e) => { e.preventDefault(); onChange('palette', undefined); }}
        title=${resetTitle}>↺</button>`}
    </label>
    ${value && html`
      <div class="palette-stops">
        <span class="palette-ramp" style=${`background: linear-gradient(to right in oklab, ${value.join(', ')})`}></span>
        ${value.map((c, i) => html`<input type="color" key=${i} value=${c} aria-label=${`Palette stop ${i + 1}`}
          onInput=${(e) => onChange('palette', value.map((s, j) => (j === i ? e.target.value : s)))} />`)}
        <button class="ghost" disabled=${value.length >= max} title="Another stop at the high end"
          onClick=${(e) => edit(e, [...value, value.at(-1)])}>+</button>
        <button class="ghost" disabled=${value.length <= min} title="Take off the high end's stop"
          onClick=${(e) => edit(e, value.slice(0, -1))}>−</button>
      </div>`}`;
}

/**
 * Style editor. For the song look, every key has a value. For a block, keys
 * inherit from the song look until changed; changed keys can be reset.
 */
export function LookPanel({ title, hint, style, inherited, onChange }) {
  return html`
    <div class="panel look-panel">
      <header><h3>${title}</h3></header>
      ${hint && html`<p class="muted hint">${hint}</p>`}
      <${LookFields} style=${style} inherited=${inherited} resetTitle="Use the song look" onChange=${onChange} />
    </div>`;
}

/** A block's transition, carried on from earlier blocks until changed, like its look. */
export function TransitionPanel({ title, hint, value, inherited, onChange }) {
  return html`
    <div class="panel transition-panel">
      <header><h3>${title}</h3></header>
      ${hint && html`<p class="muted hint">${hint}</p>`}
      <${TransitionFields} value=${value} inherited=${inherited} resetTitle="Use the transition from before this block" onChange=${onChange} />
    </div>`;
}

/**
 * The finishing pass: a preset, then any of its settings changed. `value`
 * is what this level sets (the song's always names a preset), `before` the
 * kit settings in effect without it, and `beforePreset` the preset those
 * came from. On a block, changes carry on through later blocks until one
 * changes them again, and picking a preset starts again from it, so it
 * drops this level's changes.
 */
export function FinishPanel({ title, hint, value, before, beforePreset, isBlock = false, onChange }) {
  const own = value ?? {};
  const settings = applyFinish(before, own);
  const preset = own.preset ?? beforePreset;
  const resetTitle = isBlock ? 'Use the finish from before this block' : "Use the preset's";
  const change = (next) => onChange(Object.keys(next).length ? next : null);
  const set = (key, v) => {
    const next = { ...own };
    if (v === undefined) delete next[key]; else next[key] = v;
    change(next);
  };
  const pickPreset = (p) => {
    if (p) return change({ preset: p });
    const { preset: _, ...rest } = own;
    change(rest);
  };
  const reset = (key) => html`
    <button class="ghost reset" disabled=${own[key] === undefined} title=${resetTitle}
      onClick=${(e) => { e.preventDefault(); set(key, undefined); }}>↺</button>`;
  const presets = ['clean', 'neon', 'film', 'off', ...(preset === 'none' ? ['none'] : [])];
  return html`
    <div class="panel finish-panel">
      <header><h3>${title}</h3></header>
      ${hint && html`<p class="muted hint">${hint}</p>`}
      <label class=${`field ${isBlock && own.preset ? 'overridden' : ''}`}>
        <span>Preset</span>
        <select value=${own.preset ?? ''} title=${FINISH_PRESET_HINTS[preset]} onChange=${(e) => pickPreset(e.target.value)}>
          ${isBlock && html`<option value="">From before (${FINISH_PRESET_LABELS[beforePreset]})</option>`}
          ${presets.map((p) => html`<option value=${p} title=${FINISH_PRESET_HINTS[p]}>${FINISH_PRESET_LABELS[p]}</option>`)}
        </select>
        <output></output>
        ${isBlock && html`<button class="ghost reset" disabled=${!own.preset} title=${resetTitle}
          onClick=${(e) => { e.preventDefault(); pickPreset(''); }}>↺</button>`}
      </label>
      ${preset === 'off' ? html`
        <p class="muted hint">${isBlock ? 'The frame is left as drawn from this block on.'
          : 'Drawn straight to the screen, without the finishing pass, except where a block sets a finish.'}</p>` : html`
        <label class=${`field ${own.tonemap !== undefined ? 'overridden' : ''}`}>
          <span>Tone map</span>
          <select value=${settings.tonemap} title=${TONEMAP_HINTS[settings.tonemap]} onChange=${(e) => set('tonemap', e.target.value)}>
            ${TONEMAP_NAMES.map((t) => html`<option value=${t} title=${TONEMAP_HINTS[t]}>${TONEMAP_LABELS[t] ?? t}</option>`)}
          </select>
          <output></output>
          ${reset('tonemap')}
        </label>
        ${Object.entries(FINISH_KEYS).map(([key, [min, max, step]]) => html`
          <label class=${`field ${own[key] !== undefined ? 'overridden' : ''}`} key=${key} title=${FINISH_HINTS[key]}>
            <span>${FINISH_LABELS[key] ?? key}</span>
            <input type="range" min=${min} max=${max} step=${step} value=${settings[key]}
              onInput=${(e) => set(key, Number(e.target.value))} />
            <output>${fmt(settings[key], step)}</output>
            ${reset(key)}
          </label>`)}`}
    </div>`;
}
