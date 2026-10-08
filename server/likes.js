import { Router } from 'express';
import { requireProfile } from './auth.js';
import { UUID } from './songs.js';
import { notify, unnotify } from './notifications.js';

/** How many likes a song has, and whether `userId` (if any) is one of them. */
async function likesOf(db, songId, userId = null) {
  const { rows } = await db.query(
    `select count(*)::int as count, coalesce(bool_or(user_id = $2), false) as liked
     from song_likes where song_id = $1`,
    [songId, userId],
  );
  return { likeCount: rows[0].count, liked: rows[0].liked };
}

/**
 * Liking a published song, and taking the like back. Both can be repeated
 * harmlessly, and both answer with where the song now stands, so the heart
 * can show the real count. A like shows on the liker's profile, which is
 * why it takes a username — and tells the song's owner, once.
 */
export function likesRouter(db) {
  const router = Router();
  router.use(requireProfile);

  router.param('id', (req, res, next, id) => {
    if (!UUID.test(id)) return res.status(404).json({ error: 'Song not found' });
    next();
  });

  router.put('/:id', async (req, res) => {
    const { rows } = await db.query('select owner_id from songs where id = $1 and published_at is not null', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Song not found' });
    const liked = await db.query(
      'insert into song_likes (user_id, song_id) values ($1, $2) on conflict do nothing returning 1',
      [req.user.id, req.params.id],
    );
    if (liked.rows.length) await notify(db, { to: rows[0].owner_id, kind: 'song_liked', actor: req.user.id, song: req.params.id });
    res.json(await likesOf(db, req.params.id, req.user.id));
  });

  // Unliking works even on a song since unpublished, so nothing's stuck.
  router.delete('/:id', async (req, res) => {
    await db.query('delete from song_likes where user_id = $1 and song_id = $2', [req.user.id, req.params.id]);
    await unnotify(db, { kind: 'song_liked', actor: req.user.id, song: req.params.id });
    res.json(await likesOf(db, req.params.id, req.user.id));
  });

  return router;
}
