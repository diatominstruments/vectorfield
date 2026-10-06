import { useState } from 'preact/hooks';
import { registry, matches } from 'gloaming-instruments';
import { html, hue } from '../lib.js';
import { LIMITS, GENERATIVE_SEQUENCERS, instrumentTypes, effectTypes, moduleLabel, moduleEntry, newEffect, newTrack, pruneAutomation } from '../../shared/song.js';
import { ParamPanel, moduleInfo, instrumentKeys } from './params.js';
import { ModulePicker } from './module-picker.js';

/** The note to audition a track with: its first named key, or middle C. */
export const auditionNote = (M) => (M.keys ? Number(Object.keys(M.keys)[0]) : 60);

export function InstrumentsView({ store, engine }) {
  const { tracks } = store.doc;
  const full = tracks.length >= LIMITS.tracks;

  const addTrack = (instrumentId) => store.edit((d) => { d.tracks.push(newTrack(instrumentId)); });

  return html`
    <section class="instruments">
      ${tracks.map((track, i) => html`
        <${TrackCard} key=${track.id} track=${track} index=${i} store=${store} engine=${engine} />`)}
      <div class="add-track">
        <${ModulePicker} types=${instrumentTypes()} disabled=${full} onPick=${addTrack}
          label=${full ? `Track limit (${LIMITS.tracks}) reached` : '+ Add track'} />
      </div>
      <${MixCard} store=${store} />
    </section>
  `;
}

function TrackCard({ track, index, store, engine }) {
  const [open, setOpen] = useState(false);
  const M = registry.get(track.instrument.id);
  const edit = (fn) => store.edit((d) => fn(d.tracks.find((t) => t.id === track.id), d));
  const noteCount = store.doc.patterns.reduce((n, p) => n + (p.notes[track.id]?.length ?? 0), 0);

  const changeInstrument = (id) => {
    // Notes written for a drum kit's keys mean nothing to a synth, and vice versa.
    const kindChanges = Boolean(registry.get(id).keys) !== Boolean(instrumentKeys(M, track.instrument.params));
    if (kindChanges && noteCount && !confirm('Switching between drums and a pitched instrument keeps the notes, but they may not make sense. Continue?')) return;
    // Automation of params the new instrument doesn't have goes.
    edit((t, d) => { t.instrument = moduleEntry(id); pruneAutomation(d); });
  };

  const removeTrack = () => {
    if (noteCount && !confirm(`Delete "${track.name}" and its ${noteCount} notes?`)) return;
    store.edit((d) => {
      d.tracks = d.tracks.filter((t) => t.id !== track.id);
      for (const p of d.patterns) {
        delete p.notes[track.id];
        delete p.sequencers[track.id];
        for (const kind of GENERATIVE_SEQUENCERS) delete p[kind][track.id];
      }
      pruneAutomation(d);
    });
  };

  const setInstrumentParams = (values) => edit((t) => { Object.assign(t.instrument.params, values); });
  // Automation of an effect that's removed goes with it.
  const editEffects = (fn) => edit((t, d) => { fn(t.effects); pruneAutomation(d); });
  const patternsAutomating = (uid) => store.doc.patterns
    .filter((p) => p.automation.some((l) => l.track === track.id && l.effect === uid && l.points.length)).length;

  return html`
    <article class=${`track ${track.mute ? 'muted' : ''}`} style=${`--hue: ${hue(index)}`}>
      <header>
        <button class="ghost disclosure" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? '▾' : '▸'}</button>
        <input class="name" value=${track.name} maxlength=${LIMITS.nameLength} aria-label="Track name"
          onInput=${(e) => edit((t) => { t.name = e.target.value; })} />
        <${ModulePicker} types=${instrumentTypes()} current=${M} label=${moduleLabel(M)} onPick=${changeInstrument} />
        <button class="ghost" onClick=${() => engine.audition(track.id, auditionNote(M))} title="Play a test note">♪ Test</button>
        <button class=${`ghost toggle ${track.mute ? 'on' : ''}`} onClick=${() => edit((t) => { t.mute = !t.mute; })}>Mute</button>
        <input type="range" class="volume" min="0" max="1" step="0.01" value=${track.gain} aria-label="Volume" title="Volume"
          onInput=${(e) => edit((t) => { t.gain = Number(e.target.value); })} />
        <button class="ghost danger" onClick=${removeTrack} aria-label=${`Delete ${track.name}`}>✕</button>
      </header>

      ${!open && html`
        <div class="summary">
          <${ParamPanel} module=${M} params=${track.instrument.params} compact onChange=${setInstrumentParams} />
          ${track.effects.length > 0 && html`
            <span class="effects-summary muted">${track.effects.map((e) => `→ ${moduleLabel(registry.get(e.id))}`).join(' ')}</span>`}
        </div>`}

      ${open && html`
        <div class="chain">
          <div class="module instrument">
            <${ModuleHeading} module=${M} params=${track.instrument.params} />
            <${ParamPanel} module=${M} params=${track.instrument.params} onChange=${setInstrumentParams} />
          </div>
          <${EffectChain} effects=${track.effects} edit=${editEffects} automatedIn=${patternsAutomating} />
        </div>`}
    </article>
  `;
}

