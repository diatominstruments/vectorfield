import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { instrumentKeys } from './params.js';
import { LILY_LIMITS, QUANTIZE, newSeed } from '../../shared/lilypond.js';
import { nextScaleNote } from '../../shared/scale.js';
import { newId } from '../../shared/song.js';
import { LilySim } from '../lily-sim.js';
import { Range, mixTint, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;              // canvas px around the pond
const RIPPLE_SECONDS = 1;       // how long a drop's ripple spreads before it's gone
const RIPPLE_REACH = 0.06;      // how far it spreads, in pond widths
const SPLASH_SECONDS = 0.4;     // how long a struck pad stays lit
const RIM = 0.015;              // how near a pad's edge, in pond widths, a drag resizes it instead of moving it
const NEW_PAD = 0.08;           // a new pad's radius
const PETALS = 8;
const STEPS_PER_BEAT = 4;
const COVERAGE_GRID = 64;       // samples a side when working out how much of the pond the pads cover
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };

const L = LILY_LIMITS;

/**
 * Editor for one track's lily pond in a pattern: the pads, their notes,
 * sizes and flowers, and the rain falling on them.
 *
 *   click open water          add a pad, tuned to the next note up
 *   shift-click open water    add a pad in flower
 *   drag a pad                move it
 *   drag a pad's edge         resize it (a bigger pad catches more of the rain)
 *   click a pad               select it, to tune and size it
 *   shift-click a pad         put it in flower, or take the flower off
 *   double-click a pad        take it away
 *
 * While the pattern plays, the canvas draws the engine's own rain (read
 * back against the audio clock), so what you see is what you hear. While
 * it doesn't, a silent preview rain falls instead, so changes can be
 * watched as they're made.
 */
