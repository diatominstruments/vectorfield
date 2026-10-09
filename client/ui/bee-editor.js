import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { instrumentKeys } from './params.js';
import { BEE_LIMITS, PLANT_RADIUS, NECTAR_ENOUGH, QUANTIZE, isFlower, nextFlowerNote } from '../../shared/bees.js';
import { newId } from '../../shared/song.js';
import { BeeSim } from '../bee-sim.js';
import { Range, mixTint, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;            // canvas px around the patch
const FLASH_SECONDS = 0.4;
const PETALS = 6;
const WOBBLE = 0.012;         // how far a flying bee weaves either side of its line, in patch widths
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };
const stillness = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const L = BEE_LIMITS;

/**
 * Editor for one track's bees in a pattern: the patch of tuned flowers
 * and leafy plants, and how the bees forage it.
 *
 *   click empty ground        add a flower, tuned to the next note up
 *   shift-click empty ground  add a plant with no flower, to rest on
 *   drag a plant              move it (which changes the gaps between notes)
 *   click a plant             select it, to tune it or turn it from flower to leaf and back
 *   double-click a plant      take it away
 *
 * While the pattern plays, the canvas draws the engine's own bees (read
 * back against the audio clock), so what you see is what you hear. While
 * it doesn't, silent preview bees forage instead, so the patch can be
 * watched at work as it's planted.
 */
