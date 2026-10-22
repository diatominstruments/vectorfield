import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from './config.js';
import { startSession, loadSelf, selfUser, endSessions, requireUser } from './auth.js';
import { notify } from './notifications.js';
import { emails } from './mail.js';
import {
  hashPassword, verifyPassword, needsRehash, dummyHash, pwnedCount, tooManyAttempts, recordAttempt, clearAttempts,
} from './passwords.js';
import { usernameProblem, passwordProblem, emailProblem } from '../shared/users.js';
import { DEFAULT_THEME, isTheme } from '../shared/themes.js';

// What was typed: a username as it's stored (an @ in front is forgiven), a
// password exactly as given, an email address trimmed.
const typedUsername = (x) => String(x ?? '').trim().replace(/^@/, '').toLowerCase();
const typedPassword = (x) => (typeof x === 'string' ? x : '');
const typedEmail = (x) => String(x ?? '').trim();

const BREACHED = 'That password has turned up in a data breach, so it may be on lists attackers try. Pick another.';
const LINK_DEAD = 'This link has expired or already been used.';
const tooMany = (res) => res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' });
const noMail = (res) => res.status(503).json({ error: "Recovery emails aren't set up on this server" });

// How long an emailed link works, and the page it opens.
const LINKS = { verify: { hours: 24, page: 'confirm-email' }, reset: { hours: 1, page: 'reset-password' } };
const tokenHash = (token) => createHash('sha256').update(String(token ?? '')).digest('hex');

/**
 * Username-and-password accounts: signing up and in, changing the password,
 * and — where the server can send email — an optional recovery address to
 * reset it from. Passwords are only ever kept as slow hashes (passwords.js),
 * never logged or sent back.
 *
 * `mailer` sends email (mail.js; null: no recovery emails), and `pwned`
 * checks a password against known breaches; both are swappable for tests.
 */
