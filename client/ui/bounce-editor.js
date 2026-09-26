import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, hue, noteName } from '../lib.js';
import { BALL_RADIUS, BOUNCE_LIMITS, QUANTIZE, SEGMENTS, newBall } from '../../shared/bounce.js';
import { newId } from '../../shared/song.js';

const SEGMENT_NAMES = ['Top left', 'Top right', 'Right upper', 'Right lower', 'Bottom right', 'Bottom left', 'Left lower', 'Left upper'];
// Each segment's ends, in box coordinates, clockwise from the top-left.
const SEGMENT_LINES = [
  [0, 0, 0.5, 0], [0.5, 0, 1, 0], [1, 0, 1, 0.5], [1, 0.5, 1, 1],
  [1, 1, 0.5, 1], [0.5, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 0, 0],
];
const SNAP_LABELS = { 0: 'Off', 1: '1/16', 2: '1/8', 4: '1/4' };
const PITCH_RANGE = [24, 96];
const MARGIN = 48;          // canvas px around the box, for segment labels
const FLASH_SECONDS = 0.25;

/**
 * Editor for one track's bouncing balls in a pattern: the box, the balls and
 * the tuned walls. While the pattern plays, the canvas draws the engine's
 * own simulation (read back against the audio clock), so what you see is
 * what you hear.
 */
