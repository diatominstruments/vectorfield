import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.PGLITE_DIR = 'memory://';
process.env.DEV_LOGIN = '1';
// So requests can come from different addresses, by X-Forwarded-For.
process.env.TRUST_PROXY = '1';
delete process.env.DATABASE_URL;

const { hashPassword, verifyPassword, needsRehash, pwnedCount } = await import('../server/passwords.js');
const { passwordProblem } = await import('../shared/users.js');
const { connect } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

// Stands in for Have I Been Pwned: this one password is "breached".
const BREACHED = 'password1234';
const pwned = async (p) => (p === BREACHED ? 2_000_000 : 0);

let db, server, base;

before(async () => {
  db = await connect(null);
  server = createApp(db, { pwned }).listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await db.close();
});

/**
 * A request as a browser holding `cookie` would make it, from the address
 * `ip` if given; the cookies the reply sets, if any, come back together.
 */
async function call(path, { method = 'GET', body, cookie, ip } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, body: JSON.parse(text), text, cookie: cookies || undefined };
}
// `from`: the `cookie` and `ip` to send them with.
const signUp = (username, password, extra = {}, from = {}) => call('/auth/signup', { method: 'POST', body: { username, password, ...extra }, ...from });
const logIn = (username, password, from = {}) => call('/auth/login', { method: 'POST', body: { username, password }, ...from });
const me = async (cookie) => (await call('/auth/me', { cookie })).body.user;

test('passwords hash with a fresh salt each time, and verify', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.match(a, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('correct horse batterz', a), false);
  assert.equal(await verifyPassword('correct horse battery', 'not a hash'), false);
  // The same text, composed differently.
  assert.equal(await verifyPassword('café au lait', await hashPassword('café au lait')), true);
});

test('hashes made with weaker settings are due a rehash', async () => {
  assert.equal(needsRehash(await hashPassword('correct horse battery')), false);
  assert.equal(needsRehash(await hashPassword('correct horse battery', { memory: 19456, passes: 2, parallelism: 1 })), true);
});

