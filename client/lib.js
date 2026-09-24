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

/** A stable, distinct hue per index, for colour-coding patterns and tracks. */
export const hue = (i) => (i * 67 + 170) % 360;
