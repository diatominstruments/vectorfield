import { useState } from 'preact/hooks';
import { html, hue, useEngineEvent } from '../lib.js';
import { LIMITS, newId, newBlock, copyBlock, removeBlock, playOrder } from '../../shared/song.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The arrangement: blocks in play order, top to bottom, each playing one
 * pattern. The same pattern can appear any number of times; each block's
 * height follows its length, and its controls sit alongside it. A block's
 * options (section, repeats, muted tracks, loop and what plays next) open
 * beneath it.
 */
export function SongView({ store, engine, onEditPattern }) {
  const { doc } = store;
  const [openId, setOpenId] = useState(null);
  const position = useEngineEvent(engine, 'position', engine.position);
  const byId = new Map(doc.patterns.map((p, i) => [p.id, { p, i }]));
  const full = doc.arrangement.length >= LIMITS.arrangement;

  const steps = doc.arrangement.reduce((n, b) => n + byId.get(b.pattern).p.length * b.repeat, 0);
  const seconds = (steps * 60) / doc.bpm / 4;
  const order = playOrder(doc);
  const loopIndex = doc.arrangement.findIndex((b) => b.id === doc.loop);

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
              const open = openId === block.id;
              const muted = block.mute.filter((id) => doc.tracks.some((t) => t.id === id)).length;
              const start = bar;
              bar += (p.length / 16) * block.repeat;
              return html`
                <li key=${block.id} class=${`${now ? 'now' : ''} ${open ? 'open' : ''}`}
                  style=${`--hue: ${hue(pi)}; --length: ${p.length * block.repeat}`}>
                  ${block.section && html`<span class="section-name">${block.section}</span>`}
                  <span class="bar" title=${`Starts at bar ${start}`}>${start}</span>
                  <button class="block" onClick=${() => onEditPattern(block.pattern)} title="Edit this pattern">
                    ${now && html`<span class="progress" style=${`height: ${((position.pass * p.length + position.step + 1) / (p.length * block.repeat)) * 100}%`}></span>`}
                    <span class="name">${p.name}</span>
                    <span class="badges">
                      ${block.repeat > 1 && html`<span class="badge" title=${`Plays ${block.repeat} times`}>×${block.repeat}</span>`}
                      ${muted > 0 && html`<span class="badge" title="Tracks muted in this block">${muted} muted</span>`}
                      ${doc.loop === block.id && html`<span class="badge" title="The song loops back to here after the last block">↻ loop</span>`}
                      ${block.follow.length > 0 && html`<span class="badge" title="What plays next is picked at random">⤳ random</span>`}
                    </span>
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
                    <button class=${`ghost ${open ? 'active' : ''}`} aria-expanded=${open}
                      onClick=${() => setOpenId(open ? null : block.id)}>Options</button>
                    <button class="ghost" disabled=${full} onClick=${() => edit((a) => { a.splice(i + 1, 0, copyBlock(block)); })}
                      title="Repeat this block, visuals included, right after itself">Duplicate</button>
                    <button class="ghost" disabled=${uses < 2 || doc.patterns.length >= LIMITS.patterns} onClick=${() => makeUnique(i)}
                      title=${uses < 2 ? 'This pattern is only used here' : 'Give this block its own copy of the pattern, to vary it'}>Make unique</button>
                    <button class="ghost danger" onClick=${() => store.edit((d) => removeBlock(d, i))}>Remove</button>
                  </div>
                  ${open && html`<${BlockOptions} store=${store} block=${block} index=${i} byId=${byId} />`}
                </li>`;
            })}
          </ol>
          <p class="muted">
            ${plural(doc.arrangement.length, 'block')} · ${plural(steps / 16, 'bar')} · ${fmtTime(seconds)} at ${doc.bpm} BPM
            ${order === 'loops' && ` · then loops from block ${loopIndex + 1}`}
            ${order === 'varies' && ' · the order varies each play'}
          </p>`}
    </section>
  `;
}

