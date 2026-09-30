import { useRef, useState } from 'preact/hooks';
import { registry } from 'gloaming-instruments';
import { html, hue, useEngineEvent } from '../lib.js';
import { LIMITS, automatableParams, automationValue, newId } from '../../shared/song.js';
import { moduleInfo, formatValue, toSlider, toValue } from './params.js';

const LINE_REACH = 10;   // px from the line (or a point) that still counts as on it

// Four significant figures is finer than anyone can hear or drag, and
// keeps saved songs small.
const round = (v) => Number(v.toPrecision(4));

/**
 * The params of a track's instrument a lane can sweep, labelled to read on
 * their own ('Filter cutoff', not 'Cutoff'), primary params first.
 */
function laneParams(track) {
  const M = registry.get(track.instrument.id);
  const info = moduleInfo(M);
  const groupOf = new Map(info.groups.flatMap((g) => g.params.map((name) => [name, g.label])));
  return automatableParams(M)
    .map(([name]) => {
      const spec = info.params[name];
      const group = groupOf.get(name);
      const label = !group || info.groups.length === 1 || spec.label.toLowerCase().startsWith(group.toLowerCase())
        ? spec.label : `${group} ${spec.label.toLowerCase()}`;
      return { name, spec, label };
    })
    .sort((a, b) => Boolean(b.spec.primary) - Boolean(a.spec.primary));
}

/**
 * The selected track's automation lanes in the pattern, under its
 * sequencer. Each lane sweeps one of the track's instrument params through
 * the pattern along a line through its points; see song.js.
 */
export function AutomationLanes({ store, engine, pattern, track }) {
  const lanes = pattern.automation.filter((l) => l.track === track.id);
  const params = laneParams(track);
  const used = new Set(lanes.map((l) => l.param));
  // A new lane starts on the track's first free param.
  const candidate = params.find((p) => !used.has(p.name));
  const full = lanes.length >= LIMITS.automationLanes;

  const editLanes = (fn) => store.edit((d) => { fn(d.patterns.find((p) => p.id === pattern.id).automation); });
  const addLane = () => editLanes((list) => { list.push({ id: newId(), track: track.id, param: candidate.name, points: [] }); });

  return html`
    <section class="automation">
      <header>
        <h3>Automation</h3>
        <button class="ghost" disabled=${!candidate || full} onClick=${addLane}
          title=${full ? `Up to ${LIMITS.automationLanes} lanes per track in a pattern` : undefined}>
          + Automation
        </button>
      </header>
      ${lanes.map((lane) => html`
        <${AutomationLane} key=${lane.id} store=${store} engine=${engine} pattern=${pattern} lane=${lane}
          track=${track} params=${params} used=${used} editLanes=${editLanes} />`)}
    </section>
  `;
}

/**
 * One lane: a param menu, and a line across the pattern.
 *
 *   click the line      add a point there, and drag it on from there
 *   drag a point        move it: across the steps between its neighbours, and up and down
 *   double-click point  remove it
 *
 * A drag is drawn from local state and saved once, on release.
 */
