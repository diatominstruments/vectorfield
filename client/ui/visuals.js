import { useEffect, useRef, useState } from 'preact/hooks';
import { catalog, describe } from 'gloaming-kit';
import { html, hue, useEngineEvent } from '../lib.js';
import { blockTimes, newVisual, visualsInEffect } from '../../shared/song.js';
import { VISUAL_LIMITS } from '../../shared/visuals.js';
import { VisualPanel, LookPanel, vizLabel } from './visual-config.js';
import { VisualCanvas, songTimeline } from './visual-canvas.js';
import { fmtTime } from './song-view.js';

/** The song as it will be once the open visual browser's picks are saved. */
function previewDoc(doc, browse) {
  if (!browse?.picks.length && !browse?.removed.length) return doc;
  return {
    ...doc,
    arrangement: doc.arrangement.map((b) => (b.id !== browse.blockId ? b : {
      ...b,
      visuals: [
        ...b.visuals.filter((v) => !browse.removed.includes(v.viz)),
        ...browse.picks.map((viz, i) => ({ id: `pick${i}`, viz, bind: {}, options: {} })),
      ],
    })),
  };
}

/**
 * Live preview of the song's visuals; while stopped it holds on the
 * selected block, so edits show immediately.
 */
function Preview({ store, engine, previewTime, browse }) {
  const doc = previewDoc(store.doc, browse);
  return html`<${VisualCanvas} engine=${engine} timeline=${songTimeline(doc)} look=${store.doc.look} holdTime=${previewTime} />`;
}

