import { rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';

/**
 * Client bundle options, shared by `npm run build` and the dev server's
 * watcher. `app.js` is what every page loads; the pages that play songs
 * (the editor, the song page, the embed player) import their code on first
 * use, so the audio engine, the visuals and three.js land in separate
 * chunks the feed never downloads.
 */
export const clientBuild = {
  entryPoints: { app: 'client/main.js' },
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'public/build',
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

/** Chunks are named by hash, so each build would otherwise leave the last one's behind. */
export const cleanBuild = () => rm(clientBuild.outdir, { recursive: true, force: true });

if (import.meta.url === `file://${process.argv[1]}`) {
  await cleanBuild();
  await esbuild.build({ ...clientBuild, minify: true });
}
