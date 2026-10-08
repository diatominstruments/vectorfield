import { useEffect, useState } from 'preact/hooks';
import { html, Link, navigate, useTitle } from '../lib.js';
import { api } from '../api.js';
import { TAG_LIMITS } from '../../shared/genres.js';
import { USER_LIMITS, usernameProblem } from '../../shared/users.js';
import { GenrePicker, TagChips } from './genre-picker.js';
import { SongCard } from './feed.js';
import { plural } from './song-view.js';

/**
 * A profile: who they are, what they're into, who follows them, and in two
 * tabs, what they've published and what they've liked. Anyone else can
 * follow them, to be told when they publish. The owner edits it in place;
 * a changed username moves the page to its new address.
 */
export function Profile({ username, tab, user, onUserChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    api.get(`/public/users/${encodeURIComponent(username)}`).then(setData, (e) => setError(e.message));
  }, [username]);

  useTitle(data ? data.user.username : null);

  if (error) return html`<main class="profile"><p class="error">${error}</p><${Link} href="/">Back to the feed</${Link}></main>`;
  if (!data) return html`<div class="loading">Loading…</div>`;

  const profile = data.user;
  const mine = user && user.id === profile.id;

  const saved = (updated) => {
    onUserChange(updated);
    setData({ ...data, user: { ...profile, ...updated } });
    setEditing(false);
    if (updated.username !== username) navigate(`/u/${updated.username}${tab === 'likes' ? '/likes' : ''}`);
  };

  return html`
    <main class="profile">
      ${editing
        ? html`<${ProfileForm} user=${user} onSaved=${saved} onCancel=${() => setEditing(false)} />`
        : html`
          <header class="profile-head">
            ${profile.avatarUrl ? html`<img src=${profile.avatarUrl} alt="" referrerpolicy="no-referrer" />` : html`<span class="avatar-blank" aria-hidden="true">${profile.username[0]}</span>`}
            <div class="profile-id">
              <h1>${profile.username}</h1>
              ${profile.bio && html`<p class="bio">${profile.bio}</p>`}
              ${profile.interests.length
                ? html`<p class="interests"><span class="muted">Into</span> <${TagChips} tags=${profile.interests} /></p>`
                : mine && html`<p class="muted">Pick the genres you're into and your feed's For you tab fills with them.</p>`}
              <p class="follow-stats">
                <span><b>${data.followerCount}</b> ${data.followerCount === 1 ? 'follower' : 'followers'}</span>
                <span><b>${data.followingCount}</b> following</span>
              </p>
            </div>
            ${mine
              ? html`<button class="edit-profile" onClick=${() => setEditing(true)}>Edit profile</button>`
              : html`<${FollowButton} profile=${profile} user=${user} following=${data.following} onChange=${(f) => setData({ ...data, ...f })} />`}
          </header>`}

      <nav class="tabs" aria-label="Profile">
        <${Link} href=${`/u/${username}`} class=${tab === 'songs' ? 'active' : ''} aria-current=${tab === 'songs' ? 'page' : undefined}>Songs</${Link}>
        <${Link} href=${`/u/${username}/likes`} class=${tab === 'likes' ? 'active' : ''} aria-current=${tab === 'likes' ? 'page' : undefined}>Liked</${Link}>
      </nav>
      ${tab === 'likes'
        ? html`<${LikedSongs} username=${username} mine=${mine} />`
        : data.songs.length
          ? html`<ul class="song-cards">${data.songs.map((s) => html`<${SongCard} key=${s.id} song=${s} showOwner=${false} />`)}</ul>`
          : html`<p class="muted">${mine
              ? html`Nothing published yet. Open a song in the <${Link} href="/studio">studio</${Link}> and use its Publish tab.`
              : 'Nothing published yet.'}</p>`}
    </main>
  `;
}

