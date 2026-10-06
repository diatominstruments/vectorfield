import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { instrumentKeys } from './params.js';
import { FIREFLY_LIMITS, FLY_RADIUS, QUANTIZE } from '../../shared/fireflies.js';
import { nextScaleNote } from '../../shared/scale.js';
import { newId } from '../../shared/song.js';
import { FireflySim } from '../firefly-sim.js';
import { Range, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;            // canvas px around the field
const FLASH_SECONDS = 0.5;
const STEPS_PER_BEAT = 4;
const EVERYONE = Math.SQRT2;  // a reach this far sees right across the field
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };
const HOVER = 0.008;          // how far a firefly drifts about its place as it hovers, in field widths
const stillness = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const L = FIREFLY_LIMITS;

/**
 * Editor for one track's fireflies in a pattern: where they are, their
 * notes and rates, and how strongly their flashes pull on each other.
 *
 *   click empty ground      add a firefly, tuned to the next note up
 *   drag a firefly          move it, nearer to or further from the others
 *   click a firefly         select it, to tune it and set its rate
 *   double-click a firefly  take it away
 *
 * While the pattern plays, the canvas draws the engine's own fireflies
 * (read back against the audio clock), so what you see is what you hear.
 * While it doesn't, silent preview fireflies flash instead, so changes can
 * be watched as they're made. Fireflies hover a little about their places;
 * that's only drawing — flashes reach by where they really are.
 */
