import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib.js';
import { api } from '../api.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogle() {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: GIS_SRC, async: true });
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.append(script);
  });
}

export function SignIn({ config, onSignedIn }) {
  const buttonRef = useRef();
  const [error, setError] = useState(null);
  const [devName, setDevName] = useState('');

  useEffect(() => {
    if (!config.googleClientId) return;
    loadGoogle().then(() => {
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: ({ credential }) =>
          api.post('/auth/google', { credential }).then(({ user }) => onSignedIn(user), (e) => setError(e.message)),
      });
      google.accounts.id.renderButton(buttonRef.current, { theme: 'filled_black', size: 'large', shape: 'pill' });
    }, (e) => setError(e.message));
  }, [config.googleClientId]);

  const devSignIn = (e) => {
    e.preventDefault();
    api.post('/auth/dev', { name: devName }).then(({ user }) => onSignedIn(user), (err) => setError(err.message));
  };

  return html`
    <main class="sign-in">
      <h1 class="brand">vision<span>·</span>land</h1>
      <p class="tagline">Make a song. Make it move.</p>
      ${config.googleClientId && html`<div ref=${buttonRef} class="google-button"></div>`}
      ${config.devLogin && html`
        <form class="dev-login" onSubmit=${devSignIn}>
          <input placeholder="Dev user name" value=${devName} onInput=${(e) => setDevName(e.target.value)} />
          <button>Dev sign-in</button>
        </form>`}
      ${!config.googleClientId && !config.devLogin && html`
        <p class="notice">Sign-in isn't configured. Set GOOGLE_CLIENT_ID (or DEV_LOGIN=1 locally) and restart.</p>`}
      ${error && html`<p class="error">${error}</p>`}
    </main>
  `;
}
