import { useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, hue } from '../lib.js';
import { LIMITS, instrumentTypes, effectTypes, moduleLabel, moduleEntry, newTrack } from '../../shared/song.js';
import { ParamPanel } from './params.js';

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
        <select disabled=${full} value="" onChange=${(e) => { addTrack(e.target.value); e.target.value = ''; }}>
          <option value="" disabled>${full ? `Track limit (${LIMITS.tracks}) reached` : '+ Add track…'}</option>
          ${instrumentTypes().map((M) => html`<option value=${M.id}>${moduleLabel(M)}</option>`)}
        </select>
      </div>
    </section>
  `;
}

function TrackCard({ track, index, store, engine }) {
  const [open, setOpen] = useState(index === 0);
  const M = registry.get(track.instrument.id);
  const edit = (fn) => store.edit((d) => fn(d.tracks.find((t) => t.id === track.id), d));
  const noteCount = store.doc.patterns.reduce((n, p) => n + (p.notes[track.id]?.length ?? 0), 0);

  const changeInstrument = (id) => {
    // Notes written for a drum kit's keys mean nothing to a synth, and vice versa.
    const kindChanges = Boolean(registry.get(id).keys) !== Boolean(M.keys);
    if (kindChanges && noteCount && !confirm('Switching between drums and a pitched instrument keeps the notes, but they may not make sense. Continue?')) return;
    edit((t) => { t.instrument = moduleEntry(id); });
  };

  const removeTrack = () => {
    if (noteCount && !confirm(`Delete "${track.name}" and its ${noteCount} notes?`)) return;
    store.edit((d) => {
      d.tracks = d.tracks.filter((t) => t.id !== track.id);
      for (const p of d.patterns) delete p.notes[track.id];
    });
  };

  const moveEffect = (i, by) => edit((t) => {
    const [e] = t.effects.splice(i, 1);
    t.effects.splice(i + by, 0, e);
  });

  return html`
    <article class=${`track ${track.mute ? 'muted' : ''}`} style=${`--hue: ${hue(index)}`}>
      <header>
        <button class="ghost disclosure" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? '▾' : '▸'}</button>
        <input class="name" value=${track.name} maxlength=${LIMITS.nameLength} aria-label="Track name"
          onInput=${(e) => edit((t) => { t.name = e.target.value; })} />
        <select value=${track.instrument.id} onChange=${(e) => changeInstrument(e.target.value)} aria-label="Instrument">
          ${instrumentTypes().map((T) => html`<option value=${T.id}>${moduleLabel(T)}</option>`)}
        </select>
        <button class="ghost" onClick=${() => engine.audition(track.id, auditionNote(M))} title="Play a test note">♪ Test</button>
        <button class=${`ghost toggle ${track.mute ? 'on' : ''}`} onClick=${() => edit((t) => { t.mute = !t.mute; })}>Mute</button>
        <input type="range" class="volume" min="0" max="1" step="0.01" value=${track.gain} aria-label="Volume" title="Volume"
          onInput=${(e) => edit((t) => { t.gain = Number(e.target.value); })} />
        <button class="ghost danger" onClick=${removeTrack} aria-label=${`Delete ${track.name}`}>✕</button>
      </header>

      ${open && html`
        <div class="chain">
          <div class="module instrument">
            <h3>${moduleLabel(M)}</h3>
            <${ParamPanel} module=${M} params=${track.instrument.params}
              onChange=${(name, v) => edit((t) => { t.instrument.params[name] = v; })} />
          </div>
          ${track.effects.map((effect, i) => {
            const E = registry.get(effect.id);
            return html`
              <div class="module effect" key=${`${i}:${effect.id}`}>
                <h3>
                  ${moduleLabel(E)}
                  <span class="actions">
                    <button class="ghost" disabled=${i === 0} onClick=${() => moveEffect(i, -1)} aria-label="Move earlier">←</button>
                    <button class="ghost" disabled=${i === track.effects.length - 1} onClick=${() => moveEffect(i, 1)} aria-label="Move later">→</button>
                    <button class="ghost danger" onClick=${() => edit((t) => { t.effects.splice(i, 1); })} aria-label="Remove effect">✕</button>
                  </span>
                </h3>
                <${ParamPanel} module=${E} params=${effect.params}
                  onChange=${(name, v) => edit((t) => { t.effects[i].params[name] = v; })} />
              </div>`;
          })}
          ${track.effects.length < LIMITS.effectsPerTrack && html`
            <div class="module add-effect">
              <select value="" onChange=${(e) => { const id = e.target.value; e.target.value = ''; edit((t) => { t.effects.push(moduleEntry(id)); }); }}>
                <option value="" disabled>+ Add effect…</option>
                ${effectTypes().map((E) => html`<option value=${E.id}>${moduleLabel(E)}</option>`)}
              </select>
            </div>`}
        </div>`}
    </article>
  `;
}
