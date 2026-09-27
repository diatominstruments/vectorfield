import { useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, hue, noteName, isBlackKey, useEngineEvent } from '../lib.js';
import { LIMITS, PATTERN_LENGTHS, newPattern, newId, sequencerOf } from '../../shared/song.js';
import { defaultBounce } from '../../shared/bounce.js';
import { defaultTubules } from '../../shared/tubules.js';
import { plural } from './song-view.js';
import { BounceEditor } from './bounce-editor.js';
import { TubuleEditor } from './tubule-editor.js';

const VISIBLE_OCTAVES = 2;

// The sequencers besides the step grid: how each is named, starts out, and
// sums itself up on its track's tab.
const GENERATIVE = {
  bounce: { label: 'Bouncing balls', fresh: defaultBounce, Editor: BounceEditor, summary: (c) => plural(c.balls.length, 'ball') },
  tubules: { label: 'Microtubules', fresh: defaultTubules, Editor: TubuleEditor, summary: (c) => plural(c.rings.length * c.sections, 'zone') },
};

export function PatternsView({ store, engine, pattern, onSelect }) {
  const { doc } = store;
  const [trackId, setTrackId] = useState(doc.tracks[0]?.id);
  const [newLength, setNewLength] = useState(1);
  const track = doc.tracks.find((t) => t.id === trackId) ?? doc.tracks[0];
  const pitched = track && !registry.get(track.instrument.id).keys;
  const kind = track && pattern ? sequencerOf(pattern, track.id) : 'steps';
  const generative = GENERATIVE[kind];

  // A track keeps its notes and each sequencer's settings whichever it
  // uses, so switching back and forth loses nothing.
  const setSequencer = (next) => store.edit((d) => {
    const p = d.patterns.find((x) => x.id === pattern.id);
    if (GENERATIVE[next]) {
      p.sequencers[track.id] = next;
      p[next][track.id] ??= GENERATIVE[next].fresh(registry.get(track.instrument.id).keys);
    } else {
      delete p.sequencers[track.id];
    }
  });

  const addPattern = () => {
    const p = newPattern(`Pattern ${doc.patterns.length + 1}`, pattern?.length ?? 16);
    store.edit((d) => { d.patterns.push(p); });
    onSelect(p.id);
  };

  if (!pattern) {
    return html`<section class="patterns empty">
      <p class="muted">No patterns yet.</p>
      <button class="primary" onClick=${addPattern}>New pattern</button>
    </section>`;
  }

  return html`
    <section class="patterns">
      <aside class="pattern-list">
        <ul>
          ${doc.patterns.map((p, i) => html`
            <li key=${p.id} class=${p.id === pattern.id ? 'active' : ''} style=${`--hue: ${hue(i)}`}>
              <button class="ghost" onClick=${() => onSelect(p.id)}>
                ${Object.keys(p.sequencers).length > 0 && html`<span class="kind-dot" title="Has generative tracks">●</span>`}${p.name}
              </button>
            </li>`)}
        </ul>
        <button class="ghost" disabled=${doc.patterns.length >= LIMITS.patterns} onClick=${addPattern}>+ New pattern</button>
      </aside>

      <div class="pattern-editor">
        <${PatternHeader} store=${store} pattern=${pattern} onSelect=${onSelect} />
        ${doc.tracks.length === 0
          ? html`<p class="muted">Add a track in the Instruments view first.</p>`
          : html`
            <nav class="track-tabs">
              ${doc.tracks.map((t, i) => {
                const k = sequencerOf(pattern, t.id);
                const gen = GENERATIVE[k];
                return html`
                  <button key=${t.id} class=${t.id === track.id ? 'active' : ''} style=${`--hue: ${hue(i)}`}
                    onClick=${() => setTrackId(t.id)}>
                    ${gen && html`<span class="kind-dot" title=${gen.label}>●</span>`}${t.name}
                    <small>${gen ? gen.summary(pattern[k][t.id]) : pattern.notes[t.id]?.length || ''}</small>
                  </button>`;
              })}
            </nav>
            <label class="sequencer-choice">
              <span class="muted">${track.name} sequencer</span>
              <select value=${kind} onChange=${(e) => setSequencer(e.target.value)}>
                <option value="steps">Steps</option>
                ${Object.entries(GENERATIVE).map(([k, g]) => html`<option value=${k}>${g.label}</option>`)}
              </select>
            </label>
            ${generative
              ? html`<${generative.Editor} key=${`${pattern.id}:${track.id}:${kind}`} store=${store} engine=${engine} pattern=${pattern} track=${track}
                  trackIndex=${doc.tracks.indexOf(track)} />`
              : html`
            ${pitched && html`
              <div class="note-length" role="radiogroup" aria-label="Length of new notes">
                <span class="muted">New notes</span>
                ${NOTE_LENGTHS.map(([steps, label]) => html`
                  <button key=${steps} role="radio" aria-checked=${newLength === steps}
                    class=${newLength === steps ? 'active' : ''} onClick=${() => setNewLength(steps)}
                    title=${`${plural(steps, 'step')}`}>${label}</button>`)}
              </div>`}
            <${StepGrid} key=${`${pattern.id}:${track.id}`} store=${store} engine=${engine} pattern=${pattern} track=${track}
              trackIndex=${doc.tracks.indexOf(track)} newLength=${newLength} />`}`}
      </div>
    </section>
  `;
}

