import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LilySim, seeded } from '../client/lily-sim.js';
import { LILY_LIMITS, defaultLilyPond, normalizeLilyPond } from '../shared/lilypond.js';
import { normalizeSong, sequencerOf, SongError } from '../shared/song.js';
import { sampleSong } from './fixtures.js';

const pad = (id, x, y, size, flower = false) => ({ id, x, y, size, note: 60, flower });
const config = (pads, extra = {}) => ({ ...defaultLilyPond(), pads, gusts: 0, evenness: 0, shower: 1, ...extra });

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;
// Settings with the seed left out, since every fresh pond has its own.
const unseeded = ({ seed, ...rest }) => rest;

test('a drip: perfectly even rain falls at the density, one drop a share of a beat apart', () => {
  const sim = new LilySim(config([], { density: 4, evenness: 1 }), seeded(1));
  const times = sim.advance(10).map((e) => e.at);
  assert.equal(times.length, 40);
  assert.ok(times.slice(1).every((t, i) => near(t - times[i], 0.25)), times.join());
});

test('rain at random falls at the density on average, at uneven moments', () => {
  const sim = new LilySim(config([], { density: 8 }), seeded(2));
  const drops = sim.advance(1000);
  assert.ok(Math.abs(drops.length / 1000 - 8) < 0.3, `${drops.length / 1000} a beat`);
  const gaps = drops.slice(1).map((e, i) => e.at - drops[i].at);
  assert.ok(gaps.some((g) => g < 0.05) && gaps.some((g) => g > 0.3), 'gaps all alike');
  // Spread over the whole pond.
  assert.ok(drops.every((d) => d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1));
  assert.ok(Math.abs(drops.filter((d) => d.x < 0.5).length / drops.length - 0.5) < 0.03);
});

test('a drop on a pad names it, and on a flower says so; one in open water names none', () => {
  const sim = new LilySim(config([pad('big', 0.3, 0.5, 0.2), pad('lily', 0.8, 0.5, 0.1, true)], { density: 16 }), seeded(3));
  const drops = sim.advance(1000);
  for (const d of drops) {
    const onBig = Math.hypot(d.x - 0.3, d.y - 0.5) <= 0.2;
    const onLily = Math.hypot(d.x - 0.8, d.y - 0.5) <= 0.1;
    assert.equal(d.pad, onBig ? 'big' : onLily ? 'lily' : null);
    assert.equal(d.flower, onLily);
  }
  // Each pad catches its area's share of the rain.
  const share = (id) => drops.filter((d) => d.pad === id).length / drops.length;
  assert.ok(Math.abs(share('big') - Math.PI * 0.04) < 0.01, `big caught ${share('big')}`);
  assert.ok(Math.abs(share('lily') - Math.PI * 0.01) < 0.005, `lily caught ${share('lily')}`);
});

test('where pads overlap, the one on top takes the drop', () => {
  const sim = new LilySim(config([pad('under', 0.5, 0.5, 0.2), pad('over', 0.5, 0.5, 0.1, true)], { density: 16 }), seeded(4));
  const drops = sim.advance(200).filter((d) => Math.hypot(d.x - 0.5, d.y - 0.5) <= 0.1);
  assert.ok(drops.length > 50);
  assert.ok(drops.every((d) => d.pad === 'over' && d.flower));
});

test('gusts make the rain come and go, but no heavier on the whole', () => {
  const windows = (gusts) => {
    const sim = new LilySim(config([], { density: 8, evenness: 1, gusts }), seeded(5));
    return Array.from({ length: 500 }, () => sim.advance(4).length);
  };
  const steady = windows(0);
  assert.ok(steady.every((n) => n >= 31 && n <= 33), steady.join());
  const gusty = windows(1);
  assert.ok(Math.min(...gusty) < 16 && Math.max(...gusty) > 48, `${Math.min(...gusty)}–${Math.max(...gusty)}`);
  const mean = gusty.reduce((a, b) => a + b, 0) / gusty.length;
  assert.ok(Math.abs(mean - 32) < 3, `${mean} a window`);
});

test('a shower only rains where it is, and the wind drifts it about the pond', () => {
  const still = new LilySim(config([], { density: 16, shower: 0.3, wind: 0 }), seeded(6));
  const at = still.shower();
  assert.equal(at.radius, 0.15);
  const drops = still.advance(100);
  assert.ok(drops.length > 100);
  assert.ok(drops.every((d) => Math.hypot(d.x - at.x, d.y - at.y) <= 0.15 + 1e-9));
  assert.deepEqual(still.shower(), at);
  // Drops beyond the pond fall on the bank, and aren't heard.
  assert.ok(drops.every((d) => d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1));

  const windy = new LilySim(config([], { density: 4, shower: 0.3, wind: 0.2 }), seeded(7));
  let last = windy.shower();
  let travelled = 0;
  for (let i = 0; i < 1000; i++) {
    windy.advance(0.1);
    const now = windy.shower();
    assert.ok(now.x >= 0 && now.x <= 1 && now.y >= 0 && now.y <= 1, `out at ${now.x}, ${now.y}`);
    // No faster than the wind (a little less when it turns back at a bank).
    const d = Math.hypot(now.x - last.x, now.y - last.y);
    assert.ok(d <= 0.02 + 1e-9, `jumped ${d}`);
    travelled += d;
    last = now;
  }
  assert.ok(travelled > 15, `travelled ${travelled}`);
  assert.equal(new LilySim(config([]), seeded(8)).shower().radius, null);
});

