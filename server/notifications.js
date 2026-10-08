import { Router } from 'express';
import { requireProfile } from './auth.js';
import { SONG_WITH_OWNER, card } from './public.js';

const PAGE = 20;

/**
 * Tell `to` that `actor` did something, about `song` (shared/notifications.js
 * says what each kind means and how it reads). Nothing you do yourself is
 * news to you — liking your own song tells nobody — and the same thing
 * happening again (like, unlike, like) is still one notification.
 */
export async function notify(db, { to, kind, actor = null, song = null }) {
  if (actor !== null && String(actor) === String(to)) return;
  await db.query(
    'insert into notifications (user_id, kind, actor_id, song_id) values ($1, $2, $3, $4) on conflict do nothing',
    [to, kind, actor, song],
  );
}

/** Tell everyone who follows `owner` about their `song`. */
export async function notifyFollowers(db, { owner, kind, song }) {
  await db.query(
    `insert into notifications (user_id, kind, actor_id, song_id)
     select follower_id, $2, $1, $3 from user_follows where followed_id = $1
     on conflict do nothing`,
    [owner, kind, song],
  );
}

/**
 * Take back notifications matching every given field: the one an unlike or
 * unfollow undoes, or everything about a song once it's unpublished.
 */
export async function unnotify(db, { to, kind, actor, song }) {
  const where = [];
  const params = [];
  for (const [column, value] of [['user_id', to], ['kind', kind], ['actor_id', actor], ['song_id', song]]) {
    if (value === undefined) continue;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }
  if (!where.length) throw new Error('unnotify needs something to match');
  await db.query(`delete from notifications where ${where.join(' and ')}`, params);
}

const unreadCount = async (db, userId) =>
  (await db.query('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [userId])).rows[0].n;

/** A notification as the client shows it: who, what, and the song as a feed card. */
const item = (r) => ({
  id: String(r.notification_id),
  kind: r.kind,
  createdAt: r.notified_at,
  readAt: r.read_at,
  actor: r.actor_id ? { id: String(r.actor_id), username: r.actor_username, avatarUrl: r.actor_avatar } : null,
  song: r.id ? card(r) : null,
});

/**
 * A user's own notifications: a page at a time, newest first, with how
 * many are unread for the header's badge. Opening the list marks it read;
 * the client does that once the page has loaded, so what it shows still
 * knows which ones were new.
 */
export function notificationsRouter(db) {
  const router = Router();
  router.use(requireProfile);

  // `before` is the id of the last notification shown; the next page
  // starts after it. Ids only grow, so the cursor is exact.
  router.get('/', async (req, res) => {
    const params = [req.user.id];
    const before = /^\d+$/.test(req.query.before ?? '') ? req.query.before : null;
    if (before) params.push(before);
    const { rows } = await db.query(
      `select n.id as notification_id, n.kind, n.created_at as notified_at, n.read_at,
         a.id as actor_id, a.username as actor_username, a.avatar_url as actor_avatar, x.*
       from notifications n
       left join users a on a.id = n.actor_id
       left join (${SONG_WITH_OWNER}) x on x.id = n.song_id
       where n.user_id = $1 ${before ? 'and n.id < $2' : ''}
       order by n.id desc limit ${PAGE + 1}`,
      params,
    );
    const page = rows.slice(0, PAGE);
    res.json({
      notifications: page.map(item),
      nextBefore: rows.length > PAGE ? String(page.at(-1).notification_id) : null,
      unread: await unreadCount(db, req.user.id),
    });
  });

  router.get('/unread', async (req, res) => {
    res.json({ unread: await unreadCount(db, req.user.id) });
  });

  router.put('/read', async (req, res) => {
    await db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user.id]);
    res.json({ unread: 0 });
  });

  return router;
}
