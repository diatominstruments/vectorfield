import * as THREE from 'three';
import { describe } from 'gloaming-kit';

/**
 * three.js for gloaming-kit's 3D visualizations. The kit doesn't bundle it;
 * without it (or without WebGL) every 3D visualization silently draws its 2D
 * fallback instead.
 */
export { THREE };

/**
 * Whether 3D visualizations can render here. three.js r163+ needs WebGL2, so
 * probe for it once rather than letting the kit discover its absence later.
 * The probe context is released straight away: browsers cap how many a page
 * may hold.
 */
export const has3D = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
})();

/** Whether a visualization can't be offered here because it needs 3D. */
export const needs3D = (id) => !has3D && describe(id)?.renderer === '3d';

export const NO_3D_HINT = "3D visualizations need WebGL2, which isn't available in this browser.";
