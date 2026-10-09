import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { instrumentKeys } from './params.js';
import { QUANTIZE, SANDPILE_LIMITS, SIZES, TOPPLE_AT, retune, ringCount, ringOf } from '../../shared/sandpile.js';
import { SandpileSim } from '../sandpile-sim.js';
import { Range, mixTint, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;            // canvas px around the pile
const FLASH_SECONDS = 0.35;
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };

const L = SANDPILE_LIMITS;

/**
 * Editor for one track's sandpile in a pattern: the grid, where the grains
 * land, how fast and how scattered, and what each ring out from there
 * plays.
 *
 *   click a cell     drop the grains there instead
 *
 * While the pattern plays, the canvas draws the engine's own pile (read
 * back against the audio clock), so what you see is what you hear. While
 * it doesn't, a silent preview pile topples instead, so the settings can
 * be watched at work.
 */
export function SandpileEditor({ store, engine, pattern, track }) {
  const config = pattern.sandpile[track.id];
  const canvasRef = useRef();
  const hover = useRef(null);
  const [selected, setSelected] = useState(-1);   // ring being tuned
  const keys = instrumentKeys(registry.get(track.instrument.id), track.instrument.params);
  const rings = ringCount(config.size, config.drop);

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).sandpile[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, keys, bpm: store.doc.bpm };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'sandpile');
      let scene;
      if (entry) {
        const now = engine.ctx.currentTime;
        scene = { now, cells: cellsAt(entry.trace, now), hits: entry.hits };
      } else {
        scene = runPreview(preview, live.current);
      }
      draw(canvasRef.current, scene, live.current, hover.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, pattern.id, track.id]);

  // ---- tuning ------------------------------------------------------------------

  const noteChoices = keys
    ? Object.entries(keys).map(([n, label]) => [Number(n), label])
    : Array.from({ length: PITCH_RANGE[1] - PITCH_RANGE[0] + 1 }, (_, i) => [PITCH_RANGE[0] + i, noteName(PITCH_RANGE[0] + i)]);

  const tune = (ring, note) => {
    edit((s) => { s.notes[ring] = note; });
    engine.audition(track.id, note);
  };

  // A new size is a new pile: the grains land in its middle, and the
  // tuning is cut or carried on up the scale to fit.
  const resize = (size) => edit((s) => {
    s.size = size;
    s.drop = [(size - 1) / 2, (size - 1) / 2];
    s.notes = retune(s.notes, size, keys);
  });

  const set = (key) => (v) => edit((s) => { s[key] = v; });

  // ---- pointer -------------------------------------------------------------------

  const cellAt = (e) => {
    // The canvas is drawn at a fixed resolution and scaled by CSS.
    const rect = canvasRef.current.getBoundingClientRect();
    const m = MARGIN * (rect.width / canvasRef.current.width);
    const size = rect.width - 2 * m;
    const x = (e.clientX - rect.left - m) / size;
    const y = (e.clientY - rect.top - m) / size;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    return [Math.floor(x * config.size), Math.floor(y * config.size)];
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const cell = cellAt(e);
    if (cell) set('drop')(cell);
  };

  const onPointerMove = (e) => {
    hover.current = cellAt(e);
    canvasRef.current.style.cursor = hover.current ? 'pointer' : 'default';
  };

  const ringName = (i) => (i === 0 ? 'Drop cell' : `Ring ${i}`);
  const grains = (rate) => (rate >= 1 ? `${rate % 1 ? rate.toFixed(1) : rate} per beat` : `every ${beats(1 / rate)}`);

  return html`
    <div class="bounce-editor sandpile-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
          onPointerLeave=${() => { hover.current = null; }}></canvas>
        <p class="hint muted">Grains drop one by one onto the marked cell (click another to move it). A cell with four grains topples, one to each neighbour, which may topple in turn: most grains do nothing, now and then one brings down half the pile. Each ring out from the drop cell plays its note as it topples, so an avalanche is a run.</p>
      </div>

      <div class="bounce-controls panel">
        <label class="field">
          <span>Size</span>
          <select value=${config.size} onChange=${(e) => resize(Number(e.target.value))}>
            ${SIZES.map((n) => html`<option value=${n}>${n} × ${n}</option>`)}
          </select>
        </label>
        <${Range} label="Grains" title="How often a grain drops"
          min=${Math.log2(L.rate[0])} max=${Math.log2(L.rate[1])} step="0.1" value=${Math.log2(config.rate)}
          format=${(v) => grains(2 ** v)} onInput=${(v) => set('rate')(Number((2 ** v).toFixed(3)))} />
        <${Range} label="Scatter" title="How many grains land somewhere at random instead of on the drop cell" min="0" max="1" step="0.01" value=${config.scatter}
          format=${(v) => (v === 0 ? 'none' : v === 1 ? 'all' : `${Math.round(v * 100)}%`)} onInput=${set('scatter')} />
        <${Range} label="Spread" title="How long an avalanche takes to pass from one wave of toppling cells to the next" min=${L.spread[0]} max=${L.spread[1]} step="0.0625" value=${config.spread}
          format=${(v) => (v === 0 ? 'all at once' : `${steps(v * 4)}`)} onInput=${set('spread')} />
        <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />
        <label class="field">
          <span>Snap notes</span>
          <select value=${config.quantize} onChange=${(e) => set('quantize')(Number(e.target.value))}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>

        <h4>Rings <span class="muted">out from the drop cell</span></h4>
        <div class="wall-tuning">
          ${Array.from({ length: rings }, (_, i) => html`
            <label class=${`field ${selected === i ? 'selected' : ''}`} key=${i}
              onFocusIn=${() => setSelected(i)} onFocusOut=${() => setSelected(-1)}
              onMouseEnter=${() => setSelected(i)} onMouseLeave=${() => setSelected(-1)}>
              <span>${ringName(i)}</span>
              <select value=${config.notes[i]} onChange=${(e) => tune(i, Number(e.target.value))}>
                ${!noteChoices.some(([n]) => n === config.notes[i]) && html`<option value=${config.notes[i]}>${noteName(config.notes[i])}</option>`}
                ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}
              </select>
            </label>`)}
        </div>
      </div>
    </div>
  `;
}

