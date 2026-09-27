import { CORE, ringAt, ringStart, sectionAt } from '../shared/tubules.js';

const ANGLE_TRIES = 6;   // candidate directions for a new tubule; the one with the most room wins

/**
 * TubuleSim — the live state of one track's microtubules. Time is in beats.
 * advance() runs the tubules forward, calling back at the exact moment of
 * every change inside the stretch it covered, where voices() says what
 * should be sounding from then on — so the engine can play it precisely
 * rather than at frame boundaries.
 *
 * Between events every tip moves in a straight line at a fixed speed, so
 * the simulation jumps from one event to the next: ring boundaries are
 * reached at known times, and the random switches are Poisson processes,
 * whose waits are exponential. Those waits are memoryless, so they can be
 * drawn afresh after every event without skewing the odds.
 *
 * Not deterministic by design, unless given a `random` to draw from.
 */
export class TubuleSim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.tubules = new Map();   // id → { id, angle, length, growing, ring }
    this.nextId = 1;
    this.sync(config);
  }

  /**
   * Follow edits while it plays. A change in the number of rings re-reads
   * each tip's ring from its position, and if the tubule limit drops below
   * how many are growing, the newest collapse. voices() shows the result.
   */
  sync(config) {
    // Only when the rings change: recomputing a tip that sits exactly on a
    // boundary could land it back in the ring it just left.
    if (config.rings.length !== this.config?.rings.length) {
      for (const t of this.tubules.values()) t.ring = ringAt(t.length, config.rings.length);
    }
    this.config = config;
    const growing = [...this.tubules.values()].filter((t) => t.growing);
    for (const t of growing.slice(config.count)) t.growing = false;
  }

  /**
   * The zones that should be sounding now, by the config's `sound`, as
   * "tubule:ring" → { ring, section }: each growing tip's zone, or every
   * zone each tubule reaches into.
   */
  voices() {
    const { sound, sections } = this.config;
    const out = new Map();
    for (const t of this.tubules.values()) {
      if (t.ring < 0) continue;
      const section = sectionAt(t.angle, sections);
      if (sound === 'whole') {
        for (let ring = 0; ring <= t.ring; ring++) out.set(`${t.id}:${ring}`, { ring, section });
      } else if (t.growing) {
        out.set(`${t.id}:${t.ring}`, { ring: t.ring, section });
      }
    }
    return out;
  }

  /**
   * Move forward `beats`. Returns, in time order, { at (beats from the start
   * of this call), id, ring, section } each time a growing tip enters a
   * ring — it grew into it, or was rescued inside it. `onChange(at, tubules)`
   * is called after every change and at the end, so voices() can be read
   * and the tubules drawn at each moment.
   */
  advance(beats, onChange) {
    const events = [];
    let now = 0;
    // Plenty for any sane settings; a bound so nothing can spin forever.
    for (let guard = 0; guard < 10000; guard++) {
      const next = this.#nextEvent();
      if (!next || now + next.dt >= beats) {
        this.#move(beats - now);
        break;
      }
      this.#move(next.dt);
      now += next.dt;
      next.apply(now, events);
      onChange?.(now, this.tubules.values());
    }
    onChange?.(beats, this.tubules.values());
    return events;
  }

  // The soonest thing to happen: each tubule's next boundary or switch, or a
  // new tubule starting. Returns { dt, apply(at, events) } or null.
  #nextEvent() {
    const c = this.config;
    const rings = c.rings.length;
    let best = null;
    const consider = (dt, apply) => { if (dt < (best?.dt ?? Infinity)) best = { dt, apply }; };
    const enter = (t, at, events) => events.push({ at, id: t.id, ring: t.ring, section: sectionAt(t.angle, c.sections) });

    for (const t of this.tubules.values()) {
      if (t.growing) {
        if (t.length < 1) {
          // The next boundary out: the core's edge, the next ring, or the cell edge.
          const edge = t.ring < 0 ? CORE : t.ring + 1 < rings ? ringStart(t.ring + 1, rings) : 1;
          consider(Math.max(0, (edge - t.length) / c.growth), (at, events) => {
            t.length = edge;
            if (edge === 1) return;   // stalls at the cell edge, still sounding
            t.ring++;
            enter(t, at, events);
          });
        }
        consider(this.#wait(c.catastrophe), () => { t.growing = false; });
      } else if (t.ring >= 0) {
        // The next boundary in: the start of the ring it's in.
        const edge = ringStart(t.ring, rings);
        consider(Math.max(0, (t.length - edge) / c.shrink), () => {
          t.length = edge;
          t.ring--;
        });
      } else {
        consider(t.length / c.shrink, () => { this.tubules.delete(t.id); });
      }
      if (!t.growing) {
        consider(this.#wait(c.rescue), (at, events) => {
          t.growing = true;
          if (t.ring >= 0) enter(t, at, events);
        });
      }
    }

    const free = c.count - this.tubules.size;
    if (free > 0) {
      consider(this.#wait(c.nucleation * free), () => {
        const id = `t${this.nextId++}`;
        this.tubules.set(id, { id, angle: this.#roomiestAngle(), length: 0, growing: true, ring: -1 });
      });
    }
    return best;
  }

  #move(dt) {
    const { growth, shrink } = this.config;
    for (const t of this.tubules.values()) {
      t.length = t.growing ? Math.min(1, t.length + growth * dt) : Math.max(0, t.length - shrink * dt);
    }
  }

  // How long until a Poisson process with this rate (per beat) next fires.
  #wait(rate) {
    return rate > 0 ? -Math.log(1 - this.random()) / rate : Infinity;
  }

  // A few random directions, keeping the one furthest from any living
  // tubule, so they spread around the cell rather than clumping.
  #roomiestAngle() {
    const taken = [...this.tubules.values()].map((t) => t.angle);
    let best = 0;
    let bestGap = -1;
    for (let i = 0; i < ANGLE_TRIES; i++) {
      const a = this.random() * 2 * Math.PI;
      const gap = Math.min(Math.PI, ...taken.map((b) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)));
      if (gap > bestGap) { best = a; bestGap = gap; }
    }
    return best;
  }
}