test('a repeated rain falls the same every time, whatever the pads', () => {
  const c = config([pad('a', 0.3, 0.3, 0.1)], { density: 6, gusts: 0.5, shower: 0.5, wind: 0.1, seed: 42 });
  const sim = new LilySim(c);
  sim.reseed();
  const first = sim.advance(4);
  sim.advance(3);
  // Pads moved and added in between change what it plays, not the rain.
  sim.sync({ ...c, pads: [pad('a', 0.6, 0.6, 0.2), pad('b', 0.2, 0.7, 0.1, true)] });
  sim.reseed();
  const again = sim.advance(4);
  assert.ok(first.length > 5);
  assert.deepEqual(again.map(({ at, x, y }) => ({ at, x, y })), first.map(({ at, x, y }) => ({ at, x, y })));
  assert.ok(again.some((d, i) => d.pad !== first[i].pad));
  // Another seed, another rain.
  sim.sync({ ...c, seed: 43 });
  sim.reseed();
  assert.notDeepEqual(sim.advance(4).map((d) => d.at), first.map((d) => d.at));
});

test('no rain, no drops: a lull holds the next drop back without losing it', () => {
  const sim = new LilySim(config([], { density: 4, evenness: 1 }), seeded(9));
  sim.weather.level = 0;
  sim.weather.left = 2;
  sim.pending = 0.5;
  assert.deepEqual(sim.advance(1.5), []);
  // The lull ends; the next gust is steady, since there are no gusts.
  const [next] = sim.advance(1);
  assert.ok(near(next.at, 0.5 + 0.125), `${next.at}`);
});

test('lily pond settings are validated and clamped', () => {
  const fresh = defaultLilyPond();
  assert.deepEqual(normalizeLilyPond(fresh), fresh);
  assert.deepEqual(unseeded(normalizeLilyPond({})), unseeded(fresh));
  const clean = normalizeLilyPond({
    pads: [{ id: 'a', x: 5, y: -5, size: 9, note: -3, flower: 'yes' }, { id: 'a' }, { id: 'B' }, 'pad', { id: 'b', flower: true }],
    density: 999, evenness: 2, gusts: -1, shower: 0, wind: 9, repeat: 1, seed: -4.5, gate: 99, quantize: 3,
  });
  assert.equal(clean.pads.length, 2);
  const [a, b] = clean.pads;
  assert.equal(a.size, LILY_LIMITS.size[1]);
  assert.ok(near(a.x, 1 - a.size) && near(a.y, a.size), 'a pad stays in the pond');
  assert.equal(a.note, 0);
  assert.equal(a.flower, false);
  assert.equal(b.flower, true);
  assert.equal(clean.density, LILY_LIMITS.density[1]);
  assert.equal(clean.evenness, 1);
  assert.equal(clean.gusts, 0);
  assert.equal(clean.shower, LILY_LIMITS.shower[0]);
  assert.equal(clean.wind, LILY_LIMITS.wind[1]);
  assert.equal(clean.repeat, false);
  assert.equal(clean.seed, 0);
  assert.equal(clean.gate, LILY_LIMITS.gate[1]);
  assert.equal(clean.quantize, 1);
  assert.deepEqual(normalizeLilyPond({ pads: [] }).pads, []);
  assert.throws(() => normalizeLilyPond({ pads: new Array(17).fill({}) }), SongError);
  assert.throws(() => normalizeLilyPond('rain'), SongError);
});

test('the default pond\'s pads sit apart, in the pond, two in flower, under a rain of its own', () => {
  const { pads } = defaultLilyPond();
  for (const p of pads) assert.ok(p.x - p.size >= 0 && p.x + p.size <= 1 && p.y - p.size >= 0 && p.y + p.size <= 1, p.id);
  for (const p of pads) for (const q of pads) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > p.size + q.size, `${p.id} overlaps ${q.id}`);
  assert.equal(pads.filter((p) => p.flower).length, 2);
  const drums = defaultLilyPond({ 36: 'Kick', 38: 'Snare' }).pads.map((p) => p.note);
  assert.deepEqual(drums.slice(0, 3), [36, 38, 36]);
  assert.notEqual(defaultLilyPond().seed, defaultLilyPond().seed);
});

test('a track can use the lily pond, and patterns saved before it get an empty one', () => {
  const song = sampleSong();
  const [, , keys] = song.tracks;
  song.patterns[0].sequencers = { [keys.id]: 'lilypond' };
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, keys.id), 'lilypond');
  assert.deepEqual(unseeded(clean.lilypond[keys.id]), unseeded(defaultLilyPond()));
  delete song.patterns[0].lilypond;
  delete song.patterns[0].sequencers;
  assert.deepEqual(normalizeSong(song).patterns[0].lilypond, {});
});
