import { useState } from 'preact/hooks';
import { html } from '../lib.js';
import { FAMILIES, TAGS, tagLabel } from '../../shared/genres.js';

/** One genre tag, as a small chip; links or buttons depending on use. */
export function TagChips({ tags, class: className = '' }) {
  if (!tags?.length) return null;
  return html`<span class=${`tag-chips ${className}`}>${tags.map((t) => html`<span key=${t} class="genre-tag">${tagLabel(t)}</span>`)}</span>`;
}

/**
 * Pick genres from the taxonomy: every family with its genres, as toggles.
 * A family is a tag in its own right. `suggested` tags (say, ones that fit
 * the song's tempo) are marked; `max` caps how many can be on at once.
 */
export function GenrePicker({ value, onChange, max = Infinity, suggested = [] }) {
  const [filter, setFilter] = useState('');
  const selected = new Set(value);
  const hint = new Set(suggested);
  const full = selected.size >= max;
  const q = filter.trim().toLowerCase();

  const toggle = (id) => {
    if (selected.has(id)) onChange(value.filter((t) => t !== id));
    else if (!full) onChange([...value, id]);
  };

  const matches = (t) => !q || t.label.toLowerCase().includes(q) || t.id.includes(q);

  const chip = (t) => html`
    <button key=${t.id} type="button" aria-pressed=${selected.has(t.id)}
      class=${`genre-chip ${selected.has(t.id) ? 'on' : ''} ${hint.has(t.id) ? 'suggested' : ''} ${t.family ? '' : 'family'}`}
      disabled=${!selected.has(t.id) && full} onClick=${() => toggle(t.id)}
      title=${hint.has(t.id) ? 'Fits this tempo' : undefined}>${t.label}</button>`;

  return html`
    <div class="genre-picker">
      <div class="genre-picker-head">
        <input type="search" placeholder="Find a genre" value=${filter} onInput=${(e) => setFilter(e.target.value)} aria-label="Find a genre" />
        <span class="muted">
          ${value.length ? html`${value.length}${Number.isFinite(max) ? ` of ${max}` : ''} chosen: ` : (Number.isFinite(max) ? `Up to ${max}.` : '')}
          ${value.map((id) => html`
            <button key=${id} type="button" class="genre-chip on small" onClick=${() => toggle(id)} title="Remove">${tagLabel(id)} ×</button>`)}
        </span>
      </div>
      ${FAMILIES.map((f) => {
        const genres = f.genres.filter(matches);
        const familyTag = TAGS.get(f.id);
        if (!genres.length && !matches(familyTag)) return null;
        return html`
          <div key=${f.id} class="genre-family">
            ${chip(familyTag)}
            <div class="genre-list">${genres.map(chip)}</div>
          </div>`;
      })}
    </div>
  `;
}
