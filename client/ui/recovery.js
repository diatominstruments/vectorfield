import { useEffect, useState } from 'preact/hooks';
import { html, Link, useTitle } from '../lib.js';
import { api } from '../api.js';
import { USER_LIMITS, emailProblem, passwordProblem } from '../../shared/users.js';

/**
 * Getting back into a password account through its recovery email: asking
 * for a reset link, the page that link opens, the page a confirmation link
 * opens, and the recovery email's panel in settings. The tokens in those
 * links travel after the # so they never reach a server log; they're sent
 * on in request bodies, not URLs.
 */
const linkToken = () => location.hash.slice(1);

/** "Forgot password?" on the sign-in page. */
export function ForgotPassword({ onBack }) {
  const [given, setGiven] = useState('');
  const [status, setStatus] = useState(null);   // 'sending' | 'sent' | { error }

  const submit = async (e) => {
    e.preventDefault();
    setStatus('sending');
    try {
      await api.post('/auth/forgot', { username: given });
      setStatus('sent');
    } catch (err) {
      setStatus({ error: err.message });
    }
  };

  return html`
    <form class="password-form" method="post" onSubmit=${submit}>
      <small class="muted">If your account has a confirmed recovery email, we'll send a link there to choose a new password.</small>
      <label>
        Username or recovery email
        <input name="username" value=${given} required spellcheck="false" autocapitalize="off" autocomplete="username"
          onInput=${(e) => { setGiven(e.target.value); setStatus(null); }} />
      </label>
      ${status === 'sent' && html`
        <small class="muted" role="status">If that account has a confirmed recovery email, a link is on its way. It works for an hour.</small>`}
      ${status?.error && html`<small class="error" role="alert">${status.error}</small>`}
      <button class="primary" disabled=${status === 'sending' || !given.trim()}>${status === 'sending' ? 'Sending…' : 'Send reset link'}</button>
      <p><button type="button" class="link" onClick=${onBack}>Back to sign in</button></p>
    </form>`;
}

