import { Router } from 'express';
import { expandTags } from '../shared/genres.js';
import { USERNAME } from '../shared/users.js';
import { publicUser } from './auth.js';
import { UUID, summary } from './songs.js';

const PAGE = 20;

/** A song in a feed or on a profile: its summary, who made it, and how many like it. */
export const card = (r) => ({
  ...summary(r),
  likeCount: r.like_count,
  owner: { id: String(r.owner_id), username: r.owner_username, avatarUrl: r.owner_avatar },
});

export const SONG_WITH_OWNER = `
  select s.*, u.username as owner_username, u.avatar_url as owner_avatar, c.updated_at as cover_at,
    (select count(*)::int from song_likes l where l.song_id = s.id) as like_count
  from songs s join users u on u.id = s.owner_id
  left join song_covers c on c.song_id = s.id`;

/** `before`, if it's a time: where the next page of a list starts. */
const cursor = (q) => (typeof q === 'string' && !Number.isNaN(Date.parse(q)) ? q : null);

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

    const before = cursor(req.query.before);
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

  const findUser = async (username) => {
    username = username.toLowerCase();
    if (!USERNAME.test(username)) return null;
    return (await db.query('select * from users where username = $1', [username])).rows[0] ?? null;
  };

  // A profile and its published songs.
  router.get('/users/:username', async (req, res) => {
    const user = await findUser(req.params.username);
    if (!user) return res.status(404).json({ error: 'No such user' });
    const { rows } = await db.query(
      `${SONG_WITH_OWNER} where s.owner_id = $1 and s.published_at is not null order by s.published_at desc`,
      [user.id],
    );
    res.json({ user: publicUser(user), songs: rows.map(card) });
  });

  // The songs a user has liked, most recently liked first, paged like the
  // feed but by when they were liked. A song since unpublished drops out
  // (and comes back if it's published again).
  router.get('/users/:username/likes', async (req, res) => {
    const user = await findUser(req.params.username);
    if (!user) return res.status(404).json({ error: 'No such user' });
    const params = [user.id];
    const before = cursor(req.query.before);
    if (before) params.push(before);
    const { rows } = await db.query(
      `select l.created_at as liked_at, x.* from song_likes l join (${SONG_WITH_OWNER}) x on x.id = l.song_id
       where l.user_id = $1 and x.published_at is not null ${before ? 'and l.created_at < $2::timestamptz' : ''}
       order by l.created_at desc limit ${PAGE + 1}`,
      params,
    );
    const page = rows.slice(0, PAGE);
    res.json({
      songs: page.map((r) => ({ ...card(r), likedAt: r.liked_at })),
      nextBefore: rows.length > PAGE ? page.at(-1).liked_at : null,
    });
  });

  // A song, with its document and likes, for the read-only page.
  router.get('/songs/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Song not found' });
    const { rows } = await db.query(`${SONG_WITH_OWNER} where s.id = $1`, [req.params.id]);
    const row = rows[0];
    const mine = row && req.user && String(row.owner_id) === String(req.user.id);
    if (!row || (!row.published_at && !mine)) return res.status(404).json({ error: 'Song not found' });
    const liked = req.user
      ? (await db.query('select 1 from song_likes where user_id = $1 and song_id = $2', [req.user.id, row.id])).rows.length > 0
      : false;
    res.json({ song: { ...card(row), doc: row.doc, mine: Boolean(mine), liked } });
  });

  return router;
}
