import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, DEFAULT_TRIGGERS } from 'gloaming-kit';
import { BAND_NAMES, TRIGGER_NAMES } from '../shared/visuals.js';

// shared/visuals.js validates songs without importing the kit, so it keeps
// its own copies of these names; a kit update that adds one would otherwise
// show it in the editor and then fail to save.
test('the song validator knows every band and trigger the kit ships', () => {
  assert.deepEqual([...BAND_NAMES].sort(), Object.keys(BANDS).sort());
  assert.deepEqual([...TRIGGER_NAMES].sort(), DEFAULT_TRIGGERS.map((t) => t.name).sort());
});
