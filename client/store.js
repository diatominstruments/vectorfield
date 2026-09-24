import { normalizeSong } from '../shared/song.js';
import { api } from './api.js';

const SAVE_DELAY_MS = 800;

/**
 * SongStore — the song being edited, plus autosave. Components read
 * `store.doc` and change it only through `store.edit(fn)`, which mutates
 * the doc in place, pushes it to the audio engine, schedules a save and
 * re-renders subscribers.
 *
 * Save status: 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'. A
 * conflict (the song was saved from another tab) stops autosaving so
 * neither copy gets silently overwritten.
 */
export class SongStore {
  constructor(song, engine) {
    this.id = song.id;
    this.title = song.title;
    this.revision = song.revision;
    // Normalizing on load fills in params the library has added since the
    // song was saved, and drops any it has removed.
    this.doc = normalizeSong(song.doc);
    this.engine = engine;
    this.status = 'saved';
    this.subscribers = new Set();
    this.editCount = 0;
    this.savedCount = 0;
    engine.sync(this.doc);
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  #notify() {
    this.subscribers.forEach((fn) => fn());
  }

  edit(fn) {
    if (this.status === 'conflict') return;
    fn(this.doc);
    this.engine.sync(this.doc);
    this.#changed();
  }

  setTitle(title) {
    if (this.status === 'conflict') return;
    this.title = title;
    this.#changed();
  }

  #changed() {
    this.editCount++;
    this.status = 'unsaved';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    this.#notify();
  }

  get dirty() {
    return this.editCount !== this.savedCount;
  }

  async save() {
    clearTimeout(this.timer);
    if (!this.dirty || this.saving || this.status === 'conflict') return;
    this.saving = true;
    this.status = 'saving';
    this.#notify();

    const count = this.editCount;
    try {
      const { song } = await api.put(`/songs/${this.id}`, {
        title: this.title, revision: this.revision, doc: this.doc,
      });
      this.revision = song.revision;
      this.savedCount = count;
      this.status = this.dirty ? 'unsaved' : 'saved';
    } catch (err) {
      this.status = err.status === 409 ? 'conflict' : 'error';
    }
    this.saving = false;
    this.#notify();
    // Edits made while the request was in flight still need saving.
    if (this.dirty && this.status === 'unsaved') this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    if (this.status === 'error') this.timer = setTimeout(() => this.save(), 5000);
  }
}
