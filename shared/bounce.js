/**
 * The bouncing-balls sequencer: balls in a square box, where every wall hit
 * plays a note. It's chosen per track within a pattern, so one track can
 * bounce while the others play from the step grid; these settings are
 * stored under that track's id (see song.js). Each wall is split into two
 * segments with their own notes, eight in all, numbered clockwise from the
 * top-left:
 *
 *        0       1
 *     ┌──────┬──────┐
 *   7 │             │ 2
 *     ├             ┤
 *   6 │             │ 3
 *     └──────┴──────┘
 *        5       4
 *
 * The box is the unit square; ball positions are in it and velocities are
 * in box-widths per beat before `speed` scales them, so tempo changes keep
 * the bouncing in time with the song.
 *
 * Unlike step patterns this is deliberately not repeatable: `jitter` bends
 * each rebound by a random angle and ball-on-ball collisions make the whole
 * thing chaotic, so every play is a new performance.
 *
 *   {
 *     walls: [8 MIDI notes],      // segment tunings, clockwise from top-left
 *     balls: [{ id, x, y, vx, vy }],   // where each ball starts
 *     speed,                      // multiplier on ball velocities
 *     jitter,                     // 0 = pure billiards … 1 = up to ±30° per rebound
 *     collide,                    // whether balls bounce off each other
 *     gate,                       // note length, in steps
 *     quantize,                   // 0 = free, else snap hits forward to this many steps
 *   }
 */

import { SongError } from './errors.js';

export const BALL_RADIUS = 0.035;
export const SEGMENTS = 8;
export const QUANTIZE = [0, 1, 2, 4];
export const BOUNCE_LIMITS = Object.freeze({ balls: 8, speed: [0.1, 4], gate: [0.25, 8] });

// C minor pentatonic around middle C, climbing clockwise.
const DEFAULT_WALLS = [60, 63, 65, 67, 70, 72, 75, 77];

/** Which segment a wall hit at (x, y) belongs to. `wall`: 0 top, 1 right, 2 bottom, 3 left. */
export function segmentAt(wall, x, y) {
  switch (wall) {
    case 0: return x < 0.5 ? 0 : 1;
    case 1: return y < 0.5 ? 2 : 3;
    case 2: return x >= 0.5 ? 4 : 5;
    default: return y >= 0.5 ? 6 : 7;
  }
}

/** A ball heading off at `angle` radians, at unit speed. */
export function newBall(id, x, y, angle) {
  return { id, x, y, vx: Math.cos(angle), vy: Math.sin(angle) };
}

/** Settings for a track that has just switched to bouncing; `keys` are its instrument's named notes, if any. */
export function defaultBounce(keys = null) {
  // A drum kit has no scale to climb; spread its sounds around the walls instead.
  const drumNotes = keys ? Object.keys(keys).map(Number) : null;
  return {
    walls: drumNotes ? DEFAULT_WALLS.map((_, i) => drumNotes[i % drumNotes.length]) : [...DEFAULT_WALLS],
    balls: [newBall('b1', 0.3, 0.4, 0.6), newBall('b2', 0.7, 0.6, 2.3)],
    speed: 1,
    jitter: 0.3,
    collide: true,
    gate: 1,
    quantize: 0,
  };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, lo, hi, fallback) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Validate one track's bounce settings. */
export function normalizeBounce(b) {
  if (b == null) return null;
  if (!isObj(b)) throw new SongError('bad bounce settings');
  const fallback = defaultBounce();

  const walls = Array.isArray(b.walls) && b.walls.length === SEGMENTS
    ? b.walls.map((n, i) => Math.round(num(n, 0, 127, fallback.walls[i])))
    : fallback.walls;

  if (b.balls !== undefined && !Array.isArray(b.balls)) throw new SongError('balls must be a list');
  if ((b.balls ?? []).length > BOUNCE_LIMITS.balls) throw new SongError(`too many balls (max ${BOUNCE_LIMITS.balls})`);
  const seen = new Set();
  const balls = (b.balls ?? [])
    .filter((ball) => isObj(ball) && typeof ball.id === 'string' && /^[a-z0-9]{1,24}$/.test(ball.id) && !seen.has(ball.id) && seen.add(ball.id))
    .map((ball) => {
      let vx = num(ball.vx, -1, 1, 1);
      let vy = num(ball.vy, -1, 1, 0);
      const len = Math.hypot(vx, vy);
      if (len < 1e-3) { vx = 1; vy = 0; } else { vx /= len; vy /= len; }
      return {
        id: ball.id,
        x: num(ball.x, BALL_RADIUS, 1 - BALL_RADIUS, 0.5),
        y: num(ball.y, BALL_RADIUS, 1 - BALL_RADIUS, 0.5),
        vx,
        vy,
      };
    });

  return {
    walls,
    balls,
    speed: num(b.speed, ...BOUNCE_LIMITS.speed, 1),
    jitter: num(b.jitter, 0, 1, 0.3),
    collide: b.collide !== false,
    gate: num(b.gate, ...BOUNCE_LIMITS.gate, 1),
    quantize: QUANTIZE.includes(b.quantize) ? b.quantize : 0,
  };
}
