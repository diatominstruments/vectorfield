import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Link, navigate, useSubscription, useEngineEvent, useTitle } from '../lib.js';
import { api } from '../api.js';
import { Engine } from '../engine.js';
import { SongStore } from '../store.js';
import { LIMITS } from '../../shared/song.js';
import { InstrumentsView } from './instruments.js';
import { PatternsView } from './patterns.js';
import { SongView } from './song-view.js';
import { VisualsView } from './visuals.js';
import { PublishView } from './publish.js';

const VIEWS = [
  ['instruments', 'Instruments'],
  ['patterns', 'Patterns'],
  ['song', 'Song'],
  ['visuals', 'Visuals'],
  ['publish', 'Publish'],
];

const STATUS = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: "Couldn't save — retrying",
  conflict: 'Changed in another tab — reload to continue',
};

export function Editor({ songId, view }) {
  const engine = useMemo(() => new Engine(), []);
  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);
  const [patternId, setPatternId] = useState(null);

  useEffect(() => {
    api.get(`/songs/${songId}`).then(({ song }) => {
      const s = new SongStore(song, engine);
      setPatternId(s.doc.patterns[0]?.id ?? null);
      setStore(s);
    }, (e) => setError(e.message));
    return () => engine.dispose();
  }, [songId]);

  useSubscription(store);
  useTitle(store?.title ?? null);
  const playing = useEngineEvent(engine, 'state', false);
  const togglePlayRef = useRef(null);
  useSpaceToPlay(togglePlayRef);

  // Warn before leaving with unsaved edits; save right away when the tab is hidden.
  useEffect(() => {
    if (!store) return;
    const beforeUnload = (e) => { if (store.dirty) e.preventDefault(); };
    const hidden = () => { if (document.hidden) store.save(); };
    addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      store.save();
      removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [store]);

  if (error) return html`<main class="editor"><p class="error">${error}</p><${Link} href="/studio">Back to the studio</${Link}></main>`;
  if (!store) return html`<div class="loading">Loading song…</div>`;

  const doc = store.doc;
  const pattern = doc.patterns.find((p) => p.id === patternId) ?? doc.patterns[0];

  // Play follows the view: the pattern being edited loops, anything else
  // plays the arrangement (or the current pattern if there isn't one yet).
  const togglePlay = () => {
    if (engine.playing) return engine.stop();
    if (view !== 'patterns' && doc.arrangement.length) engine.play({ index: 0 });
    else if (pattern) engine.play({ patternId: pattern.id });
  };

  togglePlayRef.current = togglePlay;

  return html`
    <main class="editor">
      <div class="toolbar">
        <${Link} href="/studio" class="ghost">← Studio</${Link}>
        <input class="title" value=${store.title} maxlength=${LIMITS.nameLength} aria-label="Song title"
          onInput=${(e) => store.setTitle(e.target.value)} />
        <span class=${`status ${store.status}`}>${STATUS[store.status]}</span>
        <div class="transport">
          <button class=${`play ${playing ? 'on' : ''}`} onClick=${togglePlay} title="Play / stop (space)">
            ${playing ? '■ Stop' : '▶ Play'}
          </button>
          <label>BPM
            <input type="number" min=${LIMITS.bpm[0]} max=${LIMITS.bpm[1]} value=${doc.bpm}
              onChange=${(e) => {
                const bpm = Math.min(LIMITS.bpm[1], Math.max(LIMITS.bpm[0], Number(e.target.value) || doc.bpm));
                store.edit((d) => { d.bpm = bpm; });
              }} />
          </label>
        </div>
      </div>
      <nav class="tabs">
        ${VIEWS.map(([id, label]) => html`
          <${Link} href=${`/songs/${songId}/${id}`} class=${view === id ? 'active' : ''}>${label}</${Link}>`)}
      </nav>
      ${view === 'instruments' && html`<${InstrumentsView} store=${store} engine=${engine} />`}
      ${view === 'patterns' && html`<${PatternsView} store=${store} engine=${engine}
        pattern=${pattern} onSelect=${setPatternId} />`}
      ${view === 'song' && html`<${SongView} store=${store} engine=${engine}
        onEditPattern=${(id) => { setPatternId(id); navigate(`/songs/${songId}/patterns`); }} />`}
      ${view === 'visuals' && html`<${VisualsView} store=${store} engine=${engine} />`}
      ${view === 'publish' && html`<${PublishView} store=${store} engine=${engine} />`}
    </main>
  `;
}

/** Space plays and stops, unless a control has focus. */
export function useSpaceToPlay(toggleRef) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (e.target.closest('input, select, textarea, button')) return;
      e.preventDefault();
      toggleRef.current?.();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
