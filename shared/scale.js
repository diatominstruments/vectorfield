const PENTATONIC = [0, 3, 5, 7, 10];   // minor pentatonic, from the root

/**
 * The note for something new added to a set of tuned things (an ant node,
 * a firefly): a minor pentatonic step above the highest of `notes`, in the
 * key of `root`, so whatever is added quickly still sounds right; back to
 * the root past the top of the range, and the root itself (middle C, if
 * none was given) for an empty set. For a drum kit (its `keys`), the
 * next sound along instead.
 */
export function nextScaleNote(notes, root = notes[0], keys = null) {
  if (keys) {
    const drums = Object.keys(keys).map(Number);
    return drums[notes.length % drums.length];
  }
  if (!notes.length) return root ?? 60;
  const top = Math.max(...notes);
  for (let octave = Math.floor((top - root) / 12); ; octave++) {
    for (const step of PENTATONIC) {
      const n = root + octave * 12 + step;
      if (n > top) return n > 96 ? root : n;
    }
  }
}