test('the breach check sends only a hash prefix', async () => {
  const sha1 = createHash('sha1').update('hunter2hunter2').digest('hex').toUpperCase();
  let asked;
  const fetch = async (url, init) => {
    asked = { url, padded: init.headers['Add-Padding'] };
    return new Response(`0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${sha1.slice(5)}:42\r\n`);
  };
  assert.equal(await pwnedCount('hunter2hunter2', { fetch }), 42);
  assert.equal(asked.url, `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
  assert.equal(asked.padded, 'true');

  const padding = async () => new Response(`${sha1.slice(5)}:0\r\n`);
  assert.equal(await pwnedCount('hunter2hunter2', { fetch: padding }), 0);
  // Unreachable or failing, it doesn't say no.
  assert.equal(await pwnedCount('hunter2hunter2', { fetch: async () => { throw new Error('offline'); } }), null);
  assert.equal(await pwnedCount('hunter2hunter2', { fetch: async () => new Response('', { status: 503 }) }), null);
});

test('password rules: long enough, and not just the username', () => {
  assert.equal(passwordProblem(''), 'Pick a password');
  assert.match(passwordProblem('short'), /At least 10/);
  assert.match(passwordProblem('x'.repeat(257)), /At most 256/);
  assert.match(passwordProblem('grace_hopper1', 'grace_hopper'), /Too close/);
  assert.match(passwordProblem('VectorField99'), /Too close/);
  assert.equal(passwordProblem('a long passphrase'), null);
  assert.equal(passwordProblem('my canadian holiday', 'ada'), null);   // containing it isn't enough
});

test('sign up with a username and password, then sign in with them', async () => {
  const up = await signUp('Lovelace', 'analytical engine', { theme: 'forest' });
  assert.equal(up.status, 200);
  assert.ok(up.cookie);
  assert.deepEqual([up.body.user.username, up.body.user.hasPassword, up.body.user.theme], ['lovelace', true, 'forest']);
  assert.deepEqual((await call('/notifications', { cookie: up.cookie })).body.notifications.map((n) => n.kind), ['welcome']);

  const back = await logIn('@LoveLace', 'analytical engine');
  assert.equal(back.status, 200);
  assert.ok(back.cookie);
  assert.notEqual(back.cookie, up.cookie);
  assert.equal((await me(back.cookie)).username, 'lovelace');

  const wrong = await logIn('lovelace', 'analytical enginf');
  const nobody = await logIn('nobody_here', 'analytical engine');
  assert.deepEqual([wrong.status, wrong.body.error, wrong.cookie], [401, 'Wrong username or password', undefined]);
  assert.deepEqual([nobody.status, nobody.body.error], [401, 'Wrong username or password']);
});

test('only a hash is stored, and it never leaves the server', async () => {
  const { cookie, text } = await signUp('hashed_user', 'secret sauce 42');
  const { rows } = await db.query("select p.hash from passwords p join users u on u.id = p.user_id where u.username = 'hashed_user'");
  assert.match(rows[0].hash, /^\$argon2id\$/);
  assert.ok(!rows[0].hash.includes('secret sauce'));
  for (const reply of [text, (await call('/auth/me', { cookie })).text, (await logIn('hashed_user', 'secret sauce 42')).text]) {
    assert.ok(!reply.includes('argon2') && !reply.includes('secret sauce'), reply);
  }
});

test('sign-up turns away bad usernames, weak or breached passwords, and taken names', async () => {
  assert.equal((await signUp('Not OK!', 'a fine passphrase')).status, 400);
  assert.equal((await signUp('turing', 'tooshort')).status, 400);
  assert.equal((await signUp('turing', 'turing12345')).status, 400);
  const breached = await signUp('turing', BREACHED);
  assert.equal(breached.status, 400);
  assert.match(breached.body.error, /breach/);
  assert.equal((await signUp('lovelace', 'a fine passphrase')).status, 409);
  assert.equal((await logIn('turing', 'a fine passphrase')).status, 401);   // nothing was made
});

test('a Google or Apple account has no password', async () => {
  const dev = await call('/auth/dev', { method: 'POST', body: { name: 'Hopper' } });
  assert.equal((await me(dev.cookie)).hasPassword, false);
  const change = await call('/auth/password', { method: 'PUT', cookie: dev.cookie, body: { current: '', password: 'a fine passphrase' } });
  assert.equal(change.status, 400);
  assert.equal((await logIn('hopper', '')).status, 400);
  assert.equal((await logIn('hopper', 'anything at all')).status, 401);
});

test('wrong guesses at one account are cut off, even before the right one', async () => {
  await signUp('guarded', 'right password here');
  for (let i = 0; i < 5; i++) assert.equal((await logIn('guarded', `wrong guess ${i}`)).status, 401);
  const blocked = await logIn('guarded', 'right password here');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many/);
  // Other accounts aren't affected.
  assert.equal((await logIn('lovelace', 'analytical engine')).status, 200);
});

test('a right password forgives earlier misses', async () => {
  await signUp('forgetful', 'remembered at last');
  for (let i = 0; i < 4; i++) await logIn('forgetful', `not it ${i}`);
  assert.equal((await logIn('forgetful', 'remembered at last')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await logIn('forgetful', `not it again ${i}`)).status, 401);
});

test('wrong guesses sent all at once are held to the same limit', async () => {
  await signUp('rushed', 'right password here');
  const from = { ip: '203.0.113.1' };
  const statuses = (await Promise.all(Array.from({ length: 20 }, (_, i) => logIn('rushed', `wrong guess ${i}`, from)))).map((r) => r.status);
  assert.ok(statuses.every((s) => s === 401 || s === 429), `${statuses}`);
  assert.ok(statuses.filter((s) => s === 401).length <= 5, `more than 5 guesses were checked: ${statuses}`);
});

test('sign-ups sent all at once are held to the same limit', async () => {
  const from = { ip: '203.0.113.2' };
  const statuses = (await Promise.all(Array.from({ length: 15 }, (_, i) => signUp(`rush_${i}`, 'bulk password here', {}, from)))).map((r) => r.status);
  assert.ok(statuses.every((s) => s === 200 || s === 429), `${statuses}`);
  assert.ok(statuses.filter((s) => s === 200).length <= 10, `more than 10 accounts were made: ${statuses}`);
});

/** Someone else's wrong guesses at `username`: five from each of six addresses, enough to use up the account's tries. */
async function besiege(username, firstAddress) {
  for (let a = 0; a < 6; a++) {
    const from = { ip: `192.0.2.${firstAddress + a}` };
    for (let i = 0; i < 5; i++) assert.equal((await logIn(username, `wrong guess ${i}`, from)).status, 401);
  }
}

test("guessing at an account can't lock its owner out of a browser they've signed in from", async () => {
  const home = { ip: '198.51.100.1' };
  const browser = (await signUp('besieged', 'right password here', {}, home)).cookie;
  await besiege('besieged', 10);

  // A browser that hasn't signed in to it before can't now, even with the right password…
  assert.equal((await logIn('besieged', 'right password here', { ip: '198.51.100.2' })).status, 429);
  // …but the owner's can, from home or even from an address the guesses came from.
  assert.equal((await logIn('besieged', 'right password here', { ...home, cookie: browser })).status, 200);
  assert.equal((await logIn('besieged', 'right password here', { ip: '192.0.2.10', cookie: browser })).status, 200);
  assert.equal((await logIn('besieged', 'right password here', { ip: '198.51.100.2' })).status, 429);   // that forgave none of theirs

  // It has a limit of its own.
  for (let i = 0; i < 10; i++) assert.equal((await logIn('besieged', `typo ${i}`, { ...home, cookie: browser })).status, 401);
  assert.equal((await logIn('besieged', 'right password here', { ...home, cookie: browser })).status, 429);
});

test('changing the password forgets the browsers that signed in with the old one', async () => {
  const mine = (await signUp('moving_on', 'old password here')).cookie;
  const theirs = (await logIn('moving_on', 'old password here', { ip: '198.51.100.3' })).cookie;   // someone else who knew it
  const change = await call('/auth/password', { method: 'PUT', cookie: mine, body: { current: 'old password here', password: 'new password here' } });
  assert.equal(change.status, 200);

  await besiege('moving_on', 20);
  assert.equal((await logIn('moving_on', 'new password here', { ip: '198.51.100.3', cookie: theirs })).status, 429);
  assert.equal((await logIn('moving_on', 'new password here', { cookie: mine })).status, 200);
});

test('changing the password needs the current one and signs out other sessions', async () => {
  const here = (await signUp('changer', 'first password')).cookie;
  const elsewhere = (await logIn('changer', 'first password')).cookie;
  const change = (current, password) => call('/auth/password', { method: 'PUT', cookie: here, body: { current, password } });

  assert.equal((await change('not my password', 'second password')).status, 403);
  assert.equal((await change('first password', 'short')).status, 400);
  assert.equal((await change('first password', BREACHED)).status, 400);
  assert.equal((await me(elsewhere)).username, 'changer');   // nothing changed yet

  assert.equal((await change('first password', 'second password')).status, 200);
  assert.equal(await me(elsewhere), null);
  assert.equal((await me(here)).username, 'changer');
  assert.equal((await logIn('changer', 'first password')).status, 401);
  assert.equal((await logIn('changer', 'second password')).status, 200);
  // Renamed, the account signs in by its new username.
  assert.equal((await call('/auth/me', { method: 'PUT', cookie: here, body: { username: 'renamed' } })).status, 200);
  assert.equal((await logIn('renamed', 'second password')).status, 200);
});

test('sign-ups from one address are limited', async () => {
  let status;
  for (let i = 0; i < 12 && status !== 429; i++) status = (await signUp(`bulk_${i}`, 'bulk password here')).status;
  assert.equal(status, 429);
});
