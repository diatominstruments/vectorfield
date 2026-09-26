import { useState } from 'preact/hooks';
import { html, Link, useTitle } from '../lib.js';
import { api } from '../api.js';
import { applyTheme } from '../theme.js';
import { ThemePicker } from './theme-picker.js';

/**
 * Account settings. The theme applies the moment it's clicked and is saved
 * to the account right after, so it follows the user to other devices;
 * profile fields (username, bio, genres) live on the profile page.
 */
export function Settings({ user, onUserChange, onSignOut }) {
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
