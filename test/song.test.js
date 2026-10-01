import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSong, normalizeSong, blockTimes, stylesInEffect, visualsInEffect, newBlock, newVisual, copyBlock, removeBlock,
  nextBlock, playOrder, sections, automationValue, LIMITS, SongError,
} from '../shared/song.js';
import { sampleSong } from './fixtures.js';

test('a new song is a blank canvas', () => {
  const song = defaultSong();
  assert.deepEqual(song.tracks, []);
  assert.equal(song.patterns.length, 1);
  assert.deepEqual(song.patterns[0].notes, {});
  assert.deepEqual(song.arrangement.map((b) => b.visuals), [[]]);
  assert.deepEqual(normalizeSong(song), song);
});

test('a filled-in song is already normal', () => {
  const song = sampleSong();
  assert.deepEqual(normalizeSong(song), song);
});

test('params are clamped to the instrument schema', () => {
  const song = sampleSong();
  song.tracks[1].instrument.params.cutoff = 1e9;
  song.tracks[1].instrument.params.bogus = 1;
  const clean = normalizeSong(song);
  assert.equal(clean.tracks[1].instrument.params.cutoff, 16000);
  assert.equal('bogus' in clean.tracks[1].instrument.params, false);
});

test('dangling references are dropped', () => {
  const song = sampleSong();
  song.patterns[0].notes.ghost = [{ step: 0, note: 60, velocity: 1, length: 1 }];
  song.arrangement.push({ id: 'nope', pattern: 'nope', visuals: [] });
  const clean = normalizeSong(song);
  assert.equal('ghost' in clean.patterns[0].notes, false);
  assert.deepEqual(clean.arrangement.map((b) => b.pattern), [song.patterns[0].id]);
});

test('notes are kept inside their pattern', () => {
  const song = sampleSong();
  const [drums] = song.tracks;
  song.patterns[0].notes[drums.id] = [
    { step: 15, note: 36, velocity: 1, length: 8 },   // runs past the end
    { step: 16, note: 36, velocity: 1, length: 1 },   // starts past the end
  ];
  assert.deepEqual(normalizeSong(song).patterns[0].notes[drums.id], [{ step: 15, note: 36, velocity: 1, length: 1 }]);
});

test('structural problems throw', () => {
  assert.throws(() => normalizeSong({ tracks: 'x' }), SongError);
  const song = sampleSong();
  song.tracks[0].id = '../etc';
  assert.throws(() => normalizeSong(song), SongError);
});

test('songs saved with bare pattern ids upgrade to blocks', () => {
  const song = sampleSong();
  const pid = song.patterns[0].id;
  song.arrangement = [pid, pid];
  delete song.look;
  const clean = normalizeSong(song);
  assert.equal(clean.arrangement.length, 2);
  assert.notEqual(clean.arrangement[0].id, clean.arrangement[1].id);
  assert.deepEqual(clean.arrangement[0].visuals, []);
  assert.equal(clean.look.background, '#0a0a12');
});

test('visuals: signal specs stay inside the closed language', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  block.visuals[0].bind = { swell: { band: 'bass', gain: 99, smooth: 0.1 }, jolt: 'snare' };
  block.style = { background: '#FF0000', lineWidth: 50, fontFamily: 'Comic Sans' };
  const clean = normalizeSong(song).arrangement[0];
  assert.deepEqual(clean.visuals[0].bind, { swell: { band: 'bass', gain: 10, smooth: 0.1 }, jolt: 'snare' });
  assert.deepEqual(clean.style, { background: '#ff0000', lineWidth: 8 });

  for (const bad of [{ eval: '1+1' }, 'kick', { sum: new Array(20).fill('mid') }]) {
    block.visuals[0].bind = { swell: bad };
    assert.throws(() => normalizeSong(song), SongError);
  }
});

test('visuals: grid options keep their drawing, bounded', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  const glyph = ['2..1', '.21.', '#  x'];
  block.visuals[0].options = {
    glyph,
    matrix: [[0, 1, 2], [9.4, 12, -1]],
    huge: Array(33).fill('1'),
    wide: ['1'.repeat(33)],
    mixed: ['11', { row: 1 }],
    control: ['1\n1'],
  };
  const clean = normalizeSong(song).arrangement[0];
  assert.deepEqual(clean.visuals[0].options, { glyph, matrix: ['012', '990'] });
});

