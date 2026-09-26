import { DEFAULT_THEME, isTheme } from '../shared/themes.js';

/**
 * Applying a theme is one attribute on <html>; styles.css does the rest.
 * The choice is mirrored in localStorage so public/theme-boot.js can
 * apply it before the bundle loads, and so it holds for signed-out visits
 * on this device.
 */
const KEY = 'vectorfield.theme';

export function storedTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return isTheme(t) ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme) {
  const t = isTheme(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* private mode, blocked storage: the attribute still applies */ }
  return t;
}

export const currentTheme = () => {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : DEFAULT_THEME;
};
