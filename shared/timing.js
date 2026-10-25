/**
 * The song's timing for gloaming-kit, worked out from the song itself rather
 * than heard. The kit can analyse a decoded song, but the visuals follow the
 * engine's live output, which has nothing to decode, so left alone the kit
 * would only estimate the tempo as it plays: a few seconds to lock on, bars
 * counted from wherever it did, and no sections or drops. The song already
 * knows all of it exactly. The result has the shape of the kit's own
 * analyzeSong() result, for its setAnalysis():
 *
 *   { duration, tempo, beats, strengths, downbeat,
 *     energy: { rate, start, values }, sections: [{ start, end, energy, level, drop, like }] }
 *
 * Times are on the arrangement laid end to end, as blockTimes() places
 * blocks, which is where the engine's song time is however the song jumps.
 *
 * Beats fall every quarter note from the start, the first on a downbeat
 * (the kit counts 4/4). A beat's strength is how much lands on it: the
 * velocities of the step notes on that step, against the song's heaviest
 * beat.
 *
 * Energy is how full the arrangement is, since the song can't be measured
 * without playing it: each track playing in a block adds its gain, a little
 * more the busier it is, and the total is scaled the way the kit scales
 * loudness, 1 at the song's fullest block and 0 at 18 dB below. Generative
 * sequencers count as fairly busy, since their notes aren't known ahead.
 *
 * Sections are the song's named sections when it names any, else its
 * blocks. A section is `like` an earlier one with the same name, or the
 * same blocks; a `drop` is one that rises sharply to near the song's
 * fullest, by the kit's own measure.
 */

import { sections as namedSections, sequencerOf } from './song.js';

// The kit's own constants (gloaming-kit src/timing.js), so its section
// levels and drops mean the same here as in a song it analysed itself.
const STEPS_PER_BEAT = 4;
const ENERGY_SPAN = 18;        // dB from energy 1 down to 0
const ENERGY_SMOOTH = 1.5;     // seconds the energy curve is averaged over
const DROP_RISE = 0.2;
const DROP_LEVEL = 0.85;
const LEVELS = [0.45, 0.75];

/** How busy a generative sequencer's track counts as, its notes being unknown. */
const GENERATIVE_ACTIVITY = 0.75;

const round = (x) => Math.round(x * 1000) / 1000;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * How busy a track is in a pattern, 0..1: hits per beat or the share of the
 * pattern its notes sound for, whichever is more, by velocity. Null when it
 * plays nothing.
 */
function activity(pattern, trackId) {
  if (sequencerOf(pattern, trackId) !== 'steps') return GENERATIVE_ACTIVITY;
  const notes = pattern.notes[trackId] ?? [];
  if (!notes.length) return null;
  let hits = 0;
  let held = 0;
  for (const n of notes) {
    hits += n.velocity;
    held += n.velocity * Math.max(1, n.length);
  }
  return Math.min(1, Math.max(hits / (pattern.length / STEPS_PER_BEAT), held / pattern.length));
}

/** The kit's timing analysis for a song document (see above). Null for a song with nothing to play. */
export function songAnalysis(song) {
  const patternOf = new Map(song.patterns.map((p) => [p.id, p]));
  const beat = 60 / song.bpm;
  const step = beat / STEPS_PER_BEAT;

  // Each block: where it starts and ends in steps, its pattern, the tracks
  // heard in it, and how full it sounds.
  let at = 0;
  const blocks = song.arrangement.map((block) => {
    const pattern = patternOf.get(block.pattern);
    const heard = song.tracks.filter((t) => !t.mute && !block.mute.includes(t.id));
    let fullness = 0;
    for (const track of heard) {
      const busy = activity(pattern, track.id);
      if (busy !== null) fullness += track.gain * (0.5 + 0.5 * busy);
    }
    const start = at;
    at += pattern.length * block.repeat;
    return { block, pattern, heard, fullness, start, end: at };
  });
  const steps = at;
  if (!steps) return null;
  const duration = steps * step;

  const fullest = Math.max(...blocks.map((b) => b.fullness));
  for (const b of blocks) {
    b.energy = b.fullness > 0 ? clamp01(1 + (20 * Math.log10(b.fullness / fullest)) / ENERGY_SPAN) : 0;
  }

  // Beats, and the weight of the step notes landing on each.
  const count = Math.ceil(steps / STEPS_PER_BEAT);
  const beats = Array.from({ length: count }, (_, i) => round(i * beat));
  const weight = new Float64Array(count);
  for (const b of blocks) {
    const onBeat = new Map();   // step in the pattern → velocity heard on it
    for (const track of b.heard) {
      if (sequencerOf(b.pattern, track.id) !== 'steps') continue;
      for (const n of b.pattern.notes[track.id] ?? []) {
        onBeat.set(n.step, (onBeat.get(n.step) ?? 0) + n.velocity * track.gain);
      }
    }
    for (let s = Math.ceil(b.start / STEPS_PER_BEAT) * STEPS_PER_BEAT; s < b.end; s += STEPS_PER_BEAT) {
      weight[s / STEPS_PER_BEAT] = onBeat.get((s - b.start) % b.pattern.length) ?? 0;
    }
  }
  const heaviest = Math.max(...weight);
  // With no step notes at all, the bar's own stresses: strong, weak, medium, weak.
  const strengths = heaviest > 0
    ? Array.from(weight, (w) => round(w / heaviest))
    : beats.map((_, i) => [1, 0.5, 0.75, 0.5][i % 4]);

  // The energy curve, one value a beat, averaged over ENERGY_SMOOTH seconds
  // as the kit's is, so it eases into a section rather than jumping.
  const perBeat = Float64Array.from(beats, (_, i) => blocks.find((b) => i * STEPS_PER_BEAT < b.end).energy);
  const half = Math.max(0, Math.round(ENERGY_SMOOTH / beat / 2));
  const values = Array.from(perBeat, (_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(count - 1, i + half); j++, n++) sum += perBeat[j];
    return round(sum / n);
  });

  // Sections: the named runs of blocks if the song names any, else each block.
  const named = song.arrangement.some((b) => b.section);
  const runs = named ? namedSections(song) : blocks.map((_, i) => ({ name: null, from: i, to: i + 1 }));
  const signature = (run) => JSON.stringify(blocks.slice(run.from, run.to)
    .map(({ block }) => [block.pattern, block.repeat, [...block.mute].sort()]));
  const sections = [];
  runs.forEach((run, i) => {
    const inRun = blocks.slice(run.from, run.to);
    const start = inRun[0].start;
    const end = inRun.at(-1).end;
    const energy = round(inRun.reduce((sum, b) => sum + b.energy * (b.end - b.start), 0) / (end - start));
    const like = runs.findIndex((other, j) => j < i
      && (run.name ? other.name === run.name : signature(other) === signature(run)));
    sections.push({
      start: round(start * step),
      end: round(end * step),
      energy,
      level: energy < LEVELS[0] ? 'low' : energy > LEVELS[1] ? 'high' : 'mid',
      drop: i > 0 && energy - sections[i - 1].energy > DROP_RISE && energy >= DROP_LEVEL,
      like: like >= 0 ? like : null,
    });
  });

  return {
    duration: round(duration),
    tempo: song.bpm,
    beats,
    strengths,
    downbeat: 0,
    energy: { rate: song.bpm / 60, start: 0, values },
    sections,
  };
}
