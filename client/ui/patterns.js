import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, hue, noteName, isBlackKey, plural, useEngineEvent } from '../lib.js';
import { LIMITS, PATTERN_LENGTHS, newPattern, newId, sequencerOf, pruneAutomation } from '../../shared/song.js';
import { defaultBounce } from '../../shared/bounce.js';
import { defaultTubules } from '../../shared/tubules.js';
import { defaultAnts } from '../../shared/ants.js';
import { defaultFireflies } from '../../shared/fireflies.js';
import { defaultBees } from '../../shared/bees.js';
import { defaultFrogs } from '../../shared/frogs.js';
import { defaultSandpile } from '../../shared/sandpile.js';
import { defaultLilyPond } from '../../shared/lilypond.js';
import { ARP_COUNTS, ORDERS, SHAPES, arpeggio } from '../../shared/arpeggio.js';
import { moveNotes, noteKey, notesInBox } from '../../shared/note-edits.js';
import { BounceEditor } from './bounce-editor.js';
import { TubuleEditor } from './tubule-editor.js';
import { AntEditor } from './ant-editor.js';
import { FireflyEditor } from './firefly-editor.js';
import { BeeEditor } from './bee-editor.js';
import { FrogEditor } from './frog-editor.js';
import { SandpileEditor } from './sandpile-editor.js';
import { LilyEditor } from './lily-editor.js';
import { AutomationLanes } from './automation.js';
import { instrumentKeys } from './params.js';

const VISIBLE_OCTAVES = 2;

// The sequencers besides the step grid: how each is named, starts out, and
// sums itself up on its track's tab.
const GENERATIVE = {
  bounce: { label: 'Bouncing balls', fresh: defaultBounce, Editor: BounceEditor, summary: (c) => plural(c.balls.length, 'ball') },
  tubules: { label: 'Microtubules', fresh: defaultTubules, Editor: TubuleEditor, summary: (c) => plural(c.rings.length * c.sections, 'zone') },
  ants: { label: 'Ant colony', fresh: defaultAnts, Editor: AntEditor, summary: (c) => plural(c.ants, 'ant') },
  fireflies: { label: 'Fireflies', fresh: defaultFireflies, Editor: FireflyEditor, summary: (c) => `${c.flies.length} ${c.flies.length === 1 ? 'firefly' : 'fireflies'}` },
  bees: { label: 'Bees', fresh: defaultBees, Editor: BeeEditor, summary: (c) => plural(c.bees, 'bee') },
  frogs: { label: 'Frog chorus', fresh: defaultFrogs, Editor: FrogEditor, summary: (c) => plural(c.frogs.length, 'frog') },
  sandpile: { label: 'Sandpile', fresh: defaultSandpile, Editor: SandpileEditor, summary: (c) => `${c.size}×${c.size}` },
  lilypond: { label: 'Lily pond', fresh: defaultLilyPond, Editor: LilyEditor, summary: (c) => plural(c.pads.length, 'pad') },
};

/** The keys of a track's instrument, as its params set it up; see instrumentKeys. */
const trackKeys = (track) => instrumentKeys(registry.get(track.instrument.id), track.instrument.params);

// What Copy took: one track's sequencer in one pattern — its notes, or its
// generative settings. Kept for the session, so it can be pasted onto any
// track in any pattern, even in another song.
let clipboard = null;

