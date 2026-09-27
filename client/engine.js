import { create, chain } from 'gloaming-instruments';
import { blockTimes, sequencerOf } from '../shared/song.js';
import { BounceSim } from './bounce-sim.js';
import { TubuleSim } from './tubule-sim.js';

const LOOKAHEAD = 0.12;   // seconds of audio scheduled ahead of the clock
const TICK_MS = 25;
const STEPS_PER_BEAT = 4;
const TUBULE_VELOCITY = 0.7;

/**
 * Engine — turns a song document into sound. Owns the AudioContext, one
 * live instrument → effects → gain chain per track, the main mix's effects
 * after them (master → mix effects → limiter), and a lookahead
 * scheduler that plays either one pattern on loop or the arrangement.
 *
 * The song document stays the source of truth: after any edit, sync(song)
 * brings the live graph in line, changing params in place where it can and
 * rebuilding a track's chain only when its modules change.
 *
 * Events (via on()): 'state' when playback starts or stops, 'position'
 * { patternId, index, step } as each step becomes audible.
 */
export class Engine {
  constructor() {
    this.ctx = null;
    this.song = null;
    this.live = new Map();   // track id -> { instrument, effects, gain, key }
    this.mix = { effects: [], key: '' };   // the main mix's live effects
    this.listeners = new Map();
    this.playing = false;
    this.position = null;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  // Created on first use. Normally that's a click, so autoplay rules let
  // it start; a context made earlier (the visuals page, which needs one to
  // attach to) starts suspended and is resumed by play().
  ensureContext() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = new GainNode(this.ctx, { gain: 0.9 });
    // A brick-wall-ish limiter: many tracks at full gain would clip, and
    // shared songs shouldn't be able to hurt anyone's ears.
    const limiter = new DynamicsCompressorNode(this.ctx, {
      threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1,
    });
    // Mix effects go between master and limiter (see #rewireMix), so the
    // limiter always has the last word.
    this.limiter = limiter;
    this.master.connect(limiter).connect(this.ctx.destination);
    /** Everything the song plays, post-limiter — for analysis. */
    this.output = limiter;
    if (this.song) this.sync(this.song);
    return this.ctx;
  }

  // ---- graph -------------------------------------------------------------------

  sync(song) {
    this.song = song;
    if (!this.ctx) return;

    const ids = new Set(song.tracks.map((t) => t.id));
    for (const [id, live] of this.live) {
      if (!ids.has(id)) {
        this.#teardown(live);
        this.live.delete(id);
      }
    }

    for (const track of song.tracks) {
      let live = this.live.get(track.id);
      if (!live || live.instrument.constructor.id !== track.instrument.id) {
        if (live) this.#teardown(live);
        live = this.#build(track);
        this.live.set(track.id, live);
      } else {
        const key = effectsKey(track);
        if (key !== live.key) this.#rewireEffects(live, track);
        updateParams(live.instrument, track.instrument.params);
        track.effects.forEach((e, i) => updateParams(live.effects[i], e.params));
      }
      live.gain.gain.setTargetAtTime(track.mute ? 0 : track.gain, this.ctx.currentTime, 0.01);
    }

    if (effectsKey(song.mix) !== this.mix.key) this.#rewireMix(song.mix);
    song.mix.effects.forEach((e, i) => updateParams(this.mix.effects[i], e.params));
  }

