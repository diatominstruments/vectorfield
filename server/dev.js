import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import * as esbuild from 'esbuild';
import { clientBuild } from './build.js';

/**
 * `npm run dev`: rebuilds the client bundle on change (including edits to
 * the symlinked instrument library) and restarts the server when server or
 * shared code changes. The bundler lives here rather than in the server, so
 * a server restart doesn't restart it.
 */
process.chdir(new URL('..', import.meta.url).pathname);   // runnable from anywhere

const ctx = await esbuild.context(clientBuild);
await ctx.watch();

let child = null;
let restartTimer = null;

function start() {
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { stdio: 'inherit' });
}

function restart(file) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log(`\n${file} changed, restarting server…`);
    if (!child || child.exitCode !== null) return start();
    child.once('exit', start);
    child.kill();
  }, 100);
}

for (const dir of ['server', 'shared']) {
  watch(dir, { recursive: true }, (_event, file) => {
    if (file?.endsWith('.js') || file?.endsWith('.sql')) restart(`${dir}/${file}`);
  });
}

start();
process.on('SIGINT', () => { child?.kill(); process.exit(); });
process.on('SIGTERM', () => { child?.kill(); process.exit(); });
