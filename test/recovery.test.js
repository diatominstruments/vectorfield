import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

process.env.PGLITE_DIR = 'memory://';
delete process.env.DATABASE_URL;

const { connect } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { emails } = await import('../server/mail.js');
const { emailProblem } = await import('../shared/users.js');

// Every email the server sends lands here instead.
const sent = [];
const mailer = { send: async (message) => { sent.push(message); } };

let db, server, origin, base;

before(async () => {
  db = await connect(null);
  server = createApp(db, { mailer, pwned: async () => 0 }).listen(0);
  origin = `http://localhost:${server.address().port}`;
  base = `${origin}/api`;
});

after(async () => {
  server.close();
  await db.close();
});

async function call(path, { method = 'POST', body, cookie } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const signUp = (username, password, email) => call('/auth/signup', { body: { username, password, email } });
const logIn = (username, password) => call('/auth/login', { body: { username, password } });
const me = async (cookie) => (await call('/auth/me', { method: 'GET', cookie })).body.user;
const forgot = (username) => call('/auth/forgot', { body: { username } });

/** The latest email to `to`, and the token in its link to `page`. */
function lastTo(to, page) {
  const email = sent.findLast((m) => m.to === to);
  const token = page && new RegExp(`${origin}/${page}#([A-Za-z0-9_-]{43})`).exec(email?.text ?? '')?.[1];
  return { email, token };
}
const confirm = async (address) => call('/auth/confirm-email', { body: { token: lastTo(address, 'confirm-email').token } });

/** A password account with a confirmed recovery email. */
async function confirmedAccount(username, password, address) {
  const { cookie } = await signUp(username, password, address);
  assert.equal((await confirm(address)).status, 200);
  return cookie;
}

test('email addresses are checked for shape', () => {
  assert.equal(emailProblem('ada@example.com'), null);
  for (const bad of ['', 'ada', 'ada@', 'ada@example', 'a da@example.com', `${'a'.repeat(250)}@example.com`]) assert.ok(emailProblem(bad), bad);
});

/** Runs `code` as a module in a fresh Node, with `env` added: what it prints, or its error. */
async function freshNode(code, env) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env } });
    return stdout.trim();
  } catch (err) {
    return err.stderr;
  }
}

test('recovery emails are off unless RECOVERY_EMAIL=1', async () => {
  const mail = new URL('../server/mail.js', import.meta.url).href;
  const hasMailer = `const { createMailer } = await import('${mail}'); console.log(Boolean(await createMailer()));`;
  const dev = { NODE_ENV: 'development', RECOVERY_EMAIL: '', SMTP_URL: '' };
  assert.equal(await freshNode(hasMailer, dev), 'false');
  assert.equal(await freshNode(hasMailer, { ...dev, SMTP_URL: 'smtp://mail.example.com' }), 'false');   // set up, but off
  assert.equal(await freshNode(hasMailer, { ...dev, RECOVERY_EMAIL: '1' }), 'true');   // printing to the log

  const production = { ...dev, NODE_ENV: 'production', DATABASE_URL: 'postgres://db.example', GOOGLE_CLIENT_ID: 'x' };
  assert.equal(await freshNode(hasMailer, production), 'false');   // off: nothing to set up, nothing to fail
  assert.match(await freshNode(hasMailer, { ...production, RECOVERY_EMAIL: '1' }), /RECOVERY_EMAIL=1 needs SMTP_URL and PUBLIC_URL/);
});

test('the server says recovery emails are on', async () => {
  assert.equal((await call('/config', { method: 'GET' })).body.recoveryEmail, true);
});

test('a recovery email given at sign-up works once it is confirmed from the link sent to it', async () => {
  const up = await signUp('mira', 'pass phrase one', ' mira@example.com ');
  assert.equal(up.status, 200);
  assert.deepEqual([up.body.user.recoveryEmail, up.body.user.recoveryEmailConfirmed], ['mira@example.com', false]);
  const { email, token } = lastTo('mira@example.com', 'confirm-email');
  assert.match(email.subject, /Confirm/);
  assert.match(email.text, /@mira/);
  assert.ok(token);

  // Unconfirmed, it gets no reset links.
  const before = sent.length;
  assert.equal((await forgot('mira')).status, 200);
  assert.equal(sent.length, before);

  const confirmed = await call('/auth/confirm-email', { body: { token } });
  assert.deepEqual([confirmed.status, confirmed.body.email], [200, 'mira@example.com']);
  assert.equal((await me(up.cookie)).recoveryEmailConfirmed, true);
  assert.equal((await call('/auth/confirm-email', { body: { token } })).status, 400);   // once only
});