export function FireflyEditor({ store, engine, pattern, track }) {
  const config = pattern.fireflies[track.id];
  const canvasRef = useRef();
  const gesture = useRef(null);
  const hover = useRef(null);
  const [picked, setSelected] = useState(null);   // firefly id
  const keys = instrumentKeys(registry.get(track.instrument.id), track.instrument.params);
  // A firefly removed by an edit is no longer selected.
  const selected = config.flies.find((f) => f.id === picked) ?? null;

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).fireflies[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, keys, bpm: store.doc.bpm, length: pattern.length };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0, beat: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'fireflies');
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
    const fly = config.flies.find((f) => f.id === id);
    if (fly) engine.audition(track.id, fly.note);
  };

  const editFly = (id, fn) => edit((c) => fn(c.flies.find((f) => f.id === id)));
  const tune = (id, note) => {
    editFly(id, (f) => { f.note = note; });
    engine.audition(track.id, note);
  };
  const removeFly = (id) => edit((c) => { c.flies = c.flies.filter((f) => f.id !== id); });

  // A new firefly flashes at the field's average rate, so it can fall into step.
  const addFly = (at) => {
    const id = newId();
    const notes = config.flies.map((f) => f.note);
    const note = nextScaleNote(notes, notes.length ? Math.min(...notes) : 60, keys);
    const rate = config.flies.length ? config.flies.reduce((s, f) => s + f.rate, 0) / config.flies.length : 0.5;
    edit((c) => { c.flies.push({ id, x: at.x, y: at.y, note, rate: Number(rate.toFixed(3)) }); });
    setSelected(id);
    engine.audition(track.id, note);
  };

  const set = (key) => (v) => edit((c) => { c[key] = v; });

  // ---- pointer -------------------------------------------------------------------

  const toField = (e) => {
    // The canvas is drawn at a fixed resolution and scaled by CSS.
    const rect = canvasRef.current.getBoundingClientRect();
    const m = MARGIN * (rect.width / canvasRef.current.width);
    const size = rect.width - 2 * m;
    return { x: (e.clientX - rect.left - m) / size, y: (e.clientY - rect.top - m) / size };
  };
  const inside = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const clamp = (p) => ({
    x: Math.min(1 - FLY_RADIUS, Math.max(FLY_RADIUS, p.x)),
    y: Math.min(1 - FLY_RADIUS, Math.max(FLY_RADIUS, p.y)),
  });
  const flyAt = (p) => {
    let best = null;
    for (const f of config.flies) {
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < FLY_RADIUS * 1.8 && d < (best?.d ?? Infinity)) best = { fly: f, d };
    }
    return best?.fly ?? null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = toField(e);
    const fly = flyAt(p);
    if (fly) {
      gesture.current = { id: fly.id, start: p, at: { x: fly.x, y: fly.y }, dx: fly.x - p.x, dy: fly.y - p.y, moved: false };
      canvasRef.current.setPointerCapture(e.pointerId);
    } else if (inside(p) && config.flies.length < L.flies) {
      addFly(clamp(p));
    }
  };

  const onPointerMove = (e) => {
    const p = toField(e);
    const g = gesture.current;
    if (!g) {
      hover.current = flyAt(p);
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
    else editFly(g.id, (f) => Object.assign(f, g.at));
  };

  const onDoubleClick = (e) => {
    const fly = flyAt(toField(e));
    if (fly) removeFly(fly.id);
  };

  const every = (rate) => `every ${beats(1 / rate)}`;

  return html`
    <div class="bounce-editor firefly-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
          onPointerCancel=${() => { gesture.current = null; }} onPointerLeave=${() => { hover.current = null; }}
          onDblClick=${onDoubleClick}></canvas>
        <p class="hint muted">Click to add a firefly; drag one to move it, click it to tune it, double-click to remove it. Each flash plays that firefly's note and nudges the ones within reach to flash sooner, so neighbours fall into step: chords when they lock together, quick runs when they nearly do.</p>
      </div>

      <div class="bounce-controls panel">
        <${Range} label="Coupling" title="How hard a flash pulls the fireflies that see it towards flashing too" min="0" max="1" step="0.01" value=${config.coupling}
          format=${(v) => (v === 0 ? 'none' : `${Math.round(v * 100)}%`)} onInput=${set('coupling')} />
        <${Range} label="Reach" title="How far a flash is seen: small for separate clusters, large for the whole field" min=${L.reach[0]} max=${L.reach[1]} step="0.01" value=${config.reach}
          format=${(v) => (v >= EVERYONE ? 'everyone' : `${Math.round(v * 100)}%`)} onInput=${set('reach')} />
        <${Range} label="Drift" title="How much each firefly's timing wobbles from one flash to the next, so they never lock for good" min="0" max="1" step="0.01" value=${config.drift}
          format=${(v) => (v === 0 ? 'steady' : `±${Math.round(v * 15)}%`)} onInput=${set('drift')} />
        <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />
        <label class="field">
          <span>Snap flashes</span>
          <select value=${config.quantize} onChange=${(e) => set('quantize')(Number(e.target.value))}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>
        <label class="field check" title="Scatter the fireflies out of step at the start of every pass through the pattern, so they fall into step again each time">
          <span>Scatter each pass</span>
          <input type="checkbox" checked=${config.restart} onChange=${(e) => set('restart')(e.target.checked)} />
        </label>

        <h4>${selected ? 'Firefly' : 'Fireflies'}</h4>
        ${selected
          ? html`
            <div class="zone-tune">
              <select aria-label="Note for the selected firefly" value=${selected.note} onChange=${(e) => tune(selected.id, Number(e.target.value))}>
                ${!noteChoices.some(([n]) => n === selected.note) && html`<option value=${selected.note}>${noteName(selected.note)}</option>`}
                ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}
              </select>
            </div>
            <${Range} label="Flashes" title="How often this firefly flashes, left to itself"
              min=${Math.log2(L.rate[0])} max=${Math.log2(L.rate[1])} step="0.05" value=${Math.log2(selected.rate)}
              format=${(v) => every(2 ** v)} onInput=${(v) => editFly(selected.id, (f) => { f.rate = Number((2 ** v).toFixed(3)); })} />
            <div class="ball-row">
              <span></span>
              <button class="ghost danger" onClick=${() => removeFly(selected.id)}>Delete</button>
            </div>`
          : html`<p class="muted hint">Select a firefly to tune it and set how often it flashes.</p>`}
        <div class="ball-row">
          <span class="muted">${config.flies.length} / ${L.flies} fireflies</span>
          <button class="ghost danger" disabled=${!config.flies.length}
            onClick=${() => confirm('Remove every firefly?') && edit((c) => { c.flies = []; })}>Clear</button>
        </div>
      </div>
    </div>
  `;
}

