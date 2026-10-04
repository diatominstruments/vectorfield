import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TubuleSim } from '../client/tubule-sim.js';
import { CORE, TUBULE_LIMITS, defaultTubules, normalizeTubules, resection, ringAt, ringStart, sectionAt } from '../shared/tubules.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

const config = (extra = {}) => ({ ...defaultTubules(), catastrophe: 0, rescue: 0, ...extra });

/** A sim holding one tubule, growing from the centre, with nothing random left to happen. */
function oneTubule(extra = {}) {
  const sim = new TubuleSim(config({ count: 1, nucleation: 0, ...extra }));
  sim.tubules.set('a', { id: 'a', angle: 0, length: 0, growing: true, ring: -1 });
  return sim;
}

const FOUR_RINGS = { sections: 1, rings: [[60], [64], [67], [71]] };

test('rings split the space between the core and the edge evenly', () => {
  assert.equal(ringAt(CORE / 2, 4), -1);
  assert.equal(ringAt(CORE, 4), 0);
  assert.equal(ringAt(ringStart(2, 4) + 1e-9, 4), 2);
  assert.equal(ringAt(1, 4), 3);
  assert.equal(ringStart(4, 4), 1);
});

test('sections are numbered clockwise from twelve o\'clock', () => {
  const up = -Math.PI / 2;
  assert.deepEqual([up + 0.1, 0.1, Math.PI / 2 + 0.1, Math.PI + 0.1].map((a) => sectionAt(a, 4)), [0, 1, 2, 3]);
  assert.equal(sectionAt(up - 0.1, 6), 5);
  assert.equal(sectionAt(up + 0.1 + 4 * Math.PI, 3), 0);
});

test('re-cutting a ring keeps each direction on the note it had', () => {
  assert.deepEqual(resection([1, 2, 3, 4], 6), [1, 2, 2, 3, 4, 4]);
  assert.deepEqual(resection([1, 2, 3, 4], 2), [2, 4]);
  assert.deepEqual(resection([7], 3), [7, 7, 7]);
});

test('a growing tubule enters each ring at exactly the right time, then stalls at the edge', () => {
  const growth = 0.1;
  const sim = oneTubule({ growth, ...FOUR_RINGS });
  const entries = sim.advance(20);
  assert.deepEqual(entries.map((e) => e.ring), [0, 1, 2, 3]);
  entries.forEach((e, i) => assert.ok(Math.abs(e.at - ringStart(i, 4) / growth) < 1e-9, `ring ${i} at ${e.at}`));
  assert.equal(sim.tubules.get('a').length, 1);
  assert.deepEqual([...sim.voices().keys()], ['a:3']);   // still holding the outer ring
});

test('a tubule sounds the zone in its own section', () => {
  const sim = oneTubule({ growth: 0.5, sections: 4, rings: [[60, 62, 64, 65], [67, 69, 71, 72]] });
  sim.tubules.get('a').angle = Math.PI * 0.75;   // down and to the left: the third section
  const [first] = sim.advance(1.5);
  assert.deepEqual([first.ring, first.section], [0, 2]);
  assert.deepEqual([...sim.voices().values()], [{ ring: 1, section: 2 }]);
});

test('sounding the whole tubule holds every ring it reaches, dropping them as it shrinks', () => {
  const sim = oneTubule({ growth: 1, shrink: 1, sound: 'whole', ...FOUR_RINGS });
  sim.advance(0.5);
  assert.deepEqual([...sim.voices().keys()], ['a:0', 'a:1']);
  sim.config.catastrophe = 1e9;
  sim.advance(0.001);
  sim.config.catastrophe = 0;
  assert.equal(sim.tubules.get('a').growing, false);
  assert.deepEqual([...sim.voices().keys()], ['a:0', 'a:1']);   // collapsing, still reaching both
  const heard = [];
  sim.advance(1, () => heard.push(sim.voices().size));
  assert.deepEqual(heard.filter((n, i) => n !== heard[i - 1]), [1, 0]);   // outer ring first
  assert.equal(sim.tubules.has('a'), false);
});

test('events split across calls land at the same times as one long call', () => {
  const whole = oneTubule().advance(16).map((e) => e.at);
  const sim = oneTubule();
  const pieces = [];
  for (let i = 0; i < 64; i++) pieces.push(...sim.advance(0.25).map((e) => e.at + i * 0.25));
  assert.equal(pieces.length, whole.length);
  pieces.forEach((t, i) => assert.ok(Math.abs(t - whole[i]) < 1e-9));
});