test('a forgotten password is reset from the emailed link', async () => {
  const first = await confirmedAccount('nova', 'old pass phrase', 'nova@example.com');
  const other = (await logIn('nova', 'old pass phrase')).cookie;

  assert.equal((await forgot('@Nova')).status, 200);
  const byName = lastTo('nova@example.com', 'reset-password');
  assert.match(byName.email.subject, /Reset/);
  assert.match(byName.email.text, /@nova/);
  assert.equal((await forgot('NOVA@example.com')).status, 200);   // by address, too
  const byAddress = lastTo('nova@example.com', 'reset-password');
  assert.notEqual(byAddress.token, byName.token);

  assert.deepEqual((await call('/auth/reset-link', { body: { token: byName.token } })).body, { username: 'nova' });
  assert.equal((await call('/auth/reset', { body: { token: byName.token, password: 'short' } })).status, 400);
  assert.equal((await call('/auth/reset-link', { body: { token: byName.token } })).status, 200);   // not used up by that

  const reset = await call('/auth/reset', { body: { token: byName.token, password: 'new pass phrase' } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.username, 'nova');
  assert.equal((await me(reset.cookie)).username, 'nova');
  assert.equal(await me(first), null);   // everywhere else is signed out
  assert.equal(await me(other), null);
  assert.equal((await logIn('nova', 'old pass phrase')).status, 401);
  assert.equal((await logIn('nova', 'new pass phrase')).status, 200);

  // Both links are spent: the one used, and the one it made stale.
  for (const token of [byName.token, byAddress.token]) {
    assert.equal((await call('/auth/reset', { body: { token, password: 'third pass phrase' } })).status, 400);
  }
});

test("forgot gives one answer whether or not there's anyone to email", async () => {
  await signUp('plain_account', 'no email given');
  await signUp('pending_account', 'email not confirmed', 'pending@example.com');
  const before = sent.length;
  for (const given of ['nobody_at_all', 'plain_account', 'pending_account', 'pending@example.com']) {
    assert.deepEqual(await forgot(given), { status: 200, body: { ok: true }, cookie: undefined });
  }
  assert.equal(sent.length, before);
});

test('reset links expire, and die when the recovery email changes', async () => {
  const cookie = await confirmedAccount('orbit', 'orbit pass phrase', 'orbit@example.com');
  await forgot('orbit');
  const stale = lastTo('orbit@example.com', 'reset-password').token;
  await db.query("update email_tokens set expires_at = now() - interval '1 minute' where purpose = 'reset'");
  assert.equal((await call('/auth/reset-link', { body: { token: stale } })).status, 400);
  assert.equal((await call('/auth/reset', { body: { token: stale, password: 'a new pass phrase' } })).status, 400);

  await forgot('orbit');
  const live = lastTo('orbit@example.com', 'reset-password').token;
  const moved = await call('/auth/recovery-email', { method: 'PUT', cookie, body: { email: 'orbit@elsewhere.example', current: 'orbit pass phrase' } });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.body.user.recoveryEmail, moved.body.user.recoveryEmailConfirmed], ['orbit@elsewhere.example', false]);
  // The old address is told, without being shown all of the new one.
  const notice = lastTo('orbit@example.com').email;
  assert.match(notice.subject, /recovery email was changed/);
  assert.match(notice.text, /o•••@elsewhere\.example/);
  assert.ok(lastTo('orbit@elsewhere.example', 'confirm-email').token);
  assert.equal((await call('/auth/reset', { body: { token: live, password: 'a new pass phrase' } })).status, 400);
  assert.equal((await logIn('orbit', 'orbit pass phrase')).status, 200);
});

test('changing the recovery email takes the password; removing it works too', async () => {
  const cookie = await confirmedAccount('keeper', 'keeper pass phrase', 'keeper@example.com');
  const put = (body) => call('/auth/recovery-email', { method: 'PUT', cookie, body });
  const before = sent.length;
  assert.equal((await put({ email: 'thief@example.com', current: 'wrong guess here' })).status, 403);
  assert.equal((await put({ email: 'not an email', current: 'keeper pass phrase' })).status, 400);
  // Saving the confirmed address again changes nothing and sends nothing.
  const same = await put({ email: 'Keeper@example.com', current: 'keeper pass phrase' });
  assert.deepEqual([same.status, same.body.user.recoveryEmailConfirmed], [200, true]);
  assert.equal(sent.length, before);

  const removed = await put({ email: '', current: 'keeper pass phrase' });
  assert.deepEqual([removed.status, removed.body.user.recoveryEmail], [200, null]);
  assert.match(lastTo('keeper@example.com').email.text, /was just removed/);
});

test('a password change tells the confirmed recovery email, and kills reset links', async () => {
  const cookie = await confirmedAccount('notified', 'first secret phrase', 'notified@example.com');
  await forgot('notified');
  const token = lastTo('notified@example.com', 'reset-password').token;
  const changed = await call('/auth/password', { method: 'PUT', cookie, body: { current: 'first secret phrase', password: 'second secret phrase' } });
  assert.equal(changed.status, 200);
  assert.match(lastTo('notified@example.com').email.subject, /password was changed/);
  assert.equal((await call('/auth/reset', { body: { token, password: 'third secret phrase' } })).status, 400);
});

test('reset emails about one account are limited', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await forgot('flooded_inbox')).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("without a mailer there's no recovery email", async () => {
  const bare = createApp(db).listen(0);
  const at = `http://localhost:${bare.address().port}/api`;
  const post = (path, body) => fetch(`${at}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(`${at}/config`)).json()).recoveryEmail, false);
    assert.equal((await post('/auth/signup', { username: 'no_mail', password: 'a pass phrase', email: 'x@example.com' })).status, 503);
    assert.equal((await post('/auth/forgot', { username: 'nova' })).status, 503);
  } finally {
    bare.close();
  }
});

test('the email copy', () => {
  assert.match(emails.recoveryChanged({ username: 'ada', email: 'ada.lovelace@example.com' }).text, /changed to a•••@example\.com/);
  assert.match(emails.reset({ username: 'ada', link: 'https://x/reset-password#t' }).text, /https:\/\/x\/reset-password#t/);
});
