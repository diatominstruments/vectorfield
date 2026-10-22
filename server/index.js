import { config } from './config.js';
import { connect } from './db.js';
import { createApp } from './app.js';
import { createMailer } from './mail.js';

const db = await connect();
const mailer = await createMailer();

createApp(db, { mailer }).listen(config.port, () => {
  const where = config.databaseUrl ? 'Postgres' : 'embedded PGlite (.data/)';
  console.log(`Vectorfield on http://localhost:${config.port} — database: ${where}`);
  if (!config.googleClientId) console.log('GOOGLE_CLIENT_ID not set: Google sign-in disabled.');
  if (config.devLogin) console.log('DEV_LOGIN=1: local dev sign-in enabled.');
  if (!mailer) console.log('RECOVERY_EMAIL not set: recovery emails are off.');
  else if (!config.smtpUrl) console.log('RECOVERY_EMAIL=1 without SMTP_URL: emails are printed here.');
});
