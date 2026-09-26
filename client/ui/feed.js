import { useEffect, useState } from 'preact/hooks';
import { html, Link, ago, useTitle } from '../lib.js';
import { api } from '../api.js';
import { TagChips } from './genre-picker.js';

/** A published song as feeds and profiles list it. */
export function SongCard({ song, showOwner = true }) {
  return html`
    <li class="song-card">
      <${Link} href=${`/s/${song.id}`} class="song-card-main">
        <span class="play-mark" aria-hidden="true">▶</span>
        <span class="song-card-text">
          <strong>${song.title}</strong>
          ${song.description && html`<span class="song-card-desc">${song.description}</span>`}
        </span>
      </${Link}>
      <div class="song-card-meta">
        ${showOwner && song.owner?.username && html`
          <${Link} href=${`/u/${song.owner.username}`} class="owner">
            ${song.owner.avatarUrl && html`<img src=${song.owner.avatarUrl} alt="" referrerpolicy="no-referrer" />`}
            ${song.owner.username}
          </${Link}>`}
        <span class="muted" title=${song.publishedAt && new Date(song.publishedAt).toLocaleString()}>${ago(song.publishedAt)}</span>
        <${TagChips} tags=${song.tags} />
      </div>
    </li>
  `;
}

const TABS = [['new', 'New'], ['for-you', 'For you']];

/**
 * The home feed. New is everything published, newest first; For you is
 * the songs tagged with genres the signed-in user is into.
 */
export function Feed({ user }) {
  useTitle(null);
  const [tab, setTab] = useState('new');
  const [state, setState] = useState({ songs: [], nextBefore: null, loading: true, error: null, noInterests: false });

  const load = (before) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const query = new URLSearchParams({ tab });
    if (before) query.set('before', before);
    api.get(`/public/feed?${query}`).then(
      ({ songs, nextBefore, noInterests }) => setState((s) => ({
        songs: before ? [...s.songs, ...songs] : songs, nextBefore, noInterests: Boolean(noInterests), loading: false, error: null,
      })),
      (e) => setState((s) => ({ ...s, loading: false, error: e })),
    );
  };

  useEffect(() => {
    setState({ songs: [], nextBefore: null, loading: true, error: null, noInterests: false });
    if (tab === 'for-you' && !user) return setState((s) => ({ ...s, loading: false }));
    load();
  }, [tab, user?.id]);

  let body;
  if (tab === 'for-you' && !user) {
    body = html`<p class="empty-state"><${Link} href="/sign-in?next=/">Sign in</${Link}> to get songs picked for the genres you're into.</p>`;
  } else if (state.error) {
    body = html`<p class="error">${state.error.message}</p>`;
  } else if (state.noInterests) {
    body = html`<p class="empty-state">Say what you're into on <${Link} href=${`/u/${user.username}`}>your profile</${Link}> and this tab fills with it.</p>`;
  } else if (!state.loading && state.songs.length === 0) {
    body = tab === 'new'
      ? html`<p class="empty-state">Nothing published yet. ${user ? html`Be first: make something in the <${Link} href="/studio">studio</${Link}>.` : ''}</p>`
      : html`<p class="empty-state">Nothing tagged with your genres yet. Try <button class="link" onClick=${() => setTab('new')}>New</button>, or add more genres on <${Link} href=${`/u/${user.username}`}>your profile</${Link}>.</p>`;
  } else {
    body = html`
      <ul class="song-cards">${state.songs.map((s) => html`<${SongCard} key=${s.id} song=${s} />`)}</ul>
      ${state.nextBefore && html`<button class="load-more" disabled=${state.loading} onClick=${() => load(state.nextBefore)}>${state.loading ? 'Loading…' : 'More'}</button>`}`;
  }

  return html`
    <main class="feed">
      <nav class="tabs" aria-label="Feed">
        ${TABS.map(([id, label]) => html`
          <button key=${id} class=${tab === id ? 'active' : ''} onClick=${() => setTab(id)}>${label}</button>`)}
      </nav>
      ${state.loading && !state.songs.length ? html`<p class="muted">Loading…</p>` : body}
    </main>
  `;
}
