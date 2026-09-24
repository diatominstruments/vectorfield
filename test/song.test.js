import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSong, normalizeSong, SongError } from '../shared/song.js';

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
  song.arrangement.push('nope');
  const clean = normalizeSong(song);
  assert.equal('ghost' in clean.patterns[0].notes, false);
  assert.deepEqual(clean.arrangement, [song.patterns[0].id]);
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
