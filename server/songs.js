import { Router } from 'express';
import { defaultSong, normalizeSong, SongError, LIMITS } from '../shared/song.js';
import { requireUser } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function title(x) {
  const t = typeof x === 'string' ? x.trim().slice(0, LIMITS.nameLength) : '';
  return t || 'Untitled song';
}

const summary = (r) => ({ id: r.id, title: r.title, revision: r.revision, updatedAt: r.updated_at });

/**
 * Songs are private to their owner for now; sharing comes with the social
 * side. Every query is scoped by owner_id, so a guessed id finds nothing.
 */
export function songsRouter(db) {
  const router = Router();
  router.use(requireUser);

  router.param('id', (req, res, next, id) => {
    if (!UUID.test(id)) return res.status(404).json({ error: 'Song not found' });
    next();
  });

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      'select id, title, revision, updated_at from songs where owner_id = $1 order by updated_at desc',
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
    const { rows } = await db.query('select * from songs where id = $1 and owner_id = $2', [req.params.id, req.user.id]);
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
       returning id, title, revision, updated_at`,
      [title(req.body.title), JSON.stringify(doc), req.params.id, req.user.id, revision],
    );
    if (rows[0]) return res.json({ song: summary(rows[0]) });

    const exists = await db.query('select revision from songs where id = $1 and owner_id = $2', [req.params.id, req.user.id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Song not found' });
    res.status(409).json({ error: 'This song was changed somewhere else', revision: exists.rows[0].revision });
  });

  router.delete('/:id', async (req, res) => {
    const { rows } = await db.query('delete from songs where id = $1 and owner_id = $2 returning id', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Song not found' });
    res.json({ ok: true });
  });

  return router;
}
