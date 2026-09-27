import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, noteName } from '../lib.js';
import { CORE, SECTIONS, TUBULE_LIMITS, resection, ringAt, ringStart, sectionAt, sectionStart } from '../../shared/tubules.js';
import { TubuleSim } from '../tubule-sim.js';
import { Range, mixTint, themeTints } from './bounce-editor.js';

const PITCH_RANGE = [24, 96];
const MARGIN = 16;            // canvas px around the cell
const FLASH_SECONDS = 0.4;
const SOUND_LABELS = { tip: 'Growing tip', whole: 'Whole tubule' };

const L = TUBULE_LIMITS;
const beats = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} beats`;
const every = (rate) => (rate === 0 ? 'never' : `~${beats(1 / rate)}`);
const ringName = (i, n) => (n === 1 ? 'Ring' : i === 0 ? 'Inner' : i === n - 1 ? 'Outer' : `Ring ${i + 1}`);

/**
 * Editor for one track's microtubules in a pattern: the cell with its tuned
 * zones, and the growth and switching rates. While the pattern plays, the
 * canvas draws the engine's own simulation (read back against the audio
 * clock), so what you see is what you hear. While it doesn't, a silent
 * preview runs instead, so changes to the rates can be watched as they're
 * made.
 */
export function TubuleEditor({ store, engine, pattern, track }) {
  const config = pattern.tubules[track.id];
  const canvasRef = useRef();
  const [picked, setSelected] = useState(null);   // zone being tuned: { ring, section }
  const M = registry.get(track.instrument.id);
  // A zone removed by an edit is no longer selected.
  const selected = picked && picked.ring < config.rings.length && picked.section < config.sections ? picked : null;

  const edit = (fn) => store.edit((d) => fn(d.patterns.find((p) => p.id === pattern.id).tubules[track.id], d));

  // Latest props for the draw loop, which outlives any one render.
  const live = useRef();
  live.current = { config, selected, M, bpm: store.doc.bpm };

  useEffect(() => {
    let raf;
    const preview = { sim: null, hits: [], last: 0 };
    const frame = () => {
      const entry = engine.sequencerTrace(pattern.id, track.id, 'tubules');
      let scene;
      if (entry) {
        const now = engine.ctx.currentTime;
        scene = { now, tubules: tubulesAt(entry.trace, now), hits: entry.hits };
      } else {
        scene = runPreview(preview, live.current);
      }
      draw(canvasRef.current, scene, live.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, pattern.id, track.id]);

  // ---- tuning ------------------------------------------------------------------

  const noteChoices = M?.keys
    ? Object.entries(M.keys).map(([n, label]) => [Number(n), label])
    : Array.from({ length: PITCH_RANGE[1] - PITCH_RANGE[0] + 1 }, (_, i) => [PITCH_RANGE[0] + i, noteName(PITCH_RANGE[0] + i)]);
  const label = (note) => M?.keys?.[note] ?? noteName(note);

  const pick = (zone) => {
    setSelected(zone);
    if (zone) engine.audition(track.id, config.rings[zone.ring][zone.section]);
  };

  const tune = ({ ring, section }, note) => {
    edit((t) => { t.rings[ring][section] = note; });
    engine.audition(track.id, note);
  };

  const tuneRing = ({ ring, section }) => edit((t) => { t.rings[ring].fill(t.rings[ring][section]); });

  const setSections = (n) => edit((t) => {
    t.sections = n;
    t.rings = t.rings.map((ring) => resection(ring, n));
  });

  // A new outer ring a fourth above the last (or the next drum sound along), section by section.
  const addRing = () => edit((t) => {
    const step = M?.keys ? 1 : 5;
    t.rings.push(t.rings.at(-1).map((last) => {
      const at = noteChoices.findIndex(([n]) => n === last);
      return at < 0 ? Math.min(127, last + step) : noteChoices[Math.min(noteChoices.length - 1, at + step)][0];
    }));
  });

  const set = (key) => (v) => edit((t) => { t[key] = v; });

  // ---- pointer: pick a zone to tune ------------------------------------------------

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scale - canvas.width / 2;
    const y = (e.clientY - rect.top) * scale - canvas.height / 2;
    const r = Math.hypot(x, y) / (canvas.width / 2 - MARGIN);
    const ring = r <= 1 ? ringAt(r, config.rings.length) : -1;
    pick(ring >= 0 ? { ring, section: sectionAt(Math.atan2(y, x), config.sections) } : null);
  };

  return html`
    <div class="bounce-editor tubule-editor">
      <div class="bounce-stage">
        <canvas ref=${canvasRef} class="bounce-canvas tubule-canvas" width="840" height="840" onPointerDown=${onPointerDown}></canvas>
        <p class="hint muted">Tubules grow out from the centre, and at random collapse back into it. Each zone of the cell plays its note as tubules reach it. Click a zone to hear and tune it.</p>
      </div>

      <div class="bounce-controls panel">
        <${Range} label="Tubules" title="The most tubules alive at once" min=${L.count[0]} max=${L.count[1]} step="1" value=${config.count}
          format=${(v) => `≤ ${v}`} onInput=${set('count')} />
        <${Range} label="Growth" title="How fast tubules grow: the time from the centre to the edge" min=${L.growth[0]} max=${L.growth[1]} step="0.005" value=${config.growth}
          format=${(v) => beats(1 / v)} onInput=${set('growth')} />
        <${Range} label="Shrink" title="How fast collapsing tubules shrink: the time from the edge back to the centre" min=${L.shrink[0]} max=${L.shrink[1]} step="0.01" value=${config.shrink}
          format=${(v) => beats(1 / v)} onInput=${set('shrink')} />
        <${Range} label="Catastrophe" title="How often a growing tubule starts to collapse: the average wait" min=${L.catastrophe[0]} max=${L.catastrophe[1]} step="0.005" value=${config.catastrophe}
          format=${every} onInput=${set('catastrophe')} />
        <${Range} label="Rescue" title="How often a collapsing tubule starts growing again: the average wait" min=${L.rescue[0]} max=${L.rescue[1]} step="0.01" value=${config.rescue}
          format=${every} onInput=${set('rescue')} />
        <${Range} label="Nucleation" title="How soon a new tubule starts when there's room for one: the average wait" min=${L.nucleation[0]} max=${L.nucleation[1]} step="0.01" value=${config.nucleation}
          format=${every} onInput=${set('nucleation')} />
        <label class="field" title="Growing tip: only the zone at a growing tubule's tip sounds. Whole tubule: every zone a tubule reaches into sounds together, and a collapsing one lets go of them from the outside in.">
          <span>Sounds</span>
          <select value=${config.sound} onChange=${(e) => set('sound')(e.target.value)}>
            ${Object.entries(SOUND_LABELS).map(([k, text]) => html`<option value=${k}>${text}</option>`)}
          </select>
        </label>
        <label class="field check" title="Hold each zone's note for as long as it's sounding, for drones. Otherwise every ring a tip grows into strikes its notes once.">
          <span>Hold notes</span>
          <input type="checkbox" checked=${config.hold} onChange=${(e) => set('hold')(e.target.checked)} />
        </label>
        ${!config.hold && html`
          <${Range} label="Note length" min=${L.gate[0]} max=${L.gate[1]} step="0.25" value=${config.gate}
            format=${(v) => `${v} step${v === 1 ? '' : 's'}`} onInput=${set('gate')} />`}

        <h4>Zones <span class="muted">centre out, clockwise</span></h4>
        <label class="field" title="How many ways each ring is divided, so tubules pointing different ways play different notes">
          <span>Sections</span>
          <select value=${config.sections} onChange=${(e) => setSections(Number(e.target.value))}>
            ${SECTIONS.map((n) => html`<option value=${n}>${n === 1 ? 'Whole rings' : n}</option>`)}
          </select>
        </label>
        <div class="zone-grid" style=${`--sections: ${config.sections}`}>
          ${config.rings.map((ring, r) => html`
            <span class="muted" key=${`l${r}`}>${ringName(r, config.rings.length)}</span>
            ${ring.map((note, s) => html`
              <button key=${`${r}:${s}`} class=${`ghost ${selected?.ring === r && selected?.section === s ? 'active' : ''}`}
                title=${`${ringName(r, config.rings.length)}, section ${s + 1}`}
                onClick=${() => pick({ ring: r, section: s })}>${label(note)}</button>`)}`)}
        </div>
        ${selected && html`
          <div class="zone-tune">
            <select aria-label="Note for the selected zone" value=${config.rings[selected.ring][selected.section]}
              onChange=${(e) => tune(selected, Number(e.target.value))}>
              ${!noteChoices.some(([n]) => n === config.rings[selected.ring][selected.section])
                && html`<option value=${config.rings[selected.ring][selected.section]}>${noteName(config.rings[selected.ring][selected.section])}</option>`}
              ${noteChoices.map(([n, text]) => html`<option value=${n}>${text}</option>`)}
            </select>
            ${config.sections > 1 && html`
              <button class="ghost" onClick=${() => tuneRing(selected)} title="Give every section of this ring this note">Whole ring</button>`}
          </div>`}
        <div class="ball-row">
          <span class="muted">${config.rings.length} / ${L.rings[1]} rings</span>
          <button class="ghost" disabled=${config.rings.length >= L.rings[1]} onClick=${addRing}>+ Ring</button>
          <button class="ghost" disabled=${config.rings.length <= L.rings[0]} onClick=${() => edit((t) => { t.rings.pop(); })}>− Ring</button>
        </div>
      </div>
    </div>
  `;
}

// ---- simulation for drawing ---------------------------------------------------------

/**
 * While nothing plays, run a silent simulation of our own on the wall clock,
 * following edits, so the settings can be seen at work. It carries on from
 * where it was whenever playback stops.
 */
function runPreview(preview, { config, bpm }) {
  const now = performance.now() / 1000;
  if (!preview.sim) {
    preview.sim = new TubuleSim(config);
    preview.last = now;
  }
  preview.sim.sync(config);
  // A backgrounded tab pauses frames; don't try to catch up on all of it.
  const seconds = Math.min(0.1, now - preview.last);
  const secondsPerBeat = 60 / bpm;
  for (const e of preview.sim.advance(seconds / secondsPerBeat)) {
    preview.hits.push({ time: preview.last + e.at * secondsPerBeat, ring: e.ring, section: e.section });
  }
  preview.last = now;
  while (preview.hits.length && preview.hits[0].time < now - FLASH_SECONDS) preview.hits.shift();
  return { now, tubules: [...preview.sim.tubules.values()], hits: preview.hits, preview: true };
}

/** Tubules at the audible moment, interpolated from the engine's trace. */
function tubulesAt(trace, now) {
  let i = trace.length - 1;
  while (i > 0 && trace[i].time > now) i--;
  const a = trace[i];
  const b = trace[i + 1];
  if (!b || now <= a.time || b.time === a.time) return a.tubules;
  const f = (now - a.time) / (b.time - a.time);
  const next = new Map(b.tubules.map((t) => [t.id, t]));
  return a.tubules.map((t) => {
    const to = next.get(t.id);
    return to ? { ...t, length: t.length + (to.length - t.length) * f } : t;
  });
}

// ---- drawing ---------------------------------------------------------------------

function draw(canvas, { now, tubules, hits, preview }, { config, selected, M }) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const C = W / 2;
  const R = C - MARGIN;
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--fg').trim() || '#d4d9e6';
  const muted = css.getPropertyValue('--muted').trim() || '#6d7490';
  const panel = css.getPropertyValue('--panel').trim() || '#13141f';
  const tints = themeTints(css);
  const h = tints.hue;
  const n = config.rings.length;
  const S = config.sections;
  const arc = (2 * Math.PI) / S;

  g.clearRect(0, 0, W, W);
  g.fillStyle = panel;
  g.beginPath();
  g.arc(C, C, R, 0, Math.PI * 2);
  g.fill();

  // Each zone glows while it's sounding, and flashes when a tip grows into it.
  const glow = Array.from({ length: n }, () => new Array(S).fill(0));
  const light = (ring, section, v) => {
    if (ring >= 0 && ring < n && section < S) glow[ring][section] = Math.max(glow[ring][section], v);
  };
  for (const hit of hits) {
    const age = now - hit.time;
    if (age >= 0 && age < FLASH_SECONDS) light(hit.ring, hit.section, 1 - age / FLASH_SECONDS);
  }
  if (config.hold) {
    for (const t of tubules) {
      const ring = ringAt(t.length, n);
      const section = sectionAt(t.angle, S);
      if (config.sound === 'whole') for (let r = 0; r <= ring; r++) light(r, section, 0.45);
      else if (t.growing) light(ring, section, 0.45);
    }
  }

  // Zones, as slices of each ring; neighbours alternate shades so each reads as its own key.
  for (let r = 0; r < n; r++) {
    const inner = ringStart(r, n) * R;
    const outer = ringStart(r + 1, n) * R;
    for (let s = 0; s < S; s++) {
      const a0 = sectionStart(s, S);
      const v = glow[r][s];
      g.fillStyle = `hsl(${h} ${mixTint(tints.line, tints.hot, v)} / ${0.06 + ((r + s) % 2) * 0.05 + v * 0.3})`;
      g.beginPath();
      g.arc(C, C, outer, a0, a0 + arc);
      g.arc(C, C, inner, a0 + arc, a0, true);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = `hsl(${h} ${tints.line} / 0.5)`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(C, C, outer, 0, Math.PI * 2);
    g.stroke();
  }
  if (S > 1) {
    g.strokeStyle = `hsl(${h} ${tints.line} / 0.5)`;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let s = 0; s < S; s++) {
      const a = sectionStart(s, S);
      g.moveTo(C + Math.cos(a) * CORE * R, C + Math.sin(a) * CORE * R);
      g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R);
    }
    g.stroke();
  }
  if (selected) {
    const a0 = sectionStart(selected.section, S);
    g.strokeStyle = `hsl(${h} ${tints.bright})`;
    g.lineWidth = 3;
    g.beginPath();
    if (S === 1) {
      for (const edge of [ringStart(selected.ring, n), ringStart(selected.ring + 1, n)]) {
        g.moveTo(C + edge * R, C);
        g.arc(C, C, edge * R, 0, Math.PI * 2);
      }
    } else {
      g.arc(C, C, ringStart(selected.ring + 1, n) * R, a0, a0 + arc);
      g.arc(C, C, ringStart(selected.ring, n) * R, a0 + arc, a0, true);
      g.closePath();
    }
    g.stroke();
  }

  // The tubules: bright with a capped tip while they grow, dim and frayed
  // (their protofilaments peeling back) while they collapse.
  g.lineCap = 'round';
  g.globalAlpha = preview ? 0.75 : 1;
  for (const t of tubules) {
    const [dx, dy] = [Math.cos(t.angle), Math.sin(t.angle)];
    const tip = t.length * R;
    const tx = C + dx * tip;
    const ty = C + dy * tip;
    g.strokeStyle = `hsl(${h} ${t.growing ? tints.bright : tints.line})`;
    g.lineWidth = t.growing ? 4 : 3;
    g.beginPath();
    g.moveTo(C, C);
    g.lineTo(tx, ty);
    g.stroke();
    if (t.growing) {
      g.fillStyle = `hsl(${h} ${tints.hot})`;
      g.shadowColor = `hsl(${h} ${tints.bright})`;
      g.shadowBlur = 14;
      g.beginPath();
      g.arc(tx, ty, 6, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    } else if (tip > CORE * R) {
      const back = 14;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(tx, ty);
        g.quadraticCurveTo(tx + dx * 4 - dy * side * 10, ty + dy * 4 + dx * side * 10,
          tx - dx * back - dy * side * 12, ty - dy * back + dx * side * 12);
        g.stroke();
      }
    }
  }
  g.globalAlpha = 1;

  // The centrosome everything grows from.
  g.fillStyle = `hsl(${h} ${tints.line})`;
  g.strokeStyle = `hsl(${h} ${tints.bright})`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(C, C, CORE * R, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Zone names on little tags in each zone's middle, so tubules passing
  // under them don't hide them. Smaller when there are many.
  const size = S * n > 12 ? W / 44 : W / 36;
  g.font = `${size}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let r = 0; r < n; r++) {
    const mid = ((ringStart(r, n) + ringStart(r + 1, n)) / 2) * R;
    for (let s = 0; s < S; s++) {
      // One whole ring: label along the top, like a ruler.
      const a = S === 1 ? -Math.PI / 2 : sectionStart(s, S) + arc / 2;
      const x = C + Math.cos(a) * mid;
      const y = C + Math.sin(a) * mid;
      const text = M?.keys?.[config.rings[r][s]] ?? noteName(config.rings[r][s]);
      const w = g.measureText(text).width + size * 0.6;
      g.fillStyle = panel;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.roundRect(x - w / 2, y - size * 0.65, w, size * 1.3, size * 0.65);
      g.fill();
      g.globalAlpha = 1;
      const chosen = selected?.ring === r && selected?.section === s;
      g.fillStyle = glow[r][s] > 0.2 || chosen ? fg : muted;
      g.fillText(text, x, y);
    }
  }
}