  #rewireMix(mix) {
    this.master.disconnect();
    this.mix.effects.forEach((e) => e.dispose());
    this.mix.effects = mix.effects.map((e) => create(this.ctx, e));
    chain(this.master, ...this.mix.effects, this.limiter);
    this.mix.key = effectsKey(mix);
  }

  #build(track) {
    const instrument = create(this.ctx, track.instrument);
    const gain = new GainNode(this.ctx, { gain: track.mute ? 0 : track.gain });
    gain.connect(this.master);
    const live = { instrument, effects: [], gain, key: null };
    this.#rewireEffects(live, track);
    return live;
  }

  #rewireEffects(live, track) {
    live.instrument.output.disconnect();
    live.effects.forEach((e) => e.dispose());
    live.effects = track.effects.map((e) => create(this.ctx, e));
    chain(live.instrument, ...live.effects, live.gain);
    live.key = effectsKey(track);
  }

  #teardown(live) {
    live.instrument.allNotesOff();
    live.instrument.dispose();
    live.effects.forEach((e) => e.dispose());
    live.gain.disconnect();
  }

  // ---- playback --------------------------------------------------------------

  /** Play one pattern on loop ({ patternId }) or the arrangement ({ index }). */
  async play(from) {
    this.ensureContext();
    this.stop();
    await this.ctx.resume();

    this.cursor = from.patternId
      ? { mode: 'pattern', patternId: from.patternId, index: 0, step: 0 }
      : { mode: 'song', patternId: null, index: from.index ?? 0, step: 0 };
    this.startIndex = this.cursor.index;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.queue = [];         // note events waiting for their time; see #enqueue
    this.sims = new Map();   // pattern + track + sequencer → its simulation; fresh every play
    this.heard = [];         // positions waiting for the clock to reach them
    this.playing = true;
    this.timer = setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
    this.#watchPosition();
    this.emit('state', true);
  }

  stop() {
    if (!this.playing) return;
    clearInterval(this.timer);
    clearTimeout(this.finishTimer);
    cancelAnimationFrame(this.raf);
    const now = this.ctx.currentTime;
    for (const live of this.live.values()) live.instrument.allNotesOff(now);
    this.playing = false;
    this.position = null;
    this.emit('position', null);
    this.emit('state', false);
  }

  #pattern() {
    const { song, cursor } = this;
    const id = cursor.mode === 'pattern' ? cursor.patternId : song.arrangement[cursor.index]?.pattern;
    return song.patterns.find((p) => p.id === id) ?? null;
  }

  #tick() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextTime < horizon) {
      let pattern = this.#pattern();
      // Edits can shorten a pattern under the cursor; treat that as its end.
      if (pattern && this.cursor.step >= pattern.length) {
        this.#advance();
        pattern = this.#pattern();
      }
      if (!pattern) return this.#finish();

      const t = this.nextTime;
      const stepLength = 60 / this.song.bpm / STEPS_PER_BEAT;
      const stepped = new Set();
      for (const track of this.song.tracks) {
        const kind = sequencerOf(pattern, track.id);
        if (kind === 'bounce') this.#bounceStep(pattern, track, t, stepLength);
        else if (kind === 'tubules') stepped.add(this.#tubuleStep(pattern, track, t, stepLength));
        else this.#gridStep(pattern, track, t, stepLength);
      }
      // Tubules hold their notes, so any left sounding from another pattern
      // (or a track that has changed sequencer) must let go.
      for (const [key, entry] of this.sims) {
        if (entry.voices?.size && !stepped.has(key)) this.#silenceTubules(entry, t);
      }
      this.#flush(t + stepLength);
      this.heard.push({ time: t, patternId: pattern.id, index: this.cursor.index, step: this.cursor.step });

      this.nextTime += stepLength;
      this.cursor.step++;
      if (this.cursor.step >= pattern.length) this.#advance();
    }
  }

  #advance() {
    this.cursor.step = 0;
    if (this.cursor.mode === 'song') this.cursor.index++;
  }

  // Step grid: the track's notes that start on this step.
  #gridStep(pattern, track, t, stepLength) {
    const live = this.live.get(track.id);
    if (!live || track.mute) return;
    for (const n of pattern.notes[track.id] ?? []) {
      if (n.step === this.cursor.step) this.#queueOn(t, live.instrument, n.note, n.velocity, n.length * stepLength);
    }
  }

  // Bouncing balls: run the track's balls through this step and play each
  // wall hit at the moment it happens (or on the next grid line, when
  // quantized). The balls live for the whole playback, so they carry on
  // from where they were the next time the pattern comes round.
  #bounceStep(pattern, track, t, stepLength) {
    const config = pattern.bounce[track.id];
    const key = simKey(pattern.id, track.id, 'bounce');
    let entry = this.sims.get(key);
    if (!entry) {
      entry = { sim: new BounceSim(config), trace: [], hits: [] };
      this.sims.set(key, entry);
    }
    entry.sim.sync(config);

    const beat = stepLength * STEPS_PER_BEAT;
    if (!entry.trace.length) entry.trace.push({ time: t, balls: snapshot([...entry.sim.balls.values()]) });
    const hits = entry.sim.advance(1 / STEPS_PER_BEAT, (at, balls) => {
      entry.trace.push({ time: t + at * beat, balls: snapshot(balls) });
    });
    // Keep a couple of seconds of history for the editor to draw from.
    const keepFrom = this.ctx.currentTime - 2;
    while (entry.trace.length > 2 && entry.trace[1].time < keepFrom) entry.trace.shift();
    while (entry.hits.length && entry.hits[0].time < keepFrom) entry.hits.shift();

    // A muted track's balls keep moving; they just don't sound.
    const live = track.mute ? null : this.live.get(track.id);
    for (const hit of hits) {
      let time = t + hit.at * beat;
      if (config.quantize) {
        const step = this.cursor.step + hit.at * STEPS_PER_BEAT;
        const snapped = Math.ceil(step / config.quantize - 1e-9) * config.quantize;
        time = t + (snapped - this.cursor.step) * stepLength;
      }
      entry.hits.push({ time, segment: hit.segment });
      if (live) this.#queueOn(time, live.instrument, config.walls[hit.segment], 0.45 + 0.55 * hit.strength, config.gate * stepLength);
    }
  }

  // Microtubules: run the track's tubules through this step. Holding, each
  // zone sounds for as long as a tubule sounds it (see tubules.js for what
  // that means in each `sound` setting); otherwise each ring a tip grows
  // into plays its notes for the set length. Tubules sounding the same
  // note share it. Like the balls, they live for the whole playback.
  // Returns the entry's key.
  #tubuleStep(pattern, track, t, stepLength) {
    const config = pattern.tubules[track.id];
    const key = simKey(pattern.id, track.id, 'tubules');
    let entry = this.sims.get(key);
    if (!entry) {
      entry = { sim: new TubuleSim(config), trace: [], hits: [], voices: new Map(), held: new Map(), instrument: null };
      this.sims.set(key, entry);
    }
    entry.sim.sync(config);

    // A muted track's tubules keep growing; they just don't sound.
    const instrument = track.mute ? null : this.live.get(track.id)?.instrument ?? null;
    if (instrument !== entry.instrument) {
      this.#silenceTubules(entry, t);
      entry.instrument = instrument;
    }

    // Bring what's held in line with the tubules. At the start of the step
    // that catches edits (tuning, sections, the sound or hold settings), an
    // unmute, or this pattern coming round again; after each change inside
    // it, the tubules themselves.
    const noteOf = ({ ring, section }) => config.rings[ring][section];
    const reconcile = (time) => {
      const want = config.hold && instrument ? entry.sim.voices() : new Map();
      for (const [id, note] of entry.voices) {
        if (!want.has(id) || noteOf(want.get(id)) !== note) this.#releaseVoice(entry, id, time);
      }
      for (const [id, zone] of want) if (!entry.voices.has(id)) this.#holdVoice(entry, id, noteOf(zone), time);
    };
    reconcile(t);

    const beat = stepLength * STEPS_PER_BEAT;
    if (!entry.trace.length) entry.trace.push({ time: t, tubules: snapshotTubules(entry.sim.tubules.values()) });
    const entries = entry.sim.advance(1 / STEPS_PER_BEAT, (at, tubules) => {
      entry.trace.push({ time: t + at * beat, tubules: snapshotTubules(tubules) });
      reconcile(t + at * beat);
    });
    const keepFrom = this.ctx.currentTime - 2;
    while (entry.trace.length > 2 && entry.trace[1].time < keepFrom) entry.trace.shift();
    while (entry.hits.length && entry.hits[0].time < keepFrom) entry.hits.shift();

    for (const e of entries) {
      const time = t + e.at * beat;
      entry.hits.push({ time, ring: e.ring, section: e.section });
      if (!instrument || config.hold) continue;
      // Struck notes: the tip's zone, or with it every zone the tubule passes through.
      const rings = config.sound === 'whole' ? Array.from({ length: e.ring + 1 }, (_, r) => r) : [e.ring];
      const notes = new Set(rings.map((ring) => noteOf({ ring, section: e.section })));
      for (const note of notes) this.#queueOn(time, instrument, note, TUBULE_VELOCITY, config.gate * stepLength);
    }
    return key;
  }

  // Held notes are counted per pitch, so two tubules sounding one note are
  // one note that ends when the last of them lets go.
  #holdVoice(entry, id, note, time) {
    entry.voices.set(id, note);
    const count = entry.held.get(note) ?? 0;
    entry.held.set(note, count + 1);
    if (!count) this.#enqueue({ time, on: true, instrument: entry.instrument, note, velocity: TUBULE_VELOCITY, length: null });
  }

  #releaseVoice(entry, id, time) {
    const note = entry.voices.get(id);
    entry.voices.delete(id);
    const count = entry.held.get(note) - 1;
    if (count) {
      entry.held.set(note, count);
      return;
    }
    entry.held.delete(note);
    // An instrument swapped out has already been silenced and disposed.
    if ([...this.live.values()].some((l) => l.instrument === entry.instrument)) {
      this.#enqueue({ time, on: false, instrument: entry.instrument, note });
    }
  }

  #silenceTubules(entry, time) {
    for (const id of [...entry.voices.keys()]) this.#releaseVoice(entry, id, time);
  }

  // Every note-on and note-off goes through one queue in time order, and
  // offs sort before ons at the same instant: instruments must see events in
  // order, and a note ending where the next begins is a retrigger, not an
  // overlap (which a mono synth would play as a slide).
  #queueOn(time, instrument, note, velocity, length) {
    this.#enqueue({ time, on: true, instrument, note, velocity, length });
  }

  #enqueue(event) {
    const q = this.queue;
    const rank = (e) => e.time + (e.on ? 1e-9 : 0);
    let i = q.length;
    while (i > 0 && rank(q[i - 1]) > rank(event)) i--;
    q.splice(i, 0, event);
  }

  /** Send every queued event before `end` to its instrument. */
  #flush(end) {
    while (this.queue.length && this.queue[0].time < end) {
      const e = this.queue.shift();
      if (e.on) {
        e.instrument.noteOn(e.note, e.velocity, e.time);
        // Held notes (length null) are ended by their own note-off.
        if (e.length != null) this.#enqueue({ time: e.time + e.length, on: false, instrument: e.instrument, note: e.note });
      } else {
        e.instrument.noteOff(e.note, e.time);
      }
    }
  }

  // The end of the arrangement: release everything still held (dropping any
  // hits snapped past the end), then stop once that moment has been heard.
  #finish() {
    clearInterval(this.timer);
    for (const entry of this.sims.values()) if (entry.voices) this.#silenceTubules(entry, this.nextTime);
    this.queue = this.queue.filter((e) => !e.on);
    this.#flush(Infinity);
    const wait = Math.max(0, this.nextTime - this.ctx.currentTime);
    this.finishTimer = setTimeout(() => this.stop(), wait * 1000);
  }

  /**
   * What a track's balls or tubules in a pattern have been doing, for
   * drawing: { trace: [{ time, balls | tubules }], hits: [{ time, … }] }.
   * Null unless playing.
   */
  sequencerTrace(patternId, trackId, kind) {
    return this.playing ? this.sims?.get(simKey(patternId, trackId, kind)) ?? null : null;
  }

  // The scheduler runs ahead of the speakers; the UI should follow what's
  // audible, so positions are released against the audio clock.
  #watchPosition() {
    const frame = () => {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      let latest = null;
      while (this.heard.length && this.heard[0].time <= now) latest = this.heard.shift();
      if (latest) {
        this.position = latest;
        this.emit('position', latest);
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /**
   * Seconds into the song that are audible right now, while the arrangement
   * plays; null otherwise. Interpolated from the last step heard, so it
   * moves smoothly between steps.
   */
  get songTime() {
    if (!this.playing || this.cursor.mode !== 'song') return null;
    const times = blockTimes(this.song);
    const pos = this.position;
    if (!pos) return times[this.startIndex]?.start ?? 0;
    const stepLength = 60 / this.song.bpm / STEPS_PER_BEAT;
    const since = Math.min(stepLength, Math.max(0, this.ctx.currentTime - pos.time));
    return (times[pos.index]?.start ?? 0) + pos.step * stepLength + since;
  }

  /** Play one note now, for trying sounds while editing. */
  async audition(trackId, note, velocity = 0.9) {
    this.ensureContext();
    await this.ctx.resume();
    const live = this.live.get(trackId);
    if (!live) return;
    live.instrument.noteOn(note, velocity, this.ctx.currentTime);
    // Released on the wall clock rather than scheduled ahead, so it can't
    // arrive out of order with notes the sequencer schedules meanwhile.
    setTimeout(() => live.instrument.noteOff(note, this.ctx.currentTime), 250);
  }

  dispose() {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
    this.live.clear();
    this.mix = { effects: [], key: '' };
  }
}

/** A chain's module ids, to tell a param change from a change of modules. */
const effectsKey = (holder) => holder.effects.map((e) => e.id).join(',');

function updateParams(module, params) {
  for (const [name, value] of Object.entries(params)) {
    if (module.params[name] !== value) module.setParam(name, value);
  }
}

const simKey = (patternId, trackId, kind) => `${patternId}:${trackId}:${kind}`;
const snapshot = (balls) => balls.map(({ id, x, y }) => ({ id, x, y }));
const snapshotTubules = (tubules) => [...tubules].map(({ id, angle, length, growing }) => ({ id, angle, length, growing }));
