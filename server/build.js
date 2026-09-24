import * as esbuild from 'esbuild';

/** Client bundle options, shared by `npm run build` and the dev server's watcher. */
export const clientBuild = {
  entryPoints: ['client/main.js'],
  bundle: true,
  format: 'esm',
  outfile: 'public/build/app.js',
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await esbuild.build({ ...clientBuild, minify: true });
}
