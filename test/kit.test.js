import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, BLENDS, CLIPS, DEFAULT_TRIGGERS, TRANSITIONS } from 'gloaming-kit';
import { BAND_NAMES, BLEND_NAMES, CLIP_NAMES, TRANSITION_NAMES, TRIGGER_NAMES } from '../shared/visuals.js';

// shared/visuals.js validates songs without importing the kit, so it keeps
// its own copies of these names; a kit update that adds one would otherwise
// show it in the editor and then fail to save.
test('the song validator knows every band and trigger the kit ships', () => {
  assert.deepEqual([...BAND_NAMES].sort(), Object.keys(BANDS).sort());
  assert.deepEqual([...TRIGGER_NAMES].sort(), DEFAULT_TRIGGERS.map((t) => t.name).sort());
});

test('the song validator knows every clip, blend and transition the kit ships', () => {
  assert.deepEqual([...CLIP_NAMES].sort(), [...CLIPS].sort());
  assert.deepEqual([...BLEND_NAMES].sort(), [...BLENDS].sort());
  assert.deepEqual([...TRANSITION_NAMES].sort(), [...TRANSITIONS].sort());
});
