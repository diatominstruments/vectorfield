import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { instrumentKeys } from './params.js';
import { FROG_LIMITS, FROG_RADIUS, QUANTIZE } from '../../shared/frogs.js';
import { nextScaleNote } from '../../shared/scale.js';
import { newId } from '../../shared/song.js';
import { FrogSim } from '../frog-sim.js';
import { Range, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;            // canvas px around the pond
const RIPPLE_SECONDS = 0.6;   // how long a call's ripple takes to reach the edge of its reach and fade
const STEPS_PER_BEAT = 4;
const EVERYONE = Math.SQRT2;  // a reach this far is heard right across the pond
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };

const L = FROG_LIMITS;

/**
 * Editor for one track's frogs in a pattern: where they sit, their notes
 * and rates, and how far out of each other's way they keep.
 *
 *   click empty water       add a frog, tuned to the next note up
 *   drag a frog             move it, nearer to or further from the others
 *   click a frog            select it, to tune it and set its rate
 *   double-click a frog     take it away
 *
 * While the pattern plays, the canvas draws the engine's own frogs (read
 * back against the audio clock), so what you see is what you hear. While
 * it doesn't, silent preview frogs call instead, so changes can be
 * watched as they're made.
 */
export function FrogEditor({ store, engine, pattern, track }) {
  const config = pattern.frogs[track.id];
  const canvasRef = useRef();
  const gesture = useRef(null);
  const hover = useRef(null);
  const [picked, setSelected] = useState(null);   // frog id
  const keys = instrumentKeys(registry.get(track.instrument.id), track.instrument.params);
  // A frog removed by an edit is no longer selected.
  const selected = config.frogs.find((f) => f.id === picked) ?? null;

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).frogs[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, keys, bpm: store.doc.bpm, length: pattern.length };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0, beat: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'frogs');
      const scene = entry ? { now: engine.ctx.currentTime, hits: entry.hits } : runPreview(preview, live.current);
      draw(canvasRef.current, scene, live.current, gesture.current, hover.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, pattern.id, track.id]);

  // ---- tuning ------------------------------------------------------------------

  const noteChoices = keys
    ? Object.entries(keys).map(([n, label]) => [Number(n), label])
    : Array.from({ length: PITCH_RANGE[1] - PITCH_RANGE[0] + 1 }, (_, i) => [PITCH_RANGE[0] + i, noteName(PITCH_RANGE[0] + i)]);

  const select = (id) => {
    setSelected(id);
    const frog = config.frogs.find((f) => f.id === id);
    if (frog) engine.audition(track.id, frog.note);
  };

  const editFrog = (id, fn) => edit((c) => fn(c.frogs.find((f) => f.id === id)));
  const tune = (id, note) => {
    editFrog(id, (f) => { f.note = note; });
    engine.audition(track.id, note);
  };
  const removeFrog = (id) => edit((c) => { c.frogs = c.frogs.filter((f) => f.id !== id); });

  // A new frog calls at the pond's commonest rate, so it has turns to take.
  const addFrog = (at) => {
    const id = newId();
    const notes = config.frogs.map((f) => f.note);
    const note = nextScaleNote(notes, notes.length ? Math.min(...notes) : 60, keys);
    const rate = config.frogs.length ? config.frogs.reduce((s, f) => s + f.rate, 0) / config.frogs.length : 1;
    edit((c) => { c.frogs.push({ id, x: at.x, y: at.y, note, rate: Number(rate.toFixed(3)) }); });
    setSelected(id);
    engine.audition(track.id, note);
  };

  const set = (key) => (v) => edit((c) => { c[key] = v; });

  // ---- pointer -------------------------------------------------------------------

  const toPond = (e) => {
    // The canvas is drawn at a fixed resolution and scaled by CSS.
    const rect = canvasRef.current.getBoundingClientRect();
    const m = MARGIN * (rect.width / canvasRef.current.width);
    const size = rect.width - 2 * m;
    return { x: (e.clientX - rect.left - m) / size, y: (e.clientY - rect.top - m) / size };
  };
  const inside = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const clamp = (p) => ({
    x: Math.min(1 - FROG_RADIUS, Math.max(FROG_RADIUS, p.x)),
    y: Math.min(1 - FROG_RADIUS, Math.max(FROG_RADIUS, p.y)),
  });
  const frogAt = (p) => {
    let best = null;
    for (const f of config.frogs) {
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < FROG_RADIUS * 1.6 && d < (best?.d ?? Infinity)) best = { frog: f, d };
    }
    return best?.frog ?? null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = toPond(e);
    const frog = frogAt(p);
    if (frog) {
      gesture.current = { id: frog.id, start: p, at: { x: frog.x, y: frog.y }, dx: frog.x - p.x, dy: frog.y - p.y, moved: false };
      canvasRef.current.setPointerCapture(e.pointerId);
    } else if (inside(p) && config.frogs.length < L.frogs) {
      addFrog(clamp(p));
    }
  };

  const onPointerMove = (e) => {
    const p = toPond(e);
    const g = gesture.current;
    if (!g) {
      hover.current = frogAt(p);
      canvasRef.current.style.cursor = hover.current ? 'grab' : inside(p) ? 'copy' : 'default';
      return;
    }
    if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 0.01) g.moved = true;
    if (g.moved) g.at = clamp({ x: p.x + g.dx, y: p.y + g.dy });
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.moved) select(g.id);
    else editFrog(g.id, (f) => Object.assign(f, g.at));
  };

  const onDoubleClick = (e) => {
    const frog = frogAt(toPond(e));
    if (frog) removeFrog(frog.id);
  };

  const every = (rate) => `every ${beats(1 / rate)}`;

  return html`
    <div class="bounce-editor frog-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
          onPointerCancel=${() => { gesture.current = null; }} onPointerLeave=${() => { hover.current = null; }}
          onDblClick=${onDoubleClick}></canvas>
        <p class="hint muted">Click to add a frog; drag one to move it, click it to tune it, double-click to remove it. Each call plays that frog's note and moves the calls of the frogs within earshot away from it, so neighbours take turns: two alternate, more go round in a round.</p>
      </div>

      <div class="bounce-controls panel">
        <${Range} label="Avoidance" title="How far a frog shifts its next call away from one it hears" min="0" max="1" step="0.01" value=${config.avoidance}
          format=${(v) => (v === 0 ? 'none' : `${Math.round(v * 100)}%`)} onInput=${set('avoidance')} />
        <${Range} label="Reach" title="How far a call is heard: small for separate groups, large for the whole pond" min=${L.reach[0]} max=${L.reach[1]} step="0.01" value=${config.reach}
          format=${(v) => (v >= EVERYONE ? 'everyone' : `${Math.round(v * 100)}%`)} onInput=${set('reach')} />
        <${Range} label="Drift" title="How much each frog's timing wobbles from one call to the next" min="0" max="1" step="0.01" value=${config.drift}
          format=${(v) => (v === 0 ? 'steady' : `±${Math.round(v * 15)}%`)} onInput=${set('drift')} />
        <${Range} label="Bouts" title="How many calls a frog makes in a row before resting; none means it never rests" min=${L.bout[0]} max=${L.bout[1]} step="1" value=${config.bout}
          format=${(v) => (v === 0 ? 'no rests' : `${v} call${v === 1 ? '' : 's'}`)} onInput=${set('bout')} />
        ${config.bout > 0 && html`
          <${Range} label="Rest" title="How long a frog rests between bouts" min=${L.rest[0]} max=${L.rest[1]} step="0.25" value=${config.rest}
            format=${beats} onInput=${set('rest')} />`}
        <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />
        <label class="field">
          <span>Snap calls</span>
          <select value=${config.quantize} onChange=${(e) => set('quantize')(Number(e.target.value))}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>
        <label class="field check" title="Scatter the frogs out of turn at the start of every pass through the pattern, so they sort themselves out again each time">
          <span>Scatter each pass</span>
          <input type="checkbox" checked=${config.restart} onChange=${(e) => set('restart')(e.target.checked)} />
        </label>

        <h4>${selected ? 'Frog' : 'Frogs'}</h4>
        ${selected
          ? html`
            <div class="zone-tune">
              <select aria-label="Note for the selected frog" value=${selected.note} onChange=${(e) => tune(selected.id, Number(e.target.value))}>
                ${!noteChoices.some(([n]) => n === selected.note) && html`<option value=${selected.note}>${noteName(selected.note)}</option>`}
                ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}
              </select>
            </div>
            <${Range} label="Calls" title="How often this frog calls, left to itself"
              min=${Math.log2(L.rate[0])} max=${Math.log2(L.rate[1])} step="0.05" value=${Math.log2(selected.rate)}
              format=${(v) => every(2 ** v)} onInput=${(v) => editFrog(selected.id, (f) => { f.rate = Number((2 ** v).toFixed(3)); })} />
            <div class="ball-row">
              <span></span>
              <button class="ghost danger" onClick=${() => removeFrog(selected.id)}>Delete</button>
            </div>`
          : html`<p class="muted hint">Select a frog to tune it and set how often it calls.</p>`}
        <div class="ball-row">
          <span class="muted">${config.frogs.length} / ${L.frogs} frogs</span>
          <button class="ghost danger" disabled=${!config.frogs.length}
            onClick=${() => confirm('Remove every frog?') && edit((c) => { c.frogs = []; })}>Clear</button>
        </div>
      </div>
    </div>
  `;
}

