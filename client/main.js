import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, usePath, Link, navigate } from './lib.js';
import { api } from './api.js';
import { SignIn } from './ui/sign-in.js';
import { SongList } from './ui/song-list.js';
import { Editor } from './ui/editor.js';
import { Feed } from './ui/feed.js';
import { Profile } from './ui/profile.js';
import { SongPage } from './ui/player.js';
import { ChooseUsername } from './ui/choose-username.js';

const EDITOR_VIEWS = 'instruments|patterns|song|visuals|publish';

/**
 * Routes:
 *   /                  the feed (everyone)
 *   /s/:id             a published song, playing live (everyone)
 *   /u/:username       a profile (everyone)
 *   /studio            your songs (signed in)
 *   /songs/:id/:view   the editor (signed in)
 *   /sign-in           sign in, then back to ?next=
 */
function route(path) {
  let m;
  if (path === '/') return { name: 'feed' };
  if (path === '/sign-in') return { name: 'sign-in' };
  if (path === '/studio') return { name: 'studio', auth: true };
  if ((m = /^\/s\/([0-9a-f-]+)$/.exec(path))) return { name: 'song', id: m[1] };
  if ((m = /^\/u\/([a-z0-9_]+)$/i.exec(path))) return { name: 'profile', username: m[1].toLowerCase() };
  if ((m = new RegExp(`^/songs/([0-9a-f-]+)(?:/(${EDITOR_VIEWS}))?$`).exec(path))) return { name: 'editor', id: m[1], view: m[2] ?? 'instruments', auth: true };
  return { name: 'missing' };
}

function App() {
  const path = usePath();
  const [session, setSession] = useState(null);   // { user, config } once loaded

  useEffect(() => {
    Promise.all([api.get('/auth/me'), api.get('/config')])
      .then(([{ user }, config]) => setSession({ user, config }));
  }, []);

  if (!session) return html`<div class="loading">Loading…</div>`;

  const { user } = session;
  const setUser = (u) => setSession((s) => ({ ...s, user: u }));

  const signOut = async () => {
    await api.post('/auth/logout');
    setUser(null);
    navigate('/');
  };

  // A first sign-in isn't finished until a username is chosen.
  if (user && !user.username) {
    return html`
      <header class="site"><span class="brand">Vector<span>field</span></span></header>
      <${ChooseUsername} onChosen=${setUser} onSignOut=${signOut} />`;
  }

  const r = route(path);
  const signInHref = `/sign-in?next=${encodeURIComponent(path)}`;

  let page;
  if (r.name === 'sign-in' || (r.auth && !user)) {
    // Signed-out visitors to a signed-in page sign in right there and stay.
    const next = r.name === 'sign-in' ? new URLSearchParams(location.search).get('next') || '/studio' : path;
    page = user
      ? (navigate(next), null)
      : html`<${SignIn} config=${session.config} next=${next} onSignedIn=${(u) => { setUser(u); navigate(next); }} />`;
  } else if (r.name === 'feed') {
    page = html`<${Feed} user=${user} />`;
  } else if (r.name === 'studio') {
    page = html`<${SongList} />`;
  } else if (r.name === 'editor') {
    page = html`<${Editor} key=${r.id} songId=${r.id} view=${r.view} />`;
  } else if (r.name === 'song') {
    page = html`<${SongPage} key=${r.id} id=${r.id} user=${user} />`;
  } else if (r.name === 'profile') {
    page = html`<${Profile} key=${r.username} username=${r.username} user=${user} onUserChange=${setUser} />`;
  } else {
    page = html`<main class="missing"><p class="error">There's nothing at ${path}.</p><${Link} href="/">Back to the feed</${Link}></main>`;
  }

  return html`
    <header class="site">
      <${Link} href="/" class="brand">Vector<span>field</span></${Link}>
      <nav class="site-nav">
        <${Link} href="/" class=${r.name === 'feed' ? 'active' : ''}>Feed</${Link}>
        ${user && html`<${Link} href="/studio" class=${r.name === 'studio' || r.name === 'editor' ? 'active' : ''}>Studio</${Link}>`}
      </nav>
      <div class="user">
        ${user
          ? html`
            <${Link} href=${`/u/${user.username}`} class="me" title="Your profile">
              ${user.avatarUrl && html`<img src=${user.avatarUrl} alt="" referrerpolicy="no-referrer" />`}
              <span>${user.username}</span>
            </${Link}>
            <button class="ghost" onClick=${signOut}>Sign out</button>`
          : r.name !== 'sign-in' && html`<${Link} href=${signInHref} class="button primary">Sign in</${Link}>`}
      </div>
    </header>
    ${page}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
