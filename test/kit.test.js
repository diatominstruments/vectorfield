import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANDS, BLENDS, CLIPS, DEFAULT_TRIGGERS, FINISH_DEFAULTS, FINISH_PRESETS, PALETTES, TIMING_TRIGGERS, TONEMAPS, TRANSITIONS,
} from 'gloaming-kit';
import {
  BAND_NAMES, BLEND_NAMES, CLIP_NAMES, DEFAULT_LOOK, FINISH_KEYS, FINISH_PRESET_NAMES, TIMING_TRIGGER_NAMES, TONEMAP_NAMES,
  TRANSITION_NAMES, TRIGGER_NAMES, normalizeStyle,
} from '../shared/visuals.js';

// shared/visuals.js validates songs without importing the kit, so it keeps
// its own copies of these names; a kit update that adds one would otherwise
// show it in the editor and then fail to save.
test('the song validator knows every band and trigger the kit ships', () => {
  assert.deepEqual([...BAND_NAMES].sort(), Object.keys(BANDS).sort());
  assert.deepEqual([...TRIGGER_NAMES].sort(), DEFAULT_TRIGGERS.map((t) => t.name).sort());
  assert.deepEqual([...TIMING_TRIGGER_NAMES].sort(), [...TIMING_TRIGGERS].sort());
});

test('the song validator knows every clip, blend and transition the kit ships', () => {
  assert.deepEqual([...CLIP_NAMES].sort(), [...CLIPS].sort());
  assert.deepEqual([...BLEND_NAMES].sort(), [...BLENDS].sort());
  assert.deepEqual([...TRANSITION_NAMES].sort(), [...TRANSITIONS].sort());
});

test("the song validator knows the kit's finishing pass", () => {
  // 'off' is the app's own: no pass at all.
  assert.deepEqual(FINISH_PRESET_NAMES.filter((p) => p !== 'off').sort(), Object.keys(FINISH_PRESETS).sort());
  assert.deepEqual([...TONEMAP_NAMES].sort(), [...TONEMAPS].sort());
  const numeric = Object.keys(FINISH_DEFAULTS).filter((k) => typeof FINISH_DEFAULTS[k] === 'number');
  assert.deepEqual(Object.keys(FINISH_KEYS).sort(), numeric.sort());
  for (const preset of Object.values(FINISH_PRESETS)) {
    for (const [key, [lo, hi]] of Object.entries(FINISH_KEYS)) {
      assert.ok(preset[key] >= lo && preset[key] <= hi, `${key} ${preset[key]}`);
    }
  }
});

test("every named palette in the kit saves as a song's look", () => {
  for (const [name, { label, description, ...look }] of Object.entries(PALETTES)) {
    assert.deepEqual(normalizeStyle({ ...DEFAULT_LOOK, ...look }, { complete: true }), { ...DEFAULT_LOOK, ...look }, name);
  }
});
