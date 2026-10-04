import { deflateSync, crc32 } from 'node:zlib';
import { hue } from '../shared/themes.js';
import { COVER_SIZE, MAX_COVER_BYTES } from '../shared/embed.js';

/**
 * Cover images: a song's picture in feeds, embeds and link previews. The
 * owner picks one when publishing by capturing a frame of the visuals (a
 * JPEG, checked here); a song without one gets one drawn from its
 * arrangement — every sixteenth of the song as a bar, as tall as the notes
 * struck on it, in its pattern's colour — so it still shows something of
 * the song rather than nothing.
 */

const JPEG_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

/** A captured cover, as the client sends it, to JPEG bytes; null if it isn't one. */
export function parseCover(dataUrl) {
  const m = typeof dataUrl === 'string' && JPEG_DATA_URL.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > MAX_COVER_BYTES || bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;   // JPEG start-of-image
  return bytes;
}

// The dark theme's background, and the levels its tints are drawn at.
const BG = [0x0b, 0x0b, 0x13];
const BAR = [0.7, 0.6];
const BAR_DIM = [0.45, 0.3];

/** A cover drawn from a song document, as PNG bytes. */
export function drawnCover(doc) {
  const { width: W, height: H } = COVER_SIZE;
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) px.set(BG, i * 3);

  const steps = songSteps(doc);
  const padX = Math.round(W * 0.05);
  const usable = W - padX * 2;
  // One bar per step, or per bucket of steps for a long song, 2px apart.
  const count = Math.max(1, Math.min(steps.length, Math.floor(usable / 6)));
  const slot = usable / count;
  const barW = Math.max(2, Math.floor(slot) - 2);
  const peak = Math.max(1, ...steps.map((s) => s.hits));
  const mid = H / 2;
  const maxHalf = H * 0.36;

  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * steps.length) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * steps.length) / count));
    const bucket = steps.slice(from, to);
    const hits = bucket.length ? Math.max(...bucket.map((s) => s.hits)) : 0;
    const h = bucket[0]?.hue ?? 170;
    const half = Math.max(3, Math.round((hits / peak) * maxHalf));
    const rgb = hslToRgb(h, ...(hits ? BAR : BAR_DIM));
    const x0 = Math.round(padX + b * slot);
    for (let y = Math.round(mid - half); y < Math.round(mid + half); y++) {
      for (let x = x0; x < x0 + barW && x < W; x++) px.set(rgb, (y * W + x) * 3);
    }
  }
  return encodePng(W, H, px);
}

/** Every sixteenth of the song in play order: its pattern's hue and how many notes start on it. */
function songSteps(doc) {
  const patterns = new Map((doc.patterns ?? []).map((p, i) => [p.id, { p, hue: hue(i) }]));
  const steps = [];
  for (const block of doc.arrangement ?? []) {
    const entry = patterns.get(block.pattern);
    if (!entry) continue;
    const { p } = entry;
    const muted = new Set(block.mute ?? []);
    const hits = new Array(p.length).fill(0);
    for (const [trackId, notes] of Object.entries(p.notes ?? {})) {
      if (muted.has(trackId) || !Array.isArray(notes)) continue;
      for (const n of notes) if (n.step >= 0 && n.step < p.length) hits[n.step]++;
    }
    for (let r = 0; r < (block.repeat ?? 1); r++) {
      for (const n of hits) steps.push({ hue: entry.hue, hits: n });
    }
    if (steps.length > 20000) break;   // more than enough to draw from
  }
  return steps;
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** RGB pixels (3 bytes each, row by row) to a PNG. */
function encodePng(width, height, rgb) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    // Each row starts with its filter type; 0 is none.
    rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);   // 8-bit, truecolour, deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
