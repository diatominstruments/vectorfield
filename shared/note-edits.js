/**
 * Editing several of a track's step notes at once: choosing them with a
 * box, and moving them together. A note is known by its pitch and start
 * step, since one row never holds two notes starting on the same step, and
 * notes on a row never overlap; both stay true after a move.
 *
 * Moving goes up and down a `scale` of the pitches the grid has, lowest
 * first: every pitch for a piano roll, a drum kit's sounds in row order.
 */

export const noteKey = (n) => `${n.note}:${n.step}`;

/** The keys of the notes in a box spanning steps s0..s1 and the rows with `pitches`. */
export function notesInBox(notes, [s0, s1], pitches) {
  return new Set(notes.filter((n) => pitches.has(n.note) && n.step <= s1 && n.step + n.length - 1 >= s0).map(noteKey));
}

/**
 * Move the notes with `keys` by { steps, rows } (rows up the scale) — as
 * far as asked, but no further than keeps every one of them inside the
 * pattern's `length` and on the scale. A moved note takes the place of any
 * other note it lands on, and cuts short one it lands partway along.
 * Returns { notes, keys (the moved notes' new keys), by (the move made) }.
 */
export function moveNotes(notes, keys, by, { length, scale }) {
  const row = new Map(scale.map((note, i) => [note, i]));
  const picked = notes.filter((n) => keys.has(noteKey(n)) && row.has(n.note));
  if (!picked.length) return { notes, keys: new Set(), by: { steps: 0, rows: 0 } };

  const steps = clamp(by.steps, -Math.min(...picked.map((n) => n.step)), length - Math.max(...picked.map((n) => n.step + n.length)));
  const rows = clamp(by.rows, -Math.min(...picked.map((n) => row.get(n.note))), scale.length - 1 - Math.max(...picked.map((n) => row.get(n.note))));
  if (!steps && !rows) return { notes, keys: new Set(picked.map(noteKey)), by: { steps: 0, rows: 0 } };

  const moved = picked.map((n) => ({ ...n, step: n.step + steps, note: scale[row.get(n.note) + rows] }));
  const rest = notes.filter((n) => !picked.includes(n)).flatMap((n) => {
    const under = moved.filter((m) => m.note === n.note && m.step < n.step + n.length && n.step < m.step + m.length);
    if (!under.length) return [n];
    if (under.some((m) => m.step <= n.step)) return [];
    return [{ ...n, length: Math.min(...under.map((m) => m.step)) - n.step }];
  });
  return { notes: [...rest, ...moved], keys: new Set(moved.map(noteKey)), by: { steps, rows } };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
