import { pathKey } from '../shared/ants.js';

const STAGGER = 0.75;     // beats between ants first leaving the nest, so they don't march in unison
const DEPOSIT = 1;        // scent laid on a journey one square-width long; shorter journeys lay more
const MAX_SCENT = 20;
const SCENT_WEIGHT = 1;   // how much a unit of scent outweighs a bare path
const MIN_LENGTH = 0.02;  // the shortest a path counts as, so nodes on top of each other don't stall time

/**
 * AntSim — the live state of one track's ant colony. Time is in beats.
 * advance() walks the ants forward, reporting every node they reach with
 * its exact time inside the stretch it covered, so the engine can play it
 * precisely rather than at frame boundaries.
 *
 * Ants walk at a fixed speed, so between arrivals nothing changes but how
 * far along their paths they are, and the simulation jumps from one
 * arrival to the next. Scent fades continuously meanwhile.
 *
 * Not deterministic by design, unless given a `random` to draw from.
 */
export class AntSim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.ants = new Map();    // id → { id, from, to, prev, t (0..1 along the path), wait, carrying, route, home, deposit, fresh }
    this.scent = new Map();   // pathKey → level
    this.nextId = 1;
    this.sync(config);
  }

  /**
   * Follow edits while it plays. Scent on paths that have gone goes with
   * them; an ant whose way has been cut (its path, or the route it means to
   * retrace) starts again from the nest, as do all of them when the nest
   * moves. Ants added start out from the nest a little apart; ants removed
   * are the newest. Moving a node keeps every ant the same share of the way
   * along its path.
   */
  sync(config) {
    const nestMoved = config.nest !== this.config?.nest;
    this.config = config;
    this.nodes = new Map(config.nodes.map((n) => [n.id, n]));
    this.links = new Map(config.nodes.map((n) => [n.id, []]));
    this.paths = new Set();
    for (const [a, b] of config.paths) {
      this.links.get(a).push(b);
      this.links.get(b).push(a);
      this.paths.add(pathKey(a, b));
    }
    for (const key of this.scent.keys()) if (!this.paths.has(key)) this.scent.delete(key);

    if (!config.nest) {
      this.ants.clear();
      return;
    }
    for (const ant of this.ants.values()) {
      if (nestMoved || !this.#walkable(ant)) this.#home(ant, 0);
    }
    const ants = [...this.ants.values()];
    for (const ant of ants.slice(config.ants)) this.ants.delete(ant.id);
    for (let i = ants.length; i < config.ants; i++) {
      const ant = { id: `a${this.nextId++}` };
      this.#home(ant, (i - ants.length) * STAGGER);
      this.ants.set(ant.id, ant);
    }
    // An ant stuck with nowhere to go tries again: an edit may have given it a way.
    for (const ant of this.ants.values()) if (!ant.to && ant.wait == null) this.#setOff(ant);
  }

  /** Where each ant is now, for drawing: [{ id, x, y, carrying }]. */
  positions() {
    return [...this.ants.values()].map((ant) => {
      const a = this.nodes.get(ant.from);
      const b = ant.to ? this.nodes.get(ant.to) : a;
      return { id: ant.id, x: a.x + (b.x - a.x) * ant.t, y: a.y + (b.y - a.y) * ant.t, carrying: ant.carrying };
    });
  }

  /**
   * Move forward `beats`. Returns, in time order, { at (beats from the start
   * of this call), node, strength } for each node an ant reaches, and for
   * the nest as each ant first leaves it; strength (0..1) is how much scent
   * is on the path it came by, against the strongest path. `onChange(at)` is
   * called after every arrival and at the end, so positions() can be drawn
   * at each moment: between two calls, every ant is on one straight path.
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

  // The soonest ant to leave the nest or reach a node. Returns { dt, apply(at, events) } or null.
  #nextEvent() {
    let best = null;
    for (const ant of this.ants.values()) {
      let dt;
      let apply;
      if (ant.wait != null) {
        dt = ant.wait;
        apply = (at, events) => {
          ant.wait = null;
          if (ant.fresh) events.push({ at, node: ant.from, strength: 0 });
          ant.fresh = false;
          this.#setOff(ant);
        };
      } else if (ant.to) {
        dt = ((1 - ant.t) * this.#length(ant.from, ant.to)) / this.config.speed;
        apply = (at, events) => this.#arrive(ant, at, events);
      } else {
        continue;
      }
      if (dt < (best?.dt ?? Infinity)) best = { dt: Math.max(0, dt), apply };
    }
    return best;
  }

  #move(dt) {
    const { speed, evaporation } = this.config;
    for (const ant of this.ants.values()) {
      if (ant.wait != null) ant.wait = Math.max(0, ant.wait - dt);
      else if (ant.to) ant.t = Math.min(1, ant.t + (dt * speed) / this.#length(ant.from, ant.to));
    }
    const keep = (1 - evaporation) ** dt;
    for (const [key, level] of this.scent) {
      if (level * keep < 1e-4) this.scent.delete(key);
      else this.scent.set(key, level * keep);
    }
  }

  #arrive(ant, at, events) {
    const node = ant.to;
    const key = pathKey(ant.from, node);
    if (ant.carrying) this.scent.set(key, Math.min(MAX_SCENT, (this.scent.get(key) ?? 0) + ant.deposit));
    const strongest = Math.max(0, ...this.scent.values());
    events.push({ at, node, strength: strongest > 0 ? (this.scent.get(key) ?? 0) / strongest : 0 });
    ant.prev = ant.from;
    ant.from = node;
    ant.to = null;
    ant.t = 0;

    if (ant.carrying) {
      if (ant.home.length) {
        ant.to = ant.home.pop();
        return;
      }
      // Home with the food: out again.
      ant.carrying = false;
      ant.route = [node];
      ant.prev = null;
    } else {
      // A route that crosses itself is cut back to where it first passed
      // here, so the way home has no loops in it.
      const seen = ant.route.indexOf(node);
      if (seen >= 0) ant.route.length = seen + 1;
      else ant.route.push(node);
      if (node === this.config.food) {
        ant.carrying = true;
        ant.deposit = DEPOSIT / Math.max(MIN_LENGTH, this.#routeLength(ant.route));
        ant.home = ant.route.slice(0, -1);
        ant.to = ant.home.pop();
        return;
      }
    }
    this.#setOff(ant);
  }

  // Pick the next path out of an outbound ant's node: anywhere but back the
  // way it came, unless that's the only way. Scent and shortness draw it,
  // and adventure mixes in a share of picking at random.
  #setOff(ant) {
    const links = this.links.get(ant.from) ?? [];
    let options = links.filter((n) => n !== ant.prev);
    if (!options.length) options = links;
    if (!options.length) return;   // a node with no paths: wait here until an edit gives it one
    const pull = options.map((n) => (1 + SCENT_WEIGHT * (this.scent.get(pathKey(ant.from, n)) ?? 0)) ** 2 / this.#length(ant.from, n));
    const total = pull.reduce((s, w) => s + w, 0);
    const { adventure } = this.config;
    let r = this.random();
    let pick = options.at(-1);
    for (let i = 0; i < options.length; i++) {
      r -= (1 - adventure) * (pull[i] / total) + adventure / options.length;
      if (r < 0) { pick = options[i]; break; }
    }
    ant.to = pick;
    ant.t = 0;
  }

  // Back to the nest, ready to set out after `wait` beats.
  #home(ant, wait) {
    Object.assign(ant, {
      from: this.config.nest, to: null, prev: null, t: 0, wait, carrying: false,
      route: [this.config.nest], home: [], deposit: 0, fresh: true,
    });
  }

  // Whether an ant can carry on after an edit: every node it's at, heading
  // for or means to retrace still there, joined by paths.
  #walkable(ant) {
    if (!this.nodes.has(ant.from)) return false;
    const ahead = ant.carrying ? [ant.from, ant.to, ...[...ant.home].reverse()] : ant.to ? [ant.from, ant.to] : [ant.from];
    const behind = ant.carrying ? [] : ant.route;
    return [ahead, behind].every((chain) => chain.every((n, i) => this.nodes.has(n) && (i === 0 || this.paths.has(pathKey(chain[i - 1], n)))));
  }

  #length(a, b) {
    const p = this.nodes.get(a);
    const q = this.nodes.get(b);
    return Math.max(MIN_LENGTH, Math.hypot(q.x - p.x, q.y - p.y));
  }

  #routeLength(route) {
    let sum = 0;
    for (let i = 1; i < route.length; i++) sum += this.#length(route[i - 1], route[i]);
    return sum;
  }
}
