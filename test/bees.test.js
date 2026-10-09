import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeeSim } from '../client/bee-sim.js';
import { BEE_LIMITS, NECTAR_ENOUGH, defaultBees, isFlower, nextFlowerNote, normalizeBees } from '../shared/bees.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const flower = (id, x, note = 60) => ({ id, x, y: 0.5, note });
const leaf = (id, x) => ({ id, x, y: 0.5, note: null });
const config = (plants, extra = {}) => ({ ...defaultBees(), plants, bees: 1, speed: 1, feed: 1, rest: 2, refill: 8, whim: 0, ...extra });

/** A sim whose bees are put where the test wants them, ready to set off. */
function placed(c, at) {
  const sim = new BeeSim(c, seeded());
  for (const [id, where] of Object.entries(at)) Object.assign(sim.bees.get(id), { x: where.x, y: 0.5, to: null, on: null, rest: 0 });
  return sim;
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a bee flies to the nearest full flower, feeds, and flies on, landing right on time', () => {
  // A at 0.2 and B at 0.9; the bee starts at 0.3, so A is 0.1 away and B 0.7 beyond it.
  const sim = placed(config([flower('a', 0.2), flower('b', 0.9)]), { b1: { x: 0.3 } });
  const events = sim.advance(2);
  assert.deepEqual(events.map((e) => e.flower), ['a', 'b']);
  assert.ok(near(events[0].at, 0.1), `${events[0].at}`);        // 0.1 at speed 1
  assert.ok(near(events[1].at, 1.1 + 0.7), `${events[1].at}`);  // a beat's feeding, then 0.7 on to B
  assert.deepEqual(events.map((e) => e.strength), [1, 1]);
  // Each was drained on landing and has been refilling since.
  assert.ok(near(sim.nectar.get('a'), (2 - 0.1) / 8));
  assert.ok(near(sim.nectar.get('b'), (2 - 1.8) / 8));
});

test('a bee won\'t land on a drained flower: it waits for it to refill, and lands softly when it has', () => {
  const sim = placed(config([flower('a', 0.5)]), { b1: { x: 0.5 } });
  const events = sim.advance(4.5);
  assert.deepEqual(events.map((e) => e.flower), ['a', 'a', 'a']);
  // Drained at 0, a quarter full (enough) 2 beats later, and so on.
  assert.ok(near(events[1].at, NECTAR_ENOUGH * 8), `${events[1].at}`);
  assert.ok(near(events[2].at, 2 * NECTAR_ENOUGH * 8), `${events[2].at}`);
  assert.equal(events[0].strength, 1);
  assert.ok(near(events[1].strength, NECTAR_ENOUGH));
  assert.ok(sim.positions()[0].on === 'a' && !sim.positions()[0].flying);   // waiting there
});

test('arriving at a flower another bee has just drained, a bee flies on without a note', () => {
  const sim = placed(config([flower('a', 0.5), flower('b', 0.9)], { bees: 2 }), { b1: { x: 0.4 }, b2: { x: 0.3 } });
  // Both set off for A, the nearer: the first lands at 0.1, the second finds it empty at 0.2.
  const first = sim.advance(0.25);
  assert.deepEqual(first.map((e) => [e.flower, e.at.toFixed(2)]), [['a', '0.10']]);
  const second = sim.bees.get('b2');
  assert.equal(second.to, 'b');
  const later = sim.advance(0.5);
  assert.deepEqual(later.map((e) => e.flower), ['b']);
  assert.ok(near(later[0].at, 0.6 - 0.25), `${later[0].at}`);   // at A at 0.2, the 0.4 on to B, less the first call
});

test('on a plant with no flower a bee only rests, for the resting time, and nothing sounds', () => {
  const sim = placed(config([flower('a', 0.2), leaf('p', 0.5)]), { b1: { x: 0.2 } });
  sim.bees.get('b1').on = 'a';   // sitting on A, so the leaf is its only way on
  const events = sim.advance(3);
  // 0.3 to the leaf, 2 beats' rest, 0.3 back to A.
  assert.deepEqual(events.map((e) => [e.flower, Number(e.at.toFixed(6))]), [['a', 2.6]]);
  assert.ok(!sim.nectar.has('p'));
});

test('with the flowers drained, a bee settles for a leaf, then waits there for a flower to refill', () => {
  const sim = placed(config([flower('a', 0.2), leaf('p', 0.5)]), { b1: { x: 0.2 } });
  const events = sim.advance(4);
  // Lands on A at once and drains it; fed by 1, rests on the leaf from 1.3
  // to 3.3; A is 0.41 full by then, so back it goes, landing at 3.6.
  assert.deepEqual(events.map((e) => [e.flower, Number(e.at.toFixed(6))]), [['a', 0], ['a', 3.6]]);
  assert.ok(near(events[1].strength, 3.6 / 8));
  // Between, with A still drained, it had nowhere else and waited on the leaf.
  const again = placed(config([flower('a', 0.2), leaf('p', 0.5)], { refill: 64 }), { b1: { x: 0.2 } });
  again.advance(4);
  assert.deepEqual([again.bees.get('b1').on, again.bees.get('b1').to], ['p', null]);
});

