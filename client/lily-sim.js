const WEATHER_BEATS = [1, 4];   // how long a gust and the wind's heading hold before they change, in beats
const MAX_TURN = Math.PI / 2;   // how far the wind can veer at each change, either way

/**
 * LilySim — the rain on one track's pond. Time is in beats. advance()
 * reports every drop that lands in the pond with its exact time inside
 * the stretch it covered, so the engine can play it precisely rather than
 * at frame boundaries.
 *
 * Rain falls at a rate (the density, scaled by the gust of the moment),
 * and each drop waits for its share of it: a share drawn at random, so the
 * drops come at random moments, or with evenness more and more nearly the
 * same, so they come like a drip. The weather — how hard it's gusting and
 * which way the wind blows — holds for a beat or a few, then changes, so
 * in between the rate and the shower's drift are steady and the
 * simulation jumps from one drop or change to the next.
 *
 * A shower narrower than the pond drifts with the wind, veering a little
 * at each change and turning back at the banks; drops fall evenly inside
 * it, and any landing beyond the pond are lost on the bank.
 *
 * Draws on its own random numbers, which reseed() starts over from the
 * settings' seed, so a rain can be repeated exactly. Every drop takes the
 * same draws whatever the pond looks like, and which pad it strikes is
 * worked out after it's placed, so editing the pads changes what the rain
 * plays, never the rain.
 */
export class LilySim {
  constructor(config, random = Math.random) {
    this.random = random;
    this.sync(config);
    this.#reset();
  }

  /** Follow edits while it plays: the rain carries on, falling on the pads as they now are. */
  sync(config) {
    this.config = config;
  }

  /** Start the rain over from its seed: the same drops, in the same places, as the last time. */
  reseed() {
    this.random = seeded(this.config.seed);
    this.#reset();
  }

  /** Where the rain is falling, for drawing: { x, y, radius }, radius null for the whole pond. */
  shower() {
    const { shower } = this.config;
    return { x: this.cloud.x, y: this.cloud.y, radius: shower >= 1 ? null : shower / 2 };
  }

  /**
   * Move forward `beats`. Returns drops in time order as { at (beats from
   * the start of this call), x, y, pad (the id of the pad it struck, or
   * null for open water), flower }.
   */
  advance(beats) {
    const events = [];
    let now = 0;
    // Plenty for any sane settings; a bound so nothing can spin forever.
    for (let guard = 0; guard < 10000; guard++) {
      const rate = this.config.density * this.weather.level;
      const toDrop = rate > 0 ? this.pending / rate : Infinity;
      const dt = Math.min(toDrop, this.weather.left);
      if (now + dt >= beats) {
        this.#move(beats - now, rate);
        break;
      }
      const drop = toDrop <= this.weather.left;
      this.#move(dt, rate);
      now += dt;
      if (drop) {
        const event = this.#drop(now);
        if (event) events.push(event);
        this.pending = this.#share();
      }
      if (this.weather.left <= 1e-12) this.#changeWeather();
    }
    return events;
  }

  #reset() {
    this.cloud = { x: this.random(), y: this.random(), heading: this.random() * Math.PI * 2 };
    this.weather = { left: 0, level: 1 };
    this.#changeWeather();
    // Part of the way to the first drop, so a rain doesn't start on the downbeat.
    this.pending = this.#share() * this.random();
  }

  #move(dt, rate) {
    this.pending = Math.max(0, this.pending - rate * dt);
    this.weather.left -= dt;
    const c = this.cloud;
    const d = this.config.wind * dt;
    const [x, turnX] = reflect(c.x + Math.cos(c.heading) * d);
    const [y, turnY] = reflect(c.y + Math.sin(c.heading) * d);
    if (turnX) c.heading = Math.PI - c.heading;
    if (turnY) c.heading = -c.heading;
    c.x = x;
    c.y = y;
  }

  // A new gust, which can be anything from a lull to twice as heavy, and a
  // veer in the wind. The draws are the same whatever the settings, so
  // turning a knob changes the rain no more than it has to.
  #changeWeather() {
    const [hold, gust, veer] = [this.random(), this.random(), this.random()];
    this.weather.left = WEATHER_BEATS[0] + (WEATHER_BEATS[1] - WEATHER_BEATS[0]) * hold;
    this.weather.level = 1 + this.config.gusts * (gust * 2 - 1);
    this.cloud.heading += MAX_TURN * (veer * 2 - 1);
  }

  // How much rain falls before the next drop, in drops: one on average,
  // exponentially spread for rain at random, exactly one for a drip.
  #share() {
    const e = this.config.evenness;
    return e + (1 - e) * -Math.log(1 - this.random());
  }

  // A drop somewhere in the shower, and the pad it strikes, the topmost
  // where pads overlap; null if it fell on the bank.
  #drop(at) {
    const [u, v] = [this.random(), this.random()];
    const { shower, pads } = this.config;
    let x = u;
    let y = v;
    if (shower < 1) {
      const r = (shower / 2) * Math.sqrt(u);
      x = this.cloud.x + r * Math.cos(v * Math.PI * 2);
      y = this.cloud.y + r * Math.sin(v * Math.PI * 2);
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    }
    const pad = pads.findLast((p) => Math.hypot(p.x - x, p.y - y) <= p.size);
    return { at, x, y, pad: pad?.id ?? null, flower: pad?.flower ?? false };
  }
}

// Fold a position back into 0..1 as if it had bounced off the edges;
// whether it ends up heading the other way.
function reflect(p) {
  const q = ((p % 2) + 2) % 2;
  return q > 1 ? [2 - q, true] : [q, false];
}

/** Random numbers from a seed (mulberry32): the same seed, the same numbers. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