/** A block's options: its section, repeats, muted tracks, loop and what plays next. */
function BlockOptions({ store, block, index, byId }) {
  const { doc } = store;
  const editBlock = (fn) => store.edit((d) => fn(d.arrangement.find((b) => b.id === block.id), d));
  const label = (b, i) => `Block ${i + 1} · ${byId.get(b.pattern).p.name}${b.section ? ` (${b.section})` : ''}`;

  const total = block.follow.reduce((n, f) => n + f.weight, 0);
  const taken = new Set(block.follow.map((f) => f.to));
  // The first place not yet a choice: the next block, then the rest, then the end.
  const untaken = () => [...doc.arrangement.slice(index + 1), ...doc.arrangement.slice(0, index + 1)]
    .map((b) => b.id).concat([null]).find((to) => !taken.has(to));
  const canAdd = block.follow.length < LIMITS.follow && untaken() !== undefined;

  return html`
    <div class="block-options">
      <label class="field">
        <span>Section</span>
        <input value=${block.section ?? ''} maxlength=${LIMITS.sectionLength} placeholder="e.g. Chorus"
          onInput=${(e) => { const v = e.target.value; editBlock((b) => { b.section = v.trim() ? v : null; }); }} />
        <small class="muted">Starts a section here, running until the next named one. Listeners see it as the song plays.</small>
      </label>

      <div class="field">
        <span>Repeat</span>
        <div class="stepper">
          <button disabled=${block.repeat <= 1} onClick=${() => editBlock((b) => { b.repeat--; })} aria-label="Fewer repeats">−</button>
          <output>×${block.repeat}</output>
          <button disabled=${block.repeat >= LIMITS.repeat} onClick=${() => editBlock((b) => { b.repeat++; })} aria-label="More repeats">+</button>
        </div>
        <small class="muted">Plays the pattern ${plural(block.repeat, 'time')} before moving on.</small>
      </div>

      <div class="field">
        <span>Tracks</span>
        <div class="track-toggles">
          ${doc.tracks.length === 0 && html`<span class="muted">No tracks yet.</span>`}
          ${doc.tracks.map((t, ti) => {
            const on = !block.mute.includes(t.id);
            return html`
              <button key=${t.id} class=${`track-toggle ${on ? 'on' : ''}`} style=${`--hue: ${hue(ti)}`} aria-pressed=${on}
                onClick=${() => editBlock((b) => { b.mute = on ? [...b.mute, t.id] : b.mute.filter((id) => id !== t.id); })}>
                ${t.name}
              </button>`;
          })}
        </div>
        <small class="muted">Mute tracks in just this block, to drop parts in and out without copying patterns.</small>
      </div>

      <label class="field check">
        <span>Loop</span>
        <input type="checkbox" checked=${doc.loop === block.id} aria-label="Loop back to this block"
          onChange=${(e) => { const on = e.target.checked; store.edit((d) => { d.loop = on ? block.id : null; }); }} />
        <small class="muted">After the last block, go back to this one and play on forever.${doc.loop && doc.loop !== block.id ? ' (Moves the loop from the block it is on now.)' : ''}</small>
      </label>

      <div class="field">
        <span>Then</span>
        <div class="segmented">
          <button class=${block.follow.length ? '' : 'on'} onClick=${() => editBlock((b) => { b.follow = []; })}>In order</button>
          <button class=${block.follow.length ? 'on' : ''}
            onClick=${() => { if (!block.follow.length) editBlock((b) => { b.follow = [{ to: untaken(), weight: 1 }]; }); }}>Pick at random</button>
        </div>
        <small class="muted">${block.follow.length
          ? 'When this block ends, one of these plays next. A higher weight comes up more often.'
          : index < doc.arrangement.length - 1 ? 'The next block plays after this one.' : doc.loop ? 'The song loops after this block.' : 'The song ends after this block.'}</small>
      </div>

      ${block.follow.length > 0 && html`
        <ul class="follow-list">
          ${block.follow.map((f, fi) => html`
            <li key=${String(f.to)}>
              <select value=${f.to ?? ''} aria-label="Plays next"
                onChange=${(e) => { const to = e.target.value || null; editBlock((b) => { b.follow[fi].to = to; }); }}>
                ${doc.arrangement.map((b, bi) => html`
                  <option value=${b.id} disabled=${taken.has(b.id) && b.id !== f.to}>${label(b, bi)}</option>`)}
                <option value="" disabled=${taken.has(null) && f.to !== null}>End of song</option>
              </select>
              <label>Weight
                <input type="number" min="1" max=${LIMITS.weight} value=${f.weight}
                  onChange=${(e) => {
                    const w = Math.min(LIMITS.weight, Math.max(1, Math.round(Number(e.target.value)) || 1));
                    editBlock((b) => { b.follow[fi].weight = w; });
                  }} />
              </label>
              <output>${Math.round((f.weight / total) * 100)}%</output>
              <button class="ghost danger" aria-label="Remove this choice" onClick=${() => editBlock((b) => { b.follow.splice(fi, 1); })}>×</button>
            </li>`)}
          <li><button class="ghost" disabled=${!canAdd} onClick=${() => editBlock((b) => { b.follow.push({ to: untaken(), weight: 1 }); })}>+ Add choice</button></li>
        </ul>`}
    </div>
  `;
}
