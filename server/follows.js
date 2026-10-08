import { Router } from 'express';
import { requireProfile } from './auth.js';
import { findUser, followersOf } from './public.js';
import { notify, unnotify } from './notifications.js';

/**
 * Following someone, and stopping. Both can be repeated harmlessly, and
 * both answer with where things now stand, so the button can show the real
 * count. Following tells the followed user once; it's what gets a follower
 * told when the followed user publishes a song.
 */
export function followsRouter(db) {
  const router = Router();
  router.use(requireProfile);

  router.put('/:username', async (req, res) => {
    const user = await findUser(db, req.params.username);
    if (!user) return res.status(404).json({ error: 'No such user' });
    if (String(user.id) === String(req.user.id)) return res.status(400).json({ error: "You can't follow yourself" });
    const { rows } = await db.query(
      'insert into user_follows (follower_id, followed_id) values ($1, $2) on conflict do nothing returning 1',
      [req.user.id, user.id],
    );
    if (rows.length) await notify(db, { to: user.id, kind: 'new_follower', actor: req.user.id });
    res.json(await followersOf(db, user.id, req.user.id));
  });

  router.delete('/:username', async (req, res) => {
    const user = await findUser(db, req.params.username);
    if (!user) return res.status(404).json({ error: 'No such user' });
    await db.query('delete from user_follows where follower_id = $1 and followed_id = $2', [req.user.id, user.id]);
    await unnotify(db, { to: user.id, kind: 'new_follower', actor: req.user.id });
    res.json(await followersOf(db, user.id, req.user.id));
  });

  return router;
}