/** The songs a user has liked, latest like first, a page at a time. */
function LikedSongs({ username, mine }) {
  const [state, setState] = useState({ songs: [], nextBefore: null, loading: true, error: null });

  const load = (before) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const query = before ? `?${new URLSearchParams({ before })}` : '';
    api.get(`/public/users/${encodeURIComponent(username)}/likes${query}`).then(
      ({ songs, nextBefore }) => setState((s) => ({ songs: before ? [...s.songs, ...songs] : songs, nextBefore, loading: false, error: null })),
      (e) => setState((s) => ({ ...s, loading: false, error: e })),
    );
  };

  useEffect(() => load(), [username]);

  if (state.error) return html`<p class="error">${state.error.message}</p>`;
  if (state.loading && !state.songs.length) return html`<p class="muted">Loading…</p>`;
  if (!state.songs.length) {
    return html`<p class="muted">${mine ? 'Nothing liked yet. Hit the heart on a song you like and it shows up here.' : 'Nothing liked yet.'}</p>`;
  }
  return html`
    <ul class="song-cards">${state.songs.map((s) => html`<${SongCard} key=${s.id} song=${s} />`)}</ul>
    ${state.nextBefore && html`<button class="load-more" disabled=${state.loading} onClick=${() => load(state.nextBefore)}>${state.loading ? 'Loading…' : 'More'}</button>`}`;
}

/**
 * Follow or unfollow, with the button showing which it is now. Following
 * someone gets you told when they publish. Signed out, it leads to sign-in
 * and back here.
 */
function FollowButton({ profile, user, following, onChange }) {
  const [busy, setBusy] = useState(false);

  if (!user) {
    return html`<${Link} href=${`/sign-in?next=${encodeURIComponent(`/u/${profile.username}`)}`} class="button follow" title="Sign in to follow">Follow</${Link}>`;
  }

  const toggle = async () => {
    setBusy(true);
    try {
      onChange(following ? await api.delete(`/follows/${profile.username}`) : await api.put(`/follows/${profile.username}`, {}));
    } finally {
      setBusy(false);
    }
  };

  return html`
    <button class=${`follow ${following ? 'on' : ''}`} disabled=${busy} onClick=${toggle} aria-pressed=${following}
      title=${following ? 'You follow them. Click to unfollow' : 'Follow to hear about their new songs'}>
      ${following ? 'Following' : 'Follow'}
    </button>`;
}

function ProfileForm({ user, onSaved, onCancel }) {
  const [form, setForm] = useState({ username: user.username, bio: user.bio, interests: user.interests });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const problem = form.username !== user.username ? usernameProblem(form.username) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await api.put('/auth/me', form);
      onSaved(updated);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return html`
    <form class="profile-form panel" onSubmit=${submit}>
      <h2>Edit profile</h2>
      <label>Username
        <span class="handle-input"><span aria-hidden="true">@</span>
          <input value=${form.username} maxlength=${USER_LIMITS.username[1]} required spellcheck="false" autocapitalize="off"
            onInput=${(e) => set('username')(e.target.value.toLowerCase())} aria-invalid=${Boolean(problem)} /></span>
        <small class=${problem ? 'error' : 'muted'}>${problem ?? `Your page is /u/${form.username}`}</small>
      </label>
      <label>Bio
        <textarea value=${form.bio} maxlength=${USER_LIMITS.bio} rows="3" onInput=${(e) => set('bio')(e.target.value)}></textarea>
        <small class="muted">${form.bio.length}/${USER_LIMITS.bio}</small>
      </label>
      <div class="field-label">Genres you're into <small class="muted">— they pick your For you feed</small></div>
      <${GenrePicker} value=${form.interests} onChange=${set('interests')} max=${TAG_LIMITS.interests} />
      ${error && html`<p class="error">${error}</p>`}
      <div class="form-actions">
        <button type="button" class="ghost" onClick=${onCancel}>Cancel</button>
        <button class="primary" disabled=${busy || Boolean(problem)}>${busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  `;
}
