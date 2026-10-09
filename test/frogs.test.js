import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrogSim } from '../client/frog-sim.js';
import { FROG_LIMITS, defaultFrogs, normalizeFrogs } from '../shared/frogs.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const frog = (id, x, rate = 1) => ({ id, x, y: 0.5, note: 60, rate });
const config = (frogs, extra = {}) => ({ ...defaultFrogs(), frogs, avoidance: 0, drift: 0, bout: 0, ...extra });

/** A sim with each frog's phase set. */
function withPhases(c, phases) {
  const sim = new FrogSim(c, seeded());
  for (const [id, phase] of Object.entries(phases)) sim.frogs.get(id).phase = phase;
  return sim;
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a frog on its own calls steadily at its rate', () => {
  const sim = withPhases(config([frog('a', 0.5, 0.5)]), { a: 0 });
  const times = sim.advance(6.5).map((e) => e.at);
  assert.equal(times.length, 3);
  [2, 4, 6].forEach((t, i) => assert.ok(near(times[i], t)));
});

test('a call moves a neighbour towards the opposite phase, but not one out of reach', () => {
  const sim = withPhases(config([frog('a', 0.1), frog('b', 0.2), frog('c', 0.9)], { avoidance: 1, reach: 0.4 }), { a: 0.999, b: 0.9, c: 0.9 });
  sim.advance(0.002);
  const b = sim.frogs.get('b').phase;
  const c = sim.frogs.get('c').phase;
  // b is a quarter of reach away, so at the call (0.001 beats in) its phase
  // moves three quarters of the way to one half, then climbs on for 0.001.
  const pushed = 0.901 + 0.75 * (0.5 - 0.901);
  assert.ok(near(b, pushed + 0.001), `b at ${b}`);
  assert.ok(near(c, 0.902), `c at ${c}`);   // too far to hear
  // A frog about to call holds back: it calls later than it would have.
  assert.ok(sim.advance(1).find((e) => e.id === 'b').at > 0.1);
});

test('two neighbours settle into alternation; frogs that can\'t hear each other don\'t', () => {
  const pair = [frog('a', 0.4), frog('b', 0.5)];
  const pattern = (sim) => {
    sim.advance(30);
    const calls = sim.advance(2);
    return { order: calls.map((e) => e.id).join(''), gaps: calls.slice(1).map((e, i) => e.at - calls[i].at) };
  };
  const chorus = pattern(new FrogSim(config(pair, { avoidance: 0.6, reach: 1 }), seeded(3)));
  assert.ok(/^(ab){2}$|^(ba){2}$/.test(chorus.order), chorus.order);
  assert.ok(chorus.gaps.every((g) => Math.abs(g - 0.5) < 1e-6), chorus.gaps.join());
  const alone = pattern(new FrogSim(config(pair), seeded(3)));
  assert.ok(alone.gaps.some((g) => Math.abs(g - 0.5) > 0.05), alone.gaps.join());
});

test('a round: three neighbours take turns', () => {
  const sim = new FrogSim(config([frog('a', 0.3), frog('b', 0.5), frog('c', 0.7)], { avoidance: 0.8, reach: 1 }), seeded(2));
  sim.advance(60);
  const calls = sim.advance(4);
  // A settled round: no two together, every frog gets its turn before any
  // calls twice, and the same three gaps come round each time — a little
  // slower in all than the beat they'd each keep alone, since each makes room.
  const gaps = calls.slice(1).map((e, i) => e.at - calls[i].at);
  assert.ok(gaps.every((g) => g > 0.25 && g < 0.5), gaps.join());
  assert.ok(gaps.slice(3).every((g, i) => Math.abs(g - gaps[i]) < 1e-6), gaps.join());
  for (let i = 0; i + 3 <= calls.length; i++) assert.equal(new Set(calls.slice(i, i + 3).map((e) => e.id)).size, 3);
});

