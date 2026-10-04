import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib.js';
import { api } from '../api.js';
import { coverPath, songPath } from '../../shared/embed.js';
import { VisualCanvas } from './visual-canvas.js';
import { Timeline, useFullscreen, useSongPlayback } from './player.js';

/**
 * /embed/:id: the song in a frame on someone else's site. Only the stage —
 * the song's picture until it's played, then the visuals filling the
 * frame, with the title over them and a play bar beneath —
 * and every link opens the song's own page in a new tab, out of the frame.
 * No session, no site header: it's the same for everyone who sees it.
 */
export function EmbedPage({ id }) {
  const [song, setSong] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Visuals are drawn on black whatever the theme, so the chrome over them stays dark.
    document.documentElement.dataset.theme = 'dark';
    api.get(`/public/songs/${id}`).then(({ song }) => setSong(song), (e) => setError(e));
  }, [id]);

  if (error) {
    return html`
      <main class="embed embed-message">
        <p>${error.status === 404 ? "This song isn't available." : error.message}</p>
        <a href="/" target="_blank" rel="noopener">Vectorfield</a>
      </main>`;
  }
  if (!song) return html`<main class="embed embed-message"><p class="muted">Loading…</p></main>`;
  return html`<${EmbedPlayer} song=${song} />`;
}

function EmbedPlayer({ song }) {
  const {
    engine, doc, timeline, times, sections, order, total, holdTime, played, playing, playingIndex, section,
    play, toggle, canPlay, patternIndex,
  } = useSongPlayback(song);
  const stageRef = useRef();
  const { full, idle, toggleFull, onPointerMove } = useFullscreen(stageRef);
  const href = location.origin + songPath(song.id);

  return html`
    <main ref=${stageRef} class=${`embed ${playing ? 'playing' : ''} ${idle && playing ? 'idle' : ''}`}
      onPointerMove=${onPointerMove}>
      <${VisualCanvas} engine=${engine} timeline=${timeline} look=${doc.look} holdTime=${holdTime} class="embed-canvas"
        onClick=${canPlay ? toggle : undefined} />
      ${!played && html`<img class="embed-poster" src=${coverPath(song.id, song.coverAt)} alt="" />`}

      <header class="embed-head">
        <a href=${href} target="_blank" rel="noopener" title="Open on Vectorfield">
          <strong>${song.title}</strong>
          <span>${song.owner.username}</span>
        </a>
      </header>
      ${section?.name && html`<span key=${section.from} class="stage-section embed-section" aria-live="polite">${section.name}</span>`}

      ${!playing && html`
        <button class="big-play" onClick=${() => play()} disabled=${!canPlay} aria-label="Play">
          ${canPlay ? html`<span aria-hidden="true">▶</span> ${played ? 'Play again' : 'Play'}` : 'Nothing to play yet'}
        </button>`}

      ${canPlay && html`
        <footer class="embed-bar">
          <button class=${`embed-play ${playing ? 'on' : ''}`} onClick=${toggle} aria-label=${playing ? 'Stop' : 'Play'}
            title="Play / stop (space)">${playing ? '■' : '▶'}</button>
          <${Timeline} engine=${engine} doc=${doc} times=${times} total=${total} order=${order} sections=${sections}
            playingIndex=${playingIndex} patternIndex=${patternIndex} onSeek=${play} />
          <button class="embed-icon" onClick=${toggleFull} onMouseDown=${(e) => e.preventDefault()} aria-pressed=${full}
            aria-label=${full ? 'Exit full screen' : 'Full screen'} title=${full ? 'Exit full screen (F)' : 'Full screen (F)'}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d=${full ? 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4' : 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4'} />
            </svg>
          </button>
          <a class="embed-brand" href=${href} target="_blank" rel="noopener">Vector<span>field</span></a>
        </footer>`}
    </main>
  `;
}
