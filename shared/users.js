/**
 * Profile fields and their rules, shared so the client can validate as the
 * user types and the server can refuse what slips past.
 *
 * A user is known by one name: the username they choose after signing in.
 * It's their profile's address (/u/<username>) and what everyone sees.
 * Nothing from the Google account is shown, or kept, beyond the avatar.
 */

export const USER_LIMITS = Object.freeze({
  username: [3, 24],
  bio: 300,
  password: [10, 256],
  email: 254,
});

/** Lowercase letters, digits and underscores; must start with a letter. */
export const USERNAME = /^[a-z][a-z0-9_]{2,23}$/;

/** Why a username isn't acceptable, or null if it is. */
export function usernameProblem(username) {
  if (typeof username !== 'string' || !username) return 'Pick a username';
  if (username.length < USER_LIMITS.username[0]) return `At least ${USER_LIMITS.username[0]} characters`;
  if (username.length > USER_LIMITS.username[1]) return `At most ${USER_LIMITS.username[1]} characters`;
  if (!USERNAME.test(username)) return 'Lowercase letters, digits and underscores, starting with a letter';
  return null;
}

/**
 * Why a password isn't acceptable, or null if it is. Length is what makes a
 * password hard to guess, so that's what's asked for — no required mix of
 * symbols — and it mustn't lean on the username or the site's name. (The
 * server also turns away any password known from a data breach.)
 */
export function passwordProblem(password, username = '') {
  const [min, max] = USER_LIMITS.password;
  if (typeof password !== 'string' || !password) return 'Pick a password';
  const length = [...password].length;
  if (length < min) return `At least ${min} characters`;
  if (length > max) return `At most ${max} characters`;
  let rest = password.toLowerCase();
  for (const word of [username, 'vectorfield']) if (word) rest = rest.replaceAll(word.toLowerCase(), '');
  if ([...rest].length < min) return "Too close to your username or the site's name";
  return null;
}

/**
 * Why an email address won't do, or null if it will. Only its shape is
 * checked here; the link sent to it proves the rest.
 */
export function emailProblem(email) {
  if (typeof email !== 'string' || !email) return 'Enter an email address';
  if (email.length > USER_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That doesn't look like an email address";
  return null;
}

/** A username from free text, for the dev sign-in: "Ada Lovelace" → "ada_lovelace". */
export function suggestUsername(text) {
  let u = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, USER_LIMITS.username[1]);
  if (!/^[a-z]/.test(u)) u = `user_${u}`.slice(0, USER_LIMITS.username[1]).replace(/_+$/, '');
  while (u.length < USER_LIMITS.username[0]) u += '_';
  return u;
}

export const cleanBio = (x) => (typeof x === 'string' ? x.trim().slice(0, USER_LIMITS.bio) : '');
