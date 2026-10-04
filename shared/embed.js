/**
 * Embedding a song elsewhere: /embed/:id is a compact player meant for an
 * iframe, and this is the iframe that goes around it — the same markup
 * whether a person copies it from the share menu or a site asks the oEmbed
 * endpoint for it.
 */

export const EMBED_SIZE = Object.freeze({ width: 640, height: 360 });
export const EMBED_MIN_WIDTH = 240;

/**
 * A song's picture: chosen by its owner when publishing, shown on feed
 * cards, as the embed player's poster and in link previews. Small, since
 * every published song keeps one in the database.
 */
export const COVER_SIZE = Object.freeze({ width: 480, height: 360 });
export const MAX_COVER_BYTES = 64 * 1024;

/** Where a song's picture is served; the version makes a new picture a new URL, past caches. */
export const coverPath = (id, coverAt) => `/covers/${id}${coverAt ? `?v=${new Date(coverAt).getTime()}` : ''}`;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const songPath = (id) => `/s/${id}`;
export const embedPath = (id) => `/embed/${id}`;

/**
 * The 16:9 size that fits within maxwidth × maxheight (either may be
 * missing), no larger than the default and no smaller than the minimum.
 */
export function embedSize(maxWidth, maxHeight) {
  let width = EMBED_SIZE.width;
  if (maxWidth > 0) width = Math.min(width, maxWidth);
  if (maxHeight > 0) width = Math.min(width, Math.floor((maxHeight * 16) / 9));
  width = Math.max(EMBED_MIN_WIDTH, Math.round(width));
  return { width, height: Math.round((width * 9) / 16) };
}

/** The iframe for a song: `origin` like https://vectorfield.example, no trailing slash. */
export function embedCode({ origin, id, title, owner, width = EMBED_SIZE.width, height = EMBED_SIZE.height }) {
  const label = owner ? `${title} by ${owner} on Vectorfield` : `${title} on Vectorfield`;
  return `<iframe src="${escapeHtml(origin + embedPath(id))}" width="${width}" height="${height}" `
    + `title="${escapeHtml(label)}" style="border:0;border-radius:8px;max-width:100%" `
    + 'allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>';
}
