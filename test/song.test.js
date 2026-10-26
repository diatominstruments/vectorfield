import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSong, normalizeSong, blockTimes, stylesInEffect, transitionsInEffect, visualsInEffect, finishesInEffect, newBlock, newVisual, copyBlock, removeBlock,
  nextBlock, playOrder, sections, automationValue, newEffect, newTrack, pruneAutomation, pruneSidechains, inapplicableParams, LIMITS, SongError,
} from '../shared/song.js';
import { registry } from 'gloaming-instruments';
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

test("visuals: the song's timing, the sound's colour, and shaped envelopes", () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  const bind = {
    a: { beat: 4, shape: 'sine' },
    b: { pulse: 'beat', decay: 6, attack: 0.05, accent: true },
    c: { pulse: 8 },
    d: { rise: 'drop', seconds: 4, ease: 2, release: 0.5 },
    e: { energy: true },
    f: { energy: 'section', smooth: 1 },
    g: 'centroid',
    h: { band: 'flatness', smooth: 0.4 },
    i: { trigger: 'snare', decay: 3, attack: 0.04, shape: 'spring' },
    j: { trigger: 'drop', decay: 1 },
    k: { hold: 'downbeat', pick: 'cycle', steps: 4 },
    l: 'phrase',
  };
  block.visuals[0].bind = structuredClone(bind);
  assert.deepEqual(normalizeSong(song).arrangement[0].visuals[0].bind, bind);

  block.visuals[0].bind = {
    a: { beat: 500, shape: 'exp' },
    b: { pulse: 0, accent: 'yes', attack: 9 },
    c: { trigger: 'bass', shape: 'wobble' },
    d: { rise: 'section', seconds: 1000 },
  };
  assert.deepEqual(normalizeSong(song).arrangement[0].visuals[0].bind, {
    a: { beat: 64 },
    b: { pulse: 0.25, attack: 4 },
    c: { trigger: 'bass' },
    d: { rise: 'section', seconds: 60 },
  });

  for (const bad of [
    { beat: 'bar' }, { pulse: 'chorus' }, { rise: 'beatdrop' }, { rise: 4 }, { energy: 'loud' }, { energy: 1 },
    { relative: 'centroid' }, { trigger: 'centroid' }, { hold: 'bar' }, 'bar',
  ]) {
    block.visuals[0].bind = { swell: bad };
    assert.throws(() => normalizeSong(song), SongError, JSON.stringify(bad));
  }
});

test('visuals: a look may carry a palette, a halo and an atmosphere', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  song.look.palette = ['#5E4FA8', '#f2789f', '#ffdfa8'];
  song.look.halo = 3;
  song.look.atmosphere = 0.2;
  block.style = { palette: null, halo: 0 };
  block.visuals[0].style = { palette: ['#ffffff'] };
  let clean = normalizeSong(song);
  assert.deepEqual(clean.look.palette, ['#5e4fa8', '#f2789f', '#ffdfa8']);
  assert.equal(clean.look.halo, 1);
  assert.equal(clean.look.atmosphere, 0.2);
  assert.deepEqual(clean.arrangement[0].style, { palette: null, halo: 0 });
  // One stop is no ramp; eight is too many; a name or a bad colour isn't stops.
  assert.equal(clean.arrangement[0].visuals[0].style, undefined);
  for (const bad of [new Array(8).fill('#000000'), 'ember', ['#000000', 'red']]) {
    song.look.palette = bad;
    assert.equal(normalizeSong(song).look.palette, null);
  }
  // A song saved before these existed gets the kit's own defaults.
  delete song.look.palette;
  delete song.look.halo;
  delete song.look.atmosphere;
  clean = normalizeSong(song);
  assert.deepEqual([clean.look.palette, clean.look.halo, clean.look.atmosphere], [null, 1, 0.6]);
});

test("visuals: a visual's trail is bounded, and 0 turns off a default one", () => {
  const song = sampleSong();
  const [visual] = song.arrangement[0].visuals;
  for (const [trail, kept] of [[0.9, 0.9], [1, 0.98], [-1, 0], [0, 0], ['long', undefined]]) {
    visual.trail = trail;
    assert.equal(normalizeSong(song).arrangement[0].visuals[0].trail, kept);
  }
});