function PatternHeader({ store, pattern, onSelect }) {
  const { doc } = store;
  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id), d));

  const duplicate = () => {
    const copy = { ...structuredClone(pattern), id: newId(), name: `${pattern.name} copy`.slice(0, LIMITS.nameLength) };
    store.edit((d) => { d.patterns.splice(d.patterns.findIndex((p) => p.id === pattern.id) + 1, 0, copy); });
    onSelect(copy.id);
  };

  const remove = () => {
    const uses = doc.arrangement.filter((b) => b.pattern === pattern.id).length;
    const msg = uses ? `Delete "${pattern.name}"? It's used ${uses}× in the song, and those blocks (with their visuals) will go too.` : `Delete "${pattern.name}"?`;
    if (!confirm(msg)) return;
    const next = doc.patterns.find((p) => p.id !== pattern.id);
    store.edit((d) => {
      d.patterns = d.patterns.filter((p) => p.id !== pattern.id);
      d.arrangement = d.arrangement.filter((b) => b.pattern !== pattern.id);
    });
    onSelect(next?.id ?? null);
  };

  // Shortening drops notes past the new end; lengthening keeps everything.
  const setLength = (length) => edit((p) => {
    p.length = length;
    for (const [tid, notes] of Object.entries(p.notes)) {
      p.notes[tid] = notes.filter((n) => n.step < length).map((n) => ({ ...n, length: Math.min(n.length, length - n.step) }));
    }
  });

  return html`
    <div class="pattern-header">
      <input class="name" value=${pattern.name} maxlength=${LIMITS.nameLength} aria-label="Pattern name"
        onInput=${(e) => edit((p) => { p.name = e.target.value; })} />
      <label>Length
        <select value=${pattern.length} onChange=${(e) => setLength(Number(e.target.value))}>
          ${PATTERN_LENGTHS.map((n) => html`<option value=${n}>${plural(n / 16, 'bar')}</option>`)}
        </select>
      </label>
      <button class="ghost" disabled=${doc.patterns.length >= LIMITS.patterns} onClick=${duplicate}>Duplicate</button>
      <button class="ghost danger" onClick=${remove}>Delete</button>
    </div>
  `;
}