test('whim sends a bee anywhere with nectar; without it, to what\'s full and near', () => {
  const far = [flower('a', 0.3), flower('b', 0.9)];
  const picks = (whim, seed) => {
    const sim = placed(config(far, { whim }), { b1: { x: 0.25 } });
    // A generator's first few draws are small; skip them for a fair pick.
    const random = seeded(seed);
    for (let i = 0; i < 10; i++) random();
    sim.random = random;
    sim.advance(0.01);
    return sim.bees.get('b1').to;
  };
  const share = (whim, flower) => Array.from({ length: 40 }, (_, i) => picks(whim, i + 1)).filter((id) => id === flower).length / 40;
  // Near and full, A wins nearly every time without whim; with it, it's a toss-up.
  assert.ok(share(0, 'a') >= 0.85, `${share(0, 'a')}`);
  assert.ok(share(1, 'a') >= 0.25 && share(1, 'b') >= 0.25, `${share(1, 'a')}`);
});

test('edits reach a running patch: flowers come and go, bees are added and removed', () => {
  const sim = placed(config([flower('a', 0.5), flower('b', 0.9)]), { b1: { x: 0.4 } });
  sim.advance(0.05);
  assert.equal(sim.bees.get('b1').to, 'a');
  // A is pulled up mid-flight: the bee picks again from where it is, and A's nectar goes with it.
  sim.sync(config([flower('b', 0.9), flower('c', 0.1)], { bees: 3 }));
  assert.equal(sim.bees.get('b1').to, null);
  assert.deepEqual([...sim.nectar.keys()].sort(), ['b', 'c']);
  assert.equal(sim.nectar.get('c'), 1);
  assert.equal(sim.bees.size, 3);
  sim.sync(config([flower('b', 0.9), flower('c', 0.1)], { bees: 1 }));
  assert.deepEqual([...sim.bees.keys()], ['b1']);
  // And it sets off again next time anything happens.
  sim.advance(0.01);
  assert.ok(sim.bees.get('b1').to);
});

test('a new flower takes the next note up the scale, leaves not counting; drum kits take the next sound', () => {
  const c = defaultBees();
  assert.equal(nextFlowerNote(c), 65);   // C minor pentatonic above the top (63) in C
  assert.equal(nextFlowerNote({ plants: [] }), 48);
  assert.equal(nextFlowerNote({ plants: [leaf('p', 0.5)] }), 48);
  assert.equal(nextFlowerNote({ plants: [{ note: 36 }, leaf('p', 0.5)] }, { 36: 'Kick', 38: 'Snare', 42: 'Hat' }), 38);
  assert.equal(defaultBees({ 36: 'Kick', 38: 'Snare' }).plants.filter((p) => !isFlower(p)).length, 2);
});

test('bee settings are validated and clamped', () => {
  assert.deepEqual(normalizeBees(defaultBees()), defaultBees());
  assert.deepEqual(normalizeBees({}), defaultBees());
  const clean = normalizeBees({
    plants: [{ id: 'a', x: 5, y: -5, note: 200 }, { id: 'a' }, { id: 'B' }, 'flower', { id: 'p', x: 0.5, y: 0.5, note: null }],
    bees: 99, speed: 0, feed: -1, rest: 99, refill: 1000, whim: 2, gate: 99, quantize: 3,
  });
  assert.equal(clean.plants.length, 2);
  assert.equal(clean.plants[0].note, 127);
  assert.equal(clean.plants[1].note, null);
  assert.ok(clean.plants[0].x < 1 && clean.plants[0].y > 0);
  assert.equal(clean.bees, BEE_LIMITS.bees[1]);
  assert.equal(clean.speed, BEE_LIMITS.speed[0]);
  assert.equal(clean.feed, 0);
  assert.equal(clean.rest, BEE_LIMITS.rest[1]);
  assert.equal(clean.refill, BEE_LIMITS.refill[1]);
  assert.equal(clean.whim, 1);
  assert.equal(clean.gate, BEE_LIMITS.gate[1]);
  assert.equal(clean.quantize, 0);
  assert.deepEqual(normalizeBees({ plants: [] }).plants, []);
  // Settings saved before leafy plants listed flowers.
  assert.deepEqual(normalizeBees({ flowers: [flower('a', 0.5)] }).plants, [flower('a', 0.5)]);
  assert.throws(() => normalizeBees({ plants: new Array(17).fill({}) }), SongError);
  assert.throws(() => normalizeBees(3), SongError);
});

test('a track can use bees, and patterns saved before bees get an empty set', () => {
  const song = sampleSong();
  const [, bass] = song.tracks;
  song.patterns[0].sequencers = { [bass.id]: 'bees' };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, bass.id), 'bees');
  assert.deepEqual(clean.bees[bass.id], defaultBees());
  delete song.patterns[0].bees;
  delete song.patterns[0].sequencers;
  assert.deepEqual(normalizeSong(song).patterns[0].bees, {});
});
