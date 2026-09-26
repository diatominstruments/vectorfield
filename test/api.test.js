import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.PGLITE_DIR = 'memory://';
process.env.DEV_LOGIN = '1';
delete process.env.DATABASE_URL;

const { connect } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

let db, server, base;

before(async () => {
  db = await connect(null);
  server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await db.close();
});

async function signIn(name) {
  const res = await fetch(`${base}/auth/dev`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (path, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('songs require a session', async () => {
  const res = await fetch(`${base}/songs`);
  assert.equal(res.status, 401);
});

test('create, list, load, save, delete', async () => {
  const api = await signIn('Ada');
  const created = await api('/songs', { method: 'POST', body: { title: 'First' } });
  assert.equal(created.status, 201);
  const { id, revision, doc } = created.body.song;
  assert.equal(doc.tracks.length, 3);

  assert.deepEqual((await api('/songs')).body.songs.map((s) => s.title), ['First']);

  doc.bpm = 999;   // clamped on save
  const saved = await api(`/songs/${id}`, { method: 'PUT', body: { title: 'Renamed', revision, doc } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.song.revision, revision + 1);

  const loaded = (await api(`/songs/${id}`)).body.song;
  assert.equal(loaded.title, 'Renamed');
  assert.equal(loaded.doc.bpm, 300);

  assert.equal((await api(`/songs/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/songs/${id}`)).status, 404);
});

test('a stale revision is rejected, not merged', async () => {
  const api = await signIn('Ada');
  const { id, revision, doc } = (await api('/songs', { method: 'POST', body: {} })).body.song;
  await api(`/songs/${id}`, { method: 'PUT', body: { revision, doc } });
  const stale = await api(`/songs/${id}`, { method: 'PUT', body: { revision, doc } });
  assert.equal(stale.status, 409);
});

test("users can't see or change each other's songs", async () => {
  const ada = await signIn('Ada');
  const bob = await signIn('Bob');
  const { id, revision, doc } = (await ada('/songs', { method: 'POST', body: {} })).body.song;
  assert.equal((await bob(`/songs/${id}`)).status, 404);
  assert.equal((await bob(`/songs/${id}`, { method: 'PUT', body: { revision, doc } })).status, 404);
  assert.equal((await bob(`/songs/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await ada(`/songs/${id}`)).status, 200);
});

test('malformed songs are refused', async () => {
  const api = await signIn('Ada');
  const { id, revision, doc } = (await api('/songs', { method: 'POST', body: {} })).body.song;
  const bad = structuredClone(doc);
  bad.tracks[0].instrument.id = 'not-a-synth';
  const res = await api(`/songs/${id}`, { method: 'PUT', body: { revision, doc: bad } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown instrument/);
});

test('non-JSON writes are refused (CSRF guard)', async () => {
  const res = await fetch(`${base}/auth/dev`, { method: 'POST', body: 'name=x' });
  assert.equal(res.status, 415);
});

test('the dev sign-in names its user; the username can be changed', async () => {
  const api = await signIn('Grace Hopper');
  const me = (await api('/auth/me')).body.user;
  assert.equal(me.username, 'grace_hopper');
  assert.equal('name' in me, false);

  const bad = await api('/auth/me', { method: 'PUT', body: { username: 'Grace!' } });
  assert.equal(bad.status, 400);

  const ok = await api('/auth/me', { method: 'PUT', body: { username: 'GRACE', bio: '  COBOL  ', interests: ['techno', 'nope', 'techno', 'dub'] } });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.user.username, ok.body.user.bio, ok.body.user.interests], ['grace', 'COBOL', ['techno', 'dub']]);

  const other = await signIn('Someone Else');
  assert.equal((await other('/auth/me', { method: 'PUT', body: { username: 'grace' } })).status, 409);

  // Signing in again keeps the chosen username.
  const again = await signIn('Grace Hopper');
  assert.equal((await again('/auth/me')).body.user.username, 'grace');
});

test('an account without a username can only choose one', async () => {
  const api = await signIn('');   // a blank dev name: nameless, like a fresh Google sign-in

  assert.equal((await api('/auth/me')).body.user.username, null);
  assert.equal((await api('/songs')).status, 403);
  assert.equal((await api('/songs', { method: 'POST', body: {} })).status, 403);
  assert.equal((await api('/auth/me', { method: 'PUT', body: { username: 'ab' } })).status, 400);

  const chosen = await api('/auth/me', { method: 'PUT', body: { username: 'newbie' } });
  assert.equal(chosen.body.user.username, 'newbie');
  assert.equal((await api('/songs')).status, 200);
  assert.equal((await api('/public/users/newbie')).status, 200);
});

test('publishing makes a song public; unpublishing hides it again', async () => {
  const ada = await signIn('Ada');
  const { id } = (await ada('/songs', { method: 'POST', body: { title: 'Public one' } })).body.song;
  const anon = (path) => fetch(`${base}${path}`).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await anon(`/public/songs/${id}`)).status, 404);
  // The owner can preview it unpublished.
  const preview = await ada(`/public/songs/${id}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.song.mine, true);

  const pub = await ada(`/songs/${id}/publish`, { method: 'PUT', body: { published: true, tags: ['acid-house', 'bogus'], description: 'squelch' } });
  assert.equal(pub.status, 200);
  assert.ok(pub.body.song.publishedAt);
  assert.deepEqual(pub.body.song.tags, ['acid-house']);

  const shown = await anon(`/public/songs/${id}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.body.song.title, 'Public one');
  assert.equal(shown.body.song.owner.username, 'ada');
  assert.equal(shown.body.song.doc.tracks.length, 3);
  assert.equal('email' in shown.body.song.owner, false);

  // Tags can change without touching the published state or date.
  const retag = await ada(`/songs/${id}/publish`, { method: 'PUT', body: { tags: ['acid-house', 'techno'] } });
  assert.equal(retag.body.song.publishedAt, pub.body.song.publishedAt);

  const profile = await anon('/public/users/ada');
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body.songs.map((s) => s.id), [id]);
  assert.equal('email' in profile.body.user, false);

  await ada(`/songs/${id}/publish`, { method: 'PUT', body: { published: false } });
  assert.equal((await anon(`/public/songs/${id}`)).status, 404);
  assert.deepEqual((await anon('/public/users/ada')).body.songs, []);
  assert.equal((await anon('/public/users/nobody_here')).status, 404);
});

test('the feed: new shows everything published; for-you follows interests', async () => {
  const ada = await signIn('Ada');
  const bob = await signIn('Bob');
  const make = async (api, title, tags) => {
    const { id } = (await api('/songs', { method: 'POST', body: { title } })).body.song;
    await api(`/songs/${id}/publish`, { method: 'PUT', body: { published: true, tags } });
    return id;
  };
  const house = await make(ada, 'House tune', ['deep-house']);
  const dnb = await make(bob, 'Rollers', ['liquid-dnb']);
  const untagged = await make(bob, 'Sketch', []);

  const fresh = (await bob('/public/feed?tab=new')).body;
  const ids = fresh.songs.map((s) => s.id);
  assert.deepEqual(ids.slice(0, 3), [untagged, dnb, house]);   // newest first
  assert.equal(fresh.nextBefore, null);

  // Signed out: new is fine, for-you needs a session.
  assert.equal((await fetch(`${base}/public/feed`)).status, 200);
  assert.equal((await fetch(`${base}/public/feed?tab=for-you`)).status, 401);

  // No interests yet: an empty page that says so.
  assert.equal((await bob('/public/feed?tab=for-you')).body.noInterests, true);

  // Liking the family finds the subgenre.
  await bob('/auth/me', { method: 'PUT', body: { interests: ['house'] } });
  assert.deepEqual((await bob('/public/feed?tab=for-you')).body.songs.map((s) => s.id), [house]);

  // Liking a subgenre finds songs tagged with just its family, but not its siblings.
  await make(ada, 'Broad', ['dnb']);
  await bob('/auth/me', { method: 'PUT', body: { interests: ['neurofunk'] } });
  assert.deepEqual((await bob('/public/feed?tab=for-you')).body.songs.map((s) => s.title), ['Broad']);
});

test('the feed pages by publish time', async () => {
  const api = await signIn('Prolific');
  for (let i = 0; i < 22; i++) {
    const { id } = (await api('/songs', { method: 'POST', body: { title: `Song ${i}` } })).body.song;
    await api(`/songs/${id}/publish`, { method: 'PUT', body: { published: true } });
  }
  const first = (await api('/public/feed')).body;
  assert.equal(first.songs.length, 20);
  assert.ok(first.nextBefore);
  const second = (await api(`/public/feed?before=${encodeURIComponent(first.nextBefore)}`)).body;
  assert.ok(second.songs.length >= 2);
  assert.ok(second.songs.every((s) => new Date(s.publishedAt) < new Date(first.nextBefore)));
});