/** Lengths offered for new notes, in steps (sixteenths). */
const NOTE_LENGTHS = [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1 bar']];

/**
 * The step sequencer. Drum-style instruments (those naming their `keys`)
 * get one row per sound, and every hit is a one-shot. Pitched instruments
 * get a two-octave piano roll that can be shifted up and down, where:
 *
 *   click an empty cell      add a note of the chosen length
 *   drag from an empty cell  add a note and stretch it as you drag
 *   drag a note             resize it (its start stays put)
 *   click a note            remove it
 *   shift-click             accent
 */
function StepGrid({ store, engine, pattern, track, trackIndex, newLength }) {
  const M = registry.get(track.instrument.id);
  const [baseOctave, setBaseOctave] = useState(M.keys ? 0 : defaultOctave(pattern.notes[track.id]));
  const gridRef = useRef();
  const drag = useRef(null);
  const position = useEngineEvent(engine, 'position', engine.position);
  const playStep = position?.patternId === pattern.id ? position.step : -1;

  const notes = pattern.notes[track.id] ?? [];
  const rows = M.keys
    ? Object.entries(M.keys).map(([note, label]) => ({ note: Number(note), label }))
    : Array.from({ length: VISIBLE_OCTAVES * 12 }, (_, i) => {
      const note = (baseOctave + 1) * 12 + VISIBLE_OCTAVES * 12 - 1 - i;
      return { note, label: noteName(note), black: isBlackKey(note) };
    });
  const lo = rows.at(-1).note;
  const hi = rows[0].note;
  const above = M.keys ? 0 : notes.filter((n) => n.note > hi).length;
  const below = M.keys ? 0 : notes.filter((n) => n.note < lo).length;

  const editNotes = (fn) => store.edit((d) => {
    const p = d.patterns.find((x) => x.id === pattern.id);
    p.notes[track.id] = fn(p.notes[track.id] ?? []);
    if (!p.notes[track.id].length) delete p.notes[track.id];
  });

  // Notes are identified by pitch and start step: the same row never holds
  // two notes starting on one step.
  const sameNote = (n, note, step) => n.note === note && n.step === step;
  const removeNote = (note, step) => editNotes((list) => list.filter((n) => !sameNote(n, note, step)));
  const resizeNote = (note, step, length) =>
    editNotes((list) => list.map((n) => (sameNote(n, note, step) ? { ...n, length } : n)));

  const stepAt = (clientX) => {
    const rect = gridRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(pattern.length - 1, Math.floor(((clientX - rect.left) / rect.width) * pattern.length)));
  };

  // A note may grow rightward up to the next note on its row, or the pattern's end.
  const roomAfter = (note, step) =>
    notes.filter((n) => n.note === note && n.step > step).reduce((m, n) => Math.min(m, n.step), pattern.length) - step;

  const onPointerDown = (e, note) => {
    if (e.button !== 0) return;
    const step = stepAt(e.clientX);
    const hit = notes.find((n) => n.note === note && n.step <= step && step < n.step + n.length);

    if (hit && M.keys) return removeNote(note, hit.step);
    if (hit) {
      // Nothing changes yet: moving makes this a resize, releasing in place a removal.
      drag.current = { note, start: hit.step, length: hit.length, max: roomAfter(note, hit.step), downStep: step, moved: false, existing: true };
    } else {
      if (notes.length >= LIMITS.notesPerTrack) return;
      const velocity = e.shiftKey ? 1 : 0.75;
      const length = M.keys ? 1 : Math.min(newLength, roomAfter(note, step));
      editNotes((list) => [...list, { step, note, velocity, length }]);
      engine.audition(track.id, note, velocity);
      if (M.keys) return;
      drag.current = { note, start: step, length, max: roomAfter(note, step), downStep: step, moved: false, existing: false };
    }
    gridRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const step = stepAt(e.clientX);
    if (step !== d.downStep) d.moved = true;
    if (!d.moved) return;
    const length = Math.max(1, Math.min(d.max, step - d.start + 1));
    if (length === d.length) return;
    d.length = length;
    resizeNote(d.note, d.start, length);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.existing && !d.moved) removeNote(d.note, d.start);
  };

  const cancelDrag = () => { drag.current = null; };

  // cell lookup: "note:step" → { note, part: 'start' | 'held' | 'end' | 'single' }
  const cells = new Map();
  for (const n of notes) {
    for (let s = n.step; s < n.step + n.length; s++) {
      const part = n.length === 1 ? 'single' : s === n.step ? 'start' : s === n.step + n.length - 1 ? 'end' : 'held';
      cells.set(`${n.note}:${s}`, { n, part });
    }
  }

  return html`
    <div class="step-grid" style=${`--hue: ${hue(trackIndex)}; --steps: ${pattern.length}`}>
      ${!M.keys && html`
        <div class="octave">
          <button class="ghost" disabled=${baseOctave >= 7} onClick=${() => setBaseOctave(baseOctave + 1)}>▲ Octave ${above ? html`<em>${above} above</em>` : ''}</button>
          <button class="ghost" disabled=${baseOctave <= 0} onClick=${() => setBaseOctave(baseOctave - 1)}>▼ Octave ${below ? html`<em>${below} below</em>` : ''}</button>
        </div>`}
      <div class="grid-wrap">
        <div class="labels">
          <div class="corner"></div>
          ${rows.map((r) => html`
            <button key=${r.note} class=${`row-label ${r.black ? 'black' : ''}`}
              onClick=${() => engine.audition(track.id, r.note)}>${r.label}</button>`)}
        </div>
        <div class=${`cells ${M.keys ? '' : 'pitched'}`} ref=${gridRef}
          onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerCancel=${cancelDrag}>
          <div class="step-numbers">
            ${Array.from({ length: pattern.length }, (_, s) => html`
              <span key=${s} class=${`${s % 4 === 0 ? 'beat' : ''} ${s === playStep ? 'now' : ''}`}>${s % 4 === 0 ? s / 4 + 1 : ''}</span>`)}
          </div>
          ${rows.map((r) => html`
            <div key=${r.note} class=${`row ${r.black ? 'black' : ''}`} onPointerDown=${(e) => onPointerDown(e, r.note)}>
              ${Array.from({ length: pattern.length }, (_, s) => {
                const c = cells.get(`${r.note}:${s}`);
                const cls = ['cell', s % 4 === 0 && 'beat', s === playStep && 'now',
                  c && `on ${c.part}`, c && c.n.velocity >= 0.95 && 'accent'].filter(Boolean).join(' ');
                return html`<div key=${s} class=${cls}></div>`;
              })}
            </div>`)}
        </div>
      </div>
      <p class="hint muted">${M.keys
        ? 'Click to add or remove a hit; drum hits are one-shots, so they have no length. Shift-click for an accent.'
        : 'Click to add a note, or drag to stretch it as you place it. Drag a note to resize it; click it to remove. Shift-click for an accent. On a mono synth, overlapping notes slide.'}</p>
    </div>
  `;
}

/** Start the roll where the track's notes are, or around C3 for an empty one. */
function defaultOctave(notes = []) {
  if (!notes.length) return 3;
  const lowest = Math.min(...notes.map((n) => n.note));
  return Math.max(0, Math.min(7, Math.floor(lowest / 12) - 1));
}