test('at the tip, a catastrophe silences the tubule and it shrinks away', () => {
  const sim = oneTubule({ growth: 0.5, shrink: 1 });
  sim.advance(1);
  assert.equal(sim.voices().size, 1);
  sim.config.catastrophe = 1e9;   // collapse straight away
  assert.deepEqual(sim.advance(0.01), []);
  assert.equal(sim.voices().size, 0);
  assert.equal(sim.tubules.get('a').growing, false);
  sim.config.catastrophe = 0;
  sim.advance(1);
  assert.equal(sim.tubules.has('a'), false);
});

test('over a long run, tubules stay in the cell, under the limit, and turn over', () => {
  const sim = new TubuleSim({ ...defaultTubules(), sound: 'whole', count: 6, growth: 0.3, catastrophe: 0.3, rescue: 0.3, nucleation: 1 });
  const seen = new Set();
  const rings = sim.config.rings.length;
  for (let i = 0; i < 2000; i++) {
    sim.advance(0.25);
    assert.ok(sim.tubules.size <= 6);
    for (const t of sim.tubules.values()) {
      seen.add(t.id);
      assert.ok(t.length >= 0 && t.length <= 1, `length ${t.length}`);
      // The ring it keeps track of is where its tip really is.
      assert.ok(Math.abs(t.ring - ringAt(t.length, rings)) <= (t.length === ringStart(t.ring + 1, rings) ? 1 : 0), `ring ${t.ring} at ${t.length}`);
    }
  }
  assert.ok(seen.size > 30, `only ${seen.size} tubules in 500 beats`);
});

test('lowering the limit collapses the newest growing tubules', () => {
  const sim = new TubuleSim(config({ count: 4, nucleation: 1e6 }));
  sim.advance(0.01);
  assert.equal(sim.tubules.size, 4);
  sim.sync({ ...sim.config, count: 2 });
  assert.deepEqual([...sim.tubules.values()].map((t) => t.growing), [true, true, false, false]);
});

test('microtubule settings are validated and clamped', () => {
  const clean = normalizeTubules({ sections: 2, count: 99, growth: -1, rings: [[1, 200], [64.4, 60, 62, 64]], sound: 'loud', hold: 'yes', gate: 0 });
  assert.equal(clean.count, TUBULE_LIMITS.count[1]);
  assert.equal(clean.growth, TUBULE_LIMITS.growth[0]);
  assert.deepEqual(clean.rings, [[1, 127], [60, 64]]);   // clamped, and re-cut to two sections
  assert.equal(clean.sound, 'tip');
  assert.equal(clean.hold, true);
  assert.equal(clean.gate, TUBULE_LIMITS.gate[0]);
  assert.equal(normalizeTubules({ sections: 5 }).sections, 4);            // not an offered count: the default
  assert.deepEqual(normalizeTubules({}).rings, defaultTubules().rings);
  assert.throws(() => normalizeTubules({ rings: new Array(9).fill([60]) }), SongError);
  assert.throws(() => normalizeTubules('fast'), SongError);
});

test('a track can use microtubules, and keeps its settings when it switches away', () => {
  const song = sampleSong();
  const [drums, bass, keys] = song.tracks;
  const [pattern] = song.patterns;
  pattern.sequencers = { [keys.id]: 'tubules', [bass.id]: 'bounce' };
  pattern.tubules = { [drums.id]: { ...defaultTubules(), count: 3 }, ghost: defaultTubules() };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, keys.id), 'tubules');
  assert.ok(clean.tubules[keys.id]);                   // settings filled in
  assert.equal(sequencerOf(clean, drums.id), 'steps');
  assert.equal(clean.tubules[drums.id].count, 3);      // kept while unused
  assert.equal('ghost' in clean.tubules, false);       // dangling track dropped
  assert.ok(clean.bounce[bass.id]);
});

test('rings saved before sections become one section each', () => {
  const clean = normalizeTubules({ rings: [48, 55, 60] });
  assert.equal(clean.sections, 1);
  assert.deepEqual(clean.rings, [[48], [55], [60]]);
});

test('patterns saved before microtubules get an empty set', () => {
  const song = sampleSong();
  delete song.patterns[0].tubules;
  assert.deepEqual(normalizeSong(song).patterns[0].tubules, {});
});
