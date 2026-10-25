import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockTimes, newBlock } from '../shared/song.js';
import { songAnalysis } from '../shared/timing.js';
import { sampleSong } from './fixtures.js';
// The kit's own timing reader, which the package doesn't export: the
// analysis has to read the way one of the kit's own does.
import { Timing } from '../node_modules/gloaming-kit/src/timing.js';

/**
 * Four blocks of the sample song's pattern: an intro without drums, a drop
 * played twice, the intro again, and a block carrying on its section.
 * The bass holds one note a bar.
 */
function arcSong() {
  const song = sampleSong();
  const [drums, bass] = song.tracks;
  const pattern = song.patterns[0];
  pattern.notes[bass.id] = [{ step: 0, note: 36, velocity: 1, length: 16 }];
  const block = (section, patch) => ({ ...newBlock(pattern.id), section, ...patch });
  song.arrangement = [
    block('Intro', { mute: [drums.id] }),
    block('Drop', { repeat: 2 }),
    block('Intro', { mute: [drums.id] }),
    block(null),
  ];
  return song;
}

test('beats fall on every quarter note of the laid-out song, the first a downbeat', () => {
  const song = arcSong();
  song.bpm = 150;
  const a = songAnalysis(song);
  const end = blockTimes(song).at(-1).end;
  assert.equal(a.tempo, 150);
  assert.equal(a.downbeat, 0);
  assert.equal(a.duration, end);
  assert.equal(a.beats.length, Math.round(end / 0.4));
  a.beats.forEach((t, i) => assert.ok(Math.abs(t - i * 0.4) < 1e-3));
  assert.equal(a.strengths.length, a.beats.length);
});

test("a beat's strength is the step notes heard on it", () => {
  const a = songAnalysis(arcSong());
  // Intro: the bass on the one, nothing else. Drop: kick and bass on the one, kick alone after.
  assert.deepEqual(a.strengths.slice(0, 8), [0.5, 0, 0, 0, 1, 0.5, 0.5, 0.5]);
});

test('without step notes, beats take the stresses of the bar', () => {
  const song = arcSong();
  song.patterns[0].notes = {};
  assert.deepEqual(songAnalysis(song).strengths.slice(0, 5), [1, 0.5, 0.75, 0.5, 1]);
});

test("named sections give the analysis its sections, with repeats and drops", () => {
  const a = songAnalysis(arcSong());
  assert.deepEqual(a.sections.map((s) => [s.start, s.end]), [[0, 2], [2, 6], [6, 10]]);
  assert.deepEqual(a.sections.map((s) => s.like), [null, null, 0]);
  assert.deepEqual(a.sections.map((s) => s.drop), [false, true, false]);
  // Half the tracks playing is 6 dB down, a third of the way to silence;
  // the last section has the drums back for its second block.
  assert.deepEqual(a.sections.map((s) => s.level), ['mid', 'high', 'high']);
  assert.ok(Math.abs(a.sections[0].energy - (1 - 6.0206 / 18)) < 1e-3);
});

test('a song without section names has one section a block', () => {
  const song = arcSong();
  for (const b of song.arrangement) b.section = null;
  const a = songAnalysis(song);
  assert.equal(a.sections.length, 4);
  // The third block is the first again; the last plays the second's tracks, but once rather than twice.
  assert.deepEqual(a.sections.map((s) => s.like), [null, null, 0, null]);
});

test('the energy curve follows the arrangement, eased at the joins', () => {
  const song = arcSong();
  const a = songAnalysis(song);
  assert.equal(a.energy.rate, song.bpm / 60);
  assert.equal(a.energy.values.length, a.beats.length);
  const at = (t) => a.energy.values[Math.round(t * a.energy.rate)];
  assert.equal(at(4), 1);   // the middle of the drop
  assert.ok(at(0) < 0.7);
  assert.ok(at(2) > at(0) && at(2) < 1);   // easing into the drop
  assert.ok(a.energy.values.every((v) => v >= 0 && v <= 1));
});

test('a song with nothing playing has no energy, and no arrangement no analysis', () => {
  const song = arcSong();
  song.tracks = [];
  assert.ok(songAnalysis(song).sections.every((s) => s.energy === 0 && s.level === 'low'));
  song.arrangement = [];
  assert.equal(songAnalysis(song), null);
});

test("the kit reads the analysis: beats, bars, sections and the drop's triggers", () => {
  const timing = new Timing();
  timing.setAnalysis(songAnalysis(arcSong()));
  const fired = [];
  const frameAt = (time) => {
    const frame = { time };
    timing.update(frame, (name) => fired.push([name, time]));
    return frame;
  };
  let frame = frameAt(1.25);
  assert.equal(frame.beat.tempo, 120);
  assert.equal(frame.beat.index, 2);
  assert.ok(Math.abs(frame.beat.phase - 0.5) < 1e-6);
  assert.equal(frame.section.index, 0);
  assert.ok(Math.abs(frame.beat.until.drop - 0.75) < 1e-6);

  frameAt(1.9);
  frame = frameAt(2.01);
  assert.equal(frame.section.index, 1);
  assert.equal(frame.section.drop, true);
  const onTheOne = fired.filter(([, t]) => t === 2.01).map(([name]) => name).sort();
  assert.deepEqual(onTheOne, ['beat', 'downbeat', 'drop', 'phrase', 'section']);
});
