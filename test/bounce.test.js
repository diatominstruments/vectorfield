import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BounceSim } from '../client/bounce-sim.js';
import { BALL_RADIUS, defaultBounce, normalizeBounce, segmentAt } from '../shared/bounce.js';
import { defaultSong, normalizeSong, sequencerOf, SongError } from '../shared/song.js';

const config = (balls, extra = {}) => ({ ...defaultBounce(), jitter: 0, collide: false, speed: 1, balls, ...extra });

test('a ball hits walls at exactly the right times', () => {
  // Heading right at one box-width per beat from the centre: the first hit is
  // when its edge reaches the right wall, then one every (1 - 2r) beats.
  const sim = new BounceSim(config([{ id: 'a', x: 0.5, y: 0.3, vx: 1, vy: 0 }]));
  const hits = sim.advance(3);
  const gap = 1 - 2 * BALL_RADIUS;
  const expected = [0.5 - BALL_RADIUS, 0.5 - BALL_RADIUS + gap, 0.5 - BALL_RADIUS + 2 * gap];
  assert.equal(hits.length, 3);
  hits.forEach((h, i) => assert.ok(Math.abs(h.at - expected[i]) < 1e-9, `hit ${i} at ${h.at}`));
  assert.deepEqual(hits.map((h) => h.segment), [2, 7, 2]);   // right-upper, left-upper, right-upper
  assert.ok(hits.every((h) => Math.abs(h.strength - 1) < 1e-9));   // square-on
});

test('hits split across calls land at the same times as one long call', () => {
  const start = [{ id: 'a', x: 0.2, y: 0.7, vx: 0.8, vy: -0.6 }];
  const whole = new BounceSim(config(start)).advance(4).map((h) => h.at);
  const sim = new BounceSim(config(start));
  const pieces = [];
  for (let i = 0; i < 16; i++) pieces.push(...sim.advance(0.25).map((h) => h.at + i * 0.25));
  assert.equal(pieces.length, whole.length);
  pieces.forEach((t, i) => assert.ok(Math.abs(t - whole[i]) < 1e-6));
});

test('segments are numbered clockwise from the top-left', () => {
  assert.deepEqual(
    [segmentAt(0, 0.2, 0), segmentAt(0, 0.8, 0), segmentAt(1, 1, 0.2), segmentAt(1, 1, 0.8),
      segmentAt(2, 0.8, 1), segmentAt(2, 0.2, 1), segmentAt(3, 0, 0.8), segmentAt(3, 0, 0.2)],
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
});

test('with jitter and collisions, balls stay in the box and keep moving', () => {
  const balls = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, x: 0.1 + i * 0.1, y: 0.5, vx: Math.cos(i), vy: Math.sin(i) }));
  const sim = new BounceSim(config(balls, { jitter: 1, collide: true, speed: 4 }));
  let hits = 0;
  for (let i = 0; i < 400; i++) hits += sim.advance(0.25).length;
  for (const b of sim.balls.values()) {
    assert.ok(b.x >= BALL_RADIUS - 1e-9 && b.x <= 1 - BALL_RADIUS + 1e-9, `x ${b.x}`);
    assert.ok(b.y >= BALL_RADIUS - 1e-9 && b.y <= 1 - BALL_RADIUS + 1e-9, `y ${b.y}`);
    assert.ok(Math.hypot(b.vx, b.vy) > 0.01);
  }
  assert.ok(hits > 1000, `only ${hits} hits in 100 beats`);
});

test('edits reach a running simulation without resetting untouched balls', () => {
  const a = { id: 'a', x: 0.5, y: 0.5, vx: 1, vy: 0 };
  const sim = new BounceSim(config([a]));
  sim.advance(0.2);
  const moved = sim.balls.get('a').x;
  sim.sync(config([a, { id: 'b', x: 0.2, y: 0.2, vx: 0, vy: 1 }]));
  assert.equal(sim.balls.get('a').x, moved);        // kept its momentum
  assert.equal(sim.balls.get('b').x, 0.2);          // new ball at its start
  sim.sync(config([{ id: 'b', x: 0.2, y: 0.2, vx: 0, vy: 1 }]));
  assert.equal(sim.balls.has('a'), false);          // removed
});

test('bounce settings are validated and clamped', () => {
  const clean = normalizeBounce({ speed: 99, jitter: -1, walls: [1, 2], balls: [{ id: 'x', x: 5, y: 0.5, vx: 3, vy: 4 }], quantize: 3 });
  assert.equal(clean.speed, 4);
  assert.equal(clean.jitter, 0);
  assert.equal(clean.walls.length, 8);
  assert.equal(clean.quantize, 0);
  assert.equal(clean.balls[0].x, 1 - BALL_RADIUS);
  assert.ok(Math.abs(Math.hypot(clean.balls[0].vx, clean.balls[0].vy) - 1) < 1e-9);
  assert.throws(() => normalizeBounce({ balls: new Array(9).fill({ id: 'a' }) }), SongError);
});

test('each track in a pattern picks its own sequencer', () => {
  const song = defaultSong();
  const [drums, bass, keys] = song.tracks;
  const [pattern] = song.patterns;
  pattern.sequencers = { [keys.id]: 'bounce', [bass.id]: 'nonsense', ghost: 'bounce' };
  const clean = normalizeSong(song).patterns[0];
  assert.deepEqual(clean.sequencers, { [keys.id]: 'bounce' });   // junk and dangling tracks dropped
  assert.ok(clean.bounce[keys.id]);                                // settings filled in for the bouncer
  assert.equal(sequencerOf(clean, drums.id), 'steps');
  assert.equal(clean.notes[drums.id].length, 4);                   // drums still on the grid
});

test('switching a track back to steps keeps its bounce settings', () => {
  const song = defaultSong();
  const keys = song.tracks[2];
  const [pattern] = song.patterns;
  pattern.bounce = { [keys.id]: { ...defaultBounce(), speed: 2.5 } };
  pattern.sequencers = {};
  const clean = normalizeSong(song).patterns[0];
  assert.equal(sequencerOf(clean, keys.id), 'steps');
  assert.equal(clean.bounce[keys.id].speed, 2.5);
});

test('patterns saved with one pattern-wide bounce move it to its track', () => {
  const song = defaultSong();
  const [drums, , keys] = song.tracks;
  const [pattern] = song.patterns;
  pattern.kind = 'bounce';
  pattern.bounce = { ...defaultBounce(), track: keys.id, speed: 3 };
  delete pattern.sequencers;
  const clean = normalizeSong(song).patterns[0];
  assert.deepEqual(clean.sequencers, { [keys.id]: 'bounce' });
  assert.equal(clean.bounce[keys.id].speed, 3);
  assert.equal('track' in clean.bounce[keys.id], false);
  assert.equal(sequencerOf(clean, drums.id), 'steps');
  assert.equal('kind' in clean, false);
});