test('visuals: the finish, on the song and on blocks', () => {
  const song = sampleSong();
  song.arrangement.push(newBlock(song.patterns[0].id), newBlock(song.patterns[0].id), newBlock(song.patterns[0].id));
  const [a, b, c] = song.arrangement;
  song.finish = { preset: 'neon', grain: 1, tonemap: 'sepia', glow: 2 };
  a.finish = { bloom: 1.5, vignette: 0.4 };
  b.finish = { vignette: 0.1 };
  c.finish = { preset: 'film', exposure: 1.2 };
  const clean = normalizeSong(song);
  assert.deepEqual(clean.finish, { preset: 'neon', grain: 0.2 });
  assert.deepEqual(clean.arrangement.map((x) => x.finish), [a.finish, b.finish, c.finish, null]);
  // Changes carry on block to block; a preset starts again from itself.
  assert.deepEqual(finishesInEffect(clean), [
    { bloom: 1.5, vignette: 0.4 },
    { bloom: 1.5, vignette: 0.1 },
    { preset: 'film', exposure: 1.2 },
    { preset: 'film', exposure: 1.2 },
  ]);

  // A song saved before finishes existed keeps the kit's default; a block with nothing in its finish has none.
  delete song.finish;
  a.finish = { preset: 'shiny' };
  const old = normalizeSong(song);
  assert.deepEqual(old.finish, { preset: 'clean' });
  assert.equal(old.arrangement[0].finish, null);
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

test('visuals: every kit trigger can drive a slot', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  block.visuals[0].bind = { ring: 'onset', glow: { trigger: 'lull', decay: 0.3 }, flash: { trigger: 'clap', decay: 4 } };
  const clean = normalizeSong(song).arrangement[0];
  assert.deepEqual(clean.visuals[0].bind, block.visuals[0].bind);
});

test('visuals: signals that move on their own, and the newer combiners and modifiers', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  const bind = {
    a: { relative: 'rms', smooth: 1 },
    b: { intensity: 'mid', invert: true, offset: 0.2, quantize: 4 },
    c: { lfo: 0.05, shape: 'triangle', phase: 0.25 },
    d: { progress: true, quantize: 4 },
    e: { hold: 'snare', pick: 'cycle', steps: 3, smooth: 2 },
    f: { hold: 'lull', pick: { relative: 'treble' }, initial: 0.5 },
    g: { min: ['bass', { trigger: 'snare', decay: 2 }] },
    h: { mul: [{ relative: 'treble' }, { intensity: 'bass', curve: 2 }], clamp: true },
  };
  block.visuals[0].bind = structuredClone(bind);
  assert.deepEqual(normalizeSong(song).arrangement[0].visuals[0].bind, bind);

  block.visuals[0].bind = { a: { lfo: 500, shape: 'wobble', quantize: -3 } };
  assert.deepEqual(normalizeSong(song).arrangement[0].visuals[0].bind, { a: { lfo: 20, quantize: 0 } });

  for (const bad of [
    { relative: 'kick' }, { hold: 'kick' }, { hold: 'snare', pick: 'sometimes' }, { lfo: 'fast' }, { progress: 'yes' },
    { mul: new Array(20).fill('mid') },
  ]) {
    block.visuals[0].bind = { swell: bad };
    assert.throws(() => normalizeSong(song), SongError);
  }
});

