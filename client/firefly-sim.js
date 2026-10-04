const MAX_PULL = 0.5;    // at full coupling, a flash right beside a firefly brings it half again closer to flashing
const MAX_DRIFT = 0.15;  // at full drift, each cycle runs up to this much fast or slow

/**
 * FireflySim — the live state of one track's fireflies. Time is in beats.
 * Each firefly's phase climbs from 0 to 1 at its own rate, and it flashes
 * on reaching 1. advance() reports every flash with its exact time inside
 * the stretch it covered, so the engine can play it precisely rather than
 * at frame boundaries.
 *
 * Phases climb in straight lines, so the simulation jumps from one flash
 * to the next. A flash multiplies the phase of every firefly within reach
 * by up to 1 + MAX_PULL — more the closer it is — which is how pulse-
 * coupled oscillators fall into step: one nearly ready is pulled a long
 * way, one that has just flashed hardly at all. A firefly pulled past 1
 * flashes in the same instant, and pulls its own neighbours in turn.
 *
 * Not deterministic by design, unless given a `random` to draw from.
 */
export class FireflySim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.flies = new Map();   // id → { id, phase, pace (this cycle's rate multiplier) }
    this.sync(config);
  }

  /**
   * Follow edits while it plays: new fireflies join at a random point in
   * their cycle, removed ones vanish, and everyone else carries on where
   * they were with their new rate, place and reach.
   */
  sync(config) {
    this.config = config;
    const ids = new Set(config.flies.map((f) => f.id));
    for (const id of this.flies.keys()) if (!ids.has(id)) this.flies.delete(id);
    for (const f of config.flies) {
      if (!this.flies.has(f.id)) this.flies.set(f.id, { id: f.id, phase: this.random(), pace: this.#pace() });
    }
    // Who sees whose flash, and how strongly: fading to nothing at the edge of reach.
    this.rates = new Map(config.flies.map((f) => [f.id, f.rate]));
    this.seen = new Map(config.flies.map((f) => [f.id, []]));
    for (const a of config.flies) {
      for (const b of config.flies) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (a !== b && d < config.reach) this.seen.get(a.id).push({ id: b.id, pull: 1 - d / config.reach });
      }
    }
  }

  /** Every firefly to a random point in its cycle, as at the start. */
  scatter() {
    for (const fly of this.flies.values()) fly.phase = this.random();
  }

  /**
   * Move forward `beats`. Returns flashes in time order as { at (beats from
   * the start of this call), id, pulled }: `pulled` when another firefly's
   * flash set this one off.
   */
  advance(beats) {
    const events = [];
    const flies = [...this.flies.values()];
    if (!flies.length) return events;
    let now = 0;
    // Plenty for any sane settings; a bound so nothing can spin forever.
    for (let guard = 0; guard < 10000; guard++) {
      const dt = Math.max(0, Math.min(...flies.map((f) => (1 - f.phase) / this.#speed(f))));
      if (now + dt >= beats) {
        this.#move(flies, beats - now);
        break;
      }
      this.#move(flies, dt);
      now += dt;
      this.#flash(flies.filter((f) => f.phase >= 1 - 1e-9), now, events);
    }
    return events;
  }

  // Flash the fireflies that have reached the top, and any their flashes
  // pull over it, each once.
  #flash(first, at, events) {
    const k = this.config.coupling * MAX_PULL;
    const queue = first.map((fly) => ({ fly, pulled: false }));
    const flashed = new Set();
    while (queue.length) {
      const { fly, pulled } = queue.shift();
      if (flashed.has(fly.id)) continue;
      flashed.add(fly.id);
      fly.phase = 0;
      fly.pace = this.#pace();
      events.push({ at, id: fly.id, pulled });
      if (!k) continue;
      for (const { id, pull } of this.seen.get(fly.id)) {
        const other = this.flies.get(id);
        if (flashed.has(id)) continue;
        other.phase = Math.min(1, other.phase * (1 + k * pull));
        if (other.phase >= 1 - 1e-9) queue.push({ fly: other, pulled: true });
      }
    }
  }

  #move(flies, dt) {
    for (const fly of flies) fly.phase = Math.min(1, fly.phase + dt * this.#speed(fly));
  }

  #speed(fly) {
    return this.rates.get(fly.id) * fly.pace;
  }

  #pace() {
    return 1 + this.config.drift * MAX_DRIFT * (this.random() * 2 - 1);
  }
}
