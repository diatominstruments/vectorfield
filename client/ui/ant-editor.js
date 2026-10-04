import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { ANT_LIMITS, NODE_RADIUS, QUANTIZE, nextNote, pathKey } from '../../shared/ants.js';
import { newId } from '../../shared/song.js';
import { AntSim } from '../ant-sim.js';
import { Range, mixTint, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;            // canvas px around the ground
const FLASH_SECONDS = 0.3;
const RIM = 2.4;              // a node's rim, where dragging draws a path, reaches this many radii out
const PATH_REACH = 0.015;     // how near a path a click must be to take it away
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };

const L = ANT_LIMITS;

/**
 * Editor for one track's ant colony in a pattern: the web of tuned nodes
 * and paths, drawn by hand, and how the colony forages across it.
 *
 *   click empty ground            add a node, tuned to the next note up
 *   drag a node                   move it (which changes the rhythm)
 *   drag from a node's rim        draw a path to another node, or to empty ground for a new one
 *   click a node                  select it, to tune it or make it the nest or food
 *   click a path                  take it away
 *   double-click a node           take it away, with its paths
 *
 * While the pattern plays, the canvas draws the engine's own colony (read
 * back against the audio clock), so what you see is what you hear. While
 * it doesn't, a silent preview colony forages instead, so the web can be
 * watched at work as it's drawn.
 */
