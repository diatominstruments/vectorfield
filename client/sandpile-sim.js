import { TOPPLE_AT, ringOf } from '../shared/sandpile.js';

const MAX_WAVES = 2000;   // a bound on one avalanche; the biggest a pile this size can make is far smaller

/**
 * SandpileSim — the live state of one track's sandpile. Time is in beats.
 * Grains drop at a steady rate; each one's avalanche, if any, is worked
 * out at once (wave by wave: the cells that topple, then those their
 * grains topple, and so on) and its waves are then released one every
 * `spread` beats. advance() reports every wave with its exact time inside
 * the stretch it covered, so the engine can play it precisely rather than
 * at frame boundaries. Waves still due after the stretch wait for the
 * next call.
 *
 * Not deterministic by design (the pile starts at random, and scattered
 * grains land at random), unless given a `random` to draw from.
 */
export class SandpileSim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.time = 0;
    this.pending = [];   // waves released but not yet due: { at (absolute), ring, count, cells }
    this.sync(config);
  }

  /**
   * Follow edits while it plays: a new size starts a new pile (the old one
   * can't be fitted to it); everything else takes effect on the next grain.
   */
  sync(config) {
    this.config = config;
    if (this.cells?.length !== config.size * config.size) {
      this.cells = Array.from({ length: config.size * config.size }, () => Math.floor(this.random() * TOPPLE_AT));
      this.nextDrop = this.time;
      this.pending = [];
    }
  }

  /**
   * Move forward `beats`. Returns, in time order, { at (beats from the
   * start of this call), ring, count, cells } for each ring of cells that
   * topples: `count` how many cells in that ring went in this wave, `cells`
   * which (indexes, row by row). `onChange(at)` is called after each
   * grain lands, so the pile can be drawn as it changes.
   */
  advance(beats, onChange) {
    const events = [];
    const end = this.time + beats;
    // Plenty for any sane settings; a bound so nothing can spin forever.
    for (let guard = 0; guard < 10000; guard++) {
      const due = this.pending[0]?.at ?? Infinity;
      if (Math.min(this.nextDrop, due) >= end) break;
      if (due <= this.nextDrop) {
        const wave = this.pending.shift();
        events.push({ at: wave.at - this.time, ring: wave.ring, count: wave.count, cells: wave.cells });
      } else {
        this.#drop(this.nextDrop);
        onChange?.(this.nextDrop - this.time);
        this.nextDrop += 1 / this.config.rate;
      }
    }
    this.time = end;
    return events;
  }

  // One grain lands, and whatever it brings down is queued as waves.
  #drop(at) {
    const { size, drop, scatter, spread } = this.config;
    const cell = this.random() < scatter
      ? Math.floor(this.random() * size * size)
      : drop[1] * size + drop[0];
    this.cells[cell]++;
    let unstable = this.cells[cell] >= TOPPLE_AT ? [cell] : [];
    for (let wave = 0; unstable.length && wave < MAX_WAVES; wave++) {
      const byRing = new Map();
      for (const i of unstable) {
        const column = i % size;
        const row = Math.floor(i / size);
        const ring = ringOf(column, row, drop);
        if (!byRing.has(ring)) byRing.set(ring, []);
        byRing.get(ring).push(i);
      }
      const time = at + wave * spread;
      for (const [ring, cells] of [...byRing].sort((a, b) => a[0] - b[0])) {
        this.#queue({ at: time, ring, count: cells.length, cells });
      }
      unstable = this.#topple(unstable);
    }
  }

  // Topple these cells together: each loses four grains, one to each
  // neighbour (off the edge, lost). Returns the cells left unstable.
  #topple(cells) {
    const { size } = this.config;
    for (const i of cells) this.cells[i] -= TOPPLE_AT;
    for (const i of cells) {
      const column = i % size;
      if (column > 0) this.cells[i - 1]++;
      if (column < size - 1) this.cells[i + 1]++;
      if (i >= size) this.cells[i - size]++;
      if (i < size * (size - 1)) this.cells[i + size]++;
    }
    const next = [];
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] >= TOPPLE_AT) next.push(i);
    return next;
  }

  // Waves keep time order, however avalanches overlap.
  #queue(wave) {
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].at > wave.at) i--;
    this.pending.splice(i, 0, wave);
  }
}