export function BeeEditor({ store, engine, pattern, track }) {
  const config = pattern.bees[track.id];
  const canvasRef = useRef();
  const gesture = useRef(null);
  const hover = useRef(null);
  const [picked, setSelected] = useState(null);   // plant id
  const keys = instrumentKeys(registry.get(track.instrument.id), track.instrument.params);
  // A plant removed by an edit is no longer selected.
  const selected = config.plants.find((p) => p.id === picked) ?? null;

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).bees[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, keys, bpm: store.doc.bpm };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'bees');
      let scene;
      if (entry) {
        const now = engine.ctx.currentTime;
        scene = { now, ...patchAt(entry.trace, now, live.current), hits: entry.hits };
      } else {
        scene = runPreview(preview, live.current);
      }
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
    const plant = config.plants.find((p) => p.id === id);
    if (plant && isFlower(plant)) engine.audition(track.id, plant.note);
  };

  const editPlant = (id, fn) => edit((c) => fn(c.plants.find((p) => p.id === id)));
  const tune = (id, note) => {
    editPlant(id, (p) => { p.note = note; });
    if (note != null) engine.audition(track.id, note);
  };
  const removePlant = (id) => edit((c) => { c.plants = c.plants.filter((p) => p.id !== id); });

  // A flower tuned to the next note up, or with `leafy` a plant with no flower.
  const addPlant = (at, leafy) => {
    const id = newId();
    const note = leafy ? null : nextFlowerNote(config, keys);
    edit((c) => { c.plants.push({ id, x: at.x, y: at.y, note }); });
    setSelected(id);
    if (!leafy) engine.audition(track.id, note);
  };

  const set = (key) => (v) => edit((c) => { c[key] = v; });

  // ---- pointer -------------------------------------------------------------------

  const toPatch = (e) => {
    // The canvas is drawn at a fixed resolution and scaled by CSS.
    const rect = canvasRef.current.getBoundingClientRect();
    const m = MARGIN * (rect.width / canvasRef.current.width);
    const size = rect.width - 2 * m;
    return { x: (e.clientX - rect.left - m) / size, y: (e.clientY - rect.top - m) / size };
  };
  const inside = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const clamp = (p) => ({
    x: Math.min(1 - PLANT_RADIUS, Math.max(PLANT_RADIUS, p.x)),
    y: Math.min(1 - PLANT_RADIUS, Math.max(PLANT_RADIUS, p.y)),
  });
  const plantAt = (p) => {
    let best = null;
    for (const plant of config.plants) {
      const d = Math.hypot(plant.x - p.x, plant.y - p.y);
      if (d < PLANT_RADIUS * 1.5 && d < (best?.d ?? Infinity)) best = { plant, d };
    }
    return best?.plant ?? null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = toPatch(e);
    const plant = plantAt(p);
    if (plant) {
      gesture.current = { id: plant.id, start: p, at: { x: plant.x, y: plant.y }, dx: plant.x - p.x, dy: plant.y - p.y, moved: false };
      canvasRef.current.setPointerCapture(e.pointerId);
    } else if (inside(p) && config.plants.length < L.plants) {
      addPlant(clamp(p), e.shiftKey);
    }
  };

  const onPointerMove = (e) => {
    const p = toPatch(e);
    const g = gesture.current;
    if (!g) {
      hover.current = plantAt(p);
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
    else editPlant(g.id, (plant) => Object.assign(plant, g.at));
  };

  const onDoubleClick = (e) => {
    const plant = plantAt(toPatch(e));
    if (plant) removePlant(plant.id);
  };

  return html`
    <div class="bounce-editor bee-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
          onPointerCancel=${() => { gesture.current = null; }} onPointerLeave=${() => { hover.current = null; }}
          onDblClick=${onDoubleClick}></canvas>
        <p class="hint muted">Click to plant a flower, or shift-click for a leafy plant with no flower; drag one to move it, click it to tune it, double-click to pull it up. A bee landing on a flower plays its note and drains it, and it won't land on one that hasn't refilled: the refill time sets how sparse the line is, the distances between plants set the gaps inside it. On a leafy plant a bee only rests, so those put silence in — all the more as the flowers around them run dry.</p>
      </div>

      <div class="bounce-controls panel">
        <${Range} label="Bees" min=${L.bees[0]} max=${L.bees[1]} step="1" value=${config.bees}
          format=${(v) => v} onInput=${set('bees')} />
        <${Range} label="Speed" title="How fast the bees fly: the time to cross the whole patch" min=${L.speed[0]} max=${L.speed[1]} step="0.05" value=${config.speed}
          format=${(v) => beats(1 / v)} onInput=${set('speed')} />
        <${Range} label="Feeding" title="How long a bee stays on a flower before flying on" min=${L.feed[0]} max=${L.feed[1]} step="0.25" value=${config.feed}
          format=${(v) => (v === 0 ? 'none' : beats(v))} onInput=${set('feed')} />
        <${Range} label="Resting" title="How long a bee stays on a plant with no flower before flying on" min=${L.rest[0]} max=${L.rest[1]} step="0.25" value=${config.rest}
          format=${(v) => (v === 0 ? 'none' : beats(v))} onInput=${set('rest')} />
        <${Range} label="Refill" title="How long a drained flower takes to fill again; a bee lands once it's a quarter full, softly"
          min=${Math.log2(L.refill[0])} max=${Math.log2(L.refill[1])} step="0.05" value=${Math.log2(config.refill)}
          format=${(v) => beats(2 ** v)} onInput=${(v) => set('refill')(Number((2 ** v).toFixed(2)))} />
        <${Range} label="Whim" title="How often a bee ignores what's full and near by and heads for any flower with nectar" min="0" max="1" step="0.01" value=${config.whim}
          format=${(v) => `${Math.round(v * 100)}%`} onInput=${set('whim')} />
        <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />
        <label class="field">
          <span>Snap landings</span>
          <select value=${config.quantize} onChange=${(e) => set('quantize')(Number(e.target.value))}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>

        <h4>${selected ? (isFlower(selected) ? 'Flower' : 'Leafy plant') : 'Plants'}</h4>
        ${selected
          ? html`
            ${isFlower(selected) && html`
              <div class="zone-tune">
                <select aria-label="Note for the selected flower" value=${selected.note} onChange=${(e) => tune(selected.id, Number(e.target.value))}>
                  ${!noteChoices.some(([n]) => n === selected.note) && html`<option value=${selected.note}>${noteName(selected.note)}</option>`}
                  ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}
                </select>
              </div>`}
            <div class="ball-row">
              <button class="ghost" title=${isFlower(selected) ? 'Take the flower off: bees will only rest here' : 'Give it a flower, tuned to the next note up'}
                onClick=${() => tune(selected.id, isFlower(selected) ? null : nextFlowerNote(config, keys))}>${isFlower(selected) ? 'Make it a leaf' : 'Make it a flower'}</button>
              <span></span>
              <button class="ghost danger" onClick=${() => removePlant(selected.id)}>Delete</button>
            </div>`
          : html`<p class="muted hint">Select a plant to tune it, or to swap it between flower and leaf.</p>`}
        <div class="ball-row">
          <span class="muted">${config.plants.length} / ${L.plants} plants</span>
          <button class="ghost danger" disabled=${!config.plants.length}
            onClick=${() => confirm('Pull up every plant?') && edit((c) => { c.plants = []; })}>Clear</button>
        </div>
      </div>
    </div>
  `;
}

