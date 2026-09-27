import express from 'express';
import { MAX_SONG_BYTES } from '../shared/song.js';
import { config } from './config.js';
import { authRouter, sessionMiddleware } from './auth.js';
import { songsRouter } from './songs.js';
import { publicRouter } from './public.js';

const PUBLIC = new URL('../public/', import.meta.url).pathname;

// Google's documented allowances for Identity Services, and Apple's sign-in
// script; everything else is same-origin only.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client https://appleid.cdn-apple.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  'frame-src https://accounts.google.com/gsi/',
  "connect-src 'self' https://accounts.google.com/gsi/",
  "img-src 'self' data: https://*.googleusercontent.com",
].join('; ');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Lets the Google and Apple sign-in popups report back to this window.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
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
    res.json({ googleClientId: config.googleClientId, appleClientId: config.appleClientId, devLogin: config.devLogin });
  });
  api.use('/auth', authRouter(db));
  api.use('/songs', songsRouter(db));
  api.use('/public', publicRouter(db));
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/api', api);
  app.use(express.static(PUBLIC));
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