export function BounceEditor({ store, engine, pattern, track, trackIndex }) {
  const config = pattern.bounce[track.id];
  const canvasRef = useRef();
  const gesture = useRef(null);
  const [selected, setSelected] = useState(-1);   // wall segment being tuned
  const M = registry.get(track.instrument.id);

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).bounce[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, trackIndex, selected, M };

  useEffect(() => {
    let raf;
    const frame = () => {
      draw(canvasRef.current, engine.bounceTrace(pattern.id, track.id), engine, live.current, gesture.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, pattern.id, track.id]);

  // ---- pointer: add, aim and remove balls ------------------------------------

  const toBox = (e) => {
    // The canvas is drawn at a fixed resolution and scaled by CSS.
    const rect = canvasRef.current.getBoundingClientRect();
    const m = MARGIN * (rect.width / canvasRef.current.width);
    const size = rect.width - 2 * m;
    return { x: (e.clientX - rect.left - m) / size, y: (e.clientY - rect.top - m) / size };
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = toBox(e);
    const hitBall = config.balls.find((b) => Math.hypot(b.x - p.x, b.y - p.y) < BALL_RADIUS * 1.6);
    if (hitBall) {
      gesture.current = { id: hitBall.id, from: { x: hitBall.x, y: hitBall.y }, to: p, existing: true, moved: false };
    } else {
      // Outside the box, or at the ball limit: a click there does nothing.
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || config.balls.length >= BOUNCE_LIMITS.balls) return;
      const r = BALL_RADIUS;
      const at = { x: Math.min(1 - r, Math.max(r, p.x)), y: Math.min(1 - r, Math.max(r, p.y)) };
      gesture.current = { id: null, from: at, to: p, existing: false, moved: false };
    }
    canvasRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    g.to = toBox(e);
    if (Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y) > 0.04) g.moved = true;
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    // Aim is the drag direction; a plain click on empty space picks one at random.
    const angle = g.moved ? Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x) : Math.random() * 2 * Math.PI;
    if (g.existing && !g.moved) {
      edit((b) => { b.balls = b.balls.filter((ball) => ball.id !== g.id); });
    } else if (g.existing) {
      edit((b) => { Object.assign(b.balls.find((ball) => ball.id === g.id), newBall(g.id, g.from.x, g.from.y, angle)); });
    } else {
      edit((b) => { b.balls.push(newBall(newId(), g.from.x, g.from.y, angle)); });
    }
  };

  // ---- tuning ------------------------------------------------------------------

  const noteChoices = M?.keys
    ? Object.entries(M.keys).map(([n, label]) => [Number(n), label])
    : Array.from({ length: PITCH_RANGE[1] - PITCH_RANGE[0] + 1 }, (_, i) => [PITCH_RANGE[0] + i, noteName(PITCH_RANGE[0] + i)]);

  const tune = (segment, note) => {
    edit((b) => { b.walls[segment] = note; });
    engine.audition(track.id, note);
  };

  const randomizeBalls = () => edit((b) => {
    b.balls = b.balls.map((ball) => newBall(ball.id, 0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7, Math.random() * 2 * Math.PI));
  });

  return html`
    <div class="bounce-editor" style=${`--hue: ${hue(trackIndex)}`}>
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas" width="840" height="840"
          onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
          onPointerCancel=${() => { gesture.current = null; }}></canvas>
        <p class="hint muted">Click to add a ball, or drag to aim it as you place it. Drag a ball to re-aim it; click it to remove. Every wall hit plays that segment's note.</p>
      </div>

      <div class="bounce-controls panel">
        <${Range} label="Speed" min=${BOUNCE_LIMITS.speed[0]} max=${BOUNCE_LIMITS.speed[1]} step="0.05" value=${config.speed}
          format=${(v) => `${v.toFixed(2)}×`} onInput=${(v) => edit((b) => { b.speed = v; })} />
        <${Range} label="Jitter" min="0" max="1" step="0.01" value=${config.jitter}
          format=${(v) => (v === 0 ? 'none' : `±${Math.round(v * 30)}°`)} onInput=${(v) => edit((b) => { b.jitter = v; })} />
        <${Range} label="Note length" min=${BOUNCE_LIMITS.gate[0]} max=${BOUNCE_LIMITS.gate[1]} step="0.25" value=${config.gate}
          format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${(v) => edit((b) => { b.gate = v; })} />
        <label class="field">
          <span>Snap hits</span>
          <select value=${config.quantize} onChange=${(e) => { const q = Number(e.target.value); edit((b) => { b.quantize = q; }); }}>
            ${QUANTIZE.map((q) => html`<option value=${q}>${SNAP_LABELS[q]}</option>`)}
          </select>
        </label>
        <label class="field check">
          <span>Ball collisions</span>
          <input type="checkbox" checked=${config.collide} onChange=${(e) => { const on = e.target.checked; edit((b) => { b.collide = on; }); }} />
        </label>
        <div class="ball-row">
          <span class="muted">${config.balls.length} / ${BOUNCE_LIMITS.balls} balls</span>
          <button class="ghost" disabled=${!config.balls.length} onClick=${randomizeBalls} title="New random starting positions and directions">Scatter</button>
          <button class="ghost danger" disabled=${!config.balls.length} onClick=${() => edit((b) => { b.balls = []; })}>Clear</button>
        </div>

        <h4>Walls</h4>
        <div class="wall-tuning">
          ${Array.from({ length: SEGMENTS }, (_, i) => html`
            <label class=${`field ${selected === i ? 'selected' : ''}`} key=${i}
              onFocusIn=${() => setSelected(i)} onFocusOut=${() => setSelected(-1)}>
              <span>${SEGMENT_NAMES[i]}</span>
              <select value=${config.walls[i]} onChange=${(e) => tune(i, Number(e.target.value))}>
                ${!noteChoices.some(([n]) => n === config.walls[i]) && html`<option value=${config.walls[i]}>${noteName(config.walls[i])}</option>`}
                ${noteChoices.map(([n, label]) => html`<option value=${n}>${label}</option>`)}
              </select>
            </label>`)}
        </div>
      </div>
    </div>
  `;
}

function Range({ label, min, max, step, value, format, onInput }) {
  return html`
    <label class="field">
      <span>${label}</span>
      <input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onInput(Number(e.target.value))} />
      <output>${format(value)}</output>
    </label>`;
}

// ---- drawing ---------------------------------------------------------------------

/** Ball positions at the audible moment, interpolated from the engine's trace. */
function ballsAt(trace, now) {
  let i = trace.length - 1;
  while (i > 0 && trace[i].time > now) i--;
  const a = trace[i];
  const b = trace[i + 1];
  if (!b || now <= a.time) return a.balls;
  const f = (now - a.time) / (b.time - a.time);
  const next = new Map(b.balls.map((ball) => [ball.id, ball]));
  return a.balls.map((ball) => {
    const to = next.get(ball.id);
    return to ? { id: ball.id, x: ball.x + (to.x - ball.x) * f, y: ball.y + (to.y - ball.y) * f } : ball;
  });
}

