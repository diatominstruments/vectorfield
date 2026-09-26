import { BALL_RADIUS, segmentAt } from '../shared/bounce.js';

const MAX_BEND = Math.PI / 6;    // largest random rebound deflection, at jitter 1
const MIN_NORMAL = 0.25;         // rebounds leave at least this steeply, so no ball skims a wall forever

/**
 * BounceSim — the live state of one bounce pattern's balls. Time is in
 * beats. advance() moves everything forward and reports wall hits with
 * their exact times inside the stretch it covered, so the engine can play
 * them precisely rather than at frame boundaries.
 *
 * Not deterministic by design: jitter draws from Math.random, and ball
 * collisions make small differences grow.
 */
export class BounceSim {
  constructor(config) {
    this.balls = new Map();   // id → { id, x, y, vx, vy, start }
    this.sync(config);
  }

  /**
   * Follow edits to the pattern while it plays: new balls appear at their
   * start, removed ones vanish, and a ball whose start was moved or re-aimed
   * restarts from there. Everything else keeps its momentum.
   */
  sync(config) {
    this.config = config;
    const ids = new Set();
    for (const b of config.balls) {
      ids.add(b.id);
      const start = `${b.x},${b.y},${b.vx},${b.vy}`;
      if (this.balls.get(b.id)?.start !== start) {
        this.balls.set(b.id, { id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, start });
      }
    }
    for (const id of this.balls.keys()) if (!ids.has(id)) this.balls.delete(id);
  }

  /**
   * Move forward `beats`. Returns hits in time order as
   * { at (beats from the start of this call), segment, strength (0..1, how
   * square-on the hit was) }. `onSubstep(at, balls)` sees positions along
   * the way, for drawing.
   */
  advance(beats, onSubstep) {
    const balls = [...this.balls.values()];
    const hits = [];
    if (!balls.length) return hits;

    // Small enough steps that no ball moves more than most of its radius,
    // so collisions between balls can't be stepped over.
    const fastest = Math.max(...balls.map((b) => Math.hypot(b.vx, b.vy))) * this.config.speed;
    const n = Math.max(1, Math.ceil((beats * fastest) / (BALL_RADIUS * 0.8)));
    const dt = beats / n;

    for (let i = 0; i < n; i++) {
      for (const b of balls) this.#move(b, i * dt, dt, hits);
      if (this.config.collide) collideAll(balls);
      onSubstep?.((i + 1) * dt, balls);
    }
    return hits.sort((a, b) => a.at - b.at);
  }

  // Straight-line motion with exact wall crossings: a ball can meet more
  // than one wall in a step (a corner), so keep going until the step is used.
  #move(b, t0, dt, hits) {
    const r = BALL_RADIUS;
    const { speed } = this.config;
    let t = t0;
    let left = dt;
    for (let guard = 0; guard < 4 && left > 0; guard++) {
      const vx = b.vx * speed;
      const vy = b.vy * speed;
      let when = Infinity;
      let wall = -1;
      if (vx > 0 && (1 - r - b.x) / vx < when) { when = (1 - r - b.x) / vx; wall = 1; }
      if (vx < 0 && (r - b.x) / vx < when) { when = (r - b.x) / vx; wall = 3; }
      if (vy > 0 && (1 - r - b.y) / vy < when) { when = (1 - r - b.y) / vy; wall = 2; }
      if (vy < 0 && (r - b.y) / vy < when) { when = (r - b.y) / vy; wall = 0; }
      when = Math.max(0, when);

      if (when > left) {
        b.x += vx * left;
        b.y += vy * left;
        return;
      }
      b.x += vx * when;
      b.y += vy * when;
      t += when;
      left -= when;

      const horizontal = wall === 1 || wall === 3;
      const normal = Math.abs(horizontal ? b.vx : b.vy) / (Math.hypot(b.vx, b.vy) || 1);
      hits.push({ at: t, segment: segmentAt(wall, b.x, b.y), strength: normal });
      if (horizontal) b.vx = -b.vx; else b.vy = -b.vy;
      this.#bend(b, wall);
    }
  }

  // Randomize the rebound angle, then make sure the ball still leaves the
  // wall it just hit, and leaves it steeply enough not to skim along it.
  #bend(b, wall) {
    const speed = Math.hypot(b.vx, b.vy);
    if (this.config.jitter > 0) {
      const angle = (Math.random() * 2 - 1) * MAX_BEND * this.config.jitter;
      const [c, s] = [Math.cos(angle), Math.sin(angle)];
      [b.vx, b.vy] = [b.vx * c - b.vy * s, b.vx * s + b.vy * c];
    }
    const horizontal = wall === 1 || wall === 3;
    const away = wall === 1 || wall === 2 ? -1 : 1;   // sign of the normal velocity leaving this wall
    let n = horizontal ? b.vx : b.vy;
    let tan = horizontal ? b.vy : b.vx;
    if (Math.sign(n) !== away) n = -n;
    if (Math.abs(n) < MIN_NORMAL * speed) {
      n = away * MIN_NORMAL * speed;
      tan = Math.sign(tan || 1) * Math.sqrt(speed * speed - n * n);
    }
    if (horizontal) { b.vx = n; b.vy = tan; } else { b.vy = n; b.vx = tan; }
  }
}

/** Equal-mass elastic collisions: swap velocity along the line between centres. */
function collideAll(balls) {
  const r = BALL_RADIUS;
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i];
      const b = balls[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= 2 * r || dist === 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (approach > 0) {
        a.vx -= approach * nx; a.vy -= approach * ny;
        b.vx += approach * nx; b.vy += approach * ny;
      }
      // Pull overlapping balls apart so they don't stick together.
      const push = (2 * r - dist) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      for (const ball of [a, b]) {
        ball.x = Math.min(1 - r, Math.max(r, ball.x));
        ball.y = Math.min(1 - r, Math.max(r, ball.y));
      }
    }
  }
}
