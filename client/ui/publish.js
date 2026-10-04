import { useRef, useState } from 'preact/hooks';
import { html, Link, useEngineEvent } from '../lib.js';
import { api } from '../api.js';
import { TAG_LIMITS, tagsForBpm } from '../../shared/genres.js';
import { coverPath } from '../../shared/embed.js';
import { GenrePicker } from './genre-picker.js';
import { VisualCanvas, songTimeline } from './visual-canvas.js';
import { frameAsCover } from './share.js';

const DESCRIPTION_LENGTH = 500;

/**
 * Publishing: tag the song, say a few words about it, pick its picture,
 * and make it public. Separate from the autosaved document — going public
 * is a choice, made with a button, and so is everything that goes with it.
 */
export function PublishView({ store, engine }) {
  const { meta } = store;
  // `cover` is a newly picked frame, as a data URL, until it's saved.
  const [form, setForm] = useState({ tags: meta.tags, description: meta.description, cover: null });
  const [busy, setBusy] = useState(null);   // 'save' | 'publish' | null
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const dirty = form.cover !== null || form.description !== meta.description || JSON.stringify(form.tags) !== JSON.stringify(meta.tags);
  const published = Boolean(meta.publishedAt);
  const url = `${location.origin}/s/${store.id}`;

  const send = async (what, body) => {
    setBusy(what);
    setError(null);
    try {
      const { song } = await api.put(`/songs/${store.id}/publish`, body);
      store.setMeta(song);
      if (body.cover) setForm((f) => ({ ...f, cover: null }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  };
  const details = () => ({ tags: form.tags, description: form.description, ...(form.cover && { cover: form.cover }) });
  const save = () => send('save', details());
  const publish = () => send('publish', { ...details(), published: true });
  const unpublish = () => send('publish', { published: false });

  const copy = () => navigator.clipboard?.writeText(url).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });

  return html`
    <section class="publish">
      <div class="publish-form">
        <h3>Picture <small class="muted">— shown in the feed, on the embed player and when the link is shared</small></h3>
        <${CoverPicker} store=${store} engine=${engine} value=${form.cover} published=${published}
          onChange=${(cover) => setForm({ ...form, cover })} />
        <h3>Genres <small class="muted">— up to ${TAG_LIMITS.perSong}; ones that fit ${store.doc.bpm} BPM are marked</small></h3>
        <${GenrePicker} value=${form.tags} onChange=${(tags) => setForm({ ...form, tags })} max=${TAG_LIMITS.perSong}
          suggested=${tagsForBpm(store.doc.bpm)} />
        <h3>About this song</h3>
        <textarea rows="4" maxlength=${DESCRIPTION_LENGTH} placeholder="What is it? How was it made? Anything you'd tell a listener."
          value=${form.description} onInput=${(e) => setForm({ ...form, description: e.target.value })}></textarea>
        <small class="muted">${form.description.length}/${DESCRIPTION_LENGTH}</small>
      </div>

      <aside class="publish-status panel">
        ${published
          ? html`
            <h3>Public</h3>
            <p class="muted">Since ${new Date(meta.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}. Anyone with the link can play it, and it's in the feed.</p>
            <p class="share"><${Link} href=${`/s/${store.id}`}>${url.replace(/^https?:\/\//, '')}</${Link}>
              <button class="ghost" onClick=${copy}>${copied ? 'Copied' : 'Copy link'}</button></p>
            <p class="muted">Share it, or get a player to embed on another site, from <${Link} href=${`/s/${store.id}`}>its page</${Link}>.</p>
            <div class="form-actions">
              <button class="ghost danger" disabled=${busy} onClick=${unpublish}>${busy === 'publish' ? '…' : 'Unpublish'}</button>
              <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save changes'}</button>
            </div>`
          : html`
            <h3>Private</h3>
            <p class="muted">Only you can hear this. Publishing puts it in the feed and at a link anyone can open.
              ${store.doc.arrangement.length === 0 && html`<strong> It has no arrangement yet, so there'd be nothing to play.</strong>`}</p>
            <p class="share"><${Link} href=${`/s/${store.id}`}>Preview the public page</${Link}></p>
            <div class="form-actions">
              <button class="ghost" disabled=${!dirty || busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save details'}</button>
              <button class="primary" disabled=${busy} onClick=${publish}>${busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
            </div>`}
        ${error && html`<p class="error">${error}</p>`}
      </aside>
    </section>
  `;
}

/**
 * Picking the song's picture: its visuals, live, in the picture's shape,
 * and a button that keeps whatever's on them at that moment. The pick
 * waits in the form (`value`) until it's saved with everything else.
 */
function CoverPicker({ store, engine, value, published, onChange }) {
  const playing = useEngineEvent(engine, 'state', engine.playing);
  const holdTime = useRef(0.001);
  const liveRef = useRef();
  const [stamp] = useState(Date.now);   // a drawn picture follows the song, so skip any cached one
  const [error, setError] = useState(null);
  const canPlay = store.doc.arrangement.length > 0;

  const take = () => {
    try {
      onChange(frameAsCover(liveRef.current.querySelector('canvas')));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const saved = store.meta.coverAt ? coverPath(store.id, store.meta.coverAt) : `${coverPath(store.id)}?t=${stamp}`;
  let caption;
  if (value) caption = `New picture — kept when you ${published ? 'save changes' : 'publish'}.`;
  else if (store.meta.coverAt) caption = 'The picture now.';
  else caption = 'None picked yet, so a sketch of the arrangement stands in.';

  return html`
    <div class="cover-picker">
      <div class="cover-live" ref=${liveRef}>
        <${VisualCanvas} engine=${engine} timeline=${songTimeline(store.doc)} look=${store.doc.look} holdTime=${holdTime}
          class="cover-canvas" />
        <div class="cover-actions">
          <button class=${`play ${playing ? 'on' : ''}`} disabled=${!canPlay}
            onClick=${() => (playing ? engine.stop() : engine.play({ index: 0 }))}>${playing ? '■ Stop' : '▶ Play'}</button>
          <button class="primary" onClick=${take}>Use this frame</button>
        </div>
        <small class="muted">${canPlay ? 'Play the song and catch the moment you want.' : 'Arrange the song first, to have visuals to pick from.'}</small>
        ${error && html`<p class="error">${error}</p>`}
      </div>
      <figure class="cover-chosen">
        <img src=${value ?? saved} alt="The song's picture" />
        <figcaption class="muted">${caption}</figcaption>
        ${value && html`<button class="ghost" onClick=${() => onChange(null)}>${store.meta.coverAt ? 'Keep the current one' : 'Clear'}</button>`}
      </figure>
    </div>
  `;
}