test('visuals: placement, blending, opacity, colours and transitions are kept, bounded', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  Object.assign(block.visuals[0], {
    place: { x: 0.5, y: 0, w: 0.5, h: 9, rotate: 400, flip: 'x', zoom: 2 },
    clip: 'circle',
    blend: 'screen',
    opacity: { relative: 'bass', clamp: true },
    style: { lineColor: '#FFB347', fontFamily: 'Comic Sans' },
    transition: 'wipe-left',
    fade: 30,
  });
  const clean = normalizeSong(song).arrangement[0].visuals[0];
  assert.deepEqual(clean.place, { x: 0.5, w: 0.5, h: 2, rotate: 180, flip: 'x' });
  assert.equal(clean.clip, 'circle');
  assert.equal(clean.blend, 'screen');
  assert.deepEqual(clean.opacity, { relative: 'bass', clamp: true });
  assert.deepEqual(clean.style, { lineColor: '#ffb347' });
  assert.equal(clean.transition, 'wipe-left');
  assert.equal(clean.fade, 10);

  // Unknown names and settings that change nothing are left out entirely.
  Object.assign(block.visuals[0], {
    place: { x: 0, w: 1, flip: 'diagonal' }, clip: 'star', blend: 'source-over', opacity: 1, style: {}, transition: 'dissolve', fade: 'slow',
  });
  assert.deepEqual(Object.keys(normalizeSong(song).arrangement[0].visuals[0]), ['id', 'viz', 'bind', 'options']);

  block.visuals[0].opacity = 0.4;
  assert.equal(normalizeSong(song).arrangement[0].visuals[0].opacity, 0.4);
  block.visuals[0].opacity = { eval: '1' };
  assert.throws(() => normalizeSong(song), SongError);
});

test('visuals: longer text options and more of them, for the kit\'s richer visualizations', () => {
  const song = sampleSong();
  const [block] = song.arrangement;
  const ratios = '1:2,2:3,3:4,3:5,4:5,5:6,1:2:3,2:3:4:5';
  block.visuals[0].options = { ratios, ...Object.fromEntries('abcdefghijklmnop'.split('').map((k, i) => [k, i])) };
  const clean = normalizeSong(song).arrangement[0].visuals[0];
  assert.equal(clean.options.ratios, ratios);
  assert.equal(Object.keys(clean.options).length, 17);
  block.visuals[0].options = { text: 'x'.repeat(121) };
  assert.deepEqual(normalizeSong(song).arrangement[0].visuals[0].options, {});
});