export function AntEditor({ store, engine, pattern, track }) {
  const config = pattern.ants[track.id];
  const canvasRef = useRef();
  const gesture = useRef(null);
  const hover = useRef(null);
  const [picked, setSelected] = useState(null);   // node id
  const M = registry.get(track.instrument.id);
  // A node removed by an edit is no longer selected.
  const selected = config.nodes.find((n) => n.id === picked) ?? null;

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).ants[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, M, bpm: store.doc.bpm };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'ants');
      let scene;
      if (entry) {
        const now = engine.ctx.currentTime;
        scene = { now, ...colonyAt(entry.trace, now), hits: entry.hits };
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

  const noteChoices = M?.keys
    ? Object.entries(M.keys).map(([n, label]) => [Number(n), label])
    : Array.from({ length: PITCH_RANGE[1] - PITCH_RANGE[0] + 1 }, (_, i) => [PITCH_RANGE[0] + i, noteName(PITCH_RANGE[0] + i)]);

  const select = (id) => {
    setSelected(id);
    const node = config.nodes.find((n) => n.id === id);
    if (node) engine.audition(track.id, node.note);
  };

  const tune = (id, note) => {
    edit((a) => { a.nodes.find((n) => n.id === id).note = note; });
    engine.audition(track.id, note);
  };

  // Nest and food are different nodes: making one the other's moves it.
  const makeNest = (id) => edit((a) => { a.nest = id; if (a.food === id) a.food = null; });
  const makeFood = (id) => edit((a) => { a.food = id; if (a.nest === id) a.nest = null; });

  const removeNode = (id) => edit((a) => {
    a.nodes = a.nodes.filter((n) => n.id !== id);
    a.paths = a.paths.filter((p) => !p.includes(id));
    if (a.nest === id) a.nest = null;
    if (a.food === id) a.food = null;
  });

  // A node at `at`, tuned to the next note up; a web's first node is its nest.
  const addNode = (at, joinTo = null) => {
    const id = newId();
    const note = nextNote(config, M?.keys);
    edit((a) => {
      a.nodes.push({ id, x: at.x, y: at.y, note });
      if (!a.nest) a.nest = id;
      if (joinTo && a.paths.length < L.paths) a.paths.push([joinTo, id]);
    });
    setSelected(id);
    engine.audition(track.id, note);
  };

  const set = (key) => (v) => edit((a) => { a[key] = v; });

  // ---- pointer -------------------------------------------------------------------

  const toGround = (e) => {
    // The canvas is drawn at a fixed resolution and scaled by CSS.
    const rect = canvasRef.current.getBoundingClientRect();
    const m = MARGIN * (rect.width / canvasRef.current.width);
    const size = rect.width - 2 * m;
    return { x: (e.clientX - rect.left - m) / size, y: (e.clientY - rect.top - m) / size };
  };
  const inside = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const clamp = (p) => ({
    x: Math.min(1 - NODE_RADIUS, Math.max(NODE_RADIUS, p.x)),
    y: Math.min(1 - NODE_RADIUS, Math.max(NODE_RADIUS, p.y)),
  });

  // What's under the pointer: a node's body or rim, a path, or nothing.
  const under = (p) => {
    let best = null;
    for (const n of config.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y) / NODE_RADIUS;
      if (d < RIM && d < (best?.d ?? Infinity)) best = { node: n, d };
    }
    if (best) return { node: best.node, rim: best.d > 1.2 };
    const byId = new Map(config.nodes.map((n) => [n.id, n]));
    const path = config.paths.find(([a, b]) => distanceToSegment(p, byId.get(a), byId.get(b)) < PATH_REACH);
    return path ? { path } : null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = toGround(e);
    const at = under(p);
    if (at?.node && at.rim) {
      gesture.current = { kind: 'link', from: at.node.id, to: p };
    } else if (at?.node) {
      gesture.current = { kind: 'move', id: at.node.id, start: p, at: { x: at.node.x, y: at.node.y }, dx: at.node.x - p.x, dy: at.node.y - p.y, moved: false };
    } else if (at?.path) {
      const [a, b] = at.path;
      edit((c) => { c.paths = c.paths.filter((q) => pathKey(...q) !== pathKey(a, b)); });
      return;
    } else if (inside(p) && config.nodes.length < L.nodes) {
      addNode(clamp(p));
      return;
    } else {
      return;
    }
    canvasRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const p = toGround(e);
    const g = gesture.current;
    if (!g) {
      // The cursor says what a press would do here.
      hover.current = under(p);
      const h = hover.current;
      canvasRef.current.style.cursor = h?.node ? (h.rim ? 'crosshair' : 'grab') : h?.path ? 'not-allowed' : inside(p) ? 'copy' : 'default';
      return;
    }
    if (g.kind === 'link') {
      g.to = p;
    } else {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 0.01) g.moved = true;
      if (g.moved) g.at = clamp({ x: p.x + g.dx, y: p.y + g.dy });
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'move') {
      if (!g.moved) return select(g.id);
      edit((a) => { Object.assign(a.nodes.find((n) => n.id === g.id), g.at); });
      return;
    }
    // A path ends on the node under the pointer, or makes one there on empty ground.
    const p = toGround(e);
    const target = under(p)?.node;
    if (target && target.id !== g.from) {
      const key = pathKey(g.from, target.id);
      if (config.paths.length < L.paths && !config.paths.some((q) => pathKey(...q) === key)) {
        edit((a) => { a.paths.push([g.from, target.id]); });
      }
    } else if (!target && inside(p) && config.nodes.length < L.nodes && config.paths.length < L.paths) {
      addNode(clamp(p), g.from);
    }
  };

  const onDoubleClick = (e) => {
    const at = under(toGround(e));
    if (at?.node && !at.rim) removeNode(at.node.id);
  };

  const halfLife = (v) => (v === 0 ? 'never fades' : v === 1 ? 'gone at once' : `halves in ~${beats(Math.log(0.5) / Math.log(1 - v))}`);
  const nodeOptions = (note) => html`
    ${!noteChoices.some(([n]) => n === note) && html`<option value=${note}>${noteName(note)}</option>`}
    ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}`;

  return html`
    <div class="bounce-editor ant-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
          onPointerCancel=${() => { gesture.current = null; }} onPointerLeave=${() => { hover.current = null; }}
          onDblClick=${onDoubleClick}></canvas>
        <p class="hint muted">Click to add a node. Drag a node to move it, or drag from its outer ring to another node to join them with a path (or to empty ground to make a new node). Click a path to take it away; double-click a node to delete it. Ants walk at a steady speed, so longer paths mean longer gaps between notes.</p>
      </div>

      <div class="bounce-controls panel">
        ${!config.nest && html`<p class="notice">No nest, so no ants: select a node and make it the nest.</p>`}
        ${config.nest && !config.food && html`<p class="notice">No food, so the ants just roam. Select a node and make it the food for them to find a favourite route.</p>`}
        <${Range} label="Ants" min=${L.ants[0]} max=${L.ants[1]} step="1" value=${config.ants}
          format=${(v) => v} onInput=${set('ants')} />
        <${Range} label="Speed" title="How fast the ants walk: the time to cross the whole ground" min=${L.speed[0]} max=${L.speed[1]} step="0.05" value=${config.speed}
          format=${(v) => beats(1 / v)} onInput=${set('speed')} />
        <${Range} label="Scent fades" title="How quickly scent on the paths fades: how long the colony remembers a route" min="0" max="0.9" step="0.01" value=${config.evaporation}
          format=${halfLife} onInput=${set('evaporation')} />
        <${Range} label="Adventure" title="How often an ant ignores the scent and picks a path at random" min="0" max="1" step="0.01" value=${config.adventure}
          format=${(v) => `${Math.round(v * 100)}%`} onInput=${set('adventure')} />
        <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />
        <label class="field">
          <span>Snap notes</span>
          <select value=${config.quantize} onChange=${(e) => set('quantize')(Number(e.target.value))}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>

        <h4>${selected ? 'Node' : 'Web'}</h4>
        ${selected
          ? html`
            <div class="zone-tune">
              <select aria-label="Note for the selected node" value=${selected.note} onChange=${(e) => tune(selected.id, Number(e.target.value))}>
                ${nodeOptions(selected.note)}
              </select>
            </div>
            <div class="ball-row">
              <button class=${`ghost ${config.nest === selected.id ? 'active' : ''}`} disabled=${config.nest === selected.id}
                onClick=${() => makeNest(selected.id)} title="Where the ants live, and every phrase starts and ends">Nest</button>
              <button class=${`ghost ${config.food === selected.id ? 'active' : ''}`}
                onClick=${() => (config.food === selected.id ? set('food')(null) : makeFood(selected.id))}
                title="What the ants forage for: the far end of the route they settle on">${config.food === selected.id ? 'No food' : 'Food'}</button>
              <span></span>
              <button class="ghost danger" onClick=${() => removeNode(selected.id)}>Delete</button>
            </div>`
          : html`<p class="muted hint">Select a node to tune it, or make it the nest or the food.</p>`}
        <div class="ball-row">
          <span class="muted">${config.nodes.length} / ${L.nodes} nodes · ${config.paths.length} / ${L.paths} paths</span>
          <button class="ghost danger" disabled=${!config.nodes.length}
            onClick=${() => confirm('Clear the whole web?') && edit((a) => { a.nodes = []; a.paths = []; a.nest = null; a.food = null; })}>Clear</button>
        </div>
      </div>
    </div>
  `;
}

