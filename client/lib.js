import { h } from 'preact';
import { useEffect, useReducer, useState } from 'preact/hooks';
import htm from 'htm';

/** JSX-like templates without a JSX build step. */
export const html = htm.bind(h);

// ---- routing -----------------------------------------------------------------

const routeListeners = new Set();

export function navigate(path) {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  routeListeners.forEach((fn) => fn());
}

addEventListener('popstate', () => routeListeners.forEach((fn) => fn()));

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const fn = () => setPath(location.pathname);
    routeListeners.add(fn);
    return () => routeListeners.delete(fn);
  }, []);
  return path;
}

export function Link({ href, children, ...props }) {
  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
  return html`<a href=${href} onClick=${onClick} ...${props}>${children}</a>`;
}

/** Sets the document title: "Page · Vectorfield", or just the brand for null. */
export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Vectorfield` : 'Vectorfield';
    return () => { document.title = 'Vectorfield'; };
  }, [title]);
}

// ---- formatting -----------------------------------------------------------------

export const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};

// ---- subscriptions -------------------------------------------------------------

/** Re-render whenever `source.subscribe` fires. */
export function useSubscription(source) {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => source?.subscribe(force), [source]);
}

/** Latest value of an engine event. */
export function useEngineEvent(engine, event, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => engine.on(event, setValue), [engine, event]);
  return value;
}

// ---- notes ---------------------------------------------------------------------

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
export const isBlackKey = (n) => NAMES[n % 12].length > 1;

export { hue } from '../shared/themes.js';