export function VisualsView({ store, engine }) {
  const { doc } = store;
  const [selection, setSelection] = useState({ kind: 'look' });
  // The open visual browser: the block it edits, the visualizations picked
  // so far (in the order they'll be added), and those it will take off.
  const [browse, setBrowse] = useState(null);
  const previewTime = useRef(0);
  const configRef = useRef();
  const position = useEngineEvent(engine, 'position', engine.position);
  const playingIndex = position && engine.cursor?.mode === 'song' ? position.index : -1;

  const patterns = new Map(doc.patterns.map((p, i) => [p.id, { p, i }]));
  const times = blockTimes(doc);
  const inEffect = visualsInEffect(doc);

  const select = (sel, blockIndex) => {
    setSelection(sel);
    // Stacked layout: the panel is below the whole timeline, so bring it to the user.
    if (matchMedia('(max-width: 900px)').matches) {
      requestAnimationFrame(() => configRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    // Hold the stopped preview a moment into the block, past any fade-in.
    if (blockIndex !== undefined) previewTime.current = times[blockIndex].start + 0.001;
  };

  const editBlock = (blockId, fn) => store.edit((d) => fn(d.arrangement.find((b) => b.id === blockId), d));

  const openBrowser = (blockIndex) => {
    const { id } = doc.arrangement[blockIndex];
    if (browse?.blockId === id) return setBrowse(null);
    setBrowse({ blockId: id, picks: [], removed: [] });
    // Hold the stopped preview on this block, so picks show as they're made.
    previewTime.current = times[blockIndex].start + 0.001;
  };

  const saveBrowser = () => {
    const blockIndex = doc.arrangement.findIndex((b) => b.id === browse.blockId);
    const added = browse.picks.map(newVisual);
    const { removed } = browse;
    setBrowse(null);
    if (blockIndex < 0 || (!added.length && !removed.length)) return;
    editBlock(browse.blockId, (b) => {
      b.visuals = b.visuals.filter((v) => !removed.includes(v.viz));
      b.visuals.push(...added);
    });
    // Open the last new one's settings, ready to tweak.
    if (added.length) select({ kind: 'visual', blockId: browse.blockId, visualId: added.at(-1).id }, blockIndex);
  };

  // Resolve the selection against the current doc; anything deleted falls back to the song look.
  const selIndex = selection.blockId ? doc.arrangement.findIndex((b) => b.id === selection.blockId) : -1;
  const selBlock = doc.arrangement[selIndex];
  const selVisual = selection.kind === 'visual' ? selBlock?.visuals.find((v) => v.id === selection.visualId) : null;
  const blockLabel = selBlock ? `Block ${selIndex + 1} · ${patterns.get(selBlock.pattern).p.name}` : '';

  let panel;
  if (selVisual) {
    const vi = selBlock.visuals.indexOf(selVisual);
    panel = html`<${VisualPanel} key=${selVisual.id} visual=${selVisual} blockLabel=${blockLabel}
      canMove=${{ left: vi > 0, right: vi < selBlock.visuals.length - 1 }}
      onChange=${(fn) => editBlock(selBlock.id, (b) => fn(b.visuals.find((v) => v.id === selVisual.id)))}
      onMove=${(by) => editBlock(selBlock.id, (b) => { const [v] = b.visuals.splice(vi, 1); b.visuals.splice(vi + by, 0, v); })}
      onRemove=${() => { editBlock(selBlock.id, (b) => { b.visuals.splice(vi, 1); }); setSelection({ kind: 'block', blockId: selBlock.id }); }} />`;
  } else if (selection.kind === 'block' && selBlock) {
    panel = html`<${LookPanel} title=${`${blockLabel} look`} style=${selBlock.style} inherited=${doc.look}
      hint="Changes here apply while this block plays. ↺ returns a setting to the song look."
      onChange=${(key, value) => editBlock(selBlock.id, (b) => {
        const style = { ...b.style };
        if (value === undefined) delete style[key]; else style[key] = value;
        b.style = Object.keys(style).length ? style : null;
      })} />`;
  } else {
    panel = html`<${LookPanel} title="Song look" style=${doc.look}
      hint="The base colours for every block. Click a song block to change them for one section, or a visual to configure it."
      onChange=${(key, value) => store.edit((d) => { d.look[key] = value; })} />`;
  }

  // A deleted block takes its open browser with it.
  const browseIndex = browse ? doc.arrangement.findIndex((b) => b.id === browse.blockId) : -1;
  if (browse && browseIndex < 0) setBrowse(null);

  return html`
    <section class=${`visuals ${browseIndex >= 0 ? 'browsing' : ''}`}>
      <div class="visuals-main">
        <${Preview} store=${store} engine=${engine} previewTime=${previewTime} browse=${browseIndex >= 0 ? browse : null} />

        ${doc.arrangement.length === 0
          ? html`<p class="muted empty">Chain some patterns in the Song view first; visuals attach to its blocks.</p>`
          : html`
            <ol class="viz-timeline">
              ${doc.arrangement.map((block, i) => {
                const { p, i: pi } = patterns.get(block.pattern);
                const blockSelected = selection.kind === 'block' && selection.blockId === block.id;
                return html`
                  <li key=${block.id} class=${i === playingIndex ? 'now' : ''} style=${`--hue: ${hue(pi)}; --length: ${p.length}`}>
                    <span class="bar" title="Start time">${fmtTime(times[i].start)}</span>
                    <button class=${`block ${blockSelected ? 'selected' : ''}`} onClick=${() => select({ kind: 'block', blockId: block.id }, i)}
                      title="Set this block's look">
                      <span class="name">${p.name}</span>
                      ${block.style && html`<span class="swatch" style=${`background: ${block.style.background ?? doc.look.background}; border-color: ${block.style.lineColor ?? doc.look.lineColor}`}></span>`}
                    </button>
                    <div class="viz-blocks">
                      ${block.visuals.map((v) => html`
                        <button key=${v.id}
                          class=${`viz-block ${selection.visualId === v.id ? 'selected' : ''} ${describe(v.viz) ? '' : 'missing'} ${browseIndex === i && browse.removed.includes(v.viz) ? 'removing' : ''}`}
                          onClick=${() => select({ kind: 'visual', blockId: block.id, visualId: v.id }, i)}>
                          ${vizLabel(v.viz)}${Object.keys(v.bind).length || Object.keys(v.options).length ? html` <small>•</small>` : ''}
                        </button>`)}
                      ${!block.visuals.length && inEffect[i].source >= 0 && inEffect[i].visuals.map((v) => html`
                        <button key=${v.id} class="viz-block continued"
                          title=${`Continues from block ${inEffect[i].source + 1}. Click to edit it there, or add a visual to change this block.`}
                          onClick=${() => select({ kind: 'visual', blockId: doc.arrangement[inEffect[i].source].id, visualId: v.id }, inEffect[i].source)}>
                          ↳ ${vizLabel(v.viz)}
                        </button>`)}
                      ${browseIndex === i && browse.picks.map((viz, k) => html`
                        <span key=${`pick${k}`} class="viz-block pending" title="Not added yet: Save or Cancel below">+ ${vizLabel(viz)}</span>`)}
                      <button class=${`add-viz ${browseIndex === i ? 'open' : ''}`} aria-expanded=${browseIndex === i}
                        onClick=${() => openBrowser(i)}>${block.visuals.length < VISUAL_LIMITS.perBlock ? '+ Visual' : 'Visuals…'}</button>
                      <button class="ghost play-here" onClick=${() => engine.play({ index: i })} title="Play from here">▶</button>
                    </div>
                    ${browseIndex === i && html`
                      <${VisualBrowser} browse=${browse} added=${block.visuals.map((v) => v.viz)}
                        limit=${VISUAL_LIMITS.perBlock}
                        onChange=${(change) => setBrowse({ ...browse, ...change })}
                        onPlay=${() => engine.play({ index: i })}
                        onSave=${saveBrowser} onCancel=${() => setBrowse(null)} />`}
                  </li>`;
              })}
            </ol>`}
      </div>
      <aside class="visuals-config" ref=${configRef}>
        ${selection.kind !== 'look' && html`<button class="ghost back" onClick=${() => setSelection({ kind: 'look' })}>← Song look</button>`}
        ${panel}
      </aside>
    </section>
  `;
}

/**
 * The visual browser: every visualization, by category, as cards, with the
 * ones already on the block highlighted. Clicking a card picks it, or for
 * one already on the block marks it to come off; clicking again undoes
 * either. The preview above shows the result straight away, and nothing is
 * saved until Save.
 */
function VisualBrowser({ browse, added, limit, onChange, onPlay, onSave, onCancel }) {
  const ref = useRef();
  const { picks, removed } = browse;
  const kept = added.filter((viz) => !removed.includes(viz)).length;
  const full = kept + picks.length >= limit;
  const changed = picks.length + removed.length > 0;

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [browse.blockId]);

  const toggle = (id, onBlock) => {
    if (onBlock) {
      // Removing a visual takes every copy of it off the block.
      onChange({ removed: removed.includes(id) ? removed.filter((r) => r !== id) : [...removed, id] });
    } else {
      onChange({ picks: picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id] });
    }
  };

  const summary = [
    picks.length && `${picks.length} to add`,
    removed.length && `${removed.length} to remove`,
  ].filter(Boolean).join(', ');

  // At the top and again at the bottom, so a long list never hides them.
  const actions = html`
    <button class="ghost" onClick=${onCancel}>Cancel</button>
    <button class="primary" disabled=${!changed} onClick=${onSave}>Save</button>`;

  return html`
    <div class="viz-browser" ref=${ref} role="dialog" aria-label="Choose visuals">
      <header>
        <div>
          <strong>Visuals for this block</strong>
          <span class="muted">
            ${summary ? ` ${summary}` : ' Pick visuals to add, or click a highlighted one to remove it. The preview shows the result as you go.'}
            ${full && ` · a block holds up to ${limit}`}
          </span>
        </div>
        <button class="ghost" onClick=${onPlay} title="Play from this block, to see the visuals move">▶ Play</button>
        ${actions}
      </header>
      ${catalog().map((group) => html`
        <section key=${group.id}>
          <h4>${group.label} <span>${group.description}</span></h4>
          <div class="viz-cards">
            ${group.visualizations.map(({ id, label, description }) => {
              const onBlock = added.filter((a) => a === id).length;
              const removing = removed.includes(id);
              const order = picks.indexOf(id);
              const picked = order >= 0;
              const selected = (onBlock && !removing) || picked;
              return html`
                <button key=${id} aria-pressed=${Boolean(selected)}
                  class=${`viz-card ${picked ? 'picked' : ''} ${onBlock ? 'added' : ''} ${removing ? 'removing' : ''}`}
                  disabled=${!selected && !removing && full} onClick=${() => toggle(id, onBlock)}
                  title=${onBlock ? (removing ? 'Will be removed when you save. Click to keep it.' : 'On this block. Click to remove it.') : undefined}>
                  <strong>${label}</strong>
                  ${description && html`<span>${description}</span>`}
                  ${onBlock > 0 && html`<em>${removing ? 'Will be removed' : `✓ On this block${onBlock > 1 ? ` ×${onBlock}` : ''}`}</em>`}
                  ${picked && html`<i aria-label=${`Pick ${order + 1}`}>${order + 1}</i>`}
                </button>`;
            })}
          </div>
        </section>`)}
      <footer>${actions}</footer>
    </div>
  `;
}
