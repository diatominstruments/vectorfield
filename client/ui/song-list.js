import { useEffect, useState } from 'preact/hooks';
import { html, Link, navigate, ago, useTitle } from '../lib.js';
import { api } from '../api.js';

export function SongList() {
  useTitle('Studio');
  const [songs, setSongs] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/songs').then(({ songs }) => setSongs(songs), (e) => setError(e.message));
  }, []);

  const createSong = async (e) => {
    e.preventDefault();
    try {
      const { song } = await api.post('/songs', { title });
      navigate(`/songs/${song.id}/instruments`);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (song) => {
    if (!confirm(`Delete "${song.title}"? This can't be undone.`)) return;
    await api.delete(`/songs/${song.id}`);
    setSongs(songs.filter((s) => s.id !== song.id));
  };

  return html`
    <main class="song-list">
      <h1>Studio</h1>
      <form class="new-song" onSubmit=${createSong}>
        <input placeholder="New song title" maxlength="60" value=${title} onInput=${(e) => setTitle(e.target.value)} />
        <button class="primary">New song</button>
      </form>
      ${error && html`<p class="error">${error}</p>`}
      <h2>Your songs</h2>
      ${songs === null ? html`<p class="muted">Loading…</p>`
        : songs.length === 0 ? html`<p class="muted">No songs yet. Name one above to start.</p>`
        : html`<ul>
            ${songs.map((s) => html`
              <li key=${s.id}>
                <${Link} href=${`/songs/${s.id}/instruments`}>${s.title}</${Link}>
                ${s.publishedAt
                  ? html`<${Link} href=${`/s/${s.id}`} class="badge public" title="Open the public page">Public</${Link}>`
                  : html`<span class="badge">Private</span>`}
                <span class="muted">${ago(s.updatedAt)}</span>
                <button class="ghost danger" onClick=${() => remove(s)} aria-label=${`Delete ${s.title}`}>Delete</button>
              </li>`)}
          </ul>`}
    </main>
  `;
}