const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} beat${v === 1 ? '' : 's'}`;

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  // Not right at either end, where the nodes are.
  if (Math.hypot(p.x - a.x, p.y - a.y) < NODE_RADIUS * RIM || Math.hypot(p.x - b.x, p.y - b.y) < NODE_RADIUS * RIM) return Infinity;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, run a silent colony of our own on the wall clock,
 * following edits, so the web can be seen at work. It carries on from
 * where it was whenever playback stops.
 */
function runPreview(preview, { config, bpm }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new AntSim(config);
    preview.last = now;
  }
  preview.sim.sync(config);
  // A backgrounded tab pauses frames; don't try to catch up on all of it.
  const seconds = Math.min(0.1, now - preview.last);
  const secondsPerBeat = 60 / bpm;
  for (const e of preview.sim.advance(seconds / secondsPerBeat)) {
    preview.hits.push({ time: preview.last + e.at * secondsPerBeat, node: e.node });
  }
  preview.last = now;
  while (preview.hits.length && preview.hits[0].time < now - FLASH_SECONDS) preview.hits.shift();
  return { now, ants: preview.sim.positions(), scent: Object.fromEntries(preview.sim.scent), hits: preview.hits };
}

/** Ants and scent at the audible moment, from the engine's trace: between two entries every ant is on one straight path. */
function colonyAt(trace, now) {
  let i = trace.length - 1;
  while (i > 0 && trace[i].time > now) i--;
  const a = trace[i];
  const b = trace[i + 1];
  if (!b || now <= a.time || b.time === a.time) return a;
  const f = (now - a.time) / (b.time - a.time);
  const next = new Map(b.ants.map((ant) => [ant.id, ant]));
  return {
    scent: a.scent,
    ants: a.ants.map((ant) => {
      const to = next.get(ant.id);
      return to ? { ...ant, x: ant.x + (to.x - ant.x) * f, y: ant.y + (to.y - ant.y) * f } : ant;
    }),
  };
}

// ---- drawing ---------------------------------------------------------------------

function draw(canvas, { now, ants, scent, hits }, { config, selected, M }, gesture, hover) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const size = W - 2 * MARGIN;
  const px = (v) => MARGIN + v * size;
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';
  const line = css.getPropertyValue('--line-strong').trim() || '#474b66';
  const panel2 = css.getPropertyValue('--panel-2').trim() || '#1a1c2a';
  const onAccent = css.getPropertyValue('--on-accent').trim() || '#0b0b13';
  const tints = themeTints(css);
  const h = tints.hue;
  const r = NODE_RADIUS * size;

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(px(0), px(0), size, size);

  // A node being dragged is drawn where it's going.
  const nodes = new Map(config.nodes.map((n) => [n.id, gesture?.kind === 'move' && gesture.id === n.id && gesture.moved ? { ...n, ...gesture.at } : n]));

  // Paths: a bare track, and over it the scent, thicker and brighter the stronger it is.
  const strongest = Math.max(1e-9, ...Object.values(scent ?? {}));
  g.lineCap = 'round';
  for (const [a, b] of config.paths) {
    const p = nodes.get(a);
    const q = nodes.get(b);
    const hovered = hover?.path && pathKey(...hover.path) === pathKey(a, b);
    g.strokeStyle = hovered ? fg : line;
    g.lineWidth = hovered ? 5 : 3;
    g.beginPath();
    g.moveTo(px(p.x), px(p.y));
    g.lineTo(px(q.x), px(q.y));
    g.stroke();
    const s = (scent?.[pathKey(a, b)] ?? 0) / strongest;
    if (s > 0.02) {
      g.strokeStyle = `hsl(${h} ${tints.bright} / ${0.25 + 0.6 * s})`;
      g.lineWidth = 3 + 11 * s;
      g.shadowColor = `hsl(${h} ${tints.bright})`;
      g.shadowBlur = 14 * s;
      g.stroke();
      g.shadowBlur = 0;
    }
  }

  // A path being drawn.
  if (gesture?.kind === 'link') {
    const from = nodes.get(gesture.from);
    g.setLineDash([10, 8]);
    g.strokeStyle = `hsl(${h} ${tints.bright})`;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px(from.x), px(from.y));
    g.lineTo(px(gesture.to.x), px(gesture.to.y));
    g.stroke();
    g.setLineDash([]);
  }

  // Nodes: each glows for a moment as an ant reaches it.
  const lit = new Map();
  for (const hit of hits ?? []) {
    const age = now - hit.time;
    if (age >= 0 && age < FLASH_SECONDS) lit.set(hit.node, Math.max(lit.get(hit.node) ?? 0, 1 - age / FLASH_SECONDS));
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const n of nodes.values()) {
    const x = px(n.x);
    const y = px(n.y);
    const glow = lit.get(n.id) ?? 0;
    const rim = hover?.node?.id === n.id && hover.rim && !gesture;
    if (rim) {
      g.setLineDash([6, 6]);
      g.strokeStyle = muted;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r * RIM, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = glow ? `hsl(${h} ${mixTint(tints.line, tints.hot, glow)})` : n.id === config.food ? `hsl(${h} ${tints.line})` : panel2;
    g.shadowColor = `hsl(${h} ${tints.bright})`;
    g.shadowBlur = glow * 30;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = selected?.id === n.id ? fg : `hsl(${h} ${tints.bright})`;
    g.lineWidth = selected?.id === n.id ? 5 : 3;
    g.stroke();
    if (n.id === config.nest) {
      // The nest: a second ring around it.
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r * 1.35, 0, Math.PI * 2);
      g.stroke();
    }
    // Lit up, a node is as bright as the accent, so its label takes the accent's text colour.
    g.fillStyle = glow > 0.3 ? onAccent : n.id === config.food ? fg : muted;
    g.font = `${W / 42}px ui-monospace, Menlo, monospace`;
    g.fillText(M?.keys?.[n.note] ?? noteName(n.note), x, y);
    if (n.id === config.nest || n.id === config.food) {
      g.fillStyle = muted;
      g.font = `${W / 56}px ui-monospace, Menlo, monospace`;
      g.fillText(n.id === config.nest ? 'nest' : 'food', x, y + r * 1.35 + W / 70);
    }
  }

  // The ants; those carrying food home glow.
  for (const ant of ants ?? []) {
    g.fillStyle = ant.carrying ? `hsl(${h} ${tints.hot})` : fg;
    g.shadowColor = `hsl(${h} ${tints.bright})`;
    g.shadowBlur = ant.carrying ? 14 : 0;
    g.beginPath();
    g.arc(px(ant.x), px(ant.y), ant.carrying ? 8 : 6, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 0;
}
