import { html } from '../lib.js';

const fmt = (v, unit) => {
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
  return unit ? `${s} ${unit}` : s;
};

// Sliders run 0..1000 and map through the schema's scale hint.
const toValue = (spec, x) => (spec.scale === 'log'
  ? spec.min * (spec.max / spec.min) ** x
  : spec.min + (spec.max - spec.min) * x);
const toSlider = (spec, v) => (spec.scale === 'log'
  ? Math.log(v / spec.min) / Math.log(spec.max / spec.min)
  : (v - spec.min) / (spec.max - spec.min));

/**
 * Controls for any instrument or effect, generated from its param schema —
 * so a module added to the library gets a working panel with no app change.
 * Double-click a slider to reset it to its default.
 */
export function ParamPanel({ module: M, params, onChange }) {
  return html`
    <div class="params">
      ${Object.entries(M.params).map(([name, spec]) => html`
        <label key=${name}>
          <span>${name}</span>
          ${spec.type === 'choice'
            ? html`<select value=${params[name]} onChange=${(e) => onChange(name, e.target.value)}>
                ${spec.values.map((v) => html`<option value=${v}>${v}</option>`)}
              </select>`
            : html`<input type="range" min="0" max="1000" value=${toSlider(spec, params[name]) * 1000}
                onInput=${(e) => onChange(name, toValue(spec, e.target.value / 1000))}
                onDblClick=${() => onChange(name, spec.default)} />`}
          <output>${spec.type === 'choice' ? '' : fmt(params[name], spec.unit)}</output>
        </label>`)}
    </div>
  `;
}
