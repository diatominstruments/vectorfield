import { useEffect, useRef } from 'preact/hooks';
import { FINISH_DEFAULTS, FINISH_PRESETS, GloamingKit } from 'gloaming-kit';
import { html } from '../lib.js';
import { THREE, has3D } from '../three.js';
import { blockTimes, finishesInEffect, stylesInEffect, transitionsInEffect, visualsInEffect } from '../../shared/song.js';

// A visual's optional entry fields, passed to the kit as they are.
const ENTRY_FIELDS = ['place', 'clip', 'blend', 'opacity', 'style', 'transition', 'fade', 'trail'];

/**
 * A finish (see shared/visuals.js) over `settings`, as the kit's plain
 * settings: one that names a preset starts again from it, and 'off' leaves
 * the frame alone (the kit's 'none'); then its own changes apply.
 */
export function applyFinish(settings, finish) {
  if (!finish) return settings;
  const { preset, ...own } = finish;
  const base = preset ? { ...FINISH_DEFAULTS, ...FINISH_PRESETS[preset === 'off' ? 'none' : preset] } : settings;
  return { ...base, ...own };
}

/** The song's finish as the kit's settings; 'off' leaves the frame alone. */
export const songFinish = (finish) => applyFinish(FINISH_DEFAULTS, finish);

/**
 * The kit's timeline for a song: one window per block, showing the visuals
 * in effect there. A block without visuals repeats the previous block's
 * entries, and since the kit keys instances by their settings, those carry
 * on across the boundary without restarting. A block's style, transition
 * and finish changes carry on the same way, setting by setting. A block's
 * finish goes to the kit whole, over the song's, so the kit needn't know
 * how presets start again.
 */
export function songTimeline(doc) {
  const times = blockTimes(doc);
  const inEffect = visualsInEffect(doc);
  const styles = stylesInEffect(doc);
  const transitions = transitionsInEffect(doc);
  const finishes = finishesInEffect(doc);
  const base = songFinish(doc.finish);
  return doc.arrangement.map((block, i) => {
    const { transition, fade } = transitions[i];
    return {
      from: times[i].start,
      to: times[i].end,
      visualizations: inEffect[i].visuals.map((v) => {
        const entry = { id: v.viz, bind: v.bind, options: v.options };
        for (const key of ENTRY_FIELDS) if (v[key] !== undefined) entry[key] = v[key];
        return entry;
      }),
      style: styles[i],
      ...(transition && { transition }),
      ...(fade !== null && { fade }),
      ...(finishes[i] && { finish: applyFinish(base, finishes[i]) }),
    };
  });
}

/**
 * A canvas running the song's visuals off the engine's output. The kit
 * analyzes what the engine plays without playing it a second time
 * (monitor: false) and follows the engine's song position; while stopped it
 * holds at `holdTime.current`, so a still frame of that moment shows.
 *
 * `analysis` is the song's timing (see shared/timing.js), which the kit
 * can't work out from a live node itself; without it the kit estimates the
 * beat as it plays.
 *
 * `finish` is the song's (shared/visuals.js); 'off' draws straight to the
 * screen, without the kit's WebGL2 pass, unless a block has a finish.
 *
 * `timeline`, `look`, `finish` and `analysis` are pushed only when they really
 * change: setStyle snaps the live style, which would cut short the kit's
 * own easing between blocks if it ran on every render.
 */
export function VisualCanvas({ engine, timeline, look, finish, analysis = null, holdTime, class: className = 'preview', onClick }) {
  const canvasRef = useRef();
  const kitRef = useRef(null);
  const applied = useRef({ timeline: null, look: null, finish: null, analysis: null });
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;

  useEffect(() => {
    const ctx = engine.ensureContext();
    // No analysis of its own: a live node has nothing to decode.
    const kit = new GloamingKit({ canvas: canvasRef.current, audioContext: ctx, monitor: false, three: THREE, enable3D: has3D, analyze: false });
    kitRef.current = kit;
    applied.current = { timeline: null, look: null, finish: null, analysis: null };
    kit.load({
      node: engine.output,
      clock: {
        get currentTime() { return engine.songTime ?? holdTime.current; },
        get playing() { return engine.playing; },
      },
    }).then(() => {
      // Loading clears the analysis, so it goes in once loaded.
      if (kitRef.current !== kit) return;
      kit.setAnalysis(analysisRef.current);
      applied.current.analysis = JSON.stringify(analysisRef.current);
    });
    kit.startLoop();
    return () => {
      kitRef.current = null;
      kit.dispose();
    };
  }, [engine]);

  useEffect(() => {
    const kit = kitRef.current;
    if (!kit) return;
    const a = JSON.stringify(analysis);
    if (applied.current.analysis !== null && a !== applied.current.analysis) {
      kit.setAnalysis(analysis);
      applied.current.analysis = a;
    }
    const t = JSON.stringify(timeline);
    if (t !== applied.current.timeline) {
      kit.setTimeline(JSON.parse(t));
      applied.current.timeline = t;
    }
    const l = JSON.stringify(look);
    if (l !== applied.current.look) {
      kit.setStyle(look);
      applied.current.look = l;
    }
    const f = JSON.stringify(finish);
    if (finish && f !== applied.current.finish) {
      kit.setFinish(finish.preset === 'off' ? false : songFinish(finish));
      applied.current.finish = f;
    }
  });

  return html`<canvas ref=${canvasRef} class=${className} onClick=${onClick}></canvas>`;
}
