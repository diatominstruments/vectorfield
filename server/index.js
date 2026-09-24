import { config } from './config.js';
import { connect } from './db.js';
import { createApp } from './app.js';

const db = await connect();

createApp(db).listen(config.port, () => {
  const where = config.databaseUrl ? 'Postgres' : 'embedded PGlite (.data/)';
  console.log(`vision-land on http://localhost:${config.port} — database: ${where}`);
  if (!config.googleClientId) console.log('GOOGLE_CLIENT_ID not set: Google sign-in disabled.');
  if (config.devLogin) console.log('DEV_LOGIN=1: local dev sign-in enabled.');
});
