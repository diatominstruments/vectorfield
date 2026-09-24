# vision·land

Make songs in the browser, then (soon) make videos for them. This is the
music half: sign in, build a song from instruments, write patterns in a step
sequencer, and chain them into an arrangement.

Instruments and effects come from
[gloaming-instruments](../Documents/gloaming-instruments). Nothing in the app
lists them by hand — every picker, control panel and validation rule is
generated from the library's registry and param schemas — so a new or
updated instrument shows up here on the next build.

## Running it

Needs Node 26 (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
cp .env.example .env
npm run dev
```

Then open http://localhost:3000. `npm run dev` rebuilds the client on change
(including edits to the symlinked instrument library) and restarts the
server when `server/` or `shared/` change.

**Database.** Set `DATABASE_URL` to use Postgres. Without it, development
runs on [PGlite](https://pglite.dev) — real Postgres compiled to WebAssembly,
stored in `.data/` — so there's nothing to install. Migrations in
`server/migrations/` apply automatically on startup, on either.

**Sign-in.** Set `GOOGLE_CLIENT_ID` to an OAuth client ID (Google Cloud
Console → APIs & Services → Credentials → OAuth client ID → Web application,
with `http://localhost:3000` as an authorized JavaScript origin). For local
work without Google, `DEV_LOGIN=1` adds a name-only sign-in; it's ignored in
production.

```bash
npm test         # song model + API, against an in-memory database
npm run build    # minified client bundle for production
npm start        # production server (needs DATABASE_URL and GOOGLE_CLIENT_ID)
```

## How it fits together

```
client/            Preact + htm, bundled by esbuild
  engine.js        audio: song doc → live instrument chains + lookahead sequencer
  store.js         the song being edited, with debounced autosave
  ui/              sign-in, song list, editor (instruments / patterns / song)
shared/song.js     the song document format and its validation — both sides use it
server/            Express 5
  auth.js          Google ID token → our own session cookie
  songs.js         CRUD, scoped to the owner, with revision checks on save
  migrations/      plain SQL, applied in order
```

A **song** is one JSON document (stored as `jsonb`): tempo, tracks (an
instrument plus an effects chain each), patterns (notes per track, in
sixteenth-note steps) and the arrangement (pattern ids in play order). See
the comment at the top of `shared/song.js`.

The server runs every save through `normalizeSong()`, which checks shapes,
ids and limits and clamps every instrument param to the library's schema.
That matters once songs are shared: nothing a client sends can push an
instrument outside the ranges it was designed for. Saves carry the revision
they were based on, so two tabs can't silently overwrite each other.
