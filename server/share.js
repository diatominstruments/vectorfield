import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { config } from './config.js';
import { sessionUser } from './auth.js';
import { UUID } from './songs.js';
import { SONG_WITH_OWNER } from './public.js';
import { drawnCover } from './cover.js';
import { COVER_SIZE, EMBED_SIZE, coverPath, embedCode, embedPath, embedSize, escapeHtml as esc, songPath } from '../shared/embed.js';

const INDEX = new URL('../public/index.html', import.meta.url);

// How many drawn covers to keep. Each is about 4 KB.
const DRAWN_KEPT = 1000;

/**
 * What a published song looks like from outside the app. Link previews
 * (Facebook, Reddit, Discord, iMessage…) don't run the app, they read the
 * page's <head>, so /s/:id and /embed/:id get the one page with the song's
 * title, description, cover and player link written into it. Alongside:
 * the cover image itself, and an oEmbed endpoint for sites that turn a
 * pasted link into an embedded player.
 */
export function shareRouter(db) {
  const router = Router();

  let indexHtml = null;
  const page = async () => {
    // Re-read in development, so editing index.html doesn't need a restart.
    if (indexHtml && config.production) return indexHtml;
    return (indexHtml = await readFile(INDEX, 'utf8'));
  };

  const published = async (id) => {
    if (!UUID.test(id)) return null;
    const { rows } = await db.query(`${SONG_WITH_OWNER} where s.id = $1 and s.published_at is not null`, [id]);
    return rows[0] ?? null;
  };

  // Drawn covers, by song id, with the revision each was drawn from. Drawing
  // one is a few milliseconds of CPU that nothing else can run during, and a
  // feed page asks for twenty, but a drawing only changes when its song is
  // saved. The least recently used go first.
  const drawn = new Map();
  const drawnCoverFor = async (id, revision) => {
    let entry = drawn.get(id);
    drawn.delete(id);   // set again below, as the most recently used
    if (entry?.revision !== revision) {
      const { rows } = await db.query('select doc, revision from songs where id = $1', [id]);
      if (!rows[0]) return null;
      entry = { revision: rows[0].revision, png: drawnCover(rows[0].doc) };
    }
    drawn.set(id, entry);
    if (drawn.size > DRAWN_KEPT) drawn.delete(drawn.keys().next().value);
    return entry.png;
  };

  const sendPage = async (req, res, song, { embed = false } = {}) => {
    let body = await page();
    if (song) {
      body = body
        .replace(/<title>[^<]*<\/title>/, '')
        .replace(/<meta name="description"[^>]*>/, '')
        .replace('</head>', `${songHead(origin(req), song, { embed })}\n</head>`);
    }
    res.type('html').send(body);
  };

  router.get('/s/:id', async (req, res) => {
    await sendPage(req, res, await published(req.params.id));
  });

  // The player that goes in an iframe on other sites, so unlike every
  // other page here, any site may frame it.
  router.get('/embed/:id', async (req, res) => {
    res.setHeader('Content-Security-Policy', res.getHeader('Content-Security-Policy').replace(/frame-ancestors [^;]+/, 'frame-ancestors *'));
    await sendPage(req, res, await published(req.params.id), { embed: true });
  });

  // A song's picture: the frame the owner chose, or one drawn from the
  // song. Anyone may see a published song's; an unpublished song's only
  // its owner, picking one in the Publish tab, so only then does it matter
  // who's asking. The song's document is read only to draw one.
  router.get('/covers/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.sendStatus(404);
    const { rows } = await db.query(
      `select s.revision, s.owner_id, s.published_at, c.image from songs s left join song_covers c on c.song_id = s.id
       where s.id = $1`,
      [req.params.id],
    );
    const row = rows[0];
    if (!row) return res.sendStatus(404);
    if (!row.published_at) {
      const user = await sessionUser(db, req);
      if (!user || String(user.id) !== String(row.owner_id)) return res.sendStatus(404);
    }
    res.setHeader('Cache-Control', row.published_at ? 'public, max-age=300' : 'private, no-cache');
    if (row.image) return res.type('jpeg').send(Buffer.from(row.image));
    const png = await drawnCoverFor(req.params.id, row.revision);
    if (!png) return res.sendStatus(404);
    res.type('png').send(png);
  });

  // oEmbed (https://oembed.com): given a song's link, the iframe to embed it.
  router.get('/oembed', async (req, res) => {
    if (req.query.format && req.query.format !== 'json') return res.sendStatus(501);
    let id;
    try {
      id = /^\/(?:s|embed)\/([^/]+)$/.exec(new URL(String(req.query.url)).pathname)?.[1];
    } catch {
      return res.sendStatus(404);
    }
    const song = id && await published(id);
    if (!song) return res.sendStatus(404);

    const base = origin(req);
    const { width, height } = embedSize(Number(req.query.maxwidth), Number(req.query.maxheight));
    res.json({
      version: '1.0',
      type: 'rich',
      provider_name: 'Vectorfield',
      provider_url: base,
      title: song.title,
      author_name: song.owner_username,
      author_url: `${base}/u/${song.owner_username}`,
      html: embedCode({ origin: base, id: song.id, title: song.title, owner: song.owner_username, width, height }),
      width,
      height,
      thumbnail_url: coverUrl(base, song),
      thumbnail_width: COVER_SIZE.width,
      thumbnail_height: COVER_SIZE.height,
      cache_age: 3600,
    });
  });

  return router;
}

const origin = (req) => config.publicUrl ?? `${req.protocol}://${req.get('host')}`;

const coverUrl = (base, song) => base + coverPath(song.id, song.cover_at);

/**
 * The <head> tags for a song: Open Graph for Facebook, Reddit and most
 * others, a Twitter card for X, and oEmbed discovery. og:video points at
 * the embed player, for the sites that will play one inline.
 */
function songHead(base, song, { embed }) {
  const url = base + songPath(song.id);
  const player = base + embedPath(song.id);
  const title = `${song.title} by ${song.owner_username}`;
  const description = song.description.trim()
    || `A song by ${song.owner_username}, with visuals. Press play: it's performed live in your browser.`;
  const image = coverUrl(base, song);
  const oembed = `${base}/oembed?url=${encodeURIComponent(url)}&format=json`;
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${esc(value)}">`;
  return [
    `<title>${esc(title)} · Vectorfield</title>`,
    meta('name', 'description', description),
    `<link rel="canonical" href="${esc(url)}">`,
    `<link rel="alternate" type="application/json+oembed" href="${esc(oembed)}" title="${esc(title)}">`,
    embed && meta('name', 'robots', 'noindex'),
    meta('property', 'og:site_name', 'Vectorfield'),
    meta('property', 'og:type', 'video.other'),
    meta('property', 'og:url', url),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', COVER_SIZE.width),
    meta('property', 'og:image:height', COVER_SIZE.height),
    meta('property', 'og:image:alt', `Visuals from ${song.title}`),
    meta('property', 'og:video', player),
    meta('property', 'og:video:secure_url', player),
    meta('property', 'og:video:type', 'text/html'),
    meta('property', 'og:video:width', EMBED_SIZE.width),
    meta('property', 'og:video:height', EMBED_SIZE.height),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
  ].filter(Boolean).join('\n');
}
