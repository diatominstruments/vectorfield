import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';

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

const publicUser = (u) => ({ id: String(u.id), name: u.name, email: u.email, avatarUrl: u.avatar_url });

/**
 * Sign-in flow: the browser runs Google Identity Services, which hands it a
 * signed ID token; we verify that token's signature and audience here, then
 * issue our own session cookie. Google is only involved at sign-in.
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
    res.json({ user: publicUser(user) });
  }

  async function upsertUser({ sub, email, name, picture }) {
    const { rows } = await db.query(
      `insert into users (google_sub, email, name, avatar_url) values ($1, $2, $3, $4)
       on conflict (google_sub) do update
         set email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url
       returning *`,
      [sub, email ?? null, name, picture ?? null],
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
      name: payload.name ?? payload.email ?? 'Anonymous',
      picture: payload.picture,
    });
    await startSession(res, user);
  });

  if (config.devLogin) {
    router.post('/dev', async (req, res) => {
      const name = String(req.body?.name ?? '').trim().slice(0, 60) || 'Dev User';
      const user = await upsertUser({ sub: `dev:${name.toLowerCase()}`, name });
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
    res.json({ user: req.user ? publicUser(req.user) : null });
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
