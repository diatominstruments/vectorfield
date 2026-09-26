import { useEffect, useState } from 'preact/hooks';
import { html, Link, navigate, useTitle } from '../lib.js';
import { api } from '../api.js';
import { TAG_LIMITS } from '../../shared/genres.js';
import { USER_LIMITS, usernameProblem } from '../../shared/users.js';
import { GenrePicker, TagChips } from './genre-picker.js';
import { SongCard } from './feed.js';

/**
 * A profile: who they are, what they're into, what they've published. The
 * owner edits it in place; a changed username moves the page to its new
 * address.
 */
export function Profile({ username, user, onUserChange }) {
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
    if (updated.username !== username) navigate(`/u/${updated.username}`);
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
            </div>
            ${mine && html`<button class="edit-profile" onClick=${() => setEditing(true)}>Edit profile</button>`}
          </header>`}

      <h2>${mine ? 'Your published songs' : 'Songs'}</h2>
      ${data.songs.length
        ? html`<ul class="song-cards">${data.songs.map((s) => html`<${SongCard} key=${s.id} song=${s} showOwner=${false} />`)}</ul>`
        : html`<p class="muted">${mine
            ? html`Nothing published yet. Open a song in the <${Link} href="/studio">studio</${Link}> and use its Publish tab.`
            : 'Nothing published yet.'}</p>`}
    </main>
  `;
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