test('block times follow pattern lengths and tempo', () => {
  const song = sampleSong();
  song.arrangement.push({ ...song.arrangement[0], id: 'second' });
  song.bpm = 120;   // a 16-step bar is 2 s
  assert.deepEqual(blockTimes(song), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});

test('blocks without visuals continue the previous visuals', () => {
  const song = sampleSong();
  const pid = song.patterns[0].id;
  const road = newVisual('road');
  song.arrangement = [newBlock(pid), newBlock(pid, [road]), newBlock(pid), newBlock(pid), newBlock(pid, [newVisual('tunnel')])];
  const inEffect = visualsInEffect(song);
  assert.deepEqual(inEffect.map((e) => e.source), [-1, 1, 1, 1, 4]);
  assert.equal(inEffect[3].visuals[0], road);
  assert.deepEqual(inEffect[0].visuals, []);
});

test('block style changes carry on until a later block changes them', () => {
  const song = sampleSong();
  const pid = song.patterns[0].id;
  song.arrangement = [newBlock(pid), newBlock(pid), newBlock(pid), newBlock(pid), newBlock(pid)];
  song.arrangement[1].style = { lineColor: '#ff0000', background: '#000000' };
  song.arrangement[3].style = { lineColor: '#00ff00' };
  assert.deepEqual(stylesInEffect(song), [
    null,
    { lineColor: '#ff0000', background: '#000000' },
    { lineColor: '#ff0000', background: '#000000' },
    { lineColor: '#00ff00', background: '#000000' },   // only the line colour changes
    { lineColor: '#00ff00', background: '#000000' },
  ]);
  assert.equal(song.arrangement[1].style.lineColor, '#ff0000');   // blocks' own changes untouched
});

test('main mix effects are validated like track effects', () => {
  const song = sampleSong();
  song.mix.effects = [{ id: 'delay', params: { mix: 5 } }];
  const clean = normalizeSong(song);
  assert.equal(clean.mix.effects[0].id, 'delay');
  assert.equal(clean.mix.effects[0].params.mix, 1);
  song.mix.effects = [{ id: 'mono-synth', params: {} }];
  assert.throws(() => normalizeSong(song), SongError);
});

/** A song of `n` blocks, all playing its one pattern. */
function blocks(n) {
  const song = sampleSong();
  const pid = song.patterns[0].id;
  song.arrangement = Array.from({ length: n }, () => newBlock(pid));
  return song;
}

test('songs saved before block options get the defaults', () => {
  const song = sampleSong();
  for (const b of song.arrangement) for (const key of ['repeat', 'mute', 'section', 'follow']) delete b[key];
  delete song.loop;
  const clean = normalizeSong(song);
  assert.equal(clean.loop, null);
  assert.deepEqual(
    clean.arrangement.map(({ repeat, mute, section, follow }) => ({ repeat, mute, section, follow })),
    [{ repeat: 1, mute: [], section: null, follow: [] }],
  );
});

test('block options are cleaned', () => {
  const song = blocks(2);
  const [a, b] = song.arrangement;
  const drums = song.tracks[0].id;
  Object.assign(a, {
    repeat: 99, mute: [drums, drums, 'ghost'], section: '  Chorus  ',
    follow: [{ to: b.id, weight: 50 }, { to: b.id, weight: 1 }, { to: 'nowhere', weight: 1 }, { to: null, weight: 0 }],
  });
  b.section = '   ';
  song.loop = 'nowhere';
  const clean = normalizeSong(song);
  const [ca, cb] = clean.arrangement;
  assert.equal(ca.repeat, 16);
  assert.deepEqual(ca.mute, [drums]);
  assert.equal(ca.section, 'Chorus');
  assert.deepEqual(ca.follow, [{ to: b.id, weight: 9 }, { to: null, weight: 1 }]);
  assert.equal(cb.section, null);
  assert.equal(clean.loop, null);

  song.loop = b.id;
  assert.equal(normalizeSong(song).loop, b.id);
});

test('repeats lengthen a block', () => {
  const song = blocks(2);
  song.bpm = 120;   // a 16-step bar is 2 s
  song.arrangement[0].repeat = 3;
  assert.deepEqual(blockTimes(song), [{ start: 0, end: 6 }, { start: 6, end: 8 }]);
});

test('the next block: in order, then the loop, or the end', () => {
  const song = blocks(3);
  assert.equal(nextBlock(song, 0), 1);
  assert.equal(nextBlock(song, 2), -1);
  song.loop = song.arrangement[1].id;
  assert.equal(nextBlock(song, 2), 1);
  assert.equal(playOrder(song), 'loops');
});

test('the next block: follow choices by weight', () => {
  const song = blocks(3);
  const [a, , c] = song.arrangement;
  a.follow = [{ to: c.id, weight: 3 }, { to: null, weight: 1 }];
  assert.equal(playOrder(song), 'varies');
  assert.equal(nextBlock(song, 0, () => 0), 2);
  assert.equal(nextBlock(song, 0, () => 0.74), 2);
  assert.equal(nextBlock(song, 0, () => 0.76), -1);   // `null` ends the song, loop or not
});

test('removing a block takes the loop and follow choices leading to it', () => {
  const song = blocks(3);
  const [a, b, c] = song.arrangement;
  song.loop = b.id;
  a.follow = [{ to: b.id, weight: 1 }, { to: c.id, weight: 1 }];
  removeBlock(song, 1);
  assert.equal(song.loop, null);
  assert.deepEqual(a.follow, [{ to: c.id, weight: 1 }]);
  assert.deepEqual(normalizeSong(song), song);
});

test('sections run from one name to the next', () => {
  const song = blocks(5);
  song.arrangement[1].section = 'Verse';
  song.arrangement[3].section = 'Chorus';
  assert.deepEqual(sections(song), [
    { name: null, from: 0, to: 1 },
    { name: 'Verse', from: 1, to: 3 },
    { name: 'Chorus', from: 3, to: 5 },
  ]);
  // A duplicate carries on its original's section instead of starting another.
  assert.equal(copyBlock(song.arrangement[3]).section, null);
});

test('songs saved before the main mix get an empty one', () => {
  const song = sampleSong();
  delete song.mix;
  assert.deepEqual(normalizeSong(song).mix, { effects: [] });
});

test('automation lanes are validated against their track\'s instrument', () => {
  const song = sampleSong();
  const [drums, bass] = song.tracks;
  const p = song.patterns[0];
  p.automation = [
    { id: 'a1', track: bass.id, param: 'cutoff', points: [{ step: 8, value: 1e9 }, { step: 0, value: 200 }, { step: 8, value: 300 }, { step: 99, value: 1 }, { step: 1.5, value: 1 }] },
    { id: 'a2', track: bass.id, param: 'cutoff', points: [] },   // same param twice
    { id: 'a3', track: drums.id, param: 'cutoff', points: [] },  // not a drum-synth param
    { id: 'a4', track: 'ghost', param: 'gain', points: [] },     // track gone
  ];
  const clean = normalizeSong(song).patterns[0].automation;
  assert.deepEqual(clean, [
    { id: 'a1', track: bass.id, param: 'cutoff', points: [{ step: 0, value: 200 }, { step: 8, value: 16000 }] },
  ]);

  // The limit is per track: each of two tracks may have a full set.
  const lanes = (track, params) => params.map((param, i) => ({ id: `${param}${i}`.toLowerCase(), track: track.id, param, points: [] }));
  p.automation = [...lanes(bass, ['cutoff', 'resonance', 'sub', 'glide']), ...lanes(drums, ['kickTune', 'kickPunch', 'kickDecay', 'kickLevel'])];
  assert.equal(normalizeSong(song).patterns[0].automation.length, 2 * LIMITS.automationLanes);
  p.automation.push(...lanes(bass, ['attack']));
  assert.throws(() => normalizeSong(song), SongError);
});

test('patterns saved before automation get none', () => {
  const song = sampleSong();
  delete song.patterns[0].automation;
  assert.deepEqual(normalizeSong(song).patterns[0].automation, []);
});

test('automation runs in straight lines between points and holds at the ends', () => {
  const points = [{ step: 4, value: 0 }, { step: 8, value: 1 }, { step: 12, value: 0.5 }];
  assert.equal(automationValue([], 3), null);
  assert.equal(automationValue(points, 0), 0);
  assert.equal(automationValue(points, 6), 0.5);
  assert.equal(automationValue(points, 10), 0.75);
  assert.equal(automationValue(points, 15.5), 0.5);
});
