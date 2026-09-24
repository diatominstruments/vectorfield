import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, usePath, Link, navigate } from './lib.js';
import { api } from './api.js';
import { SignIn } from './ui/sign-in.js';
import { SongList } from './ui/song-list.js';
import { Editor } from './ui/editor.js';

function App() {
  const path = usePath();
  const [session, setSession] = useState(null);   // { user, config } once loaded

  useEffect(() => {
    Promise.all([api.get('/auth/me'), api.get('/config')])
      .then(([{ user }, config]) => setSession({ user, config }));
  }, []);

  if (!session) return html`<div class="loading">Loading…</div>`;

  const signOut = async () => {
    await api.post('/auth/logout');
    setSession({ ...session, user: null });
    navigate('/');
  };

  if (!session.user) {
    return html`<${SignIn} config=${session.config} onSignedIn=${(user) => setSession({ ...session, user })} />`;
  }

  const songMatch = /^\/songs\/([0-9a-f-]+)(?:\/(instruments|patterns|song))?$/.exec(path);
  return html`
    <header class="site">
      <${Link} href="/" class="brand">vision<span>·</span>land</${Link}>
      <div class="user">
        ${session.user.avatarUrl && html`<img src=${session.user.avatarUrl} alt="" referrerpolicy="no-referrer" />`}
        <span>${session.user.name}</span>
        <button class="ghost" onClick=${signOut}>Sign out</button>
      </div>
    </header>
    ${songMatch
      ? html`<${Editor} key=${songMatch[1]} songId=${songMatch[1]} view=${songMatch[2] ?? 'instruments'} />`
      : html`<${SongList} />`}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
