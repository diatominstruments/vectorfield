import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib.js';
import { api } from '../api.js';
import { currentTheme } from '../theme.js';
import { themeInfo } from '../../shared/themes.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

function loadScript(src, ready, name) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src, async: true });
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${name} sign-in`));
    document.head.append(script);
  });
}
const loadGoogle = () => loadScript(GIS_SRC, () => window.google?.accounts, 'Google');
const loadApple = () => loadScript(APPLE_SRC, () => window.AppleID?.auth, 'Apple');

// Apple's logo, for a button drawn to its Human Interface Guidelines.
const APPLE_LOGO = 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

/**
 * Sign in with Apple, in a popup. Apple needs a registered return URL even
 * then; this page's origin is the one to register.
 */
function AppleButton({ clientId, dark, onSignedIn, onError }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadApple().then(() => {
      AppleID.auth.init({ clientId, scope: 'email', redirectURI: `${location.origin}/`, usePopup: true });
      setReady(true);
    }, onError);
  }, [clientId]);

  const signIn = async () => {
    let result;
    try {
      result = await AppleID.auth.signIn();
    } catch (e) {
      // Closing the popup isn't an error worth showing.
      if (e?.error !== 'popup_closed_by_user' && e?.error !== 'user_cancelled_authorize') onError(new Error('Apple sign-in failed'));
      return;
    }
    api.post('/auth/apple', { idToken: result.authorization.id_token }).then(({ user }) => onSignedIn(user), onError);
  };

  return html`
    <button type="button" class=${`apple-button ${dark ? 'on-dark' : 'on-light'}`} disabled=${!ready} onClick=${signIn}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${APPLE_LOGO} fill="currentColor" /></svg>
      Sign in with Apple
    </button>`;
}

export function SignIn({ config, onSignedIn, next }) {
  const buttonRef = useRef();
  const [error, setError] = useState(null);
  const [devName, setDevName] = useState('');
  const dark = themeInfo(currentTheme()).scheme === 'dark';
  const anyProvider = config.googleClientId || config.appleClientId;

  useEffect(() => {
    if (!config.googleClientId) return;
    loadGoogle().then(() => {
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: ({ credential }) =>
          api.post('/auth/google', { credential }).then(({ user }) => onSignedIn(user), (e) => setError(e.message)),
      });
      google.accounts.id.renderButton(buttonRef.current, { theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill' });
    }, (e) => setError(e.message));
  }, [config.googleClientId]);

  const devSignIn = (e) => {
    e.preventDefault();
    api.post('/auth/dev', { name: devName }).then(({ user }) => onSignedIn(user), (err) => setError(err.message));
  };

  return html`
    <main class="sign-in">
      <h1 class="brand">Vector<span>field</span></h1>
      <p class="tagline">Make a song. Make it move.</p>
      ${next && next !== '/' && html`<p class="muted">Sign in to continue.</p>`}
      ${config.googleClientId && html`<div ref=${buttonRef} class="google-button"></div>`}
      ${config.appleClientId && html`
        <${AppleButton} clientId=${config.appleClientId} dark=${dark} onSignedIn=${onSignedIn} onError=${(e) => setError(e.message)} />`}
      ${config.devLogin && html`
        <form class="dev-login" onSubmit=${devSignIn}>
          <input placeholder="Dev user name (blank: pick one after)" value=${devName} onInput=${(e) => setDevName(e.target.value)} />
          <button>Dev sign-in</button>
        </form>`}
      ${!anyProvider && !config.devLogin && html`
        <p class="notice">Sign-in isn't configured. Set GOOGLE_CLIENT_ID and/or APPLE_CLIENT_ID (or DEV_LOGIN=1 locally) and restart.</p>`}
      ${error && html`<p class="error">${error}</p>`}
    </main>
  `;
}