const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} beat${v === 1 ? '' : 's'}`;
const steps = (v) => `${Number.isInteger(v) ? v : v.toFixed(2)} step${v === 1 ? '' : 's'}`;

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, run a silent pile of our own on the wall clock,
 * following edits, so the settings can be seen at work. It carries on
 * from where it was whenever playback stops.
 */
function runPreview(preview, { config, bpm }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new SandpileSim(config);
    preview.last = now;
  }
  preview.sim.sync(config);
  // A backgrounded tab pauses frames; don't try to catch up on all of it.
  const seconds = Math.min(0.1, now - preview.last);
  const secondsPerBeat = 60 / bpm;
  for (const e of preview.sim.advance(seconds / secondsPerBeat)) {
    preview.hits.push({ time: preview.last + e.at * secondsPerBeat, ring: e.ring, cells: e.cells });
  }
  preview.last = now;
  while (preview.hits.length && preview.hits[0].time < now - FLASH_SECONDS) preview.hits.shift();
  return { now, cells: preview.sim.cells, hits: preview.hits };
}

/** The pile at the audible moment: its latest state from the engine's trace. */
function cellsAt(trace, now) {
  let i = trace.length - 1;
  while (i > 0 && trace[i].time > now) i--;
  return trace[i].cells;
}

// ---- drawing ---------------------------------------------------------------------

function draw(canvas, { now, cells, hits }, { config, selected, keys }, hover) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const size = W - 2 * MARGIN;
  const n = config.size;
  const cell = size / n;
  const gap = cell * 0.1;
  const px = (v) => MARGIN + v * cell;
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';
  const panel2 = css.getPropertyValue('--panel-2').trim() || '#1a1c2a';
  const onAccent = css.getPropertyValue('--on-accent').trim() || '#0b0b13';
  const tints = themeTints(css);
  const h = tints.hue;
  const [dc, dr] = config.drop;

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(MARGIN, MARGIN, size, size);

  // Cells toppling right now, each lit for a moment.
  const lit = new Map();
  for (const hit of hits ?? []) {
    const age = now - hit.time;
    if (age < 0 || age >= FLASH_SECONDS) continue;
    for (const i of hit.cells) lit.set(i, Math.max(lit.get(i) ?? 0, 1 - age / FLASH_SECONDS));
  }

  // Where each ring's note is written: the cell straight up from the drop
  // cell, or failing that down, right or left.
  const labelled = new Map();
  for (let ring = 0; ring < config.notes.length; ring++) {
    const spot = [[dc, dr - ring], [dc, dr + ring], [dc + ring, dr], [dc - ring, dr]].find(([c, r]) => c >= 0 && c < n && r >= 0 && r < n);
    if (spot) labelled.set(spot[1] * n + spot[0], ring);
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = `${Math.min(cell * 0.32, W / 42)}px ui-monospace, Menlo, monospace`;
  g.font = font;
  const pile = cells?.length === n * n ? cells : null;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const grains = pile ? pile[i] : 0;
      const ring = ringOf(c, r, config.drop);
      const glow = lit.get(i) ?? 0;
      const x = px(c) + gap / 2;
      const y = px(r) + gap / 2;
      // Fuller cells are brighter; a toppling one flares.
      const share = Math.min(1, grains / (TOPPLE_AT - 1));
      g.fillStyle = glow
        ? `hsl(${h} ${mixTint(tints.bright, tints.hot, glow)})`
        : grains ? `hsl(${h} ${mixTint(tints.line, tints.bright, share)} / ${0.25 + 0.75 * share})` : panel2;
      g.shadowColor = `hsl(${h} ${tints.bright})`;
      g.shadowBlur = glow * 24;
      g.beginPath();
      g.roundRect(x, y, cell - gap, cell - gap, cell * 0.12);
      g.fill();
      g.shadowBlur = 0;
      if (ring === selected || (hover && ringOf(...hover, config.drop) === ring && hover[0] === c && hover[1] === r)) {
        g.strokeStyle = ring === selected ? fg : muted;
        g.lineWidth = 2;
        g.stroke();
      }
      if (c === dc && r === dr) {
        // The drop cell: ringed.
        g.strokeStyle = fg;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x + (cell - gap) / 2, y + (cell - gap) / 2, (cell - gap) * 0.3, 0, Math.PI * 2);
        g.stroke();
      }
      if (labelled.has(i)) {
        const note = config.notes[labelled.get(i)];
        const text = keys?.[note] ?? noteName(note);
        // Long drum names shrink to fit their cell.
        const room = cell - gap - 8;
        const width = g.measureText(text).width;
        if (width > room) g.font = `${Math.floor(parseFloat(g.font) * room / width)}px ui-monospace, Menlo, monospace`;
        g.fillStyle = glow > 0.3 ? onAccent : share > 0.5 ? fg : muted;
        g.fillText(text, x + (cell - gap) / 2, y + (cell - gap) * (c === dc && r === dr ? 0.82 : 0.5));
        if (width > room) g.font = font;
      }
    }
  }
}