export function passwordRouter(db, { pwned = pwnedCount, mailer = null } = {}) {
  const router = Router();

  // Where links in emails point. Only development falls back on the
  // request's own host (config.js says why).
  const siteUrl = (req) => config.publicUrl ?? `${req.protocol}://${req.get('host')}`;

  async function send(to, message) {
    if (!mailer) return false;
    try {
      await mailer.send({ to, ...message });
      return true;
    } catch (err) {
      console.error(`Sending "${message.subject}" failed: ${err.message}`);
      return false;
    }
  }

  /**
   * A link for `purpose` that works once, for a while, and only while `to`
   * is still the account's address. The token rides in the #fragment, which
   * browsers never send to a server, so it stays out of every log.
   */
  async function newLink(req, user, purpose, to) {
    const token = randomBytes(32).toString('base64url');
    await db.query('delete from email_tokens where expires_at < now()');
    await db.query(
      `insert into email_tokens (token_hash, user_id, purpose, email, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
      [tokenHash(token), user.id, purpose, to, LINKS[purpose].hours],
    );
    return `${siteUrl(req)}/${LINKS[purpose].page}#${token}`;
  }

  /** An emailed token's row, if it's real and unexpired — not used up yet. */
  async function liveToken(token, purpose) {
    const { rows } = await db.query(
      'select * from email_tokens where token_hash = $1 and purpose = $2 and expires_at > now()',
      [tokenHash(token), purpose],
    );
    return rows[0] ?? null;
  }

  /** Use a token up, returning its row if it was live. Of two requests with one link, only one gets it. */
  async function spendToken(token, purpose) {
    const { rows } = await db.query(
      'delete from email_tokens where token_hash = $1 and purpose = $2 returning *, expires_at > now() as live',
      [tokenHash(token), purpose],
    );
    return rows[0]?.live ? rows[0] : null;
  }

  /**
   * The signed-in user's current password must come with the request (as
   * `current`), and wrong guesses count against the same limit as sign-ins.
   */
  async function requireCurrentPassword(req, res, next) {
    const { rows } = await db.query('select hash from passwords where user_id = $1', [req.user.id]);
    if (!rows.length) return res.status(400).json({ error: 'This account signs in with Google or Apple' });
    const who = { username: req.user.username, ip: req.ip };
    if (await tooManyAttempts(db, 'login', who)) return tooMany(res);
    if (!(await verifyPassword(typedPassword(req.body?.current), rows[0].hash))) {
      await recordAttempt(db, 'login', who);
      return res.status(403).json({ error: 'Your current password is wrong' });
    }
    next();
  }

  // The username is what a password account signs in with, so it's chosen
  // here rather than after; the theme comes along from the device. The
  // recovery email is optional, and used only once confirmed.
  router.post('/signup', async (req, res) => {
    const username = typedUsername(req.body?.username);
    const password = typedPassword(req.body?.password);
    const email = typedEmail(req.body?.email);
    const problem = usernameProblem(username) ?? passwordProblem(password, username) ?? (email ? emailProblem(email) : null);
    if (problem) return res.status(400).json({ error: problem });
    if (email && !mailer) return noMail(res);
    if (await tooManyAttempts(db, 'signup', { ip: req.ip })) return tooMany(res);
    const taken = await db.query('select 1 from users where username = $1', [username]);
    if (taken.rows.length) return res.status(409).json({ error: 'That username is taken' });
    if ((await pwned(password)) > 0) return res.status(400).json({ error: BREACHED });

    const hashed = await hashPassword(password);
    const theme = isTheme(req.body?.theme) ? req.body.theme : DEFAULT_THEME;
    let user;
    try {
      user = await db.transaction(async (tx) => {
        const { rows } = await tx.query('insert into users (username, theme) values ($1, $2) returning *', [username, theme]);
        await tx.query('insert into passwords (user_id, hash, email) values ($1, $2, $3)', [rows[0].id, hashed, email || null]);
        return rows[0];
      });
    } catch (err) {
      if (/unique|duplicate/i.test(err.message)) return res.status(409).json({ error: 'That username is taken' });
      throw err;
    }
    await recordAttempt(db, 'signup', { ip: req.ip });
    await notify(db, { to: user.id, kind: 'welcome' });
    if (email) await send(email, emails.verify({ username, link: await newLink(req, user, 'verify', email) }));
    await startSession(db, res, await loadSelf(db, user.id));
  });

  // One answer for an unknown username and a wrong password, taking the
  // same time, and a limit on wrong guesses (passwords.js has the numbers).
  router.post('/login', async (req, res) => {
    const username = typedUsername(req.body?.username);
    const password = typedPassword(req.body?.password);
    if (!username || !password) return res.status(400).json({ error: 'Enter your username and password' });
    const who = { username, ip: req.ip };
    if (await tooManyAttempts(db, 'login', who)) return tooMany(res);

    const { rows } = await db.query(
      'select u.id, p.hash from users u join passwords p on p.user_id = u.id where u.username = $1',
      [username],
    );
    const stored = rows[0]?.hash;
    const right = await verifyPassword(password, stored ?? await dummyHash());
    if (!right || !stored) {
      await recordAttempt(db, 'login', who);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    await clearAttempts(db, 'login', who);
    if (needsRehash(stored)) {
      await db.query('update passwords set hash = $2, updated_at = now() where user_id = $1', [rows[0].id, await hashPassword(password)]);
    }
    await startSession(db, res, await loadSelf(db, rows[0].id));
  });

  // Changing the password signs out every other session, in case someone
  // else knew the old one, and kills any reset links still out there. A
  // confirmed recovery address hears about it, so a change its owner
  // didn't make can be undone from there.
  router.put('/password', requireUser, requireCurrentPassword, async (req, res) => {
    const user = req.user;
    const password = typedPassword(req.body?.password);
    const problem = passwordProblem(password, user.username);
    if (problem) return res.status(400).json({ error: problem });
    if ((await pwned(password)) > 0) return res.status(400).json({ error: BREACHED });

    await db.query('update passwords set hash = $2, updated_at = now() where user_id = $1', [user.id, await hashPassword(password)]);
    await db.query("delete from email_tokens where user_id = $1 and purpose = 'reset'", [user.id]);
    await endSessions(db, user.id, req);
    if (user.recovery_email_confirmed) await send(user.recovery_email, emails.passwordChanged({ username: user.username }));
    res.json({ ok: true });
  });

  // Setting, changing or (given '') removing the recovery email takes the
  // password too, or anyone at an unattended, signed-in screen could point
  // resets at themselves. A new address works once confirmed from the link
  // sent to it; saving an unconfirmed one again sends a fresh link; the
  // address it replaces is told.
  router.put('/recovery-email', requireUser, requireCurrentPassword, async (req, res) => {
    if (!mailer) return noMail(res);
    const user = req.user;
    const email = typedEmail(req.body?.email);
    const problem = email ? emailProblem(email) : null;
    if (problem) return res.status(400).json({ error: problem });
    const same = Boolean(email) && email.toLowerCase() === user.recovery_email?.toLowerCase();
    if (same && user.recovery_email_confirmed) return res.json({ user: selfUser(user) });
    if (email) {
      const who = { username: user.username, ip: req.ip };
      if (await tooManyAttempts(db, 'email', who)) return tooMany(res);
      await recordAttempt(db, 'email', who);
    }

    await db.query('update passwords set email = $2, email_verified_at = null where user_id = $1', [user.id, email || null]);
    await db.query('delete from email_tokens where user_id = $1', [user.id]);
    if (user.recovery_email_confirmed) await send(user.recovery_email, emails.recoveryChanged({ username: user.username, email }));
    if (email && !(await send(email, emails.verify({ username: user.username, link: await newLink(req, user, 'verify', email) })))) {
      return res.status(502).json({ error: "Saved, but the confirmation email couldn't be sent. Try saving again in a while." });
    }
    res.json({ user: selfUser(await loadSelf(db, user.id)) });
  });

  // The link in a confirmation email. Having it is having the inbox, so no
  // session's needed: it may well be opened on another device.
  router.post('/confirm-email', async (req, res) => {
    const token = await spendToken(req.body?.token, 'verify');
    if (!token) return res.status(400).json({ error: LINK_DEAD });
    const { rows } = await db.query(
      'update passwords set email_verified_at = now() where user_id = $1 and email = $2 returning email',
      [token.user_id, token.email],
    );
    if (!rows.length) return res.status(400).json({ error: LINK_DEAD });
    res.json({ email: rows[0].email });
  });

  // "Forgot password?", by username or recovery email. The answer's the same
  // whether or not there's such an account with a confirmed address, and
  // comes back without waiting on the mail server, so it doesn't tell
  // anyone which accounts can be reset, or where to.
  router.post('/forgot', async (req, res) => {
    if (!mailer) return noMail(res);
    const given = typedUsername(req.body?.username);
    if (!given) return res.status(400).json({ error: 'Enter your username or recovery email' });
    const who = { username: given, ip: req.ip };
    if (await tooManyAttempts(db, 'email', who)) return tooMany(res);
    await recordAttempt(db, 'email', who);

    const { rows } = await db.query(
      `select u.id, u.username, p.email from users u join passwords p on p.user_id = u.id
       where p.email_verified_at is not null and (u.username = $1 or lower(p.email) = $1) limit 5`,
      [given],
    );
    for (const user of rows) send(user.email, emails.reset({ username: user.username, link: await newLink(req, user, 'reset', user.email) }));
    res.json({ ok: true });
  });

  // Opening a reset link: whose account it's for, so the page can say so
  // (and password managers can file the new password). It doesn't use it up.
  router.post('/reset-link', async (req, res) => {
    const token = await liveToken(req.body?.token, 'reset');
    const user = token && (await loadSelf(db, token.user_id));
    if (!user) return res.status(400).json({ error: LINK_DEAD });
    res.json({ username: user.username });
  });

  // Choosing a new password from a reset link signs out every session and
  // signs this one in: having the inbox is proof enough.
  router.post('/reset', async (req, res) => {
    const token = await liveToken(req.body?.token, 'reset');
    const user = token && (await loadSelf(db, token.user_id));
    if (!user) return res.status(400).json({ error: LINK_DEAD });
    const password = typedPassword(req.body?.password);
    const problem = passwordProblem(password, user.username);
    if (problem) return res.status(400).json({ error: problem });
    if ((await pwned(password)) > 0) return res.status(400).json({ error: BREACHED });

    const hashed = await hashPassword(password);
    if (!(await spendToken(req.body?.token, 'reset'))) return res.status(400).json({ error: LINK_DEAD });
    // Only while the link's address is still the account's confirmed one.
    const { rows } = await db.query(
      `update passwords set hash = $2, updated_at = now()
       where user_id = $1 and email = $3 and email_verified_at is not null returning user_id`,
      [user.id, hashed, token.email],
    );
    if (!rows.length) return res.status(400).json({ error: LINK_DEAD });
    await db.query("delete from email_tokens where user_id = $1 and purpose = 'reset'", [user.id]);
    await endSessions(db, user.id);
    await startSession(db, res, user);
  });

  return router;
}
