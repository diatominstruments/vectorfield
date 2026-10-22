import { useState } from 'preact/hooks';
import { html, Link, useTitle } from '../lib.js';
import { api } from '../api.js';
import { applyTheme } from '../theme.js';
import { ThemePicker } from './theme-picker.js';
import { passwordProblem } from '../../shared/users.js';
import { RecoveryEmail } from './recovery.js';

/**
 * For accounts that sign in with a password. The username rides along,
 * hidden, so password managers know which saved login to update.
 */
function ChangePassword({ user }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);   // 'saving' | 'saved' | { error }
  const problem = password ? passwordProblem(password, user.username) : null;

  const submit = async (e) => {
    e.preventDefault();
    setStatus('saving');
    try {
      await api.put('/auth/password', { current, password });
      setCurrent('');
      setPassword('');
      setStatus('saved');
    } catch (err) {
      setStatus({ error: err.message });
    }
  };

  return html`
    <section class="panel">
      <h2>Password</h2>
      <p class="muted">You sign in with your username, @${user.username}, and a password. Changing it signs you out everywhere else.</p>
      <form class="change-password" method="post" onSubmit=${submit}>
        <input name="username" autocomplete="username" value=${user.username} readonly hidden />
        <label>Current password
          <input type="password" autocomplete="current-password" required value=${current}
            onInput=${(e) => { setCurrent(e.target.value); setStatus(null); }} />
        </label>
        <label>New password
          <input type="password" autocomplete="new-password" required value=${password}
            onInput=${(e) => { setPassword(e.target.value); setStatus(null); }} />
        </label>
        <p class=${`settings-status ${problem || status?.error ? 'error' : 'muted'}`} role="status">
          ${problem ?? (status === 'saved' ? 'Password changed.' : status?.error ?? '')}
        </p>
        <p><button class="primary" disabled=${status === 'saving' || !current || !password || Boolean(problem)}>
          ${status === 'saving' ? 'Changing…' : 'Change password'}
        </button></p>
      </form>
    </section>`;
}

/**
 * Account settings. The theme applies the moment it's clicked and is saved
 * to the account right after, so it follows the user to other devices;
 * profile fields (username, bio, genres) live on the profile page.
 */
export function Settings({ user, config, onUserChange, onSignOut }) {
  useTitle('Settings');
  const [status, setStatus] = useState(null);   // 'saving' | 'saved' | { error }

  const pickTheme = async (theme) => {
    if (theme === user.theme) return;
    applyTheme(theme);
    onUserChange({ ...user, theme });   // optimistic, so the picker follows the click
    setStatus('saving');
    try {
      const { user: updated } = await api.put('/auth/me', { theme });
      onUserChange(updated);
      setStatus('saved');
    } catch (err) {
      setStatus({ error: err.message });
    }
  };

  return html`
    <main class="settings">
      <h1>Settings</h1>

      <section class="panel">
        <h2>Theme</h2>
        <p class="muted">How Vectorfield looks, everywhere you're signed in.</p>
        <${ThemePicker} value=${user.theme} onChange=${pickTheme} />
        <p class=${`settings-status ${status?.error ? 'error' : 'muted'}`} role="status">
          ${status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved.' : status?.error ? `Couldn't save: ${status.error}` : ''}
        </p>
      </section>

      <section class="panel">
        <h2>Profile</h2>
        <p class="muted">Your username, bio and the genres you're into are edited on your profile.</p>
        <p><${Link} href=${`/u/${user.username}`} class="button">Open your profile</${Link}></p>
      </section>

      ${user.hasPassword && html`<${ChangePassword} user=${user} />`}
      ${user.hasPassword && config.recoveryEmail && html`<${RecoveryEmail} user=${user} onUserChange=${onUserChange} />`}

      <section class="panel">
        <h2>Account</h2>
        <dl>
          <dt>Signed in as</dt><dd>@${user.username}</dd>
          ${user.email && html`<dt>Google account</dt><dd>${user.email}</dd>`}
        </dl>
        <p><button type="button" onClick=${onSignOut}>Sign out</button></p>
      </section>
    </main>
  `;
}
