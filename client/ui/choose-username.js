import { useState } from 'preact/hooks';
import { html, useTitle } from '../lib.js';
import { api } from '../api.js';
import { USER_LIMITS, usernameProblem } from '../../shared/users.js';
import { applyTheme, storedTheme } from '../theme.js';
import { ThemePicker } from './theme-picker.js';

/**
 * The step after a first sign-in: pick the name you'll go by. It's the
 * only name shown anywhere, and the address of your profile. Until it's
 * chosen nothing else in the app is reachable. The colour theme is picked
 * here too, previewed live, and saved with the name.
 */
export function ChooseUsername({ onChosen, onSignOut }) {
  useTitle('Choose a username');
  const [username, setUsername] = useState('');
  const [theme, setTheme] = useState(storedTheme);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const problem = username ? usernameProblem(username) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (usernameProblem(username)) return setError(usernameProblem(username));
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.put('/auth/me', { username, theme });
      onChosen(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return html`
    <main class="choose-username">
      <form class="panel" onSubmit=${submit}>
        <h1>Pick a username</h1>
        <p class="muted">It's the name on everything you make here, and your page is at /u/<strong>${username || 'username'}</strong>.
          You can change it later.</p>
        <label class="handle-input">
          <span aria-hidden="true">@</span>
          <input value=${username} maxlength=${USER_LIMITS.username[1]} autofocus required spellcheck="false" autocapitalize="off"
            autocomplete="username" placeholder="your_name" aria-label="Username" aria-invalid=${Boolean(problem)}
            onInput=${(e) => { setUsername(e.target.value.toLowerCase()); setError(null); }} />
        </label>
        <small class=${problem || error ? 'error' : 'muted'}>${error ?? problem ?? 'Lowercase letters, digits and underscores.'}</small>
        <div class="field-label">Pick a look <small class="muted">— you can change it in settings</small></div>
        <${ThemePicker} value=${theme} onChange=${(t) => setTheme(applyTheme(t))} />
        <div class="form-actions">
          <button type="button" class="ghost" onClick=${onSignOut}>Sign out</button>
          <button class="primary" disabled=${busy || !username || Boolean(problem)}>${busy ? 'Saving…' : 'Continue'}</button>
        </div>
      </form>
    </main>
  `;
}
