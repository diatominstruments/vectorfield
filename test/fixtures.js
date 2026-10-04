import { defaultSong, newTrack, newVisual, newEffect } from '../shared/song.js';

/** A song with something in it: drums, bass and keys, a four-on-the-floor, and a visual. */
export function sampleSong() {
  const song = defaultSong();
  const drums = newTrack('drum-synth', 'Drums');
  const bass = newTrack('mono-synth', 'Bass');
  const keys = newTrack('fm-synth', 'Keys');
  keys.effects.push(newEffect('reverb'));
  song.tracks.push(drums, bass, keys);
  song.patterns[0].notes[drums.id] = [0, 4, 8, 12].map((step) => ({ step, note: 36, velocity: 1, length: 1 }));
  song.arrangement[0].visuals.push(newVisual('eq-bars'));
  return song;
}
