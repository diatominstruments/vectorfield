const env = process.env;

export const config = {
  production: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 3000),

  // Postgres connection string. Unset in development means an embedded
  // PGlite database under .data/ — real Postgres, no server to install.
  databaseUrl: env.DATABASE_URL ?? null,

  // OAuth client ID from Google Cloud Console (APIs & Services → Credentials,
  // type "Web application", with this site's origin as an authorized origin).
  googleClientId: env.GOOGLE_CLIENT_ID ?? null,

  // Local-only sign-in without Google, for development. Never in production.
  devLogin: env.DEV_LOGIN === '1' && env.NODE_ENV !== 'production',

  sessionDays: 30,
};

if (config.production && !config.databaseUrl) {
  throw new Error('DATABASE_URL is required in production');
}
if (config.production && !config.googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID is required in production');
}