test('the look: peak colour is a colour or off, its knee clamped', () => {
  const song = sampleSong();
  delete song.look.peakColor;
  delete song.look.peakAbove;
  let clean = normalizeSong(song);
  assert.equal(clean.look.peakColor, null);   // off unless a song turns it on
  assert.equal(clean.look.peakAbove, 0.8);

  song.look.peakColor = '#FFFFFF';
  song.look.peakAbove = 3;
  song.arrangement[0].style = { peakColor: null };   // a block can switch it off again
  clean = normalizeSong(song);
  assert.equal(clean.look.peakColor, '#ffffff');
  assert.equal(clean.look.peakAbove, 1);
  assert.deepEqual(clean.arrangement[0].style, { peakColor: null });

  song.arrangement[0].style = { peakColor: 'red', lineColor: null };
  assert.equal(normalizeSong(song).arrangement[0].style, null);
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

test('block transitions carry on until a later block changes them', () => {
  const song = sampleSong();
  const pid = song.patterns[0].id;
  song.arrangement = [newBlock(pid), newBlock(pid), newBlock(pid), newBlock(pid)];
  Object.assign(song.arrangement[1], { transition: 'wipe-left', fade: 1.2 });
  Object.assign(song.arrangement[3], { transition: 'iris' });
  assert.deepEqual(transitionsInEffect(song), [
    { transition: null, fade: null },
    { transition: 'wipe-left', fade: 1.2 },
    { transition: 'wipe-left', fade: 1.2 },
    { transition: 'iris', fade: 1.2 },
  ]);

  song.arrangement[2].transition = 'dissolve';
  song.arrangement[2].fade = -1;
  const clean = normalizeSong(song).arrangement;
  assert.equal(clean[2].transition, null);
  assert.equal(clean[2].fade, 0);
  delete song.arrangement[0].transition;   // saved before blocks had transitions
  assert.equal(normalizeSong(song).arrangement[0].transition, null);
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

test('automation lanes can sweep a track\'s effects, named by uid', () => {
  const song = sampleSong();
  const [, bass, keys] = song.tracks;
  const reverb = keys.effects[0];
  const p = song.patterns[0];
  p.automation = [
    { id: 'a1', track: keys.id, effect: reverb.uid, param: 'mix', points: [{ step: 0, value: 5 }] },
    { id: 'a3', track: keys.id, effect: reverb.uid, param: 'size', points: [] }, // rebuilds the impulse
    { id: 'a4', track: bass.id, effect: reverb.uid, param: 'mix', points: [] },  // not this track's effect
    { id: 'a5', track: keys.id, effect: 'gone', param: 'mix', points: [] },
    { id: 'a6', track: keys.id, effect: reverb.uid, param: 'mix', points: [] },  // same param twice
  ];
  assert.deepEqual(normalizeSong(song).patterns[0].automation, [
    { id: 'a1', track: keys.id, effect: reverb.uid, param: 'mix', points: [{ step: 0, value: 1 }] },
  ]);

  // An effect's lanes go when it does, and not before.
  keys.effects.push(newEffect('delay'));
  pruneAutomation(song);
  assert.equal(p.automation.length, 1);
  keys.effects.shift();
  pruneAutomation(song);
  assert.deepEqual(p.automation, []);
});

test('a sampler\'s lanes on sounds its bank doesn\'t have go', () => {
  const song = sampleSong();
  const kit = newTrack('sampler', 'Kit');
  song.tracks.push(kit);
  const p = song.patterns[0];
  const lane = (id, param) => ({ id, track: kit.id, param, points: [] });
  p.automation = [lane('a1', 'kickTune'), lane('a2', 'rimTune'), lane('a3', 'tambourineTune'), lane('a4', 'tune')];

  // The 909 has a rim but no tambourine; kick and the whole-kit tune are in every bank.
  assert.deepEqual(normalizeSong(song).patterns[0].automation.map((l) => l.param), ['kickTune', 'rimTune', 'tune']);
  assert.deepEqual([...inapplicableParams(registry.get('sampler'), kit.instrument.params)].filter((n) => n.endsWith('Tune')).sort(),
    ['pedalHatTune', 'tambourineTune']);

  // Dirt is the other way round.
  kit.instrument.params.bank = 'DIRT';
  pruneAutomation(song);
  assert.deepEqual(p.automation.map((l) => l.param), ['kickTune', 'tambourineTune', 'tune']);
});

test('effects saved before they had uids get them, unique in their chain', () => {
  const song = sampleSong();
  const [, , keys] = song.tracks;
  keys.effects = [{ id: 'reverb', params: {} }, { uid: 'same', id: 'delay', params: {} }, { uid: 'same', id: 'delay', params: {} }];
  song.mix.effects = [{ id: 'delay', params: {} }];
  const clean = normalizeSong(song);
  const uids = clean.tracks[2].effects.map((e) => e.uid);
  assert.equal(uids[1], 'same');
  assert.equal(new Set(uids).size, 3);
  assert.ok(uids.every((u) => /^[a-z0-9]{1,24}$/.test(u)));
  assert.match(clean.mix.effects[0].uid, /^[a-z0-9]{1,24}$/);
});

test('sidechains name another track, on effects that have one', () => {
  const song = sampleSong();
  const [drums, bass, keys] = song.tracks;
  const duck = { ...newEffect('compressor'), sidechain: drums.id };
  bass.effects = [
    duck,
    { ...newEffect('vocoder'), sidechain: bass.id },     // its own track
    { ...newEffect('delay'), sidechain: drums.id },      // no sidechain to feed
    { ...newEffect('vocoder'), sidechain: 'ghost' },     // no such track
  ];
  song.mix.effects = [{ ...newEffect('vocoder'), sidechain: keys.id }];
  const clean = normalizeSong(song);
  assert.deepEqual(clean.tracks[1].effects.map((e) => e.sidechain), [drums.id, undefined, undefined, undefined]);
  assert.equal(clean.mix.effects[0].sidechain, keys.id);
  assert.deepEqual(normalizeSong(clean), clean);

  // Deleting the source track leaves the effect listening to nothing.
  clean.tracks = clean.tracks.filter((t) => t.id !== drums.id);
  pruneSidechains(clean);
  assert.equal('sidechain' in clean.tracks[0].effects[0], false);
  assert.equal(clean.mix.effects[0].sidechain, keys.id);
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
