import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveNotes, noteKey, notesInBox } from '../shared/note-edits.js';

const note = (n, step, length = 1, velocity = 0.75) => ({ step, note: n, velocity, length });
const keys = (...notes) => new Set(notes.map(noteKey));
const PIANO = { length: 16, scale: Array.from({ length: 128 }, (_, i) => i) };
const sorted = (notes) => [...notes].sort((a, b) => a.note - b.note || a.step - b.step);

test('a box takes every note on its rows that it touches, however little', () => {
  const notes = [note(60, 0, 4), note(60, 6), note(62, 3), note(64, 2, 2), note(67, 2)];
  // Steps 3..5 on the rows for 60 and 64: the first note's tail, and the 64 that ends on step 3.
  assert.deepEqual(notesInBox(notes, [3, 5], new Set([60, 64])), keys(notes[0], notes[3]));
  assert.deepEqual(notesInBox(notes, [7, 9], new Set([60, 62, 64])), new Set());
});

test('moving shifts the chosen notes in time and pitch, and leaves the rest', () => {
  const a = note(60, 0, 2, 1);
  const b = note(64, 4);
  const c = note(67, 8);
  const { notes, keys: moved, by } = moveNotes([a, b, c], keys(a, b), { steps: 2, rows: 3 }, PIANO);
  assert.deepEqual(by, { steps: 2, rows: 3 });
  assert.deepEqual(sorted(notes), sorted([note(63, 2, 2, 1), note(67, 6), c]));
  assert.deepEqual(moved, new Set(['63:2', '67:6']));
});

test('a move stops at the pattern\'s ends and the top and bottom of the scale', () => {
  const a = note(1, 1);
  const b = note(126, 12, 3);
  const { notes, by } = moveNotes([a, b], keys(a, b), { steps: 9, rows: -5 }, PIANO);
  // b already ends at 15 of 16 steps, a sits one off the bottom.
  assert.deepEqual(by, { steps: 1, rows: -1 });
  assert.deepEqual(sorted(notes), [note(0, 2), note(125, 13, 3)]);
  const stuck = moveNotes([a, b], keys(a, b), { steps: -5, rows: 9 }, PIANO);
  assert.deepEqual(stuck.by, { steps: -1, rows: 1 });
  const none = moveNotes([note(0, 0)], keys(note(0, 0)), { steps: -1, rows: -1 }, PIANO);
  assert.deepEqual(none.by, { steps: 0, rows: 0 });
});

test('a moved note takes the place of one it lands on, and cuts short one it lands along', () => {
  const mover = note(60, 0);
  const landedOn = note(62, 4, 2);
  const longOne = note(62, 1, 6);
  const { notes } = moveNotes([mover, landedOn], keys(mover), { steps: 4, rows: 2 }, PIANO);
  assert.deepEqual(notes, [note(62, 4)]);
  const cut = moveNotes([mover, longOne], keys(mover), { steps: 3, rows: 2 }, PIANO);
  assert.deepEqual(sorted(cut.notes), [note(62, 1, 2), note(62, 3)]);
});

test('notes moved together never knock each other out', () => {
  // A run up the scale, moved up a step: each lands where the next one was.
  const run = [note(60, 0), note(61, 1), note(62, 2)];
  const { notes } = moveNotes(run, keys(...run), { steps: 1, rows: 1 }, PIANO);
  assert.deepEqual(sorted(notes), [note(61, 1), note(62, 2), note(63, 3)]);
});

test('on a drum kit, rows are its sounds in order, not semitones', () => {
  const kit = { length: 16, scale: [36, 38, 42, 46] };   // kick, snare, closed hat, open hat
  const kick = note(36, 0);
  const snare = note(38, 4);
  const { notes, by } = moveNotes([kick, snare], keys(kick, snare), { steps: 0, rows: 5 }, kit);
  assert.deepEqual(by, { steps: 0, rows: 2 });
  assert.deepEqual(sorted(notes), [note(42, 0), note(46, 4)]);
  // A hit for a sound the kit doesn't have can't be moved.
  const stray = note(50, 2);
  assert.deepEqual(moveNotes([stray], keys(stray), { steps: 1, rows: 0 }, kit).notes, [stray]);
});
