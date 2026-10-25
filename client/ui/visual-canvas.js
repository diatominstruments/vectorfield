import { useEffect, useRef } from 'preact/hooks';
import { GloamingKit } from 'gloaming-kit';
import { html } from '../lib.js';
import { THREE, has3D } from '../three.js';
import { blockTimes, stylesInEffect, transitionsInEffect, visualsInEffect } from '../../shared/song.js';

// A visual's optional entry fields, passed to the kit as they are.
const ENTRY_FIELDS = ['place', 'clip', 'blend', 'opacity', 'style', 'transition', 'fade'];

/**
 * The kit's timeline for a song: one window per block, showing the visuals
 * in effect there. A block without visuals repeats the previous block's
 * entries, and since the kit keys instances by their settings, those carry
 * on across the boundary without restarting. A block's style and
 * transition changes carry on the same way, setting by setting.
 */
export function songTimeline(doc) {
  const times = blockTimes(doc);
  const inEffect = visualsInEffect(doc);
  const styles = stylesInEffect(doc);
  const transitions = transitionsInEffect(doc);
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
 * `timeline`, `look` and `analysis` are pushed only when they really
 * change: setStyle snaps the live style, which would cut short the kit's
 * own easing between blocks if it ran on every render.
 */
export function VisualCanvas({ engine, timeline, look, analysis = null, holdTime, class: className = 'preview', onClick }) {
  const canvasRef = useRef();
  const kitRef = useRef(null);
  const applied = useRef({ timeline: null, look: null, analysis: null });
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;

  useEffect(() => {
    const ctx = engine.ensureContext();
    // No analysis of its own: a live node has nothing to decode.
    const kit = new GloamingKit({ canvas: canvasRef.current, audioContext: ctx, monitor: false, three: THREE, enable3D: has3D, analyze: false });
    kitRef.current = kit;
    applied.current = { timeline: null, look: null, analysis: null };
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
  });

  return html`<canvas ref=${canvasRef} class=${className} onClick=${onClick}></canvas>`;
}
