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
