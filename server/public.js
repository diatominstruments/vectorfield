import { Router } from 'express';
import { expandTags } from '../shared/genres.js';
import { USERNAME } from '../shared/users.js';
import { publicUser } from './auth.js';
import { UUID, summary } from './songs.js';

const PAGE = 20;

/** A song in a feed or on a profile: its summary plus who made it. */
const card = (r) => ({
  ...summary(r),
  owner: { id: String(r.owner_id), username: r.owner_username, avatarUrl: r.owner_avatar },
});

const SONG_WITH_OWNER = `
  select s.*, u.username as owner_username, u.avatar_url as owner_avatar
  from songs s join users u on u.id = s.owner_id`;

/**
 * The public side: what anyone, signed in or not, can read. Published songs
 * only, except that owners can see their own unpublished songs here too, so
 * the song page works as a preview before publishing.
 */
export function publicRouter(db) {
  const router = Router();

  // The feed. `tab` is 'new' (everything, newest first) or 'for-you'
  // (songs tagged with something the signed-in user is into). `before` is
  // the publishedAt of the last card shown; the next page starts after it.
  router.get('/feed', async (req, res) => {
    const tab = req.query.tab === 'for-you' ? 'for-you' : 'new';
    const where = ['s.published_at is not null'];
    const params = [];

    if (tab === 'for-you') {
      if (!req.user) return res.status(401).json({ error: 'Sign in to get a feed picked for you' });
      const wanted = expandTags(req.user.interests ?? []);
      if (!wanted.length) return res.json({ songs: [], nextBefore: null, noInterests: true });
      params.push(JSON.stringify(wanted));
      where.push(`s.tags ?| array(select jsonb_array_elements_text($${params.length}::jsonb))`);
    }

    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
    if (before) {
      params.push(before);
      where.push(`s.published_at < $${params.length}::timestamptz`);
    }

    const { rows } = await db.query(
      `${SONG_WITH_OWNER} where ${where.join(' and ')} order by s.published_at desc limit ${PAGE + 1}`,
      params,
    );
    const page = rows.slice(0, PAGE);
    res.json({
      songs: page.map(card),
      nextBefore: rows.length > PAGE ? page.at(-1).published_at : null,
    });
  });

  // A profile and its published songs.
  router.get('/users/:username', async (req, res) => {
    const username = req.params.username.toLowerCase();
    if (!USERNAME.test(username)) return res.status(404).json({ error: 'No such user' });
    const users = await db.query('select * from users where username = $1', [username]);
    const user = users.rows[0];
    if (!user) return res.status(404).json({ error: 'No such user' });
    const { rows } = await db.query(
      `${SONG_WITH_OWNER} where s.owner_id = $1 and s.published_at is not null order by s.published_at desc`,
      [user.id],
    );
    res.json({ user: publicUser(user), songs: rows.map(card) });
  });

  // A song, with its document, for the read-only page.
  router.get('/songs/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Song not found' });
    const { rows } = await db.query(`${SONG_WITH_OWNER} where s.id = $1`, [req.params.id]);
    const row = rows[0];
    const mine = row && req.user && String(row.owner_id) === String(req.user.id);
    if (!row || (!row.published_at && !mine)) return res.status(404).json({ error: 'Song not found' });
    res.json({ song: { ...card(row), doc: row.doc, mine: Boolean(mine) } });
  });

  return router;
}