export function PatternsView({ store, engine, pattern, onSelect }) {
  const { doc } = store;
  const [trackId, setTrackId] = useState(doc.tracks[0]?.id);
  const [newLength, setNewLength] = useState(1);
  // What a click on the roll lays down: one note, or a whole arpeggio from it.
  const [arp, setArp] = useState({ shape: 'single', order: 'up', count: 4 });
  const track = doc.tracks.find((t) => t.id === trackId) ?? doc.tracks[0];
  const pitched = track && !trackKeys(track);
  const kind = track && pattern ? sequencerOf(pattern, track.id) : 'steps';
  const generative = GENERATIVE[kind];
  const [copied, setCopied] = useState(clipboard);

  // A track keeps its notes and each sequencer's settings whichever it
  // uses, so switching back and forth loses nothing.
  const setSequencer = (next) => store.edit((d) => {
    const p = d.patterns.find((x) => x.id === pattern.id);
    if (GENERATIVE[next]) {
      p.sequencers[track.id] = next;
      p[next][track.id] ??= GENERATIVE[next].fresh(trackKeys(track));
    } else {
      delete p.sequencers[track.id];
    }
  });

  const copy = () => {
    clipboard = {
      kind,
      data: structuredClone(generative ? pattern[kind][track.id] : pattern.notes[track.id] ?? []),
      from: `${track.name} · ${pattern.name}`,
      drums: Boolean(trackKeys(track)),
    };
    setCopied(clipboard);
  };

  // Pasting replaces what the track plays in this pattern: its sequencer
  // choice and that sequencer's notes or settings. Its other sequencers'
  // settings stay, as when switching by hand.
  const paste = () => {
    const c = clipboard;
    const label = (k) => GENERATIVE[k]?.label.toLowerCase() ?? 'notes';
    const replacing = generative || pattern.notes[track.id]?.length;
    const warnings = [
      replacing && `Replace ${track.name}'s ${label(kind)} in "${pattern.name}" with ${c.from}'s ${label(c.kind)}?`,
      c.drums !== !pitched && `${c.from} is ${c.drums ? 'a drum kit' : 'pitched'} and ${track.name} isn't, so the notes may not make sense.`,
    ].filter(Boolean);
    if (warnings.length && !confirm(warnings.join('\n\n'))) return;
    store.edit((d) => {
      const p = d.patterns.find((x) => x.id === pattern.id);
      if (c.kind === 'steps') {
        delete p.sequencers[track.id];
        // Notes past the end of a shorter pattern are dropped or cut short.
        const notes = c.data.filter((n) => n.step < p.length).map((n) => ({ ...n, length: Math.min(n.length, p.length - n.step) }));
        if (notes.length) p.notes[track.id] = notes;
        else delete p.notes[track.id];
      } else {
        p.sequencers[track.id] = c.kind;
        p[c.kind][track.id] = structuredClone(c.data);
      }
    });
  };

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
            <div class="sequencer-bar">
              <label class="sequencer-choice">
                <span class="muted">${track.name} sequencer</span>
                <select value=${kind} onChange=${(e) => setSequencer(e.target.value)}>
                  <option value="steps">Steps</option>
                  ${Object.entries(GENERATIVE).map(([k, g]) => html`<option value=${k}>${g.label}</option>`)}
                </select>
              </label>
              <button class="ghost" onClick=${copy} title=${`Copy ${track.name}'s ${generative ? generative.label.toLowerCase() : 'notes'} in this pattern`}>Copy</button>
              <button class="ghost" disabled=${!copied} onClick=${paste}
                title=${copied ? `Paste ${copied.from} onto ${track.name}` : 'Copy a track\'s pattern first'}>Paste</button>
              ${copied && html`<span class="muted copied">Copied: ${copied.from}</span>`}
            </div>
            ${generative
              ? html`<${generative.Editor} key=${`${pattern.id}:${track.id}:${kind}`} store=${store} engine=${engine} pattern=${pattern} track=${track} />`
              : html`
            ${pitched && html`
              <div class="note-length" role="radiogroup" aria-label="Length of new notes">
                <span class="muted">New notes</span>
                ${NOTE_LENGTHS.map(([steps, label]) => html`
                  <button key=${steps} role="radio" aria-checked=${newLength === steps}
                    class=${newLength === steps ? 'active' : ''} onClick=${() => setNewLength(steps)}
                    title=${`${plural(steps, 'step')}`}>${label}</button>`)}
              </div>
              <div class="note-length arpeggio" role="group" aria-label="Arpeggio">
                <span class="muted">Arpeggio</span>
                <select aria-label="Chord shape" value=${arp.shape} onChange=${(e) => setArp({ ...arp, shape: e.target.value })}
                  title="A click lays down a run of this chord from the clicked note, one note per new-note length">
                  <option value="single">Off</option>
                  ${Object.entries(SHAPES).map(([k, s]) => html`<option value=${k}>${s.label}</option>`)}
                </select>
                ${arp.shape !== 'single' && html`
                  <select aria-label="Order" value=${arp.order} onChange=${(e) => setArp({ ...arp, order: e.target.value })}>
                    ${Object.entries(ORDERS).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
                  </select>
                  <select aria-label="Notes in the run" value=${arp.count} onChange=${(e) => setArp({ ...arp, count: Number(e.target.value) })}>
                    ${ARP_COUNTS.map((n) => html`<option value=${n}>${n} notes</option>`)}
                  </select>`}
              </div>`}
            <${StepGrid} key=${`${pattern.id}:${track.id}`} store=${store} engine=${engine} pattern=${pattern} track=${track}
              trackIndex=${doc.tracks.indexOf(track)} newLength=${newLength} arp=${arp} />`}
            <${AutomationLanes} store=${store} engine=${engine} pattern=${pattern} track=${track} />`}
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

  // Shortening drops notes and automation points past the new end;
  // lengthening keeps everything.
  const setLength = (length) => edit((p, d) => {
    p.length = length;
    for (const [tid, notes] of Object.entries(p.notes)) {
      p.notes[tid] = notes.filter((n) => n.step < length).map((n) => ({ ...n, length: Math.min(n.length, length - n.step) }));
    }
    pruneAutomation(d);
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

// The last change made to a step grid's notes, for its Undo: where it was
// made, what it did, the notes and selection from before it, and the
// song's edit count just after it, so Undo is only offered while nothing
// else has changed since. Kept outside the grid so it outlasts switching
// tracks, and tied to its song so it can't reach into another.
let lastEdit = null;

// What to hold to select notes, and to undo, as this computer names them.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const SELECT_KEY = MAC ? 'Ctrl or ⌘' : 'Ctrl';
const UNDO_KEY = MAC ? '⌘Z' : 'Ctrl+Z';

// Pitched rows' shift-arrows move a beat sideways or an octave up and down.
const NUDGES = {
  ArrowLeft: (shift) => ({ steps: shift ? -4 : -1, rows: 0 }),
  ArrowRight: (shift) => ({ steps: shift ? 4 : 1, rows: 0 }),
  ArrowUp: (shift, pitched) => ({ steps: 0, rows: shift && pitched ? 12 : 1 }),
  ArrowDown: (shift, pitched) => ({ steps: 0, rows: shift && pitched ? -12 : -1 }),
};

/**
 * The step sequencer. Drum-style instruments (those naming their `keys`)
 * get one row per sound, and every hit is a one-shot. Pitched instruments
 * get a two-octave piano roll that can be shifted up and down, where:
 *
 *   click an empty cell      add a note of the chosen length — or, with an
 *                            arpeggio chosen, the whole run from that note,
 *                            one note of that length after another
 *   drag from an empty cell  add a note and stretch it as you drag
 *   drag a note             resize it (its start stays put)
 *   click a note            remove it
 *   shift-click             accent
 *
 * And in either, to work on several notes at once:
 *
 *   ctrl-drag (or ⌘-drag)    select the notes in a box; with shift, add them
 *   ctrl-click a note        select it, or let it go
 *   drag a selected note     move every selected note (on a piano roll, its
 *                            last step still stretches it instead)
 *   arrow keys               nudge them a step or a row; with shift, a beat
 *                            or an octave
 *   Delete / Backspace       remove them
 *   Esc, or click an empty cell   let them go
 *
 * Undo (or ctrl/⌘-Z) takes back the last change to the notes, a whole drag
 * at a time.
 */
function StepGrid({ store, engine, pattern, track, trackIndex, newLength, arp }) {
  const keys = trackKeys(track);
  const [baseOctave, setBaseOctave] = useState(keys ? 0 : defaultOctave(pattern.notes[track.id]));
  const [picked, setPicked] = useState(() => new Set());   // keys of the selected notes
  const [box, setBox] = useState(null);                     // the selection box being dragged, in px within the grid
  const gridRef = useRef();
  const drag = useRef(null);
  const position = useEngineEvent(engine, 'position', engine.position);
  const playStep = position?.patternId === pattern.id ? position.step : -1;

  const notes = pattern.notes[track.id] ?? [];
  const rows = keys
    ? Object.entries(keys).map(([note, label]) => ({ note: Number(note), label }))
    : Array.from({ length: VISIBLE_OCTAVES * 12 }, (_, i) => {
      const note = (baseOctave + 1) * 12 + VISIBLE_OCTAVES * 12 - 1 - i;
      return { note, label: noteName(note), black: isBlackKey(note) };
    });
  const lo = rows.at(-1).note;
  const hi = rows[0].note;
  const above = keys ? 0 : notes.filter((n) => n.note > hi).length;
  const below = keys ? 0 : notes.filter((n) => n.note < lo).length;
  // The pitches a note can move between, bottom row first.
  const scale = keys ? rows.map((r) => r.note).reverse() : Array.from({ length: 128 }, (_, i) => i);
  // Notes taken away or changed some other way are no longer selected.
  const selected = new Set(notes.map(noteKey).filter((k) => picked.has(k)));

  // Every change to the notes goes through here, so the last one can be
  // undone; the edits of one drag undo together.
  const editNotes = (fn, label) => {
    const g = drag.current;
    const continuing = g?.undo && g.undo === lastEdit;
    let applied = false;
    store.edit((d) => {
      const p = d.patterns.find((x) => x.id === pattern.id);
      const before = p.notes[track.id] ?? [];
      if (!continuing) {
        lastEdit = { song: store.id, pattern: pattern.id, track: track.id, label, notes: structuredClone(before), selected: [...selected] };
        if (g) g.undo = lastEdit;
      }
      p.notes[track.id] = fn(before);
      if (!p.notes[track.id].length) delete p.notes[track.id];
      applied = true;
    });
    if (applied) lastEdit.at = store.editCount;
  };

  const canUndo = lastEdit?.song === store.id && lastEdit.pattern === pattern.id && lastEdit.track === track.id && lastEdit.at === store.editCount;
  const undo = () => {
    if (!canUndo) return;
    const { notes: before, selected: was } = lastEdit;
    lastEdit = null;
    store.edit((d) => {
      const p = d.patterns.find((x) => x.id === pattern.id);
      if (before.length) p.notes[track.id] = before;
      else delete p.notes[track.id];
    });
    setPicked(new Set(was));
  };

  // Notes are identified by pitch and start step: the same row never holds
  // two notes starting on one step.
  const sameNote = (n, note, step) => n.note === note && n.step === step;
  const removeNote = (note, step) => editNotes((list) => list.filter((n) => !sameNote(n, note, step)), 'removing a note');
  const resizeNote = (note, step, length) =>
    editNotes((list) => list.map((n) => (sameNote(n, note, step) ? { ...n, length } : n)), 'stretching a note');

  const deleteSelected = () => {
    editNotes((list) => list.filter((n) => !selected.has(noteKey(n))), `deleting ${plural(selected.size, 'note')}`);
    setPicked(new Set());
  };
  const nudge = (by) => {
    const moved = moveNotes(notes, selected, by, { length: pattern.length, scale });
    if (!moved.by.steps && !moved.by.rows) return;
    editNotes(() => moved.notes, `moving ${plural(selected.size, 'note')}`);
    setPicked(moved.keys);
  };

  const stepAt = (clientX) => {
    const rect = gridRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(pattern.length - 1, Math.floor(((clientX - rect.left) / rect.width) * pattern.length)));
  };
  const rowAt = (clientY) => {
    const first = gridRef.current.querySelector('.row').getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.floor((clientY - first.top) / first.height)));
  };
  // Where the pointer is in the grid, in px, kept inside it.
  const within = (e) => {
    const rect = gridRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
  };
  // On a piano roll, the right half of a note's last step is its handle for stretching.
  const onStretchHandle = (e, n, step) => {
    if (keys || step !== n.step + n.length - 1) return false;
    const rect = gridRef.current.getBoundingClientRect();
    return e.clientX - rect.left >= ((step + 0.5) / pattern.length) * rect.width;
  };

  // A note may grow rightward up to the next note on its row, or the pattern's end.
  const roomAfter = (note, step, list = notes) =>
    list.filter((n) => n.note === note && n.step > step).reduce((m, n) => Math.min(m, n.step), pattern.length) - step;

  // Lay an arpeggio's notes down from `step`, one new-note length apart,
  // skipping any that would land on a note already there or past the end.
  const placeArpeggio = (root, step, velocity) => {
    const run = arpeggio(root, arp.shape, arp.order, arp.count);
    editNotes((list) => {
      const out = [...list];
      run.forEach((note, i) => {
        const at = step + i * newLength;
        if (at >= pattern.length || out.length >= LIMITS.notesPerTrack) return;
        if (out.some((n) => n.note === note && n.step <= at && at < n.step + n.length)) return;
        out.push({ step: at, note, velocity, length: Math.min(newLength, roomAfter(note, at, out)) });
      });
      return out;
    }, 'adding a run');
    engine.audition(track.id, root, velocity);
  };

  const onPointerDown = (e, note) => {
    const boxing = e.ctrlKey || e.metaKey;
    // On a Mac, a ctrl-click can come through as a right click.
    if (e.button !== 0 && !(boxing && e.button === 2)) return;
    const step = stepAt(e.clientX);
    const row = rowAt(e.clientY);
    const hit = notes.find((n) => n.note === note && n.step <= step && step < n.step + n.length);

    if (boxing) {
      drag.current = { kind: 'box', from: within(e), step, row, hit, add: e.shiftKey, base: selected, moved: false };
      gridRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (hit && selected.has(noteKey(hit)) && !onStretchHandle(e, hit, step)) {
      // Nothing changes yet: moving drags the selection along, releasing in place removes the note.
      drag.current = { kind: 'move', hit, step, row, origin: notes, keys: selected, by: { steps: 0, rows: 0 }, moved: false };
      gridRef.current.setPointerCapture(e.pointerId);
      return;
    }
    // With notes selected, a click on an empty cell lets them go rather than adding one.
    if (!hit && selected.size) return setPicked(new Set());

    if (hit && keys) return removeNote(note, hit.step);
    if (hit) {
      // Nothing changes yet: moving makes this a resize, releasing in place a removal.
      drag.current = { kind: 'resize', note, start: hit.step, length: hit.length, max: roomAfter(note, hit.step), downStep: step, moved: false, existing: true };
    } else {
      if (notes.length >= LIMITS.notesPerTrack) return;
      const velocity = e.shiftKey ? 1 : 0.75;
      if (!keys && arp?.shape !== 'single') return placeArpeggio(note, step, velocity);
      const length = keys ? 1 : Math.min(newLength, roomAfter(note, step));
      // Started first, so stretching the new note undoes along with adding it.
      if (!keys) drag.current = { kind: 'resize', note, start: step, length, max: roomAfter(note, step), downStep: step, moved: false, existing: false };
      editNotes((list) => [...list, { step, note, velocity, length }], 'adding a note');
      engine.audition(track.id, note, velocity);
      if (keys) return;
    }
    gridRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'box') return dragBox(d, e);
    if (d.kind === 'move') return dragSelection(d, e);
    const step = stepAt(e.clientX);
    if (step !== d.downStep) d.moved = true;
    if (!d.moved) return;
    const length = Math.max(1, Math.min(d.max, step - d.start + 1));
    if (length === d.length) return;
    d.length = length;
    resizeNote(d.note, d.start, length);
  };

  // Select whatever the box touches, as it's drawn.
  const dragBox = (d, e) => {
    const at = within(e);
    if (!d.moved && Math.hypot(at.x - d.from.x, at.y - d.from.y) < 4) return;
    d.moved = true;
    setBox({ x: Math.min(d.from.x, at.x), y: Math.min(d.from.y, at.y), w: Math.abs(at.x - d.from.x), h: Math.abs(at.y - d.from.y) });
    const [r0, r1] = [d.row, rowAt(e.clientY)].sort((a, b) => a - b);
    const [s0, s1] = [d.step, stepAt(e.clientX)].sort((a, b) => a - b);
    const inside = notesInBox(notes, [s0, s1], new Set(rows.slice(r0, r1 + 1).map((r) => r.note)));
    setPicked(d.add ? new Set([...d.base, ...inside]) : inside);
  };

  // Move the selection with the pointer: always from where it started, so
  // a note passed over on the way isn't harmed, only one it ends up on.
  const dragSelection = (d, e) => {
    const step = stepAt(e.clientX);
    const row = rowAt(e.clientY);
    if (step !== d.step || row !== d.row) d.moved = true;
    const moved = moveNotes(d.origin, d.keys, { steps: step - d.step, rows: d.row - row }, { length: pattern.length, scale });
    if (moved.by.steps === d.by.steps && moved.by.rows === d.by.rows) return;
    const pitchChanged = moved.by.rows !== d.by.rows;
    d.by = moved.by;
    editNotes(() => moved.notes, `moving ${plural(d.keys.size, 'note')}`);
    setPicked(moved.keys);
    if (pitchChanged) engine.audition(track.id, scale[scale.indexOf(d.hit.note) + moved.by.rows], d.hit.velocity);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'box') {
      setBox(null);
      if (d.moved) return;
      // A ctrl-click: a note in or out of the selection, or on an empty cell, letting go of them all.
      if (d.hit) {
        const next = new Set(selected);
        if (!next.delete(noteKey(d.hit))) next.add(noteKey(d.hit));
        setPicked(next);
      } else if (!d.add) {
        setPicked(new Set());
      }
      return;
    }
    if (d.kind === 'move' && !d.moved) return removeNote(d.hit.note, d.hit.step);
    if (d.existing && !d.moved) removeNote(d.note, d.start);
  };

  const cancelDrag = () => {
    drag.current = null;
    setBox(null);
  };

  // Keys: undo anywhere on the page; nudge, delete and let go while notes are selected.
  const onKey = useRef();
  onKey.current = (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      if (!canUndo) return;
      e.preventDefault();
      return undo();
    }
    if (!selected.size || mod || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'Escape') {
      setPicked(new Set());
    } else if (NUDGES[e.key]) {
      e.preventDefault();
      nudge(NUDGES[e.key](e.shiftKey, !keys));
    }
  };
  useEffect(() => {
    const listener = (e) => onKey.current(e);
    addEventListener('keydown', listener);
    return () => removeEventListener('keydown', listener);
  }, []);

  // cell lookup: "note:step" → { note, part: 'start' | 'held' | 'end' | 'single' }
  const cells = new Map();
  for (const n of notes) {
    for (let s = n.step; s < n.step + n.length; s++) {
      const part = n.length === 1 ? 'single' : s === n.step ? 'start' : s === n.step + n.length - 1 ? 'end' : 'held';
      cells.set(`${n.note}:${s}`, { n, part });
    }
  }

  const what = keys ? 'hit' : 'note';
  return html`
    <div class="step-grid" style=${`--hue: ${hue(trackIndex)}; --steps: ${pattern.length}`}>
      <div class="grid-tools">
        ${!keys && html`
          <button class="ghost" disabled=${baseOctave >= 7} onClick=${() => setBaseOctave(baseOctave + 1)}>▲ Octave ${above ? html`<em>${above} above</em>` : ''}</button>
          <button class="ghost" disabled=${baseOctave <= 0} onClick=${() => setBaseOctave(baseOctave - 1)}>▼ Octave ${below ? html`<em>${below} below</em>` : ''}</button>`}
        <span class="spacer"></span>
        ${selected.size > 0 && html`<span class="selection">${plural(selected.size, what)} selected</span>`}
        <button class="ghost" disabled=${!canUndo} onClick=${undo}
          title=${canUndo ? `Undo ${lastEdit.label} (${UNDO_KEY})` : 'Nothing to undo: Undo takes back the last change to these notes'}>↶ Undo</button>
      </div>
      <div class="grid-wrap">
        <div class="labels">
          <div class="corner"></div>
          ${rows.map((r) => keys
            ? html`
              <button key=${r.note} class="row-label"
                onClick=${() => engine.audition(track.id, r.note)}>${r.label}</button>`
            : html`
              <button key=${r.note} class=${pianoKeyClass(r.note)} title=${r.label} aria-label=${r.label}
                onClick=${() => engine.audition(track.id, r.note)}>${r.note % 12 === 0 ? r.label : ''}</button>`)}
        </div>
        <div class=${`cells ${keys ? '' : 'pitched'}`} ref=${gridRef}
          onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerCancel=${cancelDrag}
          onContextMenu=${(e) => { if (e.ctrlKey || drag.current) e.preventDefault(); }}>
          <div class="step-numbers">
            ${Array.from({ length: pattern.length }, (_, s) => html`
              <span key=${s} class=${`${s % 4 === 0 ? 'beat' : ''} ${s === playStep ? 'now' : ''}`}>${s % 4 === 0 ? s / 4 + 1 : ''}</span>`)}
          </div>
          ${rows.map((r) => html`
            <div key=${r.note} class=${`row ${r.black ? 'black' : ''}`} onPointerDown=${(e) => onPointerDown(e, r.note)}>
              ${Array.from({ length: pattern.length }, (_, s) => {
                const c = cells.get(`${r.note}:${s}`);
                const cls = ['cell', s % 4 === 0 && 'beat', s === playStep && 'now',
                  c && `on ${c.part}`, c && c.n.velocity >= 0.95 && 'accent', c && selected.has(noteKey(c.n)) && 'selected'].filter(Boolean).join(' ');
                return html`<div key=${s} class=${cls}></div>`;
              })}
            </div>`)}
          ${box && html`<div class="select-box" style=${`left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px`}></div>`}
        </div>
      </div>
      <p class="hint muted">${selected.size
        ? `${plural(selected.size, what)} selected. Drag one to move them all${keys ? '' : ' (its last step still stretches it)'}; the arrow keys nudge them${keys ? '' : ', with Shift by a beat or an octave'}; Delete removes them; Esc or a click on an empty cell lets them go.`
        : `${keys
          ? 'Click to add or remove a hit; drum hits are one-shots, so they have no length. Shift-click for an accent.'
          : arp?.shape !== 'single'
            ? `Click to lay down a ${SHAPES[arp.shape].label.toLowerCase()} run of ${arp.count} notes from that note, ${ORDERS[arp.order].toLowerCase()}, one note per new-note length. Drag a note to resize it; click it to remove. Shift-click for accents.`
            : 'Click to add a note, or drag to stretch it as you place it. Drag a note to resize it; click it to remove. Shift-click for an accent. On a mono synth, overlapping notes slide.'} Hold ${SELECT_KEY} and drag to select several ${what}s.`}</p>
    </div>
  `;
}

/**
 * A key on the roll's keyboard. Each row is one pitch, so white keys meet
 * mid-row on the black keys between them, and on the row edge only below
 * C and F, where two white keys sit side by side.
 */
function pianoKeyClass(note) {
  if (isBlackKey(note)) return 'piano-key black';
  return `piano-key white ${note % 12 === 0 || note % 12 === 5 ? 'edge' : ''}`;
}

/** Start the roll where the track's notes are, or around C3 for an empty one. */
function defaultOctave(notes = []) {
  if (!notes.length) return 3;
  const lowest = Math.min(...notes.map((n) => n.note));
  return Math.max(0, Math.min(7, Math.floor(lowest / 12) - 1));
}