/** /reset-password#token: choose a new password, and be signed in. */
export function ResetPassword({ onSignedIn }) {
  useTitle('Choose a new password');
  const [username, setUsername] = useState(undefined);   // undefined: checking the link; null: it's no good
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const problem = password && username ? passwordProblem(password, username) : null;

  useEffect(() => {
    api.post('/auth/reset-link', { token: linkToken() }).then((r) => setUsername(r.username), () => setUsername(null));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post('/auth/reset', { token: linkToken(), password });
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (username === undefined) return html`<div class="loading">Checking your link…</div>`;
  return html`
    <main class="choose-username">
      ${username === null ? html`
        <div class="panel">
          <h1>That link doesn't work</h1>
          <p class="muted">It has expired or already been used. Reset links work once, for an hour.</p>
          <div class="form-actions"><${Link} href="/sign-in" class="button primary">Ask for a new one</${Link}></div>
        </div>` : html`
        <form class="panel reset-password" method="post" onSubmit=${submit}>
          <h1>Choose a new password</h1>
          <p class="muted">For <strong>@${username}</strong>. Saving it signs you out everywhere else.</p>
          <input name="username" autocomplete="username" value=${username} readonly hidden />
          <label>
            New password
            <span class="password-input">
              <input name="password" type=${shown ? 'text' : 'password'} value=${password} required autofocus autocomplete="new-password"
                onInput=${(e) => { setPassword(e.target.value); setError(null); }} />
              <button type="button" class="ghost" aria-pressed=${shown} onClick=${() => setShown(!shown)}>${shown ? 'Hide' : 'Show'}</button>
            </span>
          </label>
          <small class=${problem || error ? 'error' : 'muted'} role=${error ? 'alert' : null}>${error ?? problem ?? `At least ${USER_LIMITS.password[0]} characters.`}</small>
          <button class="primary" disabled=${busy || !password || Boolean(problem)}>${busy ? 'Saving…' : 'Save and sign in'}</button>
        </form>`}
    </main>`;
}

/** /confirm-email#token: the link in a confirmation email. */
export function ConfirmEmail({ user, onConfirmed }) {
  useTitle('Confirm your recovery email');
  const [result, setResult] = useState(null);   // { email } | { error }

  useEffect(() => {
    api.post('/auth/confirm-email', { token: linkToken() }).then(
      ({ email }) => { setResult({ email }); onConfirmed(); },
      (err) => setResult({ error: err.message }),
    );
  }, []);

  if (!result) return html`<div class="loading">Confirming…</div>`;
  return html`
    <main class="choose-username">
      <div class="panel">
        <h1>${result.email ? 'Recovery email confirmed' : "That link doesn't work"}</h1>
        <p class="muted">
          ${result.email
            ? html`If you forget your password, a reset link can go to <strong>${result.email}</strong>.`
            : `${result.error} To get a new one, save your recovery email again in settings.`}
        </p>
        <div class="form-actions">
          <${Link} href=${user ? '/settings' : '/sign-in'} class="button primary">${user ? 'Go to settings' : 'Sign in'}</${Link}>
        </div>
      </div>
    </main>`;
}

/**
 * Settings' recovery email panel, for password accounts. Changing it takes
 * the password, like changing the password does; an unconfirmed address
 * can be sent a fresh link by saving it again.
 */
export function RecoveryEmail({ user, onUserChange }) {
  const [email, setEmail] = useState(user.recoveryEmail ?? '');
  const [current, setCurrent] = useState('');
  const [status, setStatus] = useState(null);   // 'saving' | { sent } | 'removed' | { error }
  const typed = email.trim();
  const changed = typed !== (user.recoveryEmail ?? '');
  const resend = !changed && Boolean(user.recoveryEmail) && !user.recoveryEmailConfirmed;
  const problem = typed ? emailProblem(typed) : null;

  const submit = async (e) => {
    e.preventDefault();
    setStatus('saving');
    try {
      const { user: updated } = await api.put('/auth/recovery-email', { email: typed, current });
      onUserChange(updated);
      setCurrent('');
      setStatus(typed ? { sent: typed } : 'removed');
    } catch (err) {
      setStatus({ error: err.message });
    }
  };

  const about = !user.recoveryEmail
    ? "None yet. Add one so a forgotten password can be reset; without it, a lost password means a lost account."
    : user.recoveryEmailConfirmed
      ? html`Reset links go to <strong>${user.recoveryEmail}</strong>.`
      : html`Waiting for you to open the link sent to <strong>${user.recoveryEmail}</strong>. Not there? Save it again for another.`;
  const message = problem ?? status?.error
    ?? (status?.sent ? `Sent a link to ${status.sent}. Open it to confirm.` : status === 'removed' ? 'Removed.' : '');

  return html`
    <section class="panel">
      <h2>Recovery email</h2>
      <p class="muted">${about}</p>
      <form class="change-password" method="post" onSubmit=${submit}>
        <input name="username" autocomplete="username" value=${user.username} readonly hidden />
        <label>Email
          <input type="email" autocomplete="email" spellcheck="false" value=${email} placeholder="you@example.com"
            onInput=${(e) => { setEmail(e.target.value); setStatus(null); }} />
        </label>
        <label>Current password
          <input type="password" autocomplete="current-password" required value=${current}
            onInput=${(e) => { setCurrent(e.target.value); setStatus(null); }} />
        </label>
        <p class=${`settings-status ${problem || status?.error ? 'error' : 'muted'}`} role="status">${message}</p>
        <p><button class="primary" disabled=${status === 'saving' || !current || Boolean(problem) || !(changed || resend)}>
          ${status === 'saving' ? 'Saving…' : !typed && user.recoveryEmail ? 'Remove' : resend ? 'Send link again' : 'Save'}
        </button></p>
      </form>
    </section>`;
}
