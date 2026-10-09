const MAX_PUSH = 1;      // at full avoidance, a call right beside a frog moves its next call straight to the opposite phase
const MAX_DRIFT = 0.15;  // at full drift, each cycle runs up to this much fast or slow

/**
 * FrogSim — the live state of one track's frogs. Time is in beats. Each
 * frog's phase climbs from 0 to 1 at its own rate, and it calls on
 * reaching 1. advance() reports every call with its exact time inside the
 * stretch it covered, so the engine can play it precisely rather than at
 * frame boundaries.
 *
 * Phases climb in straight lines, so the simulation jumps from one call to
 * the next. A call moves the phase of every frog within reach towards
 * one half — more the closer it is — which is the opposite of the
 * fireflies' pull: a frog about to call holds back, one that has just
 * called answers sooner, and two neighbours settle into alternation. The
 * push never takes a frog past 1, so no call sets off another.
 *
 * A frog in a bout counts its calls, and having made `bout` of them rests
 * for `rest` beats, deaf to the chorus, before starting again from 0.
 *
 * Not deterministic by design, unless given a `random` to draw from.
 */
export class FrogSim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.frogs = new Map();   // id → { id, phase, pace (this cycle's rate multiplier), calls (this bout), rest (beats left, or 0) }
    this.sync(config);
  }

  /**
   * Follow edits while it plays: new frogs join at a random point in their
   * cycle, removed ones vanish, and everyone else carries on where they
   * were with their new rate, place and reach.
   */
  sync(config) {
    this.config = config;
    const ids = new Set(config.frogs.map((f) => f.id));
    for (const id of this.frogs.keys()) if (!ids.has(id)) this.frogs.delete(id);
    for (const f of config.frogs) {
      if (!this.frogs.has(f.id)) this.frogs.set(f.id, { id: f.id, phase: this.random(), pace: this.#pace(), calls: 0, rest: 0 });
    }
    // Who hears whose call, and how strongly: fading to nothing at the edge of reach.
    this.rates = new Map(config.frogs.map((f) => [f.id, f.rate]));
    this.heard = new Map(config.frogs.map((f) => [f.id, []]));
    for (const a of config.frogs) {
      for (const b of config.frogs) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (a !== b && d < config.reach) this.heard.get(a.id).push({ id: b.id, push: 1 - d / config.reach });
      }
    }
  }

  /** Every frog to a random point in its cycle, mid-bout, as at the start. */
  scatter() {
    for (const frog of this.frogs.values()) Object.assign(frog, { phase: this.random(), calls: 0, rest: 0 });
  }

  /**
   * Move forward `beats`. Returns calls in time order as { at (beats from
   * the start of this call), id, first }: `first` for the first call of a
   * bout.
   */
  advance(beats) {
    const events = [];
    const frogs = [...this.frogs.values()];
    if (!frogs.length) return events;
    let now = 0;
    // Plenty for any sane settings; a bound so nothing can spin forever.
    for (let guard = 0; guard < 10000; guard++) {
      const dt = Math.max(0, Math.min(...frogs.map((f) => (f.rest > 0 ? f.rest : (1 - f.phase) / this.#speed(f)))));
      if (now + dt >= beats) {
        this.#move(frogs, beats - now);
        break;
      }
      this.#move(frogs, dt);
      now += dt;
      for (const frog of frogs) {
        if (frog.rest > 0 || frog.phase < 1 - 1e-9) continue;
        this.#call(frog, now, events);
      }
    }
    return events;
  }

  #call(frog, at, events) {
    const { bout, rest, avoidance } = this.config;
    frog.phase = 0;
    frog.pace = this.#pace();
    events.push({ at, id: frog.id, first: frog.calls === 0 });
    frog.calls++;
    if (bout && frog.calls >= bout) {
      frog.calls = 0;
      frog.rest = rest;
    }
    const k = avoidance * MAX_PUSH;
    if (!k) return;
    for (const { id, push } of this.heard.get(frog.id)) {
      const other = this.frogs.get(id);
      if (other.rest > 0) continue;
      other.phase += k * push * (0.5 - other.phase);
    }
  }

  #move(frogs, dt) {
    for (const frog of frogs) {
      if (frog.rest > 0) {
        frog.rest = Math.max(0, frog.rest - dt);
        if (frog.rest === 0) frog.phase = 0;
      } else {
        frog.phase = Math.min(1, frog.phase + dt * this.#speed(frog));
      }
    }
  }

  #speed(frog) {
    return this.rates.get(frog.id) * frog.pace;
  }

  #pace() {
    return 1 + this.config.drift * MAX_DRIFT * (this.random() * 2 - 1);
  }
}