function draw(canvas, trace, engine, { config, trackIndex, selected, M }, gesture) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const box = W - 2 * MARGIN;
  const px = (v) => MARGIN + v * box;
  const h = hue(trackIndex);
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';

  g.clearRect(0, 0, W, W);
  g.fillStyle = css.getPropertyValue('--panel').trim() || '#13141f';
  g.fillRect(px(0), px(0), box, box);

  const now = engine.ctx?.currentTime ?? 0;

  // Walls: each segment glows for a moment after a hit.
  const lit = new Array(SEGMENTS).fill(0);
  for (const hit of trace?.hits ?? []) {
    const age = now - hit.time;
    if (age >= 0 && age < FLASH_SECONDS) lit[hit.segment] = Math.max(lit[hit.segment], 1 - age / FLASH_SECONDS);
  }
  g.lineCap = 'round';
  g.font = `${W / 28}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  SEGMENT_LINES.forEach(([x0, y0, x1, y1], i) => {
    const glow = lit[i];
    g.strokeStyle = `hsl(${h} ${60 + glow * 30}% ${38 + glow * 40}%)`;
    g.lineWidth = selected === i ? 12 : 6 + glow * 8;
    g.shadowColor = `hsl(${h} 90% 65%)`;
    g.shadowBlur = glow * 30;
    const inset = 0.02;   // gap between segments, so each reads as its own key
    g.beginPath();
    g.moveTo(px(x0 + (x1 - x0) * inset), px(y0 + (y1 - y0) * inset));
    g.lineTo(px(x1 - (x1 - x0) * inset), px(y1 - (y1 - y0) * inset));
    g.stroke();
    g.shadowBlur = 0;

    // Note label just outside the segment's midpoint.
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const out = MARGIN * 0.55 / box;
    const lx = mx === 0 ? -out : mx === 1 ? 1 + out : mx;
    const ly = my === 0 ? -out : my === 1 ? 1 + out : my;
    const note = config.walls[i];
    g.fillStyle = glow > 0.2 ? fg : muted;
    // Side labels run along their wall, so long drum names still fit the margin.
    g.save();
    g.translate(px(lx), px(ly));
    if (mx === 0) g.rotate(-Math.PI / 2);
    if (mx === 1) g.rotate(Math.PI / 2);
    g.fillText(M?.keys?.[note] ?? noteName(note), 0, 0);
    g.restore();
  });

  // Where each ball starts, with its aim; faint while the live balls play.
  const playing = Boolean(trace);
  for (const ball of config.balls) {
    const aiming = gesture?.existing && gesture.id === ball.id && gesture.moved;
    const dir = aiming ? Math.atan2(gesture.to.y - ball.y, gesture.to.x - ball.x) : Math.atan2(ball.vy, ball.vx);
    drawBall(g, px(ball.x), px(ball.y), BALL_RADIUS * box, dir, playing ? 0.3 : 1, h);
  }
  if (gesture && !gesture.existing) {
    const dir = gesture.moved ? Math.atan2(gesture.to.y - gesture.from.y, gesture.to.x - gesture.from.x) : null;
    drawBall(g, px(gesture.from.x), px(gesture.from.y), BALL_RADIUS * box, dir, 0.7, h);
  }

  if (playing) {
    g.fillStyle = `hsl(${h} 90% 72%)`;
    g.shadowColor = `hsl(${h} 90% 65%)`;
    g.shadowBlur = 16;
    for (const ball of ballsAt(trace.trace, now)) {
      g.beginPath();
      g.arc(px(ball.x), px(ball.y), BALL_RADIUS * box, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
  }
}

function drawBall(g, x, y, r, dir, alpha, h) {
  g.globalAlpha = alpha;
  g.strokeStyle = `hsl(${h} 80% 70%)`;
  g.fillStyle = `hsl(${h} 60% 45%)`;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  if (dir !== null) {
    const len = r * 2.6;
    const tx = x + Math.cos(dir) * len;
    const ty = y + Math.sin(dir) * len;
    g.beginPath();
    g.moveTo(x + Math.cos(dir) * r, y + Math.sin(dir) * r);
    g.lineTo(tx, ty);
    g.moveTo(tx, ty);
    g.lineTo(tx - Math.cos(dir - 0.5) * r * 0.9, ty - Math.sin(dir - 0.5) * r * 0.9);
    g.moveTo(tx, ty);
    g.lineTo(tx - Math.cos(dir + 0.5) * r * 0.9, ty - Math.sin(dir + 0.5) * r * 0.9);
    g.stroke();
  }
  g.globalAlpha = 1;
}
