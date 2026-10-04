import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AntSim } from '../client/ant-sim.js';
import { ANT_LIMITS, defaultAnts, nextNote, normalizeAnts } from '../shared/ants.js';
import { nextScaleNote } from '../shared/scale.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// Nest, middle and food in a row, 0.3 apart: an ant takes 0.3 beats a hop at speed 1.
const LINE = {
  ...defaultAnts(),
  nodes: [{ id: 'n', x: 0.1, y: 0.5, note: 60 }, { id: 'm', x: 0.4, y: 0.5, note: 63 }, { id: 'f', x: 0.7, y: 0.5, note: 67 }],
  paths: [['n', 'm'], ['m', 'f']],
  nest: 'n',
  food: 'f',
  ants: 1,
  speed: 1,
};

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('an ant walks out to the food and back home, reaching each node right on time', () => {
  const sim = new AntSim(LINE, seeded());
  const events = sim.advance(1.6);
  assert.deepEqual(events.map((e) => e.node), ['n', 'm', 'f', 'm', 'n', 'm']);
  [0, 0.3, 0.6, 0.9, 1.2, 1.5].forEach((t, i) => assert.ok(near(events[i].at, t), `${events[i].at} ≠ ${t}`));
});

test('carrying food home lays scent, louder on the way back out', () => {
  const sim = new AntSim({ ...LINE, evaporation: 0 }, seeded());
  const events = sim.advance(1.6);
  assert.equal(events[1].strength, 0);            // nothing laid yet on the way out
  assert.ok(sim.scent.get('m-n') > 0);
  assert.ok(near(sim.scent.get('m-n'), sim.scent.get('f-m')));   // the whole route gets the same
  assert.equal(events[5].strength, 1);            // back out along the strongest path
});

test('scent fades by its evaporation per beat', () => {
  const sim = new AntSim({ ...LINE, evaporation: 0.5 }, seeded());
  sim.advance(1);                                 // back from the food to the middle, scent laid behind it
  const laid = sim.scent.get('f-m');
  sim.ants.clear();
  sim.advance(2);
  assert.ok(near(sim.scent.get('f-m'), laid * 0.25));
});

test('the colony comes to prefer the shorter of two routes', () => {
  // Nest and food with two ways between: over a near node, or round a far one.
  const config = {
    ...defaultAnts(),
    nodes: [
      { id: 'n', x: 0.1, y: 0.5, note: 60 }, { id: 'f', x: 0.9, y: 0.5, note: 72 },
      { id: 's', x: 0.5, y: 0.4, note: 63 }, { id: 'l', x: 0.5, y: 0.95, note: 67 },
    ],
    paths: [['n', 's'], ['s', 'f'], ['n', 'l'], ['l', 'f']],
    nest: 'n', food: 'f', ants: 4, speed: 1, evaporation: 0.1, adventure: 0,
  };
  const sim = new AntSim(config, seeded(7));
  sim.advance(20);
  const later = sim.advance(100).map((e) => e.node);
  const count = (n) => later.filter((x) => x === n).length;
  assert.ok(count('s') > 3 * count('l'), `short ${count('s')} vs long ${count('l')}`);
});

test('arrivals split across calls land at the same times as one long call', () => {
  const config = { ...defaultAnts(), adventure: 0.5 };
  const whole = new AntSim(config, seeded(3)).advance(8).map((e) => [e.node, e.at]);
  const sim = new AntSim(config, seeded(3));
  const parts = [];
  for (let i = 0; i < 32; i++) parts.push(...sim.advance(0.25).map((e) => [e.node, e.at + i * 0.25]));
  assert.equal(parts.length, whole.length);
  parts.forEach(([node, at], i) => {
    assert.equal(node, whole[i][0]);
    assert.ok(Math.abs(at - whole[i][1]) < 1e-9);
  });
});

test('ants leave the nest a little apart', () => {
  const sim = new AntSim({ ...LINE, ants: 3 }, seeded());
  // Leaving the nest is the only time the nest sounds with no scent behind it.
  const leaving = sim.advance(1.6).filter((e) => e.node === 'n' && e.strength === 0).map((e) => e.at);
  assert.equal(leaving.length, 3);
  [0, 0.75, 1.5].forEach((t, i) => assert.ok(near(leaving[i], t), `${leaving[i]} ≠ ${t}`));
});

