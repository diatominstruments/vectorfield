import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib.js';
import { COVER_SIZE, MAX_COVER_BYTES, embedCode, songPath } from '../../shared/embed.js';

/** Copies text, and says so on the button for a moment. */
function useCopy() {
  const [copied, setCopied] = useState(null);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (what, text) => navigator.clipboard?.writeText(text).then(() => {
    setCopied(what);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  });
  return [copied, copy];
}

/**
 * Sharing a published song: its link, straight to Facebook, Reddit or X
 * (each shows the song's cover and title, from the tags server/share.js
 * writes into the page), the phone's own share sheet where there is one,
 * and an iframe of the embed player to paste into any site that takes HTML.
 */
export function ShareMenu({ song }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy();
  const ref = useRef();

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      removeEventListener('keydown', esc);
    };
  }, [open]);

  const url = location.origin + songPath(song.id);
  const text = `${song.title} by ${song.owner.username}`;
  const q = (params) => new URLSearchParams(params).toString();
  const targets = [
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?${q({ u: url })}`],
    ['Reddit', `https://www.reddit.com/submit?${q({ url, title: text })}`],
    ['X', `https://x.com/intent/tweet?${q({ url, text })}`],
  ];
  const code = embedCode({ origin: location.origin, id: song.id, title: song.title, owner: song.owner.username });
  const nativeShare = typeof navigator.share === 'function'
    && (() => navigator.share({ title: text, url }).catch(() => {}));

  return html`
    <div class="share-menu" ref=${ref}>
      <button class=${open ? 'active' : ''} aria-expanded=${open} onClick=${() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3M3 8v5.5h10V8" /></svg>
        Share
      </button>
      ${open && html`
        <div class="share-panel panel" role="dialog" aria-label="Share this song">
          <label class="share-field">
            <span>Link</span>
            <span class="share-copy">
              <input readonly value=${url} onFocus=${(e) => e.target.select()} />
              <button onClick=${() => copy('link', url)}>${copied === 'link' ? 'Copied' : 'Copy'}</button>
            </span>
          </label>
          <div class="share-targets">
            ${targets.map(([name, href]) => html`
              <a key=${name} class="button" href=${href} target="_blank" rel="noopener noreferrer">${name}</a>`)}
            ${nativeShare && html`<button onClick=${nativeShare}>More…</button>`}
          </div>
          <label class="share-field">
            <span>Embed</span>
            <span class="share-copy">
              <textarea readonly rows="3" value=${code} onFocus=${(e) => e.target.select()}></textarea>
              <button onClick=${() => copy('embed', code)}>${copied === 'embed' ? 'Copied' : 'Copy'}</button>
            </span>
            <small class="muted">A small player with the visuals, for any site that takes HTML.</small>
          </label>
        </div>`}
    </div>
  `;
}

/**
 * The frame on the canvas, cropped to a song picture's shape, as a JPEG
 * data URL small enough for the server to take. A busier frame compresses
 * worse, so quality steps down until it fits.
 */
export function frameAsCover(canvas) {
  const { width: W, height: H } = COVER_SIZE;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const scale = Math.max(W / canvas.width, H / canvas.height);
  const sw = W / scale;
  const sh = H / scale;
  g.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, W, H);
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const url = out.toDataURL('image/jpeg', quality);
    if ((url.length - url.indexOf(',') - 1) * 0.75 <= MAX_COVER_BYTES) return url;
  }
  throw new Error('That frame is too busy to save as a cover. Try another moment.');
}
