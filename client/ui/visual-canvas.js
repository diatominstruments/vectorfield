import { useEffect, useRef } from 'preact/hooks';
import { GloamingKit } from 'gloaming-kit';
import { html } from '../lib.js';
import { blockTimes, visualsInEffect } from '../../shared/song.js';

/**
 * The kit's timeline for a song: one window per block, showing the visuals
 * in effect there. A block without visuals repeats the previous block's
 * entries, and since the kit keys instances by their settings, those carry
 * on across the boundary without restarting.
 */
export function songTimeline(doc) {
  const times = blockTimes(doc);
  const inEffect = visualsInEffect(doc);
  return doc.arrangement.map((block, i) => ({
    from: times[i].start,
    to: times[i].end,
    visualizations: inEffect[i].visuals.map((v) => ({ id: v.viz, bind: v.bind, options: v.options })),
    style: block.style,
  }));
}

/**
 * A canvas running the song's visuals off the engine's output. The kit
 * analyzes what the engine plays without playing it a second time
 * (monitor: false) and follows the engine's song position; while stopped it
 * holds at `holdTime.current`, so a still frame of that moment shows.
 *
 * `timeline` and `look` are pushed only when they really change: setStyle
 * snaps the live style, which would cut short the kit's own easing between
 * blocks if it ran on every render.
 */
export function VisualCanvas({ engine, timeline, look, holdTime, class: className = 'preview', onClick }) {
  const canvasRef = useRef();
  const kitRef = useRef(null);
  const applied = useRef({ timeline: null, look: null });

  useEffect(() => {
    const ctx = engine.ensureContext();
    const kit = new GloamingKit({ canvas: canvasRef.current, audioContext: ctx, monitor: false });
    kit.load({
      node: engine.output,
      clock: {
        get currentTime() { return engine.songTime ?? holdTime.current; },
        get playing() { return engine.playing; },
      },
    });
    kit.startLoop();
    kitRef.current = kit;
    applied.current = { timeline: null, look: null };
    return () => kit.dispose();
  }, [engine]);

  useEffect(() => {
    const kit = kitRef.current;
    if (!kit) return;
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
