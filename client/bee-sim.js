import { NECTAR_ENOUGH, isFlower } from '../shared/bees.js';

const STAGGER = 0.5;       // beats between bees first setting off, so they don't move as one
const MIN_DISTANCE = 0.02; // the nearest a plant counts as when choosing, so one right here doesn't outpull everything
const LEAF_PULL = 0.15;    // how much a plant with no flower draws a bee, against a full flower's 1: less than a half-full one

/**
 * BeeSim — the live state of one track's bees. Time is in beats. advance()
 * flies the bees forward, reporting every landing on a flower with its
 * exact time inside the stretch it covered, so the engine can play it
 * precisely rather than at frame boundaries.
 *
 * A bee is flying straight to a plant, feeding on a flower, resting on a
 * plant without one, or waiting on a plant for something near by to
 * refill; nectar refills steadily meanwhile. So between events nothing
 * changes but how far along bees and nectar are, and the simulation jumps
 * from one event to the next.
 *
 * Not deterministic by design, unless given a `random` to draw from.
 */
export class BeeSim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.bees = new Map();     // id → { id, x, y, from, to, t (0..1 along the flight), on (plant id), rest (beats of feeding or resting left) }
    this.nectar = new Map();   // flower id → 0..1
    this.nextId = 1;
    this.sync(config);
  }

  /**
   * Follow edits while it plays: new flowers start full, gone plants take
   * their nectar with them, and a bee heading for or sitting on one picks
   * again from where it is. Bees added set off a little apart from where
   * they happen to be; bees removed are the newest. Moving a plant keeps
   * a bee flying to it the same share of the way there.
   */
  sync(config) {
    this.config = config;
    const plants = new Map(config.plants.map((p) => [p.id, p]));
    // Bees bound for a plant that's gone stop where they are (worked out
    // while the old plants are still known), to pick again.
    for (const bee of this.bees.values()) {
      if (bee.to && !plants.has(bee.to)) {
        Object.assign(bee, this.#at(bee), { from: null, to: null, t: 0, rest: 0 });
      }
      if (bee.on && !plants.has(bee.on)) {
        bee.on = null;
        bee.rest = 0;
      }
    }
    this.plants = plants;
    for (const id of this.nectar.keys()) if (!isFlower(this.plants.get(id) ?? {})) this.nectar.delete(id);
    for (const p of config.plants) if (isFlower(p) && !this.nectar.has(p.id)) this.nectar.set(p.id, 1);
    const bees = [...this.bees.values()];
    for (const bee of bees.slice(config.bees)) this.bees.delete(bee.id);
    for (let i = bees.length; i < config.bees; i++) {
      const bee = { id: `b${this.nextId++}`, x: 0.1 + 0.8 * this.random(), y: 0.1 + 0.8 * this.random(), to: null, t: 0, on: null, rest: (i - bees.length) * STAGGER };
      this.bees.set(bee.id, bee);
    }
  }

  /** Where each bee is now, for drawing: [{ id, x, y, on (the plant it's on, if any), flying }]. */
  positions() {
    return [...this.bees.values()].map((bee) => ({ id: bee.id, ...this.#at(bee), on: bee.on, flying: Boolean(bee.to) }));
  }

  /**
   * Move forward `beats`. Returns landings on flowers in time order as
   * { at (beats from the start of this call), flower, strength (0..1: how
   * full it was) }. `onChange(at)` is called after every event and at the
   * end, so positions() can be drawn at each moment: between two calls
   * every bee is on one straight flight, or still.
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
      onChange?.(now);
    }
    onChange?.(beats);
    return events;
  }

  // The soonest bee to land, finish feeding or resting, or see a flower it was waiting for refill.
  #nextEvent() {
    let best = null;
    for (const bee of this.bees.values()) {
      let dt;
      let apply;
      if (bee.to) {
        dt = ((1 - bee.t) * this.#flight(bee)) / this.config.speed;
        apply = (at, events) => this.#land(bee, at, events);
      } else if (bee.rest > 0) {
        dt = bee.rest;
        apply = () => this.#setOff(bee);
      } else {
        // Waiting: until the nearest-to-ready flower it could go to has
        // enough — or at once, if there's a leaf to go and rest on.
        dt = Infinity;
        for (const p of this.#choices(bee)) {
          dt = Math.min(dt, isFlower(p) ? Math.max(0, NECTAR_ENOUGH - this.nectar.get(p.id)) * this.config.refill : 0);
        }
        if (dt === Infinity) continue;
        apply = () => this.#setOff(bee);
      }
      if (dt < (best?.dt ?? Infinity)) best = { dt: Math.max(0, dt), apply };
    }
    return best;
  }

  #move(dt) {
    const { speed, refill } = this.config;
    for (const bee of this.bees.values()) {
      if (bee.to) {
        const flight = this.#flight(bee);
        bee.t = flight ? Math.min(1, bee.t + (dt * speed) / flight) : 1;
      } else if (bee.rest > 0) {
        bee.rest = Math.max(0, bee.rest - dt);
      }
    }
    for (const [id, level] of this.nectar) this.nectar.set(id, Math.min(1, level + dt / refill));
  }

  // On a flower, a bee feeds and the note sounds; on a leaf it only rests.
  // Arriving at a flower another bee has drained meanwhile, a bee doesn't
  // land: it flies straight on (or waits there), and nothing sounds.
  #land(bee, at, events) {
    const plant = this.plants.get(bee.to);
    Object.assign(bee, { x: plant.x, y: plant.y, from: null, to: null, t: 0, on: plant.id, rest: 0 });
    if (!isFlower(plant)) {
      bee.rest = this.config.rest;
      return;
    }
    const nectar = this.nectar.get(plant.id);
    if (nectar < NECTAR_ENOUGH) return this.#setOff(bee);
    events.push({ at, flower: plant.id, strength: nectar });
    this.nectar.set(plant.id, 0);
    bee.rest = this.config.feed;
  }

  // Fly on to another plant: drawn to full flowers near by, less to leaves,
  // or on a whim to any it could land on. With none, wait here (see #nextEvent).
  #setOff(bee) {
    bee.rest = 0;
    const here = this.#at(bee);
    const options = this.#choices(bee).filter((p) => !isFlower(p) || this.nectar.get(p.id) >= NECTAR_ENOUGH);
    if (!options.length) return;
    const pull = options.map((p) => (isFlower(p) ? this.nectar.get(p.id) ** 2 : LEAF_PULL) / Math.max(MIN_DISTANCE, Math.hypot(p.x - here.x, p.y - here.y)));
    const total = pull.reduce((s, w) => s + w, 0);
    const { whim } = this.config;
    let r = this.random();
    let pick = options.at(-1);
    for (let i = 0; i < options.length; i++) {
      r -= (1 - whim) * (pull[i] / total) + whim / options.length;
      if (r < 0) { pick = options[i]; break; }
    }
    Object.assign(bee, { ...here, from: here, to: pick.id, t: 0, on: null });
  }

  // The plants a bee could fly to: any but the one it's on, unless that's the only one.
  #choices(bee) {
    const others = this.config.plants.filter((p) => p.id !== bee.on);
    return others.length ? others : this.config.plants;
  }

  #at(bee) {
    if (!bee.to) return { x: bee.x, y: bee.y };
    const p = this.plants.get(bee.to);
    return { x: bee.from.x + (p.x - bee.from.x) * bee.t, y: bee.from.y + (p.y - bee.from.y) * bee.t };
  }

  // How far a flying bee's whole flight is.
  #flight(bee) {
    const p = this.plants.get(bee.to);
    return Math.hypot(p.x - bee.from.x, p.y - bee.from.y);
  }
}
