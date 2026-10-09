import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARP_COUNTS, ORDERS, SHAPES, arpeggio } from '../shared/arpeggio.js';

test('a run climbs the chord from the clicked note, on into the next octave', () => {
  assert.deepEqual(arpeggio(60, 'minor', 'up', 4), [60, 63, 67, 72]);
  assert.deepEqual(arpeggio(60, 'major', 'up', 8), [60, 64, 67, 72, 76, 79, 84, 88]);
  assert.deepEqual(arpeggio(60, 'octave', 'up', 3), [60, 72, 84]);
  assert.deepEqual(arpeggio(60, 'power', 'up', 5), [60, 67, 72, 79, 84]);
});

test('down falls through the chord below the clicked note', () => {
  assert.deepEqual(arpeggio(60, 'major', 'down', 5), [60, 55, 52, 48, 43]);
  assert.deepEqual(arpeggio(60, 'dom7', 'down', 5), [60, 58, 55, 52, 48]);
  assert.deepEqual(arpeggio(60, 'octave', 'down', 2), [60, 48]);
});

test('up and down goes out and back without repeating the ends; down and up the reverse', () => {
  assert.deepEqual(arpeggio(60, 'minor', 'updown', 8), [60, 63, 67, 72, 75, 72, 67, 63]);
  assert.deepEqual(arpeggio(60, 'minor', 'updown', 4), [60, 63, 67, 63]);
  assert.deepEqual(arpeggio(60, 'minor', 'updown', 3), [60, 63, 67]);
  assert.deepEqual(arpeggio(60, 'minor', 'downup', 6), [60, 55, 51, 48, 51, 55]);
});

test('random plays the same notes as up, shuffled', () => {
  let s = 7;
  const random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const notes = arpeggio(60, 'maj7', 'random', 8, random);
  assert.deepEqual([...notes].sort((a, b) => a - b), arpeggio(60, 'maj7', 'up', 8));
  assert.notDeepEqual(notes, arpeggio(60, 'maj7', 'up', 8));
});

test('notes off the keyboard are left out', () => {
  assert.deepEqual(arpeggio(120, 'major', 'up', 4), [120, 124, 127]);
  assert.deepEqual(arpeggio(3, 'major', 'down', 4), [3]);
});

test('every shape and order is usable at every count', () => {
  for (const shape of Object.keys(SHAPES)) {
    for (const order of Object.keys(ORDERS)) {
      for (const count of ARP_COUNTS) {
        const notes = arpeggio(60, shape, order, count);
        // Only wide shapes at long counts run off the keyboard.
        const fits = count * 12 / SHAPES[shape].steps.length <= 60;
        assert.equal(notes.length, fits ? count : notes.length, `${shape} ${order} ${count}`);
        assert.ok(notes.length >= 3 && notes.length <= count && notes.every((n) => n >= 0 && n <= 127));
        if (order !== 'random') assert.equal(notes[0], 60);
      }
    }
  }
});