const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} beat${v === 1 ? '' : 's'}`;

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, run silent fireflies of our own on the wall clock,
 * following edits, so the settings can be seen at work — scattering them
 * every pattern's length, as playback would, when the settings say to.
 */
function runPreview(preview, { config, bpm, length }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new FireflySim(config);
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
  while (preview.hits.length && preview.hits[0].time < now - FLASH_SECONDS) preview.hits.shift();
  return { now, hits: preview.hits };
}

// ---- drawing ---------------------------------------------------------------------

/** A steady number in [0, 1) for a firefly, so each hovers its own way. */
function seedOf(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 1000;
  return n / 1000;
}

function draw(canvas, { now, hits }, { config, selected, keys }, gesture, hover) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const size = W - 2 * MARGIN;
  const px = (v) => MARGIN + v * size;
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';
  const tints = themeTints(css);
  const h = tints.hue;
  const r = FLY_RADIUS * size;

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(px(0), px(0), size, size);
  // Everything stays inside the field, where clicks add fireflies.
  g.save();
  g.beginPath();
  g.rect(px(0), px(0), size, size);
  g.clip();

  // A firefly being dragged is drawn where it's going, held still; the
  // rest hover about their places, each on its own slow loop.
  const t = performance.now() / 1000;
  const flies = config.flies.map((f) => {
    if (gesture?.id === f.id && gesture.moved) return { ...f, ...gesture.at };
    if (stillness?.matches) return f;
    const k = seedOf(f.id);
    return { ...f, x: f.x + HOVER * Math.sin(t * (0.6 + 0.3 * k) + 7 * k), y: f.y + HOVER * Math.sin(t * (0.45 + 0.25 * k) + 13 * k) };
  });

  // The reach of the firefly under the pointer, or the selected one.
  const shown = flies.find((f) => f.id === (hover?.id ?? selected?.id));
  if (shown && config.reach < EVERYONE) {
    g.setLineDash([6, 8]);
    g.strokeStyle = muted;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px(shown.x), px(shown.y), config.reach * size, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  // Fireflies: a faint glow at rest, a bright bloom as each flashes.
  const lit = new Map();
  for (const hit of hits ?? []) {
    const age = now - hit.time;
    if (age >= 0 && age < FLASH_SECONDS) lit.set(hit.id, Math.max(lit.get(hit.id) ?? 0, 1 - age / FLASH_SECONDS));
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${W / 50}px ui-monospace, Menlo, monospace`;
  for (const f of flies) {
    const x = px(f.x);
    const y = px(f.y);
    const glow = lit.get(f.id) ?? 0;
    if (glow) {
      const bloom = g.createRadialGradient(x, y, 0, x, y, r * (2 + 3 * glow));
      bloom.addColorStop(0, `hsl(${h} ${tints.hot} / ${glow})`);
      bloom.addColorStop(1, `hsl(${h} ${tints.hot} / 0)`);
      g.fillStyle = bloom;
      g.beginPath();
      g.arc(x, y, r * (2 + 3 * glow), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = glow ? `hsl(${h} ${tints.hot})` : `hsl(${h} ${tints.line})`;
    g.beginPath();
    g.arc(x, y, r * 0.55, 0, Math.PI * 2);
    g.fill();
    if (selected?.id === f.id) {
      g.strokeStyle = fg;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = glow > 0.3 ? fg : muted;
    g.fillText(keys?.[f.note] ?? noteName(f.note), x, y + r * 1.6);
  }
  g.restore();
}
