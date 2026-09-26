import { html, hue, useEngineEvent } from '../lib.js';
import { LIMITS, newId, newBlock, copyBlock } from '../../shared/song.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The arrangement: blocks in play order, top to bottom, each playing one
 * pattern. The same pattern can appear any number of times; each block's
 * height follows its length, and its controls sit alongside it.
 */
export function SongView({ store, engine, onEditPattern }) {
  const { doc } = store;
  const position = useEngineEvent(engine, 'position', engine.position);
  const byId = new Map(doc.patterns.map((p, i) => [p.id, { p, i }]));
  const full = doc.arrangement.length >= LIMITS.arrangement;

  const steps = doc.arrangement.reduce((n, b) => n + byId.get(b.pattern).p.length, 0);
  const seconds = (steps * 60) / doc.bpm / 4;

  const edit = (fn) => store.edit((d) => fn(d.arrangement, d));
  const move = (i, by) => edit((a) => { const [x] = a.splice(i, 1); a.splice(i + by, 0, x); });

  // Copy this block's pattern into a new one and point just this block at
  // it, so one occurrence can be varied without touching the others.
  const makeUnique = (i) => {
    const source = byId.get(doc.arrangement[i].pattern).p;
    const copy = { ...structuredClone(source), id: newId(), name: `${source.name} copy`.slice(0, LIMITS.nameLength) };
    store.edit((d) => {
      d.patterns.splice(d.patterns.findIndex((p) => p.id === source.id) + 1, 0, copy);
      d.arrangement[i].pattern = copy.id;
    });
  };

  let bar = 1;   // where each block starts, in bars

  return html`
    <section class="song-view">
      <div class="palette">
        <span class="muted">Add:</span>
        ${doc.patterns.map((p, i) => html`
          <button key=${p.id} class="chip" style=${`--hue: ${hue(i)}`} disabled=${full}
            onClick=${() => edit((a) => { a.push(newBlock(p.id)); })}>+ ${p.name}</button>`)}
      </div>

      ${doc.arrangement.length === 0
        ? html`<p class="muted empty">Click patterns above to chain them into a song.</p>`
        : html`
          <ol class="arrangement">
            ${doc.arrangement.map((block, i) => {
              const { p, i: pi } = byId.get(block.pattern);
              const now = position && engine.cursor?.mode === 'song' && position.index === i;
              const uses = doc.arrangement.filter((b) => b.pattern === block.pattern).length;
              const start = bar;
              bar += p.length / 16;
              return html`
                <li key=${block.id} class=${now ? 'now' : ''} style=${`--hue: ${hue(pi)}; --length: ${p.length}`}>
                  <span class="bar" title=${`Starts at bar ${start}`}>${start}</span>
                  <button class="block" onClick=${() => onEditPattern(block.pattern)} title="Edit this pattern">
                    ${now && html`<span class="progress" style=${`height: ${((position.step + 1) / p.length) * 100}%`}></span>`}
                    <span class="name">${p.name}</span>
                    <span class="length">${p.length} steps</span>
                  </button>
                  <div class="block-actions">
                    <button class="ghost" onClick=${() => engine.play({ index: i })} title="Play from here">▶</button>
                    <button class="ghost" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="Move up">↑</button>
                    <button class="ghost" disabled=${i === doc.arrangement.length - 1} onClick=${() => move(i, 1)} aria-label="Move down">↓</button>
                    <select value=${block.pattern} aria-label="Pattern for this block"
                      onChange=${(e) => { const pid = e.target.value; edit((a) => { a[i].pattern = pid; }); }}>
                      ${doc.patterns.map((q) => html`<option value=${q.id}>${q.name}</option>`)}
                    </select>
                    <button class="ghost" disabled=${full} onClick=${() => edit((a) => { a.splice(i + 1, 0, copyBlock(block)); })}
                      title="Repeat this block, visuals included, right after itself">Duplicate</button>
                    <button class="ghost" disabled=${uses < 2 || doc.patterns.length >= LIMITS.patterns} onClick=${() => makeUnique(i)}
                      title=${uses < 2 ? 'This pattern is only used here' : 'Give this block its own copy of the pattern, to vary it'}>Make unique</button>
                    <button class="ghost danger" onClick=${() => edit((a) => { a.splice(i, 1); })}>Remove</button>
                  </div>
                </li>`;
            })}
          </ol>
          <p class="muted">${plural(doc.arrangement.length, 'block')} · ${plural(steps / 16, 'bar')} · ${fmtTime(seconds)} at ${doc.bpm} BPM</p>`}
    </section>
  `;
}
