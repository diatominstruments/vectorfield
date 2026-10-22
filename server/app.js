import express from 'express';
import compression from 'compression';
import { MAX_SONG_BYTES } from '../shared/song.js';
import { config } from './config.js';
import { authRouter, sessionMiddleware } from './auth.js';
import { passwordRouter } from './password-auth.js';
import { songsRouter } from './songs.js';
import { publicRouter } from './public.js';
import { likesRouter } from './likes.js';
import { followsRouter } from './follows.js';
import { notificationsRouter } from './notifications.js';
import { shareRouter } from './share.js';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
// The sampler's banks ship inside the instrument library, beside its source.
const KITS = new URL('kits/', import.meta.resolve('gloaming-instruments')).pathname;

// Google's documented allowances for Identity Services, and Apple's sign-in
// script; everything else is same-origin only. Only this site may frame its
// pages, except the embed player, which share.js opens to everyone.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client https://appleid.cdn-apple.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  'frame-src https://accounts.google.com/gsi/',
  "connect-src 'self' https://accounts.google.com/gsi/",
  "img-src 'self' data: https://*.googleusercontent.com",
  "frame-ancestors 'self'",
].join('; ');

/**
 * `mailer` sends email (see mail.js; without one there are no recovery
 * emails), and `pwned` stands in for the breached-password check in tests.
 */
export function createApp(db, { mailer = null, pwned } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Who's on the other end, behind a proxy: rate limits on sign-in go by it.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  let warnedProxy = false;
  // Brotli/gzip for every text response; the client bundle shrinks ~85%.
  app.use(compression());

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Lets the Google and Apple sign-in popups report back to this window.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    // Passwords are typed into this site, so browsers that have been here
    // once must only ever come back over HTTPS.
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (!config.trustProxy && !warnedProxy && req.headers['x-forwarded-for']) {
      warnedProxy = true;
      console.warn('Requests are coming through a proxy but TRUST_PROXY is unset, so every visitor shares one '
        + 'limit on password sign-ins and sign-ups. See .env.example.');
    }
    next();
  });

  const api = express.Router();
  // State-changing API calls must be JSON. A cross-site form can't send that
  // without a CORS preflight we never grant, which, with SameSite cookies,
  // shuts out CSRF.
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' });
    }
    next();
  });
  api.use(express.json({ limit: MAX_SONG_BYTES }));
  api.use(sessionMiddleware(db));

  api.get('/config', (_req, res) => {
    res.json({
      googleClientId: config.googleClientId, appleClientId: config.appleClientId, devLogin: config.devLogin, recoveryEmail: Boolean(mailer),
    });
  });
  api.use('/auth', authRouter(db));
  api.use('/auth', passwordRouter(db, { pwned, mailer }));
  api.use('/songs', songsRouter(db));
  api.use('/likes', likesRouter(db));
  api.use('/follows', followsRouter(db));
  api.use('/notifications', notificationsRouter(db));
  api.use('/public', publicRouter(db));
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/api', api);
  app.use(shareRouter(db));
  app.use(express.static(PUBLIC));
  app.use('/kits', express.static(KITS), (_req, res) => res.sendStatus(404));
  // Client-side routes all load the one page.
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: PUBLIC }));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Song is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
