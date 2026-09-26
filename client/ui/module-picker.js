import { useEffect, useRef } from 'preact/hooks';
import { html } from '../lib.js';
import { moduleInfo } from './params.js';

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A button that opens a menu of instruments or effects, each shown with its
 * description and tags from the library's metadata — so choosing one doesn't
 * mean guessing from a name. `grouped` sections the list by each module's
 * first tag (effects: filter, time, space…).
 */
export function ModulePicker({ types, label, current, disabled, grouped = false, onPick, class: className = '' }) {
  const popRef = useRef(null);
  const buttonRef = useRef(null);
  const id = useRef(`picker-${Math.random().toString(36).slice(2)}`).current;

  const sections = new Map();
  for (const M of types) {
    const key = grouped ? moduleInfo(M).tags[0] ?? 'other' : '';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(M);
  }

  // Popovers open in the top layer, centred; place this one under its button,
  // and close it when the page scrolls it away from there.
  const close = useRef((e) => {
    if (!popRef.current?.contains(e.target)) popRef.current?.hidePopover();
  }).current;
  useEffect(() => () => {
    removeEventListener('scroll', close, true);
    removeEventListener('resize', close);
  }, []);
  const place = (e) => {
    if (e.newState !== 'open') {
      removeEventListener('scroll', close, true);
      removeEventListener('resize', close);
      return;
    }
    addEventListener('scroll', close, true);
    addEventListener('resize', close);
    const r = buttonRef.current.getBoundingClientRect();
    const pop = popRef.current;
    const width = Math.min(340, innerWidth - 16);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= 240 || below >= above) {
      pop.style.top = `${r.bottom + 4}px`;
      pop.style.bottom = 'auto';
      pop.style.maxHeight = `${below}px`;
    } else {
      pop.style.bottom = `${innerHeight - r.top + 4}px`;
      pop.style.top = 'auto';
      pop.style.maxHeight = `${above}px`;
    }
  };

  const pick = (M) => {
    popRef.current.hidePopover();
    onPick(M.id);
  };

  return html`
    <button ref=${buttonRef} type="button" class=${`picker-button ${className}`} popovertarget=${id} disabled=${disabled}
      title=${current ? moduleInfo(current).description : undefined}>
      ${label} <span aria-hidden="true">▾</span>
    </button>
    <div ref=${popRef} id=${id} popover="auto" class="picker" onToggle=${place}>
      ${[...sections].map(([key, list]) => html`
        <div class="picker-section" key=${key}>
          ${key && html`<h5>${capitalize(key)}</h5>`}
          ${list.map((M) => {
            const info = moduleInfo(M);
            return html`
              <button type="button" key=${M.id} class=${`picker-item ${M === current ? 'current' : ''}`} onClick=${() => pick(M)}>
                <strong>${info.label}</strong>
                ${info.description && html`<span class="description">${info.description}</span>`}
                ${!grouped && info.tags.length > 0 && html`
                  <span class="tags">${info.tags.map((t) => html`<span class="tag">${t}</span>`)}</span>`}
              </button>`;
          })}
        </div>`)}
    </div>
  `;
}
