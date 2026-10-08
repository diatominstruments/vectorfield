import { useEffect, useState } from 'preact/hooks';
import { html, Link, ago, useTitle } from '../lib.js';
import { api } from '../api.js';
import { icon, messageParts, showsCard } from '../../shared/notifications.js';
import { SongCard } from './feed.js';

const POLL_MS = 60_000;

/**
 * How many notifications are unread, for the bell: asked on sign-in, then
 * every minute while the tab is visible, and again whenever it comes back
 * into view. The notifications page sets it to zero once it has marked
 * everything read.
 */
export function useUnread(user) {
  const [unread, setUnread] = useState(0);
  const signedIn = Boolean(user?.username);

  useEffect(() => {
    if (!signedIn) {
      setUnread(0);
      return;
    }
    const check = () => api.get('/notifications/unread').then(({ unread }) => setUnread(unread), () => {});
    // A hidden tab doesn't poll; it catches up the moment it's shown.
    const ifVisible = () => { if (document.visibilityState !== 'hidden') check(); };
    check();
    const timer = setInterval(ifVisible, POLL_MS);
    document.addEventListener('visibilitychange', ifVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ifVisible);
    };
  }, [signedIn, user?.id]);

  return [unread, setUnread];
}

/** The bell in the header, with how many are unread. */
export function NotificationBell({ unread, active }) {
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return html`
    <${Link} href="/notifications" class=${`bell ${active ? 'active' : ''}`} aria-label=${label} title=${label}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.1V5.5a4 4 0 0 0-4-4zM6.3 13a1.8 1.8 0 0 0 3.4 0" />
      </svg>
      ${unread > 0 && html`<span class="bell-count">${unread > 99 ? '99+' : unread}</span>`}
    </${Link}>`;
}

/**
 * The notifications page: newest first, a page at a time. Loading it marks
 * everything read, so the bell clears; the ones that were new stay marked
 * on the page until it's next opened.
 */
export function Notifications({ user, onSeen }) {
  useTitle('Notifications');
  const [state, setState] = useState({ items: [], nextBefore: null, loading: true, error: null });

  const load = (before) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const query = before ? `?${new URLSearchParams({ before })}` : '';
    api.get(`/notifications${query}`).then(
      ({ notifications, nextBefore, unread }) => {
        setState((s) => ({ items: before ? [...s.items, ...notifications] : notifications, nextBefore, loading: false, error: null }));
        if (!before && unread > 0) api.put('/notifications/read', {}).then(onSeen, () => {});
      },
      (e) => setState((s) => ({ ...s, loading: false, error: e })),
    );
  };

  useEffect(() => load(), []);

  let body;
  if (state.error) {
    body = html`<p class="error">${state.error.message}</p>`;
  } else if (state.loading && !state.items.length) {
    body = html`<p class="muted">Loading…</p>`;
  } else if (!state.items.length) {
    body = html`<p class="empty-state">Nothing yet. When someone likes a song of yours, or someone you follow publishes one, it shows up here.</p>`;
  } else {
    body = html`
      <ol class="notification-list">
        ${state.items.map((n) => html`<${Notification} key=${n.id} n=${n} user=${user} />`)}
      </ol>
      ${state.nextBefore && html`<button class="load-more" disabled=${state.loading} onClick=${() => load(state.nextBefore)}>${state.loading ? 'Loading…' : 'More'}</button>`}`;
  }

  return html`
    <main class="notifications">
      <h1>Notifications</h1>
      ${body}
    </main>
  `;
}

/**
 * One notification: who it's from (their avatar, with the kind's glyph on
 * it), what happened, with the people and songs in it as links, and for
 * kinds about a song, the song as a feed card.
 */
function Notification({ n, user }) {
  const parts = messageParts(n);
  return html`
    <li class=${`notification ${n.readAt ? '' : 'unread'}`}>
      <span class="who" aria-hidden="true">
        ${n.actor
          ? html`
            ${n.actor.avatarUrl
              ? html`<img src=${n.actor.avatarUrl} alt="" referrerpolicy="no-referrer" />`
              : html`<span class="avatar-blank">${n.actor.username[0]}</span>`}
            <span class="kind">${icon(n.kind)}</span>`
          : html`<span class="avatar-blank glyph">${icon(n.kind)}</span>`}
      </span>
      <p>
        ${parts.map((p, i) => (p.href ? html`<${Link} key=${i} href=${p.href}>${p.text}</${Link}>` : p.text))}
        <span class="when muted" title=${new Date(n.createdAt).toLocaleString()}> · ${ago(n.createdAt)}</span>
        ${!n.readAt && html`<span class="sr-only"> (new)</span>`}
      </p>
      ${showsCard(n) && html`
        <ul class="song-cards">
          <${SongCard} song=${n.song} showOwner=${n.song.owner.id !== user.id} />
        </ul>`}
    </li>
  `;
}