/**
 * The main mix: effects on the whole song, after every track and before the
 * limiter that protects listeners' ears.
 */
function MixCard({ store }) {
  const { effects } = store.doc.mix;
  const [open, setOpen] = useState(effects.length > 0);
  const edit = (fn) => store.edit((d) => fn(d.mix.effects));

  return html`
    <article class="track mix">
      <header>
        <button class="ghost disclosure" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? '▾' : '▸'}</button>
        <h2>Main mix</h2>
        ${!open && html`<span class="effects-summary muted">
          ${effects.length ? effects.map((e) => `→ ${moduleLabel(registry.get(e.id))}`).join(' ') : 'No effects'}
        </span>`}
      </header>
      ${open && html`
        <p class="hint muted">Effects here process the whole song, after every track.</p>
        <div class="chain">
          <${EffectChain} effects=${effects} edit=${edit} />
        </div>`}
    </article>
  `;
}

/**
 * A chain of effect cards with reorder and remove, plus an add button while
 * there's room. `edit(fn)` makes a store edit, passing fn the effects list;
 * `automatedIn(uid)`, where effects can be automated, counts the patterns
 * that automate one.
 */
function EffectChain({ effects, edit, automatedIn }) {
  const move = (i, by) => edit((list) => {
    const [e] = list.splice(i, 1);
    list.splice(i + by, 0, e);
  });
  const remove = (i) => {
    const count = automatedIn?.(effects[i].uid);
    const label = moduleLabel(registry.get(effects[i].id));
    if (count && !confirm(`Remove ${label} and its automation in ${count} pattern${count === 1 ? '' : 's'}?`)) return;
    edit((list) => { list.splice(i, 1); });
  };

  return html`
    ${effects.map((effect, i) => {
      const E = registry.get(effect.id);
      return html`
        <div class="module effect" key=${effect.uid}>
          <${ModuleHeading} module=${E} params=${effect.params}>
            <span class="actions">
              <button class="ghost" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="Move earlier">←</button>
              <button class="ghost" disabled=${i === effects.length - 1} onClick=${() => move(i, 1)} aria-label="Move later">→</button>
              <button class="ghost danger" onClick=${() => remove(i)} aria-label="Remove effect">✕</button>
            </span>
          <//>
          <${ParamPanel} module=${E} params=${effect.params}
            onChange=${(values) => edit((list) => { Object.assign(list[i].params, values); })} />
        </div>`;
    })}
    ${effects.length < LIMITS.effectsPerTrack && html`
      <div class="module add-effect">
        <${ModulePicker} types=${effectTypes()} grouped label="+ Add effect"
          onPick=${(id) => edit((list) => { list.push(newEffect(id)); })} />
      </div>`}
  `;
}

/** How an instrument plays, in a word or two: 'Mono', '8 voices', 'One-shot'. */
function playsLike(info, params) {
  const traits = [];
  if (info.polyphony === 1) traits.push('Mono');
  else if (info.polyphony) traits.push(`${info.polyphony} voices`);
  if (info.gated != null && !matches(info.gated, params)) traits.push('One-shot');
  return traits;
}

/** A module's name, what it is, and (for instruments) how it plays. */
function ModuleHeading({ module: M, params, children }) {
  const info = moduleInfo(M);
  const traits = info.kind === 'instrument' ? playsLike(info, params) : [];
  return html`
    <div class="module-heading">
      <h3>
        ${info.label}
        ${traits.map((t) => html`<span class="badge">${t}</span>`)}
        ${children}
      </h3>
      ${info.description && html`<p class="description">${info.description}</p>`}
    </div>
  `;
}