test('edits reach a running colony: cut paths send ants home, and no nest means no ants', () => {
  const sim = new AntSim(LINE, seeded());
  sim.advance(0.45);                              // between the middle and the food
  const [ant] = sim.ants.values();
  assert.deepEqual([ant.from, ant.to], ['m', 'f']);
  sim.sync({ ...LINE, paths: [['n', 'm']] });
  assert.equal(ant.from, 'n');
  assert.equal(ant.carrying, false);
  // Moving a node keeps the ant the same share of the way along.
  sim.sync(LINE);
  sim.advance(0.15);
  const t = ant.t;
  sim.sync({ ...LINE, nodes: LINE.nodes.map((n) => (n.id === 'm' ? { ...n, x: 0.6 } : n)) });
  assert.equal(ant.t, t);
  sim.sync({ ...LINE, nest: null });
  assert.equal(sim.ants.size, 0);
});

test('a node with no paths keeps its ants waiting until one is drawn', () => {
  const sim = new AntSim({ ...LINE, paths: [] }, seeded());
  assert.deepEqual(sim.advance(2).map((e) => e.node), ['n']);   // out of the nest, and nowhere to go
  sim.sync(LINE);
  assert.deepEqual(sim.advance(0.35).map((e) => e.node), ['m']);
});

test('new nodes climb the minor pentatonic from the nest, or step through a drum kit', () => {
  assert.equal(nextScaleNote([60]), 63);
  assert.equal(nextScaleNote([60, 63, 65, 67, 70]), 72);
  assert.equal(nextScaleNote([57, 70], 57), 72);   // A minor: the next step above 70
  assert.equal(nextScaleNote([60, 96]), 60);       // past the top of the range: back to the root
  assert.equal(nextScaleNote([], 60), 60);
  assert.equal(nextScaleNote([36, 38], 36, { 36: 'Kick', 38: 'Snare', 42: 'Hat' }), 42);
  assert.equal(nextNote({ nodes: [{ note: 62 }, { id: 'n', note: 50 }], nest: 'n' }), 65);   // D minor, from the nest
});

test('ant colony settings are validated and clamped', () => {
  assert.deepEqual(normalizeAnts(defaultAnts()), defaultAnts());
  assert.deepEqual(normalizeAnts({}), defaultAnts());
  const clean = normalizeAnts({
    nodes: [{ id: 'a', x: -1, y: 2, note: 200 }, { id: 'b', x: 0.5, y: 0.5, note: 60 }, { id: 'a', x: 0, y: 0 }, { id: 'BAD' }],
    paths: [['a', 'b'], ['b', 'a'], ['a', 'a'], ['a', 'ghost'], 'a-b'],
    nest: 'b', food: 'b', ants: 99, speed: 0, evaporation: 2, adventure: -1, gate: 0, quantize: 3,
  });
  assert.deepEqual(clean.nodes.map((n) => n.id), ['a', 'b']);
  assert.equal(clean.nodes[0].note, 127);
  assert.ok(clean.nodes[0].x > 0 && clean.nodes[0].y < 1);
  assert.deepEqual(clean.paths, [['a', 'b']]);
  assert.equal(clean.nest, 'b');
  assert.equal(clean.food, null);                 // can't be the nest too
  assert.equal(clean.ants, ANT_LIMITS.ants[1]);
  assert.equal(clean.speed, ANT_LIMITS.speed[0]);
  assert.equal(clean.evaporation, 1);
  assert.equal(clean.adventure, 0);
  assert.equal(clean.quantize, defaultAnts().quantize);
  assert.equal(normalizeAnts({ nodes: [] }).nest, null);   // a cleared web stays cleared
  assert.throws(() => normalizeAnts({ nodes: new Array(17).fill({}) }), SongError);
  assert.throws(() => normalizeAnts({ paths: new Array(41).fill(['a', 'b']) }), SongError);
  assert.throws(() => normalizeAnts('busy'), SongError);
});

test('a track can use an ant colony, and patterns saved before ants get an empty set', () => {
  const song = sampleSong();
  const [, bass] = song.tracks;
  const [pattern] = song.patterns;
  pattern.sequencers = { [bass.id]: 'ants' };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, bass.id), 'ants');
  assert.deepEqual(clean.ants[bass.id], defaultAnts());
  delete song.patterns[0].ants;
  delete song.patterns[0].sequencers;
  assert.deepEqual(normalizeSong(song).patterns[0].ants, {});
});