export function LilyEditor({ store, engine, pattern, track }) {
  const config = pattern.lilypond[track.id];
  const canvasRef = useRef();
  const gesture = useRef(null);
  const hover = useRef(null);
  const [picked, setSelected] = useState(null);   // pad id
  const keys = instrumentKeys(registry.get(track.instrument.id), track.instrument.params);
  // A pad removed by an edit is no longer selected.
  const selected = config.pads.find((p) => p.id === picked) ?? null;

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).lilypond[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, keys, bpm: store.doc.bpm, length: pattern.length };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0, beat: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'lilypond');
      let scene;
      if (entry) {
        const now = engine.ctx.currentTime;
        scene = { now, shower: showerAt(entry.trace, now), hits: entry.hits };
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

  // How a pad sounds when a drop strikes it: harder on a flower.
  const audition = (pad) => engine.audition(track.id, pad.note, pad.flower ? 1 : 0.75);

  const select = (id) => {
    setSelected(id);
    const pad = config.pads.find((p) => p.id === id);
    if (pad) audition(pad);
  };

  const editPad = (id, fn) => edit((c) => fn(c.pads.find((p) => p.id === id)));
  const tune = (pad, note) => {
    editPad(pad.id, (p) => { p.note = note; });
    audition({ ...pad, note });
  };
  const toggleFlower = (pad) => {
    editPad(pad.id, (p) => { p.flower = !p.flower; });
    audition({ ...pad, flower: !pad.flower });
  };
  const removePad = (id) => edit((c) => { c.pads = c.pads.filter((p) => p.id !== id); });

  const addPad = (at, flower) => {
    const id = newId();
    const notes = config.pads.map((p) => p.note);
    const note = nextScaleNote(notes, notes.length ? Math.min(...notes) : 60, keys);
    const pad = { id, ...fit(at, NEW_PAD), size: NEW_PAD, note, flower };
    edit((c) => { c.pads.push(pad); });
    setSelected(id);
    audition(pad);
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
  // The pad under the pointer, the topmost where they overlap, and whether
  // the pointer is on its edge.
  const padAt = (p) => {
    const pad = config.pads.findLast((pad) => Math.hypot(pad.x - p.x, pad.y - p.y) <= pad.size + RIM);
    return pad ? { pad, rim: Math.hypot(pad.x - p.x, pad.y - p.y) >= pad.size - RIM } : null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = toPond(e);
    const hit = padAt(p);
    if (hit) {
      const { pad, rim } = hit;
      gesture.current = { id: pad.id, rim, shift: e.shiftKey, start: p, at: { x: pad.x, y: pad.y }, size: pad.size, dx: pad.x - p.x, dy: pad.y - p.y, moved: false };
      canvasRef.current.setPointerCapture(e.pointerId);
    } else if (inside(p) && config.pads.length < L.pads) {
      addPad(p, e.shiftKey);
    }
  };

  const onPointerMove = (e) => {
    const p = toPond(e);
    const g = gesture.current;
    if (!g) {
      hover.current = padAt(p);
      canvasRef.current.style.cursor = hover.current ? (hover.current.rim ? 'nwse-resize' : 'grab') : inside(p) ? 'copy' : 'default';
      return;
    }
    if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 0.01) g.moved = true;
    if (!g.moved) return;
    if (g.rim) {
      // As big as the pointer says, but no further than the pond's edge.
      const { x, y } = g.at;
      g.size = Math.max(L.size[0], Math.min(L.size[1], Math.hypot(p.x - x, p.y - y), x, 1 - x, y, 1 - y));
    } else {
      g.at = fit({ x: p.x + g.dx, y: p.y + g.dy }, g.size);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const pad = config.pads.find((p) => p.id === g.id);
    if (!pad) return;
    if (g.moved) editPad(g.id, (p) => Object.assign(p, g.at, { size: Number(g.size.toFixed(4)) }));
    else if (g.shift) {
      setSelected(g.id);
      toggleFlower(pad);
    } else {
      select(g.id);
    }
  };

  const onDoubleClick = (e) => {
    const hit = padAt(toPond(e));
    if (hit) removePad(hit.pad.id);
  };

  const notesPerBeat = config.density * coverage(config.pads);

  return html`
    <div class="bounce-editor lily-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
          onPointerCancel=${() => { gesture.current = null; }} onPointerLeave=${() => { hover.current = null; }}
          onDblClick=${onDoubleClick}></canvas>
        <p class="hint muted">Click the water to float a lily pad, or shift-click for one in flower; drag a pad to move it or its edge to resize it, click it to tune it, shift-click to put it in flower or take the flower off, double-click to take it away. A raindrop striking a pad plays its note, accented on a flower; drops into open water only ripple, so the bigger the pads the busier the line.</p>
      </div>

      <div class="bounce-controls panel">
        <${Range} label="Rain" title="How hard it's raining: drops a beat over the whole pond, pads or not"
          min=${Math.log2(L.density[0])} max=${Math.log2(L.density[1])} step="0.05" value=${Math.log2(config.density)}
          format=${() => `${round(config.density)} a beat`} onInput=${(v) => set('density')(round(2 ** v))} />
        <${Range} label="Evenness" title="Whether drops fall at random moments or evenly spaced, like a drip" min="0" max="1" step="0.01" value=${config.evenness}
          format=${(v) => (v === 0 ? 'at random' : v === 1 ? 'a drip' : `${Math.round(v * 100)}%`)} onInput=${set('evenness')} />
        <${Range} label="Gusts" title="How much the rain comes and goes, from a lull to twice as heavy, every beat or few" min="0" max="1" step="0.01" value=${config.gusts}
          format=${(v) => (v === 0 ? 'steady' : `${Math.round(v * 100)}%`)} onInput=${set('gusts')} />
        <${Range} label="Shower" title="How wide the rain falls: over the whole pond, or a shower the wind drifts across it, playing the pads it passes over"
          min=${L.shower[0]} max=${L.shower[1]} step="0.01" value=${config.shower}
          format=${(v) => (v >= 1 ? 'whole pond' : `${Math.round(v * 100)}% wide`)} onInput=${set('shower')} />
        ${config.shower < 1 && html`
          <${Range} label="Wind" title="How fast the wind drifts the shower: the time it takes to cross the pond" min=${L.wind[0]} max=${L.wind[1]} step="0.005" value=${config.wind}
            format=${(v) => (v === 0 ? 'still' : beats(1 / v))} onInput=${set('wind')} />`}
        <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />
        <label class="field">
          <span>Snap drops</span>
          <select value=${config.quantize} onChange=${(e) => set('quantize')(Number(e.target.value))}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>
        <label class="field check" title="Let the same rain fall every pass through the pattern, so a line you like can be kept">
          <span>Repeat each pass</span>
          <input type="checkbox" checked=${config.repeat} onChange=${(e) => set('repeat')(e.target.checked)} />
        </label>
        ${config.repeat && html`
          <div class="ball-row">
            <span class="muted">The same drops every pass.</span>
            <button class="ghost" title="Let a different rain fall, and repeat that one instead" onClick=${() => set('seed')(newSeed())}>New rain</button>
          </div>`}

        <h4>${selected ? (selected.flower ? 'Lily in flower' : 'Lily pad') : 'Lily pads'}</h4>
        ${selected
          ? html`
            <div class="zone-tune">
              <select aria-label="Note for the selected pad" value=${selected.note} onChange=${(e) => tune(selected, Number(e.target.value))}>
                ${!noteChoices.some(([n]) => n === selected.note) && html`<option value=${selected.note}>${noteName(selected.note)}</option>`}
                ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}
              </select>
            </div>
            <${Range} label="Size" title="How big the pad is: the share of the rain it catches"
              min=${L.size[0]} max=${Math.min(L.size[1], selected.x, 1 - selected.x, selected.y, 1 - selected.y)} step="0.005" value=${selected.size}
              format=${(v) => `${(Math.PI * v * v * 100).toFixed(1)}% of rain`} onInput=${(v) => editPad(selected.id, (p) => { p.size = v; })} />
            <div class="ball-row">
              <button class="ghost" title=${selected.flower ? 'Drops on it will play plain notes' : 'Drops on it will play accented notes'}
                onClick=${() => toggleFlower(selected)}>${selected.flower ? 'Take the flower off' : 'Put it in flower'}</button>
              <span></span>
              <button class="ghost danger" onClick=${() => removePad(selected.id)}>Delete</button>
            </div>`
          : html`<p class="muted hint">Select a pad to tune it, size it, or put it in flower.</p>`}
        <div class="ball-row">
          <span class="muted">${config.pads.length} / ${L.pads} pads${config.pads.length > 0 && `, ${pace(notesPerBeat)}`}</span>
          <button class="ghost danger" disabled=${!config.pads.length}
            onClick=${() => confirm('Take away every pad?') && edit((c) => { c.pads = []; })}>Clear</button>
        </div>
      </div>
    </div>
  `;
}

