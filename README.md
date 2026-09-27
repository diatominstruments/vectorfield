# Vectorfield

Make songs in the browser, then set them to visuals. Sign in, build a song
from instruments, write patterns in a step sequencer, chain them into an
arrangement, and attach visualizations to each block of it. Tag it with
genres and publish it: it goes into the feed and gets a page where anyone
can play it, visuals and all, live — nothing is rendered to video.

Instruments and effects come from
[gloaming-instruments](https://github.com/diatominstruments/gloaming-instruments),
and visualizations from
[gloaming-kit](https://github.com/diatominstruments/gloaming-kit). Nothing in
the app lists them by hand — every picker and control panel is generated
from the libraries' registries, param schemas and declared visualization
inputs — so a new or updated instrument or visualization shows up here on
the next build.

## Running it

Needs Node 26 (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
cp .env.example .env
npm run dev
```

Then open http://localhost:3000. `npm run dev` rebuilds the client on change
and restarts the server when `server/` or `shared/` change.

**The libraries.** `package.json` pins gloaming-instruments and gloaming-kit
to a commit in their GitHub repos, so `npm ci` gets the same code anywhere.
To bump one, push the library, put the new commit hash after the `#` in
`package.json`, and run `npm install`. To work on a library and see edits
here live, link your checkout in instead — this swaps in a symlink without
touching `package.json`, and a plain `npm install` puts the pinned version
back:

```bash
npm link ../path/to/gloaming-instruments
```

**Database.** Set `DATABASE_URL` to use Postgres. Without it, development
runs on [PGlite](https://pglite.dev) — real Postgres compiled to WebAssembly,
stored in `.data/` — so there's nothing to install. Migrations in
`server/migrations/` apply automatically on startup, on either.

**Sign-in.** Google identifies the account, nothing more: only the account
id, verified email and avatar are kept, never the Google name. After a
first sign-in the user picks a username, which is the one name shown
anywhere in the app and the address of their profile, and a colour theme.

**Themes.** Dark (the default), light, goth, dawn and forest, listed in
`shared/themes.js`. Every colour in `public/styles.css` is a token set per
theme under a `[data-theme]` selector, including the saturation and
lightness that track and pattern hues are drawn at, so adding a theme is
one more block of tokens and one entry in the list. The choice is saved on
the account (changeable at `/settings`) and mirrored in `localStorage`,
which `public/theme-boot.js` reads before the bundle loads so the first
paint is already themed.

Set `GOOGLE_CLIENT_ID` to an OAuth client ID (Google Cloud
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
  main.js          routes: / feed, /s/:id song page, /u/:username profile, /studio, /songs/:id editor, /settings
  theme.js         applies a theme (data-theme on <html>) and remembers it on the device
  engine.js        audio: song doc → live instrument chains + lookahead sequencer
  bounce-sim.js, tubule-sim.js  the generative sequencers — bouncing balls, microtubules — stepped by the engine
  store.js         the song being edited, with debounced autosave
  ui/visual-canvas.js  gloaming-kit on a canvas: analyzes the engine's output, follows its clock
  ui/visuals.js    the editor's visuals tab; ui/player.js the read-only song page
  ui/feed.js       New / For you; ui/profile.js profiles; ui/publish.js the Publish tab
  ui/genre-picker.js  choosing genres, for a song's tags or a profile's interests
  ui/theme-picker.js  choosing a colour theme, at signup and in ui/settings.js
shared/song.js     the song document format and its validation — both sides use it
shared/bounce.js, shared/tubules.js  each generative sequencer's settings and their validation
shared/visuals.js  validation for the visual side: looks and the kit's signal-spec language
shared/genres.js   the electronic music taxonomy (families → genres) used for tags
shared/users.js    username and profile rules
shared/themes.js   the colour themes; their tokens are in public/styles.css
server/            Express 5
  auth.js          Google ID token → our own session cookie; profile edits
  songs.js         the owner's side: CRUD with revision checks, publishing
  public.js        what anyone can read: the feed, profiles, published songs
  migrations/      plain SQL, applied in order
```

A **song** is one JSON document (stored as `jsonb`): tempo, tracks (an
instrument plus an effects chain each), the main mix's effects chain (on the
whole song, before the output limiter), patterns (notes per track, in
sixteenth-note steps), the arrangement (blocks in play order, each playing a
pattern and carrying the visualizations shown meanwhile, plus an optional
style override) and the song's base look. See
the comment at the top of `shared/song.js`.

**Publishing.** A song is private until its owner publishes it from the
editor's Publish tab, which also sets up to five genre tags (from
`shared/genres.js`, where a tag can be a family like "techno" or a genre
like "dub-techno") and a description. Published songs appear in the feed —
_New_ is everything, _For you_ is what's tagged with genres in the user's
interests, where liking a family means liking every genre in it — and at
`/s/:id`, where the song plays live from its document with its visuals.
Unpublishing takes it out of both.

The server runs every save through `normalizeSong()`, which checks shapes,
ids and limits and clamps every instrument param to the library's schema.
That matters once songs are shared: nothing a client sends can push an
instrument outside the ranges it was designed for. Saves carry the revision
they were based on, so two tabs can't silently overwrite each other.