function AutomationLane({ store, engine, pattern, lane, track, params, used, editLanes }) {
  const { doc } = store;
  const plotRef = useRef();
  const drag = useRef(null);
  const [draft, setDraft] = useState(null);   // points while dragging
  const [hover, setHover] = useState(null);   // { near: 'line' | point index }
  const position = useEngineEvent(engine, 'position', engine.position);

  const trackIndex = doc.tracks.indexOf(track);
  const param = params.find((p) => p.name === lane.param);
  if (!param) return null;   // stranded until the next edit prunes it
  const { spec } = param;
  const base = track.instrument.params[lane.param];
  const points = draft ?? lane.points;
  const { length } = pattern;

  const editLane = (fn) => editLanes((list) => fn(list.find((l) => l.id === lane.id), list));

  // Changing the param keeps the line's shape, rescaled to the new range.
  const setParam = (name) => {
    const next = params.find((p) => p.name === name).spec;
    editLane((l) => {
      l.points = l.points.map((pt) => ({ step: pt.step, value: round(toValue(next, toSlider(spec, pt.value))) }));
      l.param = name;
    });
  };
  const remove = () => editLanes((list) => list.splice(list.findIndex((l) => l.id === lane.id), 1));

  // ---- geometry ---------------------------------------------------------------

  const yOf = (value) => 1 - toSlider(spec, value);   // 0 at the top
  const lineValue = (step) => automationValue(points, step) ?? base;

  const locate = (e) => {
    const r = plotRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const nearestPoint = ({ x, y, w, h }) => {
    let best = -1;
    let bestDist = LINE_REACH;
    points.forEach((pt, i) => {
      const d = Math.hypot((pt.step / length) * w - x, yOf(pt.value) * h - y);
      if (d <= bestDist) [best, bestDist] = [i, d];
    });
    return best;
  };
  const onLine = ({ x, y, w, h }) => Math.abs(yOf(lineValue((x / w) * length)) * h - y) <= LINE_REACH;
  const stepAt = ({ x, w }) => Math.max(0, Math.min(length, Math.round((x / w) * length)));
  const valueAt = ({ y, h }) => round(toValue(spec, Math.max(0, Math.min(1, 1 - y / h))));

  // ---- pointer ----------------------------------------------------------------

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const at = locate(e);
    let index = nearestPoint(at);
    let next = points;
    if (index < 0) {
      if (!onLine(at) || points.length >= LIMITS.automationPoints) return;
      const step = stepAt(at);
      index = points.findIndex((pt) => pt.step >= step);
      if (points[index]?.step !== step) {
        // A new point lands on the line where it was clicked.
        if (index < 0) index = points.length;
        next = [...points.slice(0, index), { step, value: round(lineValue(step)) }, ...points.slice(index)];
      }
    }
    drag.current = { index, points: next, changed: next !== points };
    setDraft(next);
    plotRef.current.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const at = locate(e);
    const d = drag.current;
    if (!d) {
      const index = nearestPoint(at);
      const near = index >= 0 ? index : onLine(at) ? 'line' : null;
      if (near !== hover?.near) setHover(near === null ? null : { near });
      return;
    }
    const list = d.points;
    const lo = d.index > 0 ? list[d.index - 1].step + 1 : 0;
    const hi = d.index < list.length - 1 ? list[d.index + 1].step - 1 : length;
    const moved = { step: Math.max(lo, Math.min(hi, stepAt(at))), value: valueAt(at) };
    const old = list[d.index];
    if (moved.step === old.step && moved.value === old.value) return;
    d.changed = true;
    d.points = list.map((pt, i) => (i === d.index ? moved : pt));
    setDraft(d.points);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.changed) editLane((l) => { l.points = d.points; });
    setDraft(null);
  };

  const cancel = () => {
    drag.current = null;
    setDraft(null);
  };

  const onDoubleClick = (e) => {
    const index = nearestPoint(locate(e));
    if (index >= 0) editLane((l) => { l.points = l.points.filter((_, i) => i !== index); });
  };

  // ---- drawing ------------------------------------------------------------------

  // The line runs edge to edge, flat before the first point and after the last.
  const line = points.length
    ? [{ step: 0, value: points[0].value }, ...points, { step: length, value: points.at(-1).value }]
    : [{ step: 0, value: base }, { step: length, value: base }];
  const active = drag.current ? drag.current.index : typeof hover?.near === 'number' ? hover.near : null;
  const describePoint = (pt) => `${pt.step === length ? 'End' : `Step ${pt.step + 1}`} · ${formatValue(spec, pt.value)}`;
  const readout = active !== null && points[active]
    ? describePoint(points[active])
    : points.length ? '' : `${formatValue(spec, base)} — click the line to add a point`;
  const playStep = position?.patternId === pattern.id ? position.step : -1;

  return html`
    <div class="automation-lane" style=${`--hue: ${hue(trackIndex)}; --steps: ${length}`}>
      <div class="lane-head">
        <select value=${lane.param} onChange=${(e) => setParam(e.target.value)} aria-label=${`Automated ${track.name} param`}>
          ${params.map((p) => html`
            <option value=${p.name} disabled=${used.has(p.name) && p.name !== lane.param}>${p.label}</option>`)}
        </select>
        <span class="muted readout">${readout}</span>
        <button class="ghost danger" onClick=${remove} aria-label="Remove automation lane">✕</button>
      </div>
      <div class="lane-wrap">
        <div class="lane-scale">
          <span>${formatValue(spec, spec.max)}</span>
          <span>${formatValue(spec, spec.min)}</span>
        </div>
        <div class="lane-area">
          <div class="lane-steps">
            ${Array.from({ length }, (_, s) => html`
              <span key=${s} class=${`${s % 4 === 0 ? 'beat' : ''} ${s === playStep ? 'now' : ''}`}></span>`)}
          </div>
          <div ref=${plotRef}
            class=${`lane-plot ${hover?.near === 'line' ? 'near-line' : ''} ${hover && typeof hover.near === 'number' ? 'near-point' : ''} ${draft ? 'dragging' : ''}`}
            onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}
            onPointerCancel=${cancel} onPointerLeave=${() => !drag.current && setHover(null)} onDblClick=${onDoubleClick}>
            <svg viewBox=${`0 0 ${length} 1`} preserveAspectRatio="none" aria-hidden="true">
              <polyline class=${points.length ? '' : 'idle'} points=${line.map((pt) => `${pt.step},${yOf(pt.value)}`).join(' ')} />
            </svg>
            ${points.map((pt, i) => html`
              <span key=${i} class=${`point ${i === active ? 'active' : ''}`}
                style=${`left: ${(pt.step / length) * 100}%; top: ${yOf(pt.value) * 100}%`}
                title=${describePoint(pt)}></span>`)}
          </div>
        </div>
      </div>
    </div>
  `;
}