test('bouts: after its calls a frog rests, deaf to the chorus, and the first call of each bout is marked', () => {
  const sim = withPhases(config([frog('a', 0.5, 1)], { bout: 2, rest: 3 }), { a: 0 });
  const calls = sim.advance(8.5);
  // Calls at 1 and 2, a rest of 3, then 6 and 7.
  assert.deepEqual(calls.map((e) => [Number(e.at.toFixed(6)), e.first]), [[1, true], [2, false], [6, true], [7, false]]);
  const pair = withPhases(config([frog('a', 0.4), frog('b', 0.5)], { avoidance: 1, reach: 1, bout: 1, rest: 10 }), { a: 0.999, b: 0.6 });
  pair.advance(0.002);
  assert.ok(pair.frogs.get('a').rest > 9.9);
  // b's call shortly after can't move a resting a.
  pair.frogs.get('b').phase = 0.999;
  pair.advance(0.002);
  assert.ok(pair.frogs.get('a').rest > 9.9 && pair.frogs.get('a').phase === 0);
});

test('drift makes each cycle a little fast or slow', () => {
  const sim = withPhases(config([frog('a', 0.5, 1)], { drift: 1 }), { a: 0 });
  const times = sim.advance(20).map((e) => e.at);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(gaps.every((g) => g > 0.85 && g < 1.18), gaps.join());
  assert.ok(new Set(gaps.map((g) => g.toFixed(4))).size > 1);
});

test('edits reach a running pond: new frogs join, removed ones go, the rest carry on', () => {
  const sim = withPhases(config([frog('a', 0.3), frog('b', 0.6)]), { a: 0.25, b: 0.5 });
  sim.sync(config([frog('a', 0.3, 2), frog('c', 0.7)]));
  assert.deepEqual([...sim.frogs.keys()].sort(), ['a', 'c']);
  assert.equal(sim.frogs.get('a').phase, 0.25);
  assert.ok(near(sim.advance(0.5).find((e) => e.id === 'a').at, 0.375));   // the rest of its cycle at its new rate
  sim.scatter();
  assert.notEqual(sim.frogs.get('a').phase, 0);
});

test('frog settings are validated and clamped', () => {
  assert.deepEqual(normalizeFrogs(defaultFrogs()), defaultFrogs());
  assert.deepEqual(normalizeFrogs({}), defaultFrogs());
  const clean = normalizeFrogs({
    frogs: [{ id: 'a', x: 5, y: -5, note: -3, rate: 99 }, { id: 'a' }, { id: 'B' }, 'frog'],
    avoidance: 2, reach: 0, drift: -1, bout: 99, rest: 0, restart: 'yes', gate: 99, quantize: 3,
  });
  assert.equal(clean.frogs.length, 1);
  assert.equal(clean.frogs[0].note, 0);
  assert.equal(clean.frogs[0].rate, FROG_LIMITS.rate[1]);
  assert.ok(clean.frogs[0].x < 1 && clean.frogs[0].y > 0);
  assert.equal(clean.avoidance, 1);
  assert.equal(clean.reach, FROG_LIMITS.reach[0]);
  assert.equal(clean.drift, 0);
  assert.equal(clean.bout, FROG_LIMITS.bout[1]);
  assert.equal(clean.rest, FROG_LIMITS.rest[0]);
  assert.equal(clean.restart, false);
  assert.equal(clean.gate, FROG_LIMITS.gate[1]);
  assert.equal(clean.quantize, 0);
  assert.deepEqual(normalizeFrogs({ frogs: [] }).frogs, []);
  assert.throws(() => normalizeFrogs({ frogs: new Array(13).fill({}) }), SongError);
  assert.throws(() => normalizeFrogs(3), SongError);
});

test('a track can use frogs, and patterns saved before frogs get an empty set', () => {
  const song = sampleSong();
  const [, , keys] = song.tracks;
  song.patterns[0].sequencers = { [keys.id]: 'frogs' };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, keys.id), 'frogs');
  assert.deepEqual(clean.frogs[keys.id], defaultFrogs());
  delete song.patterns[0].frogs;
  delete song.patterns[0].sequencers;
  assert.deepEqual(normalizeSong(song).patterns[0].frogs, {});
});
