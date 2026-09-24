import { useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, hue, noteName, isBlackKey, useEngineEvent } from '../lib.js';
import { LIMITS, PATTERN_LENGTHS, newPattern, newId } from '../../shared/song.js';

const VISIBLE_OCTAVES = 2;

export function PatternsView({ store, engine, pattern, onSelect }) {
  const { doc } = store;
  const [trackId, setTrackId] = useState(doc.tracks[0]?.id);
  const track = doc.tracks.find((t) => t.id === trackId) ?? doc.tracks[0];

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
              <button class="ghost" onClick=${() => onSelect(p.id)}>${p.name}</button>
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
              ${doc.tracks.map((t, i) => html`
                <button key=${t.id} class=${t.id === track.id ? 'active' : ''} style=${`--hue: ${hue(i)}`}
                  onClick=${() => setTrackId(t.id)}>
                  ${t.name} <small>${pattern.notes[t.id]?.length || ''}</small>
                </button>`)}
            </nav>
            <${StepGrid} key=${`${pattern.id}:${track.id}`} store=${store} engine=${engine} pattern=${pattern} track=${track}
              trackIndex=${doc.tracks.indexOf(track)} />`}
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
    const uses = doc.arrangement.filter((id) => id === pattern.id).length;
    const msg = uses ? `Delete "${pattern.name}"? It's used ${uses}× in the song, and those will go too.` : `Delete "${pattern.name}"?`;
    if (!confirm(msg)) return;
    const next = doc.patterns.find((p) => p.id !== pattern.id);
    store.edit((d) => {
      d.patterns = d.patterns.filter((p) => p.id !== pattern.id);
      d.arrangement = d.arrangement.filter((id) => id !== pattern.id);
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
      <label>Steps
        <select value=${pattern.length} onChange=${(e) => setLength(Number(e.target.value))}>
          ${PATTERN_LENGTHS.map((n) => html`<option value=${n}>${n}</option>`)}
        </select>
      </label>
      <button class="ghost" disabled=${doc.patterns.length >= LIMITS.patterns} onClick=${duplicate}>Duplicate</button>
      <button class="ghost danger" onClick=${remove}>Delete</button>
    </div>
  `;
}

/**
 * The step sequencer. Drum-style instruments (those naming their `keys`)
 * get one row per sound; pitched ones get a two-octave piano roll that can
 * be shifted up and down. Click a cell to add a note, drag right to lengthen
 * it (pitched only), click a note to remove it; shift-click adds an accent.
 */
function StepGrid({ store, engine, pattern, track, trackIndex }) {
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

  const stepAt = (clientX) => {
    const rect = gridRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(pattern.length - 1, Math.floor(((clientX - rect.left) / rect.width) * pattern.length)));
  };

  const onPointerDown = (e, note) => {
    if (e.button !== 0) return;
    const step = stepAt(e.clientX);
    const hit = notes.find((n) => n.note === note && n.step <= step && step < n.step + n.length);
    if (hit) {
      editNotes((list) => list.filter((n) => n !== hit));
      return;
    }
    if (notes.length >= LIMITS.notesPerTrack) return;
    // A new note may grow rightward, up to the next note on the same row.
    const next = notes.filter((n) => n.note === note && n.step > step).reduce((m, n) => Math.min(m, n.step), pattern.length);
    const velocity = e.shiftKey ? 1 : 0.75;
    editNotes((list) => [...list, { step, note, velocity, length: 1 }]);
    engine.audition(track.id, note, velocity);
    if (!M.keys) {
      drag.current = { step, note, max: next - step, length: 1 };
      gridRef.current.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const length = Math.max(1, Math.min(d.max, stepAt(e.clientX) - d.step + 1));
    if (length === d.length) return;
    d.length = length;
    editNotes((list) => list.map((n) => (n.step === d.step && n.note === d.note ? { ...n, length } : n)));
  };

  const endDrag = () => { drag.current = null; };

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
        <div class="cells" ref=${gridRef} onPointerMove=${onPointerMove} onPointerUp=${endDrag} onPointerCancel=${endDrag}>
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
        ? 'Click to add or remove a hit. Shift-click for an accent.'
        : 'Click to add a note, drag right to hold it longer, click a note to remove it. Shift-click for an accent. On a mono synth, overlapping notes slide.'}</p>
    </div>
  `;
}

/** Start the roll where the track's notes are, or around C3 for an empty one. */
function defaultOctave(notes = []) {
  if (!notes.length) return 3;
  const lowest = Math.min(...notes.map((n) => n.note));
  return Math.max(0, Math.min(7, Math.floor(lowest / 12) - 1));
}
