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

/** A username from free text, for the dev sign-in: "Ada Lovelace" → "ada_lovelace". */
export function suggestUsername(text) {
  let u = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, USER_LIMITS.username[1]);
  if (!/^[a-z]/.test(u)) u = `user_${u}`.slice(0, USER_LIMITS.username[1]).replace(/_+$/, '');
  while (u.length < USER_LIMITS.username[0]) u += '_';
  return u;
}

export const cleanBio = (x) => (typeof x === 'string' ? x.trim().slice(0, USER_LIMITS.bio) : '');
