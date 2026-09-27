import { createPublicKey, verify } from 'node:crypto';

const ISSUER = 'https://appleid.apple.com';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';
const SKEW_SECONDS = 60;

/**
 * Apple's signing keys, fetched on first use and again when a token names a
 * key we don't have (Apple rotates them) — but at most once a minute, so
 * made-up key ids can't turn into a stream of requests to Apple.
 */
let cache = { keys: [], fetchedAt: 0 };
export async function appleKey(kid) {
  let key = cache.keys.find((k) => k.kid === kid);
  if (!key && Date.now() - cache.fetchedAt > 60_000) {
    const res = await fetch(KEYS_URL);
    if (!res.ok) throw new Error(`Apple keys: HTTP ${res.status}`);
    cache = { keys: (await res.json()).keys ?? [], fetchedAt: Date.now() };
    key = cache.keys.find((k) => k.kid === kid);
  }
  return key ?? null;
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Checks a Sign in with Apple ID token — RS256 signature against Apple's
 * published keys, issuer, audience (our Services ID) and expiry — and
 * returns its payload. Throws on anything off. `getKey` is swappable for
 * tests.
 */
export async function verifyAppleIdToken(token, { audience, getKey = appleKey }) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [head, body, sig] = parts;
  const header = decode(head);
  if (header.alg !== 'RS256') throw new Error('Unexpected algorithm');
  const jwk = await getKey(header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const ok = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('Bad signature');

  const payload = decode(body);
  const now = Date.now() / 1000;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER) throw new Error('Wrong issuer');
  if (!aud.includes(audience)) throw new Error('Wrong audience');
  if (!(payload.exp > now - SKEW_SECONDS)) throw new Error('Expired');
  if (!payload.sub) throw new Error('No subject');
  return payload;
}