const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} beat${v === 1 ? '' : 's'}`;

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, run silent frogs of our own on the wall clock,
 * following edits, so the settings can be seen at work — scattering them
 * every pattern's length, as playback would, when the settings say to.
 */
function runPreview(preview, { config, bpm, length }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new FrogSim(config);
    preview.last = now;
  }
  preview.sim.sync(config);
  // A backgrounded tab pauses frames; don't try to catch up on all of it.
  const seconds = Math.min(0.1, now - preview.last);
  const secondsPerBeat = 60 / bpm;
  const span = seconds / secondsPerBeat;
  const passBeats = length / STEPS_PER_BEAT;
  if (config.restart && Math.floor((preview.beat + span) / passBeats) > Math.floor(preview.beat / passBeats)) preview.sim.scatter();
  preview.beat += span;
  for (const e of preview.sim.advance(span)) {
    preview.hits.push({ time: preview.last + e.at * secondsPerBeat, id: e.id });
  }
  preview.last = now;
  while (preview.hits.length && preview.hits[0].time < now - RIPPLE_SECONDS) preview.hits.shift();
  return { now, hits: preview.hits };
}

// ---- drawing ---------------------------------------------------------------------

function draw(canvas, { now, hits }, { config, selected, keys }, gesture, hover) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const size = W - 2 * MARGIN;
  const px = (v) => MARGIN + v * size;
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';
  const panel2 = css.getPropertyValue('--panel-2').trim() || '#1a1c2a';
  const tints = themeTints(css);
  const h = tints.hue;
  const r = FROG_RADIUS * size;

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(px(0), px(0), size, size);
  // Everything stays in the pond, where clicks add frogs.
  g.save();
  g.beginPath();
  g.rect(px(0), px(0), size, size);
  g.clip();

  // A frog being dragged is drawn where it's going.
  const frogs = config.frogs.map((f) => (gesture?.id === f.id && gesture.moved ? { ...f, ...gesture.at } : f));
  const reach = Math.min(config.reach, EVERYONE) * size;

  // The reach of the frog under the pointer, or the selected one.
  const shown = frogs.find((f) => f.id === (hover?.id ?? selected?.id));
  if (shown && config.reach < EVERYONE) {
    g.setLineDash([6, 8]);
    g.strokeStyle = muted;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px(shown.x), px(shown.y), reach, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  // Calls: a ripple spreading from the frog to the edge of its reach.
  const calling = new Map();
  const at = new Map(frogs.map((f) => [f.id, f]));
  g.lineWidth = 2;
  for (const hit of hits ?? []) {
    const age = (now - hit.time) / RIPPLE_SECONDS;
    const f = at.get(hit.id);
    if (!f || age < 0 || age >= 1) continue;
    calling.set(hit.id, Math.max(calling.get(hit.id) ?? 0, 1 - age));
    g.strokeStyle = `hsl(${h} ${tints.bright} / ${(1 - age) * 0.7})`;
    g.beginPath();
    g.arc(px(f.x), px(f.y), r + (reach - r) * age, 0, Math.PI * 2);
    g.stroke();
  }

  // Frogs on their pads: a throat that puffs out as each calls.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${W / 50}px ui-monospace, Menlo, monospace`;
  for (const f of frogs) {
    const x = px(f.x);
    const y = px(f.y);
    const puff = calling.get(f.id) ?? 0;
    // The pad.
    g.fillStyle = panel2;
    g.strokeStyle = selected?.id === f.id ? fg : `hsl(${h} ${tints.line})`;
    g.lineWidth = selected?.id === f.id ? 3 : 2;
    g.beginPath();
    g.arc(x, y, r, 0.15, Math.PI * 2 - 0.45);
    g.lineTo(x, y);
    g.closePath();
    g.fill();
    g.stroke();
    // The frog, its throat swelling with the call.
    g.fillStyle = `hsl(${h} ${puff ? tints.hot : tints.bright})`;
    g.shadowColor = `hsl(${h} ${tints.bright})`;
    g.shadowBlur = puff * 24;
    g.beginPath();
    g.arc(x, y, r * (0.4 + 0.3 * puff), 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = puff > 0.3 ? fg : muted;
    g.fillText(keys?.[f.note] ?? noteName(f.note), x, y + r * 1.6);
  }
  g.restore();
}
