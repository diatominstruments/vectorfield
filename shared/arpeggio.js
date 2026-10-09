/**
 * Arpeggios for the step sequencer: pick a chord shape, an order and a
 * count, and one click on the grid lays down the whole run from the
 * clicked note, one note after another. The clicked note is where the
 * run starts: Up climbs the chord from it, Down falls through the chord
 * below it, Up and down climbs and comes back, Down and up the reverse,
 * and Random plays the notes Up would, shuffled. Runs longer than the
 * chord carry on into the next octave.
 */

export const SHAPES = {
  major: { label: 'Major', steps: [0, 4, 7] },
  minor: { label: 'Minor', steps: [0, 3, 7] },
  sus2: { label: 'Sus2', steps: [0, 2, 7] },
  sus4: { label: 'Sus4', steps: [0, 5, 7] },
  dom7: { label: 'Dominant 7th', steps: [0, 4, 7, 10] },
  min7: { label: 'Minor 7th', steps: [0, 3, 7, 10] },
  maj7: { label: 'Major 7th', steps: [0, 4, 7, 11] },
  sus7: { label: '7sus4', steps: [0, 5, 7, 10] },
  dim: { label: 'Diminished', steps: [0, 3, 6] },
  dim7: { label: 'Diminished 7th', steps: [0, 3, 6, 9] },
  aug: { label: 'Augmented', steps: [0, 4, 8] },
  power: { label: 'Fifths', steps: [0, 7] },
  octave: { label: 'Octaves', steps: [0] },
  minpent: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  majpent: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
};

export const ORDERS = {
  up: 'Up',
  down: 'Down',
  updown: 'Up and down',
  downup: 'Down and up',
  random: 'Random',
};

/** How many notes a run may have. */
export const ARP_COUNTS = [3, 4, 5, 6, 7, 8, 12, 16];

/**
 * The notes of a run, in the order they play. `random` is only drawn
 * from for the random order.
 */
export function arpeggio(root, shape, order, count, random = Math.random) {
  const { steps } = SHAPES[shape];
  const n = steps.length;
  // The i-th chord tone up from the root, and the i-th down from it: the
  // chord's tones in the octave below, nearest first.
  const up = (i) => root + Math.floor(i / n) * 12 + steps[i % n];
  const below = [0, ...steps.slice(1).reverse().map((s) => 12 - s)];
  const down = (i) => root - Math.floor(i / n) * 12 - below[i % n];
  const run = (tone, m) => Array.from({ length: m }, (_, i) => tone(i));

  let notes;
  if (order === 'up') notes = run(up, count);
  else if (order === 'down') notes = run(down, count);
  else if (order === 'random') notes = shuffle(run(up, count), random);
  else {
    // Out to the far end and back, without sounding either end twice.
    const far = Math.ceil(count / 2);
    const out = run(order === 'updown' ? up : down, far + 1);
    notes = [...out, ...out.slice(1, -1).reverse()].slice(0, count);
  }
  return notes.filter((note) => note >= 0 && note <= 127);
}

function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
