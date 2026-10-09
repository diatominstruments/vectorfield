import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SandpileSim } from '../client/sandpile-sim.js';
import { SANDPILE_LIMITS, defaultSandpile, normalizeSandpile, retune, ringCount, ringOf } from '../shared/sandpile.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const config = (extra = {}) => ({ ...defaultSandpile(), size: 5, drop: [2, 2], scatter: 0, rate: 1, spread: 0.25, ...extra });

/** A pile with every cell holding `grains`, set after the random start. */
function level(c, grains) {
  const sim = new SandpileSim(c, seeded());
  sim.cells.fill(grains);
  return sim;
}

const near = (a, b) => Math.abs(a - b) < 1e-9;
const total = (sim) => sim.cells.reduce((s, g) => s + g, 0);

test('rings are counted out from the drop cell, diagonals included', () => {
  assert.equal(ringOf(2, 2, [2, 2]), 0);
  assert.equal(ringOf(3, 1, [2, 2]), 1);
  assert.equal(ringOf(0, 4, [2, 2]), 2);
  assert.equal(ringCount(5, [2, 2]), 3);
  assert.equal(ringCount(5, [0, 0]), 5);
  assert.equal(ringCount(7, [1, 3]), 6);
});

test('a cell with four grains topples, one to each neighbour; off the edge they\'re lost', () => {
  const sim = level(config(), 0);
  sim.cells[12] = 3;   // the middle of a 5 × 5
  const events = sim.advance(1.5);   // grains at 0 and 1
  assert.deepEqual(events.map((e) => [e.at, e.ring, e.count, e.cells]), [[0, 0, 1, [12]]]);
  assert.equal(sim.cells[12], 1);   // toppled to 0, then the second grain
  assert.deepEqual([sim.cells[7], sim.cells[11], sim.cells[13], sim.cells[17]], [1, 1, 1, 1]);
  assert.equal(total(sim), 5);

  const corner = level(config({ drop: [0, 0] }), 0);
  corner.cells[0] = 3;
  corner.advance(0.5);
  assert.equal(total(corner), 2);   // two grains went to neighbours, two off the edge
});

test('an avalanche spreads in waves, one every `spread` beats, each ring in it sounding once', () => {
  const sim = level(config({ spread: 0.25 }), 3);   // everything on the brink
  const events = sim.advance(0.6);
  assert.deepEqual(events[0], { at: 0, ring: 0, count: 1, cells: [12] });
  // The four neighbours go together in the next wave.
  const second = events.filter((e) => near(e.at, 0.25));
  assert.deepEqual(second.map((e) => [e.ring, e.count]), [[1, 4]]);
  // The wave after brings down the middle again, the diagonals and the ring beyond.
  const third = events.filter((e) => near(e.at, 0.5));
  assert.deepEqual(third.map((e) => e.ring), [0, 1, 2]);
  assert.ok(events.every((e, i) => !i || e.at >= events[i - 1].at));
  assert.ok(sim.cells.every((g) => g < 4) || sim.pending.length);
});

test('waves still due after a call wait for the next one', () => {
  const sim = level(config({ spread: 1 }), 3);
  const first = sim.advance(0.5);
  assert.deepEqual(first.map((e) => e.at), [0]);
  const next = sim.advance(1);
  assert.ok(next.length > 0 && near(next[0].at, 0.5));   // the wave due at 1, half a beat into this call
  const settled = sim.advance(1000);
  assert.ok(sim.cells.every((g) => g < 4));
  assert.ok(settled.length > 0);
});

test('grains fall at their rate, and scatter lands them anywhere', () => {
  const sim = level(config({ rate: 4 }), 0);
  sim.advance(1);   // grains at 0, 0.25, 0.5 and 0.75, all on the drop cell: which topples on the fourth
  assert.equal(total(sim), 4);
  assert.equal(sim.cells[12], 0);
  assert.deepEqual([sim.cells[7], sim.cells[11], sim.cells[13], sim.cells[17]], [1, 1, 1, 1]);
  const scattered = level(config({ rate: 4, scatter: 1 }), 0);
  scattered.advance(5);
  assert.equal(total(scattered), 20);
  assert.ok(scattered.cells.filter((g) => g > 0).length > 1);
});

test('a new size starts a new pile; other edits take effect on the next grain', () => {
  const sim = level(config(), 0);
  sim.advance(2.5);
  assert.equal(total(sim), 3);
  sim.sync(config({ rate: 2 }));
  sim.advance(1.25);   // grains at 3 and 3.5
  assert.equal(total(sim), 5);
  sim.sync(config({ size: 7, drop: [3, 3] }));
  assert.equal(sim.cells.length, 49);
  assert.ok(sim.cells.every((g) => g >= 0 && g < 4));
});

test('tuning is cut or carried on up the scale to fit a size', () => {
  assert.deepEqual(retune([48, 51, 55], 5), [48, 51, 55, 58, 60]);
  assert.deepEqual(retune([48, 51, 55], 2), [48, 51]);
  assert.deepEqual(retune([], 2), [48, 51]);
  assert.deepEqual(retune([36], 3, { 36: 'Kick', 38: 'Snare' }), [36, 38, 36]);
});

test('sandpile settings are validated and clamped', () => {
  assert.deepEqual(normalizeSandpile(defaultSandpile()), defaultSandpile());
  assert.deepEqual(normalizeSandpile({}), defaultSandpile());
  const clean = normalizeSandpile({ size: 9, drop: [-4, 99], scatter: 2, rate: 0, spread: 5, notes: [60, 'x'], gate: 99, quantize: 3 });
  assert.equal(clean.size, 9);
  assert.deepEqual(clean.drop, [0, 8]);
  assert.equal(clean.scatter, 1);
  assert.equal(clean.rate, SANDPILE_LIMITS.rate[0]);
  assert.equal(clean.spread, SANDPILE_LIMITS.spread[1]);
  assert.equal(clean.notes.length, 9);
  assert.deepEqual(clean.notes.slice(0, 3), [60, 60, 63]);   // a bad note is middle C; then on up the scale
  assert.equal(clean.gate, SANDPILE_LIMITS.gate[1]);
  assert.equal(clean.quantize, 0);
  assert.deepEqual(normalizeSandpile({ size: 6 }).size, 7);   // not a size on offer
  assert.deepEqual(normalizeSandpile({ drop: [1] }).drop, [1, 3]);
  assert.throws(() => normalizeSandpile({ notes: 'c' }), SongError);
  assert.throws(() => normalizeSandpile(3), SongError);
});

test('a track can use the sandpile, and patterns saved before it get an empty set', () => {
  const song = sampleSong();
  const [drums] = song.tracks;
  song.patterns[0].sequencers = { [drums.id]: 'sandpile' };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, drums.id), 'sandpile');
  assert.deepEqual(clean.sandpile[drums.id], defaultSandpile());
  delete song.patterns[0].sandpile;
  delete song.patterns[0].sequencers;
  assert.deepEqual(normalizeSong(song).patterns[0].sandpile, {});
});
