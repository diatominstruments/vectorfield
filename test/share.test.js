import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleSong } from './fixtures.js';
import { embedSize } from '../shared/embed.js';

process.env.PGLITE_DIR = 'memory://';
process.env.DEV_LOGIN = '1';
delete process.env.DATABASE_URL;

const { connect } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

let db, server, origin;

before(async () => {
  db = await connect(null);
  server = createApp(db).listen(0);
  origin = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

async function sessionCookie(name) {
  const res = await fetch(`${origin}/api/auth/dev`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

async function signIn(name) {
  const cookie = await sessionCookie(name);
  return (path, { method = 'GET', body } = {}) => fetch(`${origin}/api${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

/** A song by `name`, saved with something in it; published unless told otherwise. */
async function songBy(name, { title = 'Night <Bus>', publish = true } = {}) {
  const api = await signIn(name);
  const { id, revision } = (await api('/songs', { method: 'POST', body: {} })).body.song;
  await api(`/songs/${id}`, { method: 'PUT', body: { title, revision, doc: sampleSong() } });
  if (publish) await api(`/songs/${id}/publish`, { method: 'PUT', body: { published: true, description: 'Late & low "dub"' } });
  return { api, id };
}

const page = (path) => fetch(origin + path).then(async (r) => ({ status: r.status, headers: r.headers, text: await r.text() }));
const metaContent = (html, key) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];

test("a published song's page carries its link preview", async () => {
  const { id } = await songBy('Ada');
  const { status, text } = await page(`/s/${id}`);
  assert.equal(status, 200);
  assert.match(text, /<title>Night &lt;Bus&gt; by ada · Vectorfield<\/title>/);
  assert.equal(text.match(/<title>/g).length, 1);   // replaces the page's own title
  assert.equal(metaContent(text, 'og:title'), 'Night &lt;Bus&gt; by ada');
  assert.equal(metaContent(text, 'og:description'), 'Late &amp; low &quot;dub&quot;');
  assert.equal(metaContent(text, 'og:url'), `${origin}/s/${id}`);
  assert.equal(metaContent(text, 'og:image'), `${origin}/covers/${id}`);
  assert.equal(metaContent(text, 'og:video'), `${origin}/embed/${id}`);
  assert.match(text, /<link rel="alternate" type="application\/json\+oembed"/);
  assert.match(text, /<script type="module" src="\/build\/app.js">/);   // still the app
});

test('unpublished and unknown songs get the plain page, and no cover', async () => {
  const { id } = await songBy('Bob', { publish: false });
  for (const path of [`/s/${id}`, '/s/00000000-0000-0000-0000-000000000000', '/s/nope']) {
    const { status, text } = await page(path);
    assert.equal(status, 200);
    assert.equal(metaContent(text, 'og:title'), undefined, path);
  }
  assert.equal((await page(`/covers/${id}`)).status, 404);
});

test('only the embed player may be framed by other sites', async () => {
  const { id } = await songBy('Cyd');
  const csp = async (path) => (await page(path)).headers.get('content-security-policy');
  assert.match(await csp(`/embed/${id}`), /frame-ancestors \*/);
  assert.match(await csp(`/s/${id}`), /frame-ancestors 'self'/);
  assert.match(await csp('/'), /frame-ancestors 'self'/);
  assert.equal(metaContent((await page(`/embed/${id}`)).text, 'robots'), 'noindex');
});

test('oEmbed gives the player for a song link', async () => {
  const { id } = await songBy('Dina');
  const url = encodeURIComponent(`https://example.com/s/${id}`);
  const res = await fetch(`${origin}/oembed?url=${url}&maxwidth=400`);
  assert.equal(res.status, 200);
  const o = await res.json();
  assert.equal(o.type, 'rich');
  assert.equal(o.author_name, 'dina');
  assert.deepEqual([o.width, o.height], [400, 225]);
  assert.match(o.html, new RegExp(`<iframe src="${origin}/embed/${id}" width="400" height="225"`));
  assert.match(o.html, /title="Night &lt;Bus&gt; by dina on Vectorfield"/);

  assert.equal((await fetch(`${origin}/oembed?url=nonsense`)).status, 404);
  assert.equal((await fetch(`${origin}/oembed?url=${url}&format=xml`)).status, 501);
});

test('embed sizes stay 16:9 within the bounds asked for', () => {
  assert.deepEqual(embedSize(), { width: 640, height: 360 });
  assert.deepEqual(embedSize(1000), { width: 640, height: 360 });
  assert.deepEqual(embedSize(0, 180), { width: 320, height: 180 });
  assert.deepEqual(embedSize(50), { width: 240, height: 135 });
});

test('the picture is picked with publishing, and shows in feeds and previews', async () => {
  const { api, id } = await songBy('Evie', { publish: false });
  const other = await signIn('Mallory');
  const cover = (path, who) => fetch(`${origin}${path}`, { headers: who ? { cookie: who } : {} });

  // Before publishing only the owner sees it: drawn from the song, at the picture's size.
  assert.equal((await cover(`/covers/${id}`)).status, 404);
  const ownerCookie = await sessionCookie('Evie');
  const drawn = await cover(`/covers/${id}`, ownerCookie);
  assert.equal(drawn.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await drawn.arrayBuffer());
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [480, 360]);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const picture = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const publish = (who, body) => who(`/songs/${id}/publish`, { method: 'PUT', body: { published: true, ...body } });

  // Not a JPEG, or too big: refused, and nothing else changes either.
  for (const bad of ['data:image/png;base64,iVBORw0K', `data:image/jpeg;base64,${Buffer.from('<svg>').toString('base64')}`,
    `data:image/jpeg;base64,${Buffer.concat([jpeg, Buffer.alloc(70 * 1024)]).toString('base64')}`]) {
    assert.equal((await publish(api, { cover: bad })).status, 400);
  }
  assert.equal((await cover(`/covers/${id}`)).status, 404);
  assert.equal((await publish(other, { cover: picture })).status, 404);

  const published = await publish(api, { cover: picture });
  assert.equal(published.status, 200);
  const { coverAt } = published.body.song;
  assert.ok(coverAt);

  const served = await cover(`/covers/${id}`);
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), jpeg);

  // The feed, the song and the owner's editor all know which picture it is.
  const feed = await (await fetch(`${origin}/api/public/feed`)).json();
  assert.equal(feed.songs.find((s) => s.id === id).coverAt, coverAt);
  assert.equal((await api(`/songs/${id}`)).body.song.coverAt, coverAt);

  // Saving other details keeps the picture; the preview's URL is versioned by it.
  const retag = await api(`/songs/${id}/publish`, { method: 'PUT', body: { tags: ['techno'] } });
  assert.equal(retag.body.song.coverAt, coverAt);
  const { text } = await page(`/s/${id}`);
  assert.equal(metaContent(text, 'og:image'), `${origin}/covers/${id}?v=${Date.parse(coverAt)}`);
  assert.equal(metaContent(text, 'og:image:width'), '480');
});
