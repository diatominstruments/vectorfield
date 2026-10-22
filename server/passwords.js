import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(argon2);

/**
 * Passwords are kept only as Argon2id hashes, at RFC 9106's second
 * recommended setting: 64 MiB of memory, 3 passes, 4 lanes, a random
 * 16-byte salt and a 32-byte tag — slow and memory-hungry enough that a
 * leaked table can't practically be cracked back into passwords. The hash is
 * a PHC string that records its parameters, so raising them later just
 * means rehashing each password at its owner's next sign-in.
 */
const PARAMS = { memory: 65536, passes: 3, parallelism: 4 };
const SALT_BYTES = 16;
const TAG_BYTES = 32;

// The same text typed on two devices can arrive as different code points
// (é as one character or as e + accent); normalized, it hashes the same.
const normalize = (password) => String(password).normalize('NFKC');

const tag = (password, salt, { memory, passes, parallelism }, tagLength) =>
  derive('argon2id', { message: normalize(password), nonce: salt, memory, passes, parallelism, tagLength });

const b64 = (buf) => buf.toString('base64').replace(/=+$/, '');

export async function hashPassword(password, params = PARAMS) {
  const salt = randomBytes(SALT_BYTES);
  const out = await tag(password, salt, params, TAG_BYTES);
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(out)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function parse(stored) {
  const m = PHC.exec(String(stored));
  if (!m) return null;
  return {
    params: { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) },
    salt: Buffer.from(m[4], 'base64'),
    tag: Buffer.from(m[5], 'base64'),
  };
}

/** Whether `password` is the one `stored` was hashed from. */
export async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed) return false;
  const out = await tag(password, parsed.salt, parsed.params, parsed.tag.length);
  return timingSafeEqual(out, parsed.tag);
}

/** Whether a stored hash was made with weaker settings than today's. */
export function needsRehash(stored) {
  const parsed = parse(stored);
  return !parsed || Object.keys(PARAMS).some((k) => parsed.params[k] !== PARAMS[k]);
}

/**
 * A hash of nothing anyone knows, checked against when the username doesn't
 * exist, so that answer takes as long as a wrong password does.
 */
let dummy;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

const PWNED_RANGE = 'https://api.pwnedpasswords.com/range/';

/**
 * How many times a password has turned up in known data breaches, from Have
 * I Been Pwned. Only the first 5 hex digits of its SHA-1 leave this server;
 * the reply is every breached hash starting with them (padded with decoys,
 * so its size doesn't hint which), matched here. Null if the service can't
 * be reached in time: a sign-up shouldn't fail because it's down.
 */
export async function pwnedCount(password, { fetch = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const sha1 = createHash('sha1').update(normalize(password)).digest('hex').toUpperCase();
  try {
    const res = await fetch(PWNED_RANGE + sha1.slice(0, 5), {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    for (const line of (await res.text()).split('\n')) {
      const [suffix, count] = line.trim().split(':');
      if (suffix === sha1.slice(5)) return Number(count);
    }
    return 0;
  } catch {
    return null;
  }
}

/**
 * How many tries are allowed. Failed password sign-ins, in 15 minutes: at
 * one account from one address (someone guessing), at one account from
 * anywhere (guessing spread across many addresses), and from one address
 * at any account (trying one password on many) — except from a browser
 * that has signed in to the account before, which is held only to a limit
 * of its own (device), so guessing from elsewhere can't lock its owner out.
 * New accounts, in an hour: from one address. Requests that send an email,
 * in an hour: about one account, and from one address — so nobody's inbox
 * can be flooded.
 */
const LIMITS = {
  login: { minutes: 15, pair: 5, account: 30, address: 30, device: 10 },
  signup: { minutes: 60, address: 10 },
  email: { minutes: 60, account: 5, address: 20 },
};
const KEEP = "interval '1 hour'";

/**
 * Take one of `ip`'s tries at `kind` (at `username`, for a sign-in; from
 * `device`, a browser that has signed in to it before) ahead of the work
 * it's for, or null if they're used up. Taken first, it counts at once, so
 * requests sent all together can't each slip past the limit before any of
 * them is counted. It stands as a used try unless given back with release().
 */
export async function claimAttempt(db, kind, { username = null, ip, device = null }) {
  const limit = LIMITS[kind];
  await db.query(`delete from auth_attempts where at < now() - ${KEEP}`);
  const { rows: [{ id }] } = await db.query(
    'insert into auth_attempts (kind, username, ip, device) values ($1, $2, $3, $4) returning id',
    [kind, username, ip, device],
  );
  const { rows: [n] } = await db.query(
    `select count(*) filter (where device is null and username = $2 and ip = $3)::int as pair,
            count(*) filter (where device is null and username = $2)::int as account,
            count(*) filter (where device is null and ip = $3)::int as address,
            count(*) filter (where device = $4 and username = $2)::int as device
     from auth_attempts
     where kind = $1 and at > now() - make_interval(mins => $5) and (username = $2 or ip = $3)`,
    [kind, username, ip, device, limit.minutes],
  );
  const release = () => db.query('delete from auth_attempts where id = $1', [id]);
  const over = device ? n.device > limit.device : ['pair', 'account', 'address'].some((k) => limit[k] && n[k] > limit[k]);
  if (over) {
    await release();   // a refused try isn't one
    return null;
  }
  return { release };
}

/** After a right password: that account's earlier misses from there (this browser if it's a known one, or else this address) are forgiven. */
export async function clearAttempts(db, kind, { username, ip, device = null }) {
  const [where, from] = device ? ['device = $3', device] : ['device is null and ip = $3', ip];
  await db.query(`delete from auth_attempts where kind = $1 and username = $2 and ${where}`, [kind, username, from]);
}
