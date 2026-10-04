import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FireflySim } from '../client/firefly-sim.js';
import { FIREFLY_LIMITS, defaultFireflies, normalizeFireflies } from '../shared/fireflies.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const fly = (id, x, rate = 1) => ({ id, x, y: 0.5, note: 60, rate });
const config = (flies, extra = {}) => ({ ...defaultFireflies(), flies, coupling: 0, drift: 0, ...extra });

/** A sim with each firefly's phase set. */
function withPhases(c, phases) {
  const sim = new FireflySim(c, seeded());
  for (const [id, phase] of Object.entries(phases)) sim.flies.get(id).phase = phase;
  return sim;
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a firefly on its own flashes steadily at its rate', () => {
  const sim = withPhases(config([fly('a', 0.5, 0.5)]), { a: 0 });
  const times = sim.advance(6.5).map((e) => e.at);
  assert.equal(times.length, 3);
  [2, 4, 6].forEach((t, i) => assert.ok(near(times[i], t)));
});

test('a flash sets off a nearly-ready neighbour in the same instant', () => {
  const sim = withPhases(config([fly('a', 0.4), fly('b', 0.5)], { coupling: 1, reach: 0.5 }), { a: 0.99, b: 0.8 });
  const [first, second] = sim.advance(0.05);
  assert.deepEqual([first.id, first.pulled, second.id, second.pulled], ['a', false, 'b', true]);
  assert.ok(near(first.at, second.at));
  // Both start their next cycle together.
  assert.equal(sim.flies.get('a').phase, sim.flies.get('b').phase);
});

test('a flash pulls a neighbour closer, but not one out of reach or just flashed', () => {
  const sim = withPhases(config([fly('a', 0.1), fly('b', 0.2), fly('c', 0.9)], { coupling: 1, reach: 0.4 }), { a: 0.999, b: 0.5, c: 0.5 });
  sim.advance(0.002);
  const b = sim.flies.get('b').phase;
  const c = sim.flies.get('c').phase;
  // b is a quarter of reach away, so at the flash (0.001 beats in) its phase
  // grows by half of three quarters, then climbs on for the last 0.001.
  assert.ok(near(b, 0.501 * (1 + 0.5 * 0.75) + 0.001), `b at ${b}`);
  assert.ok(c < 0.51, `c at ${c}`);               // too far to see the flash
});

test('coupled fireflies fall into step; uncoupled ones don\'t', () => {
  const flies = [fly('a', 0.4), fly('b', 0.45), fly('c', 0.5), fly('d', 0.55)];
  const lastCycle = (sim) => {
    sim.advance(40);
    return new Set(sim.advance(1).map((e) => e.at.toFixed(6))).size;
  };
  assert.equal(lastCycle(new FireflySim(config(flies, { coupling: 0.6, reach: 1 }), seeded(5))), 1);
  assert.equal(lastCycle(new FireflySim(config(flies), seeded(5))), 4);
});

test('drift makes each cycle a little fast or slow', () => {
  const sim = withPhases(config([fly('a', 0.5, 1)], { drift: 1 }), { a: 0 });
  const times = sim.advance(20).map((e) => e.at);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(gaps.every((g) => g > 0.85 && g < 1.18), gaps.join());
  assert.ok(new Set(gaps.map((g) => g.toFixed(4))).size > 1);
});

test('edits reach a running field: new fireflies join, removed ones go, the rest carry on', () => {
  const sim = withPhases(config([fly('a', 0.3), fly('b', 0.6)]), { a: 0.25, b: 0.5 });
  sim.sync(config([fly('a', 0.3, 2), fly('c', 0.7)]));
  assert.deepEqual([...sim.flies.keys()].sort(), ['a', 'c']);
  assert.equal(sim.flies.get('a').phase, 0.25);
  assert.ok(near(sim.advance(0.5).find((e) => e.id === 'a').at, 0.375));   // the rest of its cycle at its new rate
  sim.scatter();
  assert.notEqual(sim.flies.get('a').phase, 0);
});

test('firefly settings are validated and clamped', () => {
  assert.deepEqual(normalizeFireflies(defaultFireflies()), defaultFireflies());
  assert.deepEqual(normalizeFireflies({}), defaultFireflies());
  const clean = normalizeFireflies({
    flies: [{ id: 'a', x: 5, y: -5, note: -3, rate: 99 }, { id: 'a' }, { id: 'B' }, 'fly'],
    coupling: 2, reach: 0, drift: -1, restart: 'yes', gate: 99, quantize: 3,
  });
  assert.equal(clean.flies.length, 1);
  assert.equal(clean.flies[0].note, 0);
  assert.equal(clean.flies[0].rate, FIREFLY_LIMITS.rate[1]);
  assert.ok(clean.flies[0].x < 1 && clean.flies[0].y > 0);
  assert.equal(clean.coupling, 1);
  assert.equal(clean.reach, FIREFLY_LIMITS.reach[0]);
  assert.equal(clean.drift, 0);
  assert.equal(clean.restart, false);
  assert.equal(clean.gate, FIREFLY_LIMITS.gate[1]);
  assert.equal(clean.quantize, 0);
  assert.deepEqual(normalizeFireflies({ flies: [] }).flies, []);
  assert.throws(() => normalizeFireflies({ flies: new Array(17).fill({}) }), SongError);
  assert.throws(() => normalizeFireflies(3), SongError);
});

test('a track can use fireflies, and patterns saved before fireflies get an empty set', () => {
  const song = sampleSong();
  const [, , keys] = song.tracks;
  song.patterns[0].sequencers = { [keys.id]: 'fireflies' };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, keys.id), 'fireflies');
  assert.deepEqual(clean.fireflies[keys.id], defaultFireflies());
  delete song.patterns[0].fireflies;
  delete song.patterns[0].sequencers;
  assert.deepEqual(normalizeSong(song).patterns[0].fireflies, {});
});
