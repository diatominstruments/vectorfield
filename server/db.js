import { mkdir, readdir, readFile } from 'node:fs/promises';
import { config } from './config.js';

const MIGRATIONS = new URL('./migrations/', import.meta.url);

/**
 * Database handle:
 *
 *   query(text, params) → { rows }
 *   transaction(async (tx) => { await tx.query(...) })
 *
 * Backed by node-postgres when a DATABASE_URL is given, or by PGlite (real
 * Postgres compiled to WebAssembly, in-process) otherwise — so everything
 * above this file is the same SQL either way.
 */
export async function connect(databaseUrl = config.databaseUrl) {
  let db;
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    db = {
      query: (text, params) => pool.query(text, params),
      // A pool hands each query to whichever client is free, so a
      // transaction has to hold one client for its whole length.
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const result = await fn(client);
          await client.query('commit');
          return result;
        } catch (err) {
          await client.query('rollback');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    // PGLITE_DIR='memory://' for tests; otherwise persisted under .data/.
    const dir = process.env.PGLITE_DIR ?? './.data/pglite';
    if (!dir.includes('://')) await mkdir(dir, { recursive: true });
    const pglite = new PGlite(dir);
    db = {
      query: (text, params) => pglite.query(text, params),
      transaction: (fn) => pglite.transaction(fn),
      close: () => pglite.close(),
    };
  }
  await migrate(db);
  return db;
}

/** Apply migrations/NNN_*.sql in order, each once, each in a transaction. */
async function migrate(db) {
  await db.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query('select name from schema_migrations')).rows.map((r) => r.name));

  for (const file of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, MIGRATIONS), 'utf8');
    try {
      await db.transaction(async (tx) => {
        for (const statement of sql.split(/;\s*$/m).filter((s) => s.trim())) await tx.query(statement);
        await tx.query('insert into schema_migrations (name) values ($1)', [file]);
      });
    } catch (err) {
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }
}
