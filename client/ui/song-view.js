import { html, hue, useEngineEvent } from '../lib.js';
import { LIMITS } from '../../shared/song.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The arrangement: patterns chained in play order. The same pattern can
 * appear any number of times; each block's width follows its length.
 */
export function SongView({ store, engine, onEditPattern }) {
  const { doc } = store;
  const position = useEngineEvent(engine, 'position', engine.position);
  const byId = new Map(doc.patterns.map((p, i) => [p.id, { p, i }]));
  const full = doc.arrangement.length >= LIMITS.arrangement;

  const steps = doc.arrangement.reduce((n, id) => n + byId.get(id).p.length, 0);
  const seconds = (steps * 60) / doc.bpm / 4;

  const edit = (fn) => store.edit((d) => fn(d.arrangement, d));
  const move = (i, by) => edit((a) => { const [x] = a.splice(i, 1); a.splice(i + by, 0, x); });

  return html`
    <section class="song-view">
      <div class="palette">
        <span class="muted">Add:</span>
        ${doc.patterns.map((p, i) => html`
          <button key=${p.id} class="chip" style=${`--hue: ${hue(i)}`} disabled=${full}
            onClick=${() => edit((a) => { a.push(p.id); })}>+ ${p.name}</button>`)}
      </div>

      ${doc.arrangement.length === 0
        ? html`<p class="muted empty">Click patterns above to chain them into a song.</p>`
        : html`
          <ol class="arrangement">
            ${doc.arrangement.map((id, i) => {
              const { p, i: pi } = byId.get(id);
              const now = position && engine.cursor?.mode === 'song' && position.index === i;
              return html`
                <li key=${`${i}:${id}`} class=${now ? 'now' : ''} style=${`--hue: ${hue(pi)}; flex-grow: ${p.length}`}>
                  <button class="block" onClick=${() => onEditPattern(id)} title="Edit this pattern">
                    <span class="index">${i + 1}</span> ${p.name}
                  </button>
                  ${now && html`<div class="progress" style=${`width: ${((position.step + 1) / p.length) * 100}%`}></div>`}
                  <div class="block-actions">
                    <button class="ghost" onClick=${() => engine.play({ index: i })} title="Play from here">▶</button>
                    <button class="ghost" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="Move earlier">←</button>
                    <button class="ghost" disabled=${i === doc.arrangement.length - 1} onClick=${() => move(i, 1)} aria-label="Move later">→</button>
                    <button class="ghost danger" onClick=${() => edit((a) => { a.splice(i, 1); })} aria-label="Remove">✕</button>
                  </div>
                </li>`;
            })}
          </ol>
          <p class="muted">${plural(doc.arrangement.length, 'block')} · ${plural(steps / 16, 'bar')} · ${fmtTime(seconds)} at ${doc.bpm} BPM</p>`}
    </section>
  `;
}
