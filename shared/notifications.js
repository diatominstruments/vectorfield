/**
 * Notifications: what a user is told about, and how each kind reads.
 *
 * A notification is a row (server/notifications.js) with a kind, the user
 * it's for, and what it's about: the `actor` who did something, the `song`
 * it concerns, or both. Everything a kind says is here, so changing the
 * wording is one edit in one place — and since the wording is put together
 * on display, it changes for old notifications too.
 *
 * Each kind has:
 *   icon     a glyph shown beside it
 *   message  the notification as a list of parts: plain strings, `actor`
 *            (shown as a link to their profile), `song` (a link to its
 *            page), or link(text, href) for any other link
 *   card     true to show the song it's about beneath the message, as a
 *            feed card
 */

const link = (text, href) => ({ text, href });

export const NOTIFICATIONS = {
  welcome: {
    icon: '✦',
    message: () => [
      'Welcome to Vectorfield! Make a song in the ', link('studio', '/studio'),
      ', and follow people to hear their new songs.',
    ],
  },

  song_liked: {
    icon: '♥',
    message: ({ actor, song }) => [actor, ' liked your song ', song],
    card: true,
  },

  new_song: {
    icon: '▶',
    message: ({ actor, song }) => [actor, ' published a new song, ', song],
    card: true,
  },

  new_follower: {
    icon: '+',
    message: ({ actor }) => [actor, ' started following you'],
  },
};

export const KINDS = Object.keys(NOTIFICATIONS);

/**
 * A notification's message as a list of { text, href? }: the template's
 * parts with the actor and song turned into links to their pages. A kind
 * nobody knows (one since removed from the list) says so rather than
 * breaking the page.
 */
export function messageParts(n) {
  const template = NOTIFICATIONS[n.kind];
  if (!template) return [{ text: 'Something happened' }];
  const actor = n.actor ?? { username: 'someone' };
  const song = n.song ?? { title: 'a song' };
  return template.message({ actor, song }).map((part) => {
    if (typeof part === 'string') return { text: part };
    if (part === actor) return { text: actor.username, href: actor.id ? `/u/${actor.username}` : undefined };
    if (part === song) return { text: song.title, href: song.id ? `/s/${song.id}` : undefined };
    return part;
  });
}

/** The message as one string, for titles and tests. */
export const messageText = (n) => messageParts(n).map((p) => p.text).join('');

export const icon = (kind) => NOTIFICATIONS[kind]?.icon ?? '•';
export const showsCard = (n) => Boolean(NOTIFICATIONS[n.kind]?.card && n.song);
