import { create, chain } from 'gloaming-instruments';

const LOOKAHEAD = 0.12;   // seconds of audio scheduled ahead of the clock
const TICK_MS = 25;
const STEPS_PER_BEAT = 4;

/**
 * Engine — turns a song document into sound. Owns the AudioContext, one
 * live instrument → effects → gain chain per track, and a lookahead
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

  // The context is created on first use, from a click, so autoplay rules
  // let it start.
  #ensureContext() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = new GainNode(this.ctx, { gain: 0.9 });
    // A brick-wall-ish limiter: many tracks at full gain would clip, and
    // shared songs shouldn't be able to hurt anyone's ears.
    const limiter = new DynamicsCompressorNode(this.ctx, {
      threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1,
    });
    this.master.connect(limiter).connect(this.ctx.destination);
    if (this.song) this.sync(this.song);
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
    this.#ensureContext();
    this.stop();
    await this.ctx.resume();

    this.cursor = from.patternId
      ? { mode: 'pattern', patternId: from.patternId, index: 0, step: 0 }
      : { mode: 'song', patternId: null, index: from.index ?? 0, step: 0 };
    this.nextTime = this.ctx.currentTime + 0.05;
    this.pendingOffs = [];   // { time, instrument, note }, kept in time order
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
    const id = cursor.mode === 'pattern' ? cursor.patternId : song.arrangement[cursor.index];
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
      // Note-offs that fall due go first, so instruments see every event in
      // time order: a note ending where the next begins is a retrigger, not
      // an overlap (which a mono synth would play as a slide).
      this.#flushOffs(t);
      for (const track of this.song.tracks) {
        const live = this.live.get(track.id);
        if (!live || track.mute) continue;
        for (const n of pattern.notes[track.id] ?? []) {
          if (n.step !== this.cursor.step) continue;
          live.instrument.noteOn(n.note, n.velocity, t);
          this.#queueOff(t + n.length * stepLength, live.instrument, n.note);
        }
      }
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

  #queueOff(time, instrument, note) {
    const offs = this.pendingOffs;
    let i = offs.length;
    while (i > 0 && offs[i - 1].time > time) i--;
    offs.splice(i, 0, { time, instrument, note });
  }

  #flushOffs(upTo) {
    while (this.pendingOffs.length && this.pendingOffs[0].time <= upTo) {
      const { time, instrument, note } = this.pendingOffs.shift();
      instrument.noteOff(note, time);
    }
  }

  // The end of the arrangement: release everything as the last step ends,
  // then stop once that moment has actually been heard.
  #finish() {
    clearInterval(this.timer);
    this.#flushOffs(Infinity);
    const wait = Math.max(0, this.nextTime - this.ctx.currentTime);
    this.finishTimer = setTimeout(() => this.stop(), wait * 1000);
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

  /** Play one note now, for trying sounds while editing. */
  async audition(trackId, note, velocity = 0.9) {
    this.#ensureContext();
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
  }
}

const effectsKey = (track) => track.effects.map((e) => e.id).join(',');

function updateParams(module, params) {
  for (const [name, value] of Object.entries(params)) {
    if (module.params[name] !== value) module.setParam(name, value);
  }
}
