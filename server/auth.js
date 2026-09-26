import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { TAG_LIMITS, normalizeTags } from '../shared/genres.js';
import { usernameProblem, suggestUsername, cleanBio } from '../shared/users.js';
import { DEFAULT_THEME, isTheme } from '../shared/themes.js';

const COOKIE = 'sid';
const hash = (token) => createHash('sha256').update(token).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, value, maxAgeSeconds) {
  const attrs = [
    `${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.production) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

/** What anyone may see of a user. `username` is null until they've chosen one. */
export const publicUser = (u) => ({
  id: String(u.id), username: u.username, avatarUrl: u.avatar_url, bio: u.bio ?? '', interests: u.interests ?? [],
});
/** What the user sees of themselves: also their email and colour theme. */
const selfUser = (u) => ({ ...publicUser(u), email: u.email, theme: isTheme(u.theme) ? u.theme : DEFAULT_THEME });

/** A username nobody has yet, from some text: ada, ada2, ada3, … (dev sign-in only). */
async function freeUsername(db, text) {
  const base = suggestUsername(text);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 24 - String(n).length)}${n}`;
    const { rows } = await db.query('select 1 from users where username = $1', [candidate]);
    if (!rows.length) return candidate;
  }
}

/**
 * Sign-in flow: the browser runs Google Identity Services, which hands it a
 * signed ID token; we verify that token's signature and audience here, then
 * issue our own session cookie. Google is only involved at sign-in, and
 * only the account id, verified email and avatar are kept — never the
 * name. A new account has no username until its owner picks one.
 */
export function authRouter(db) {
  const router = Router();
  const google = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

  async function startSession(res, user) {
    const token = randomBytes(32).toString('base64url');
    const days = config.sessionDays;
    await db.query(
      `insert into sessions (token_hash, user_id, expires_at)
       values ($1, $2, now() + make_interval(days => $3))`,
      [hash(token), user.id, days],
    );
    setCookie(res, token, days * 86400);
    res.json({ user: selfUser(user) });
  }

  async function upsertUser({ sub, email, picture, username = null }) {
    const { rows } = await db.query(
      `insert into users (google_sub, email, avatar_url, username) values ($1, $2, $3, $4)
       on conflict (google_sub) do update set email = excluded.email, avatar_url = excluded.avatar_url
       returning *`,
      [sub, email ?? null, picture ?? null, username],
    );
    return rows[0];
  }

  router.post('/google', async (req, res) => {
    if (!google) return res.status(503).json({ error: 'Google sign-in is not configured' });
    let payload;
    try {
      const ticket = await google.verifyIdToken({ idToken: String(req.body?.credential ?? ''), audience: config.googleClientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Invalid Google credential' });
    }
    const user = await upsertUser({
      sub: payload.sub,
      email: payload.email_verified ? payload.email : null,
      picture: payload.picture,
    });
    await startSession(res, user);
  });

  if (config.devLogin) {
    // The dev sign-in names its user up front, so local work skips the
    // username step: the typed name becomes the username. Left blank, it
    // makes a fresh nameless account each time, to walk the same path a
    // Google sign-in takes.
    router.post('/dev', async (req, res) => {
      const name = String(req.body?.name ?? '').trim().slice(0, 60);
      const sub = name ? `dev:${name.toLowerCase()}` : `dev:anon:${randomBytes(6).toString('hex')}`;
      const existing = await db.query('select 1 from users where google_sub = $1', [sub]);
      const username = name && !existing.rows.length ? await freeUsername(db, name) : null;
      const user = await upsertUser({ sub, username });
      await startSession(res, user);
    });
  }

  router.post('/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await db.query('delete from sessions where token_hash = $1', [hash(token)]);
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? selfUser(req.user) : null });
  });

  // Profile edits, including the first choice of username (and theme, made
  // at the same step). Only the fields sent change; a username must be free.
  router.put('/me', requireUser, async (req, res) => {
    const body = req.body ?? {};
    const user = req.user;
    const bio = 'bio' in body ? cleanBio(body.bio) : user.bio;
    const interests = 'interests' in body ? normalizeTags(body.interests, TAG_LIMITS.interests) : user.interests;
    let theme = user.theme;
    if ('theme' in body) {
      if (!isTheme(body.theme)) return res.status(400).json({ error: 'Unknown theme' });
      theme = body.theme;
    }
    let username = user.username;
    if ('username' in body) {
      username = String(body.username ?? '').trim().toLowerCase();
      const problem = usernameProblem(username);
      if (problem) return res.status(400).json({ error: problem });
      const taken = await db.query('select 1 from users where username = $1 and id <> $2', [username, user.id]);
      if (taken.rows.length) return res.status(409).json({ error: 'That username is taken' });
    }
    try {
      const { rows } = await db.query(
        'update users set bio = $2, interests = $3, username = $4, theme = $5 where id = $1 returning *',
        [user.id, bio, JSON.stringify(interests), username, theme],
      );
      res.json({ user: selfUser(rows[0]) });
    } catch (err) {
      // Two people claiming one username at the same instant: the unique index decides.
      if (/unique|duplicate/i.test(err.message)) return res.status(409).json({ error: 'That username is taken' });
      throw err;
    }
  });

  return router;
}

/** Attaches `req.user` when the session cookie is valid. Never rejects. */
export function sessionMiddleware(db) {
  return async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const { rows } = await db.query(
        `select u.* from sessions s join users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`,
        [hash(token)],
      );
      req.user = rows[0] ?? null;
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}

/**
 * Signed in and named. Songs need this: anything they lead to publicly
 * points at the owner's profile, which doesn't exist without a username.
 */
export function requireProfile(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (!req.user.username) return res.status(403).json({ error: 'Choose a username first' });
  next();
}