const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(v >= 1 ? 1 : 2)} beat${v === 1 ? '' : 's'}`;

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, run silent bees of our own on the wall clock,
 * following edits, so the patch can be seen at work. They carry on from
 * where they were whenever playback stops.
 */
function runPreview(preview, { config, bpm }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new BeeSim(config);
    preview.last = now;
  }
  preview.sim.sync(config);
  // A backgrounded tab pauses frames; don't try to catch up on all of it.
  const seconds = Math.min(0.1, now - preview.last);
  const secondsPerBeat = 60 / bpm;
  for (const e of preview.sim.advance(seconds / secondsPerBeat)) {
    preview.hits.push({ time: preview.last + e.at * secondsPerBeat, flower: e.flower });
  }
  preview.last = now;
  while (preview.hits.length && preview.hits[0].time < now - FLASH_SECONDS) preview.hits.shift();
  return { now, bees: preview.sim.positions(), nectar: Object.fromEntries(preview.sim.nectar), hits: preview.hits };
}

/**
 * Bees and nectar at the audible moment, from the engine's trace: between
 * two entries every bee is on one straight flight or still, and every
 * flower refills steadily.
 */
function patchAt(trace, now, { config, bpm }) {
  let i = trace.length - 1;
  while (i > 0 && trace[i].time > now) i--;
  const a = trace[i];
  const b = trace[i + 1];
  const since = Math.max(0, now - a.time);
  const refilled = since / (config.refill * 60 / bpm);
  const nectar = Object.fromEntries(Object.entries(a.nectar).map(([id, level]) => [id, Math.min(1, level + refilled)]));
  if (!b || now <= a.time || b.time === a.time) return { bees: a.bees, nectar };
  const f = (now - a.time) / (b.time - a.time);
  const next = new Map(b.bees.map((bee) => [bee.id, bee]));
  return {
    nectar,
    bees: a.bees.map((bee) => {
      const to = next.get(bee.id);
      return to ? { ...bee, x: bee.x + (to.x - bee.x) * f, y: bee.y + (to.y - bee.y) * f } : bee;
    }),
  };
}

// ---- drawing ---------------------------------------------------------------------

/** A steady number in [0, 1) for a bee, so each weaves its own way. */
function seedOf(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 1000;
  return n / 1000;
}

function draw(canvas, { now, bees, nectar, hits }, { config, selected, keys }, gesture, hover) {
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
  const r = PLANT_RADIUS * size;

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(px(0), px(0), size, size);

  // A plant being dragged is drawn where it's going.
  const plants = config.plants.map((p) => (gesture?.id === p.id && gesture.moved ? { ...p, ...gesture.at } : p));

  // Flowers: petals round a centre that fills as the nectar does, and
  // glows for a moment as a bee lands. Leafy plants: just leaves.
  const lit = new Map();
  for (const hit of hits ?? []) {
    const age = now - hit.time;
    if (age >= 0 && age < FLASH_SECONDS) lit.set(hit.flower, Math.max(lit.get(hit.flower) ?? 0, 1 - age / FLASH_SECONDS));
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const f of plants) {
    const x = px(f.x);
    const y = px(f.y);
    const picked = selected?.id === f.id || hover?.id === f.id;
    if (!isFlower(f)) {
      g.fillStyle = `hsl(${h} ${tints.line} / 0.45)`;
      g.strokeStyle = picked ? fg : `hsl(${h} ${tints.line} / 0.8)`;
      g.lineWidth = selected?.id === f.id ? 3 : 1.5;
      for (const a of [-0.5, 0.6, 1.9, 3.1, 4.3]) {
        g.beginPath();
        g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.62, r * 0.26, a, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      continue;
    }
    const glow = lit.get(f.id) ?? 0;
    const level = nectar?.[f.id] ?? 1;
    const ready = level >= NECTAR_ENOUGH;
    g.shadowColor = `hsl(${h} ${tints.bright})`;
    g.shadowBlur = glow * 30;
    // Petals, drawn open when there's nectar to be had and furled when drained.
    const petal = r * (0.55 + 0.45 * (ready ? 1 : level / NECTAR_ENOUGH));
    g.fillStyle = glow ? `hsl(${h} ${mixTint(tints.line, tints.hot, glow)})` : ready ? `hsl(${h} ${tints.line} / 0.9)` : panel2;
    g.strokeStyle = picked ? fg : `hsl(${h} ${tints.bright} / ${ready ? 0.9 : 0.4})`;
    g.lineWidth = selected?.id === f.id ? 3 : 2;
    for (let i = 0; i < PETALS; i++) {
      const a = (i / PETALS) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, petal * 0.5, petal * 0.28, a, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.shadowBlur = 0;
    // The centre: full to the brim, or a sliver.
    g.fillStyle = panel2;
    g.beginPath();
    g.arc(x, y, r * 0.42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `hsl(${h} ${glow ? tints.hot : tints.bright})`;
    g.beginPath();
    g.arc(x, y, r * 0.42 * Math.sqrt(level), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = glow > 0.3 || ready ? fg : muted;
    g.font = `${W / 50}px ui-monospace, Menlo, monospace`;
    g.fillText(keys?.[f.note] ?? noteName(f.note), x, y + r * 1.45);
  }

  // The bees: weaving a little as they fly, settled while they feed or rest.
  const t = performance.now() / 1000;
  const flowering = new Set(plants.filter(isFlower).map((p) => p.id));
  for (const bee of bees ?? []) {
    let { x, y } = bee;
    if (bee.flying && !stillness?.matches) {
      const k = seedOf(bee.id);
      x += WOBBLE * Math.sin(t * (9 + 4 * k) + 7 * k);
      y += WOBBLE * Math.cos(t * (7 + 5 * k) + 3 * k);
    }
    const feeding = flowering.has(bee.on) && !bee.flying;
    g.fillStyle = feeding ? `hsl(${h} ${tints.hot})` : fg;
    g.shadowColor = `hsl(${h} ${tints.bright})`;
    g.shadowBlur = feeding ? 14 : 0;
    const bx = px(x);
    const by = px(y);
    // Wings, then a striped body.
    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = fg;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(bx + side * 7, by - 9, 8, 4.5, side * 0.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.fillStyle = feeding ? `hsl(${h} ${tints.hot})` : fg;
    g.beginPath();
    g.ellipse(bx, by, 14, 9.5, 0, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = panel2;
    g.lineWidth = 2.5;
    for (const dx of [-5, 0, 5]) {
      g.beginPath();
      g.moveTo(bx + dx, by - 8.5);
      g.lineTo(bx + dx, by + 8.5);
      g.stroke();
    }
  }
}
