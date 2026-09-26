import { html, hue } from '../lib.js';
import { THEMES } from '../../shared/themes.js';

/**
 * Picking a colour theme: one card per theme, drawn in that theme's own
 * tokens (the card carries its `data-theme`, so styles.css colours it the
 * way it would colour the page). Radio semantics for keyboards and screen
 * readers.
 */
export function ThemePicker({ value, onChange, disabled = false }) {
  return html`
    <div class="theme-picker" role="radiogroup" aria-label="Colour theme">
      ${THEMES.map((t) => html`
        <button key=${t.id} type="button" role="radio" class="theme-card" data-theme=${t.id}
          aria-checked=${t.id === value} disabled=${disabled} onClick=${() => onChange(t.id)}>
          <span class="swatch" aria-hidden="true">
            <i class="accent"></i><i class="text"></i><i class="muted"></i>
            <span class="tint">${[0, 1, 2, 3].map((i) => html`<b key=${i} style=${`--hue: ${hue(i)}`}></b>`)}</span>
          </span>
          <strong>${t.name}</strong>
          <small>${t.blurb}</small>
          ${t.id === value && html`<span class="check" aria-hidden="true">✓</span>`}
        </button>`)}
    </div>
  `;
}
