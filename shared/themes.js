/**
 * Colour themes. Each is a set of CSS custom properties in styles.css,
 * selected by a `data-theme` attribute; the ids here are the attribute's
 * values. A user's choice is kept on their account (and mirrored in the
 * browser, so it applies before the session loads and for signed-out
 * visits on the same device).
 *
 * `scheme` says whether the theme is light or dark overall, for things
 * that can't read the tokens, like Google's sign-in button.
 */
export const THEMES = Object.freeze([
  { id: 'dark', name: 'Dark', scheme: 'dark', blurb: 'Deep blue-black with aquamarine' },
  { id: 'light', name: 'Light', scheme: 'light', blurb: 'Clean white and teal' },
  { id: 'goth', name: 'Goth', scheme: 'dark', blurb: 'Black, violet and blood red' },
  { id: 'dawn', name: 'Dawn', scheme: 'light', blurb: 'Warm peach and sunrise orange' },
  { id: 'forest', name: 'Forest', scheme: 'dark', blurb: 'Deep green and new leaves' },
].map(Object.freeze));

export const DEFAULT_THEME = 'dark';

export const isTheme = (id) => THEMES.some((t) => t.id === id);

/** The theme with this id, or the default. */
export const themeInfo = (id) => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME);
