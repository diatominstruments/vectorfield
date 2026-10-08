import { Router } from 'express';
import { defaultSong, normalizeSong, SongError, LIMITS } from '../shared/song.js';
import { TAG_LIMITS, normalizeTags } from '../shared/genres.js';
import { requireProfile } from './auth.js';
import { parseCover } from './cover.js';
import { notifyFollowers, unnotify } from './notifications.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DESCRIPTION_LENGTH = 500;

function title(x) {
  const t = typeof x === 'string' ? x.trim().slice(0, LIMITS.nameLength) : '';
  return t || 'Untitled song';
}

const description = (x) => (typeof x === 'string' ? x.trim().slice(0, DESCRIPTION_LENGTH) : '');

/** A song as lists show it: everything but the document. */
export const summary = (r) => ({
  id: r.id, title: r.title, revision: r.revision, updatedAt: r.updated_at,
  description: r.description ?? '', tags: r.tags ?? [], publishedAt: r.published_at ?? null,
  coverAt: r.cover_at ?? null,
});

/**
 * The owner's side of songs: create, edit, publish, delete. Every query is
 * scoped by owner_id, so a guessed id finds nothing. Reading a published
 * song is public.js's job.
 */
export function songsRouter(db) {
  const router = Router();
  router.use(requireProfile);

  router.param('id', (req, res, next, id) => {
    if (!UUID.test(id)) return res.status(404).json({ error: 'Song not found' });
    next();
  });

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `select id, title, revision, updated_at, description, tags, published_at
       from songs where owner_id = $1 order by updated_at desc`,
      [req.user.id],
    );
    res.json({ songs: rows.map(summary) });
  });

  router.post('/', async (req, res) => {
    const { rows } = await db.query(
      'insert into songs (owner_id, title, doc) values ($1, $2, $3) returning *',
      [req.user.id, title(req.body?.title), JSON.stringify(defaultSong())],
    );
    res.status(201).json({ song: { ...summary(rows[0]), doc: rows[0].doc } });
  });

  router.get('/:id', async (req, res) => {
    const { rows } = await db.query(
      `select s.*, c.updated_at as cover_at from songs s left join song_covers c on c.song_id = s.id
       where s.id = $1 and s.owner_id = $2`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Song not found' });
    res.json({ song: { ...summary(rows[0]), doc: rows[0].doc } });
  });

  // Save. The body names the revision the edit was based on; if the stored
  // song has moved on since (another tab saved), nothing is written and the
  // client is told to reload rather than clobbering the other edit.
  router.put('/:id', async (req, res) => {
    const { revision } = req.body ?? {};
    if (!Number.isInteger(revision)) return res.status(400).json({ error: 'revision is required' });

    let doc;
    try {
      doc = normalizeSong(req.body.doc);
    } catch (err) {
      if (err instanceof SongError) return res.status(400).json({ error: err.message });
      throw err;
    }

    const { rows } = await db.query(
      `update songs set title = $1, doc = $2, revision = revision + 1, updated_at = now()
       where id = $3 and owner_id = $4 and revision = $5
       returning id, title, revision, updated_at, description, tags, published_at`,
      [title(req.body.title), JSON.stringify(doc), req.params.id, req.user.id, revision],
    );
    if (rows[0]) return res.json({ song: summary(rows[0]) });

    const exists = await db.query('select revision from songs where id = $1 and owner_id = $2', [req.params.id, req.user.id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Song not found' });
    res.status(409).json({ error: 'This song was changed somewhere else', revision: exists.rows[0].revision });
  });

  // Publishing is separate from saving: it's a deliberate act, not an
  // autosave, and it doesn't touch the document or its revision. The same
  // call updates tags, description and picture (`cover`, a frame of the
  // visuals as a JPEG data URL) whether or not the song is public;
  // `published` flips it, and the original publish date is kept. Going
  // public tells the owner's followers; going private takes that back.
  router.put('/:id/publish', async (req, res) => {
    const body = req.body ?? {};
    const cover = 'cover' in body ? parseCover(body.cover) : null;
    if ('cover' in body && !cover) return res.status(400).json({ error: 'The picture must be a JPEG under 64 KB' });

    const song = await db.transaction(async (tx) => {
      const was = await tx.query('select published_at from songs where id = $1 and owner_id = $2', [req.params.id, req.user.id]);
      if (!was.rows[0]) return null;
      const { rows } = await tx.query(
        `update songs set
           tags = coalesce($3::jsonb, tags),
           description = coalesce($4, description),
           published_at = case
             when $5::boolean is null then published_at
             when $5 then coalesce(published_at, now())
             else null end
         where id = $1 and owner_id = $2
         returning id, title, revision, updated_at, description, tags, published_at`,
        [
          req.params.id, req.user.id,
          'tags' in body ? JSON.stringify(normalizeTags(body.tags, TAG_LIMITS.perSong)) : null,
          'description' in body ? description(body.description) : null,
          typeof body.published === 'boolean' ? body.published : null,
        ],
      );
      if (!rows[0]) return null;
      const wasPublic = Boolean(was.rows[0].published_at);
      const isPublic = Boolean(rows[0].published_at);
      if (isPublic && !wasPublic) await notifyFollowers(tx, { owner: req.user.id, kind: 'new_song', song: req.params.id });
      if (wasPublic && !isPublic) await unnotify(tx, { kind: 'new_song', song: req.params.id });
      const covers = cover
        ? await tx.query(
          `insert into song_covers (song_id, image) values ($1, $2)
           on conflict (song_id) do update set image = excluded.image, updated_at = now()
           returning updated_at`,
          [req.params.id, cover],
        )
        : await tx.query('select updated_at from song_covers where song_id = $1', [req.params.id]);
      return { ...rows[0], cover_at: covers.rows[0]?.updated_at };
    });
    if (!song) return res.status(404).json({ error: 'Song not found' });
    res.json({ song: summary(song) });
  });

  router.delete('/:id', async (req, res) => {
    const { rows } = await db.query('delete from songs where id = $1 and owner_id = $2 returning id', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Song not found' });
    res.json({ ok: true });
  });

  return router;
}
