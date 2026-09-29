import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Link, hue, useEngineEvent, useTitle } from '../lib.js';
import { api } from '../api.js';
import { Engine } from '../engine.js';
import { normalizeSong, blockTimes, playOrder, sections as songSections } from '../../shared/song.js';
import { VisualCanvas, songTimeline } from './visual-canvas.js';
import { TagChips } from './genre-picker.js';
import { fmtTime } from './song-view.js';
import { useSpaceToPlay } from './editor.js';

/**
 * The read-only song page: the song plays live from its document, with
 * its visuals on the canvas, exactly as in the studio. Nothing is rendered
 * ahead of time; every play is a performance.
 */
export function SongPage({ id, user }) {
  const [song, setSong] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSong(null);
    setError(null);
    api.get(`/public/songs/${id}`).then(({ song }) => setSong(song), (e) => setError(e));
  }, [id]);

  useTitle(song ? `${song.title} by ${song.owner.username}` : null);

  if (error) {
    return html`
      <main class="song-page">
        <p class="error">${error.status === 404 ? "This song isn't here — it may be unpublished, or the link is wrong." : error.message}</p>
        <${Link} href="/">Back to the feed</${Link}>
      </main>`;
  }
  if (!song) return html`<div class="loading">Loading song…</div>`;
  return html`<${Player} key=${song.id} song=${song} user=${user} />`;
}

function Player({ song, user }) {
  const engine = useMemo(() => new Engine(), []);
  // Normalizing fills in params the library has added since the song was
  // saved, so it plays with today's instruments.
  const doc = useMemo(() => normalizeSong(song.doc), [song]);
  const timeline = useMemo(() => songTimeline(doc), [doc]);
  const times = useMemo(() => blockTimes(doc), [doc]);
  const sections = useMemo(() => songSections(doc), [doc]);
  const order = playOrder(doc);
  const total = times.at(-1)?.end ?? 0;
  const holdTime = useRef(0.001);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    engine.sync(doc);
    return () => engine.dispose();
  }, [engine, doc]);

  const playing = useEngineEvent(engine, 'state', false);
  const position = useEngineEvent(engine, 'position', null);
  const playingIndex = playing && position ? position.index : -1;
  const section = sections.find((s) => playingIndex >= s.from && playingIndex < s.to);

  const play = (index = 0) => {
    setPlayed(true);
    engine.play({ index });
  };
  const toggle = () => (playing ? engine.stop() : play());
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useSpaceToPlay(toggleRef);

  const canPlay = doc.arrangement.length > 0;
  const patternIndex = new Map(doc.patterns.map((p, i) => [p.id, i]));

  return html`
    <main class="song-page">
      <div class="stage">
        <${VisualCanvas} engine=${engine} timeline=${timeline} look=${doc.look} holdTime=${holdTime} class="stage-canvas"
          onClick=${canPlay ? toggle : undefined} />
        ${section?.name && html`<span key=${section.from} class="stage-section" aria-live="polite">${section.name}</span>`}
        ${!playing && html`
          <button class="big-play" onClick=${() => play()} disabled=${!canPlay} aria-label="Play">
            ${canPlay ? html`<span aria-hidden="true">▶</span> ${played ? 'Play again' : 'Play'}` : 'Nothing to play yet'}
          </button>`}
      </div>

      ${canPlay && html`
        <div class="transport-row">
          <button class=${`play ${playing ? 'on' : ''}`} onClick=${toggle} title="Play / stop (space)">${playing ? '■ Stop' : '▶ Play'}</button>
          <${Timeline} engine=${engine} doc=${doc} times=${times} total=${total} order=${order} sections=${sections}
            playingIndex=${playingIndex} patternIndex=${patternIndex} onSeek=${play} />
        </div>`}

      <header class="song-head">
        <div>
          <h1>${song.title}</h1>
          <p class="byline">
            <${Link} href=${`/u/${song.owner.username}`} class="owner">
              ${song.owner.avatarUrl && html`<img src=${song.owner.avatarUrl} alt="" referrerpolicy="no-referrer" />`}
              ${song.owner.username}
            </${Link}>
            ${song.publishedAt
              ? html`<span class="muted"> · ${new Date(song.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>`
              : html`<span class="muted"> · not published</span>`}
            <span class="muted"> · ${doc.bpm} BPM · ${LENGTH_LABEL[order] ?? fmtTime(total)}</span>
          </p>
          <${TagChips} tags=${song.tags} />
          ${song.description && html`<p class="description">${song.description}</p>`}
        </div>
        ${song.mine && html`
          <div class="owner-tools">
            ${!song.publishedAt && html`<p class="notice">Only you can see this page until you publish.</p>`}
            <${Link} href=${`/songs/${song.id}/publish`} class="button">Edit in studio</${Link}>
          </div>`}
      </header>
      ${!user && html`<p class="muted cta">Made with Vectorfield. <${Link} href="/sign-in?next=/studio">Sign in</${Link}> to make your own.</p>`}
    </main>
  `;
}

/** How long a song is, for one that doesn't just play straight through. */
const LENGTH_LABEL = { loops: 'loops forever', varies: 'different every play' };

/**
 * The song's blocks as a bar, each as wide as it is long, in its pattern's
 * colour, with a playhead moving through them and section names above.
 * Click a block to play from there. Redraws itself on its own frame loop
 * so the rest of the page doesn't re-render sixty times a second.
 *
 * A song that loops or picks its way jumps around the bar as it plays,
 * so in place of a total the time shows ∞ or ~.
 */
function Timeline({ engine, doc, times, total, order, sections, playingIndex, patternIndex, onSeek }) {
  const [time, setTime] = useState(0);

  useEffect(() => {
    let raf;
    const frame = () => {
      const t = engine.songTime;
      setTime(t ?? 0);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const named = sections.some((s) => s.name);
  const span = (s) => times[s.to - 1].end - times[s.from].start;

  return html`
    <div class="song-timeline">
      <div class="timeline-bars">
      ${named && html`
        <div class="timeline-sections" aria-hidden="true">
          ${sections.map((s) => html`
            <span key=${s.from} class=${playingIndex >= s.from && playingIndex < s.to ? 'now' : ''}
              style=${`flex-grow: ${span(s)}`} title=${s.name ?? ''}>${s.name}</span>`)}
        </div>`}
      <div class="segments" role="list">
        ${doc.arrangement.map((block, i) => {
          const pattern = doc.patterns.find((p) => p.id === block.pattern);
          return html`
            <button key=${block.id} role="listitem" class=${`segment ${i === playingIndex ? 'now' : ''}`}
              style=${`--hue: ${hue(patternIndex.get(block.pattern))}; flex-grow: ${times[i].end - times[i].start}`}
              title=${`${pattern.name} · ${fmtTime(times[i].start)}`} onClick=${() => onSeek(i)}></button>`;
        })}
        ${engine.playing && html`<span class="playhead" style=${`left: ${(time / total) * 100}%`}></span>`}
      </div>
      </div>
      <span class="time" title=${LENGTH_LABEL[order] ?? ''}>
        ${fmtTime(engine.playing ? time : 0)} / ${order === 'loops' ? '∞' : order === 'varies' ? `~${fmtTime(total)}` : fmtTime(total)}
      </span>
    </div>
  `;
}
