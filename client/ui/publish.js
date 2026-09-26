import { useState } from 'preact/hooks';
import { html, Link } from '../lib.js';
import { api } from '../api.js';
import { TAG_LIMITS, tagsForBpm } from '../../shared/genres.js';
import { GenrePicker } from './genre-picker.js';

const DESCRIPTION_LENGTH = 500;

/**
 * Publishing: tag the song, say a few words about it, and make it public.
 * Separate from the autosaved document — going public is a choice, made
 * with a button.
 */
export function PublishView({ store }) {
  const { meta } = store;
  const [form, setForm] = useState({ tags: meta.tags, description: meta.description });
  const [busy, setBusy] = useState(null);   // 'save' | 'publish' | null
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const dirty = form.description !== meta.description || JSON.stringify(form.tags) !== JSON.stringify(meta.tags);
  const published = Boolean(meta.publishedAt);
  const url = `${location.origin}/s/${store.id}`;

  const send = async (what, body) => {
    setBusy(what);
    setError(null);
    try {
      const { song } = await api.put(`/songs/${store.id}/publish`, body);
      store.setMeta(song);
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  };
  const save = () => send('save', form);
  const publish = () => send('publish', { ...form, published: true });
  const unpublish = () => send('publish', { published: false });

  const copy = () => navigator.clipboard?.writeText(url).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });

  return html`
    <section class="publish">
      <div class="publish-form">
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
