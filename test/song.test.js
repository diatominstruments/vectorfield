import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSong, normalizeSong, blockTimes, visualsInEffect, newBlock, newVisual, SongError } from '../shared/song.js';

test('the default song is already normal', () => {
  const song = defaultSong();
  assert.deepEqual(normalizeSong(song), song);
});

test('params are clamped to the instrument schema', () => {
  const song = defaultSong();
  song.tracks[1].instrument.params.cutoff = 1e9;
  song.tracks[1].instrument.params.bogus = 1;
  const clean = normalizeSong(song);
  assert.equal(clean.tracks[1].instrument.params.cutoff, 16000);
  assert.equal('bogus' in clean.tracks[1].instrument.params, false);
});

test('dangling references are dropped', () => {
  const song = defaultSong();
  song.patterns[0].notes.ghost = [{ step: 0, note: 60, velocity: 1, length: 1 }];
  song.arrangement.push({ id: 'nope', pattern: 'nope', visuals: [] });
  const clean = normalizeSong(song);
  assert.equal('ghost' in clean.patterns[0].notes, false);
  assert.deepEqual(clean.arrangement.map((b) => b.pattern), [song.patterns[0].id]);
});

test('notes are kept inside their pattern', () => {
  const song = defaultSong();
  const [drums] = song.tracks;
  song.patterns[0].notes[drums.id] = [
    { step: 15, note: 36, velocity: 1, length: 8 },   // runs past the end
    { step: 16, note: 36, velocity: 1, length: 1 },   // starts past the end
  ];
  assert.deepEqual(normalizeSong(song).patterns[0].notes[drums.id], [{ step: 15, note: 36, velocity: 1, length: 1 }]);
});

test('structural problems throw', () => {
  assert.throws(() => normalizeSong({ tracks: 'x' }), SongError);
  const song = defaultSong();
  song.tracks[0].id = '../etc';
  assert.throws(() => normalizeSong(song), SongError);
});

test('songs saved with bare pattern ids upgrade to blocks', () => {
  const song = defaultSong();
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
  const song = defaultSong();
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

test('block times follow pattern lengths and tempo', () => {
  const song = defaultSong();
  song.arrangement.push({ ...song.arrangement[0], id: 'second' });
  song.bpm = 120;   // a 16-step bar is 2 s
  assert.deepEqual(blockTimes(song), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});

test('blocks without visuals continue the previous visuals', () => {
  const song = defaultSong();
  const pid = song.patterns[0].id;
  const road = newVisual('road');
  song.arrangement = [newBlock(pid), newBlock(pid, [road]), newBlock(pid), newBlock(pid), newBlock(pid, [newVisual('tunnel')])];
  const inEffect = visualsInEffect(song);
  assert.deepEqual(inEffect.map((e) => e.source), [-1, 1, 1, 1, 4]);
  assert.equal(inEffect[3].visuals[0], road);
  assert.deepEqual(inEffect[0].visuals, []);
});

test('main mix effects are validated like track effects', () => {
  const song = defaultSong();
  song.mix.effects = [{ id: 'delay', params: { mix: 5 } }];
  const clean = normalizeSong(song);
  assert.equal(clean.mix.effects[0].id, 'delay');
  assert.equal(clean.mix.effects[0].params.mix, 1);
  song.mix.effects = [{ id: 'mono-synth', params: {} }];
  assert.throws(() => normalizeSong(song), SongError);
});

test('songs saved before the main mix get an empty one', () => {
  const song = defaultSong();
  delete song.mix;
  assert.deepEqual(normalizeSong(song).mix, { effects: [] });
});