const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} beat${v === 1 ? '' : 's'}`;
const round = (v) => (v >= 10 ? Math.round(v) : Number(v.toPrecision(2)));

/** How often the pads sound, given `n` notes a beat on average. */
function pace(n) {
  if (n >= 1) return `about ${round(n)} note${round(n) === 1 ? '' : 's'} a beat`;
  return n > 0 ? `a note every ${beats(round(1 / n))} or so` : 'no notes';
}

/** Where a pad of radius `size` centred near `p` can sit, wholly in the pond. */
const fit = (p, size) => ({
  x: Math.min(1 - size, Math.max(size, p.x)),
  y: Math.min(1 - size, Math.max(size, p.y)),
});

/** The share of the pond the pads cover, overlaps counted once. */
function coverage(pads) {
  let covered = 0;
  for (let i = 0; i < COVERAGE_GRID; i++) {
    for (let j = 0; j < COVERAGE_GRID; j++) {
      const x = (i + 0.5) / COVERAGE_GRID;
      const y = (j + 0.5) / COVERAGE_GRID;
      if (pads.some((p) => Math.hypot(p.x - x, p.y - y) <= p.size)) covered++;
    }
  }
  return covered / COVERAGE_GRID ** 2;
}

// A pad's own angle for the notch in its edge, so they don't all face one way.
function notchOf(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((h >>> 0) % 360) * (Math.PI / 180);
}

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, let a silent rain of our own fall on the wall
 * clock, following edits, so the settings can be seen at work — starting
 * it over every pattern's length, as playback would, when it repeats.
 */
function runPreview(preview, { config, bpm, length }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new LilySim(config);
    preview.last = now;
  }
  preview.sim.sync(config);
  // A backgrounded tab pauses frames; don't try to catch up on all of it.
  const seconds = Math.min(0.1, now - preview.last);
  const secondsPerBeat = 60 / bpm;
  const span = seconds / secondsPerBeat;
  const passBeats = length / STEPS_PER_BEAT;
  if (config.repeat && Math.floor((preview.beat + span) / passBeats) > Math.floor(preview.beat / passBeats)) preview.sim.reseed();
  preview.beat += span;
  for (const e of preview.sim.advance(span)) {
    preview.hits.push({ time: preview.last + e.at * secondsPerBeat, x: e.x, y: e.y, pad: e.pad, flower: e.flower });
  }
  preview.last = now;
  while (preview.hits.length && preview.hits[0].time < now - RIPPLE_SECONDS) preview.hits.shift();
  return { now, shower: preview.sim.shower(), hits: preview.hits };
}

/** Where the shower is at the audible moment, from the engine's trace: it drifts in a straight line in between. */
function showerAt(trace, now) {
  let i = trace.length - 1;
  while (i > 0 && trace[i].time > now) i--;
  const a = trace[i];
  const b = trace[i + 1];
  if (!a) return null;
  if (!b || now <= a.time || b.time === a.time) return a.shower;
  const k = Math.min(1, (now - a.time) / (b.time - a.time));
  return { ...b.shower, x: a.shower.x + (b.shower.x - a.shower.x) * k, y: a.shower.y + (b.shower.y - a.shower.y) * k };
}

// ---- drawing ---------------------------------------------------------------------

function draw(canvas, { now, shower, hits }, { config, selected, keys }, gesture, hover) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const size = W - 2 * MARGIN;
  const px = (v) => MARGIN + v * size;
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';
  const fill = css.getPropertyValue('--tint-fill').trim() || '45% 22%';
  const tints = themeTints(css);
  const h = tints.hue;

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(px(0), px(0), size, size);
  // Everything stays in the pond, where clicks add pads.
  g.save();
  g.beginPath();
  g.rect(px(0), px(0), size, size);
  g.clip();

  // The shower, a soft patch of the pond where the rain is falling.
  if (shower?.radius) {
    const r = shower.radius * size;
    const glow = g.createRadialGradient(px(shower.x), px(shower.y), 0, px(shower.x), px(shower.y), r);
    glow.addColorStop(0, `hsl(${h} ${tints.bright} / 0.12)`);
    glow.addColorStop(0.75, `hsl(${h} ${tints.bright} / 0.06)`);
    glow.addColorStop(1, `hsl(${h} ${tints.bright} / 0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(px(shower.x), px(shower.y), r, 0, Math.PI * 2);
    g.fill();
  }

  // A pad being dragged is drawn where it's going, at the size it's becoming.
  const pads = config.pads.map((p) => (gesture?.id === p.id && gesture.moved ? { ...p, ...gesture.at, size: gesture.size } : p));
  const byId = new Map(pads.map((p) => [p.id, p]));

  // Ripples: from where a drop fell into open water, or from the edge of
  // the pad it struck, which bobs and sets the water round it moving.
  const struck = new Map();   // pad id → how lit, 0..1
  g.lineWidth = 2;
  for (const hit of hits ?? []) {
    const age = (now - hit.time) / RIPPLE_SECONDS;
    if (age < 0 || age >= 1) continue;
    const pad = hit.pad ? byId.get(hit.pad) : null;
    if (hit.pad && !pad) continue;
    if (pad) {
      const lit = 1 - (now - hit.time) / SPLASH_SECONDS;
      if (lit > 0) struck.set(pad.id, Math.max(struck.get(pad.id) ?? 0, lit));
    }
    const [x, y, from] = pad ? [pad.x, pad.y, pad.size] : [hit.x, hit.y, 0.004];
    g.strokeStyle = `hsl(${h} ${tints.bright} / ${(1 - age) * (pad ? (pad.flower ? 0.7 : 0.5) : 0.35)})`;
    g.beginPath();
    g.arc(px(x), px(y), (from + RIPPLE_REACH * Math.sqrt(age)) * size, 0, Math.PI * 2);
    g.stroke();
  }

  // The edge of the pad under the pointer, when a drag there would resize it.
  const resizing = gesture?.rim ? byId.get(gesture.id) : hover?.rim ? byId.get(hover.pad.id) : null;
  if (resizing) {
    g.setLineDash([6, 8]);
    g.strokeStyle = muted;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px(resizing.x), px(resizing.y), resizing.size * size + 8, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  for (const pad of pads) {
    const x = px(pad.x);
    const y = px(pad.y);
    const r = pad.size * size;
    const lit = struck.get(pad.id) ?? 0;
    const picked = selected?.id === pad.id;
    // The pad, with the notch in its edge, dipping a little as a drop strikes it.
    const notch = notchOf(pad.id);
    const rr = r * (1 - 0.04 * lit);
    g.fillStyle = `hsl(${h} ${mixTint(fill, tints.line, 0.3 + 0.7 * lit)})`;
    g.strokeStyle = picked ? fg : `hsl(${h} ${lit ? tints.bright : tints.line})`;
    g.lineWidth = picked ? 3 : 2;
    g.shadowColor = `hsl(${h} ${tints.bright})`;
    g.shadowBlur = lit * (pad.flower ? 30 : 14);
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, rr, notch + 0.2, notch + Math.PI * 2 - 0.2);
    g.closePath();
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    // Veins, from the middle out.
    g.strokeStyle = `hsl(${h} ${tints.line} / 0.5)`;
    g.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const a = notch + (i / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * rr * 0.85, y + Math.sin(a) * rr * 0.85);
      g.stroke();
    }
    // A flower in the middle, flaring as it's struck.
    if (pad.flower) {
      const petal = Math.min(r * 0.62, 34) * (1 + 0.15 * lit);
      g.shadowColor = `hsl(${h} ${tints.hot})`;
      g.shadowBlur = lit * 30;
      g.fillStyle = `hsl(${h} ${mixTint(tints.bright, tints.hot, lit)})`;
      g.strokeStyle = `hsl(${h} ${tints.line})`;
      g.lineWidth = 1.5;
      for (let i = 0; i < PETALS; i++) {
        const a = notch + (i / PETALS) * Math.PI * 2;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * petal * 0.5, y + Math.sin(a) * petal * 0.5, petal * 0.5, petal * 0.22, a, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.shadowBlur = 0;
      g.fillStyle = fg;
      g.beginPath();
      g.arc(x, y, petal * 0.18, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Notes under their pads, over everything, so a pad on top doesn't hide one.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${W / 50}px ui-monospace, Menlo, monospace`;
  for (const pad of pads) {
    g.fillStyle = (struck.get(pad.id) ?? 0) > 0.3 || selected?.id === pad.id ? fg : muted;
    g.fillText(keys?.[pad.note] ?? noteName(pad.note), px(pad.x), px(pad.y) + pad.size * size + W / 55);
  }

  // Each drop as it strikes: a fleck where it landed.
  for (const hit of hits ?? []) {
    const age = (now - hit.time) / SPLASH_SECONDS;
    if (age < 0 || age >= 1) continue;
    g.fillStyle = `hsl(${h} ${tints.hot} / ${1 - age})`;
    g.beginPath();
    g.arc(px(hit.x), px(hit.y), 3 + 2 * (1 - age), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
