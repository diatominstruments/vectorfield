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

  // Optional. The Services ID from Apple Developer (Certificates, Identifiers
  // & Profiles → Identifiers → Services IDs) with Sign in with Apple
  // enabled, this site's domain, and `https://<domain>/` as a return URL.
  // Apple won't accept localhost, so try it locally through an HTTPS tunnel.
  appleClientId: env.APPLE_CLIENT_ID ?? null,

  // Local-only sign-in without Google, for development. Never in production.
  devLogin: env.DEV_LOGIN === '1' && env.NODE_ENV !== 'production',

  // The site's public origin, like https://vectorfield.example — the base
  // of the absolute links in share previews and embed codes. Unset, each
  // request's own host is used, which is right locally but not behind a
  // proxy that rewrites the host or terminates HTTPS.
  publicUrl: env.PUBLIC_URL?.replace(/\/+$/, '') || null,

  // Behind a reverse proxy (as on most hosts), which visitor address to
  // believe from X-Forwarded-For: usually the number of proxies in front,
  // like 1 (or anything Express's "trust proxy" setting takes). Limits on
  // password guessing are kept per address, so this must be right there —
  // unset, every visitor looks like the proxy and they all share one limit.
  // Set where there's no proxy, visitors could forge their address.
  trustProxy: /^\d+$/.test(env.TRUST_PROXY ?? '') ? Number(env.TRUST_PROXY) : env.TRUST_PROXY || false,

  // Recovery emails for password accounts — confirming the address, sending
  // reset links. Off unless RECOVERY_EMAIL=1: with it off, nothing about
  // email shows in the app, and a lost password can't be reset.
  recoveryEmail: env.RECOVERY_EMAIL === '1',
  // With it on, how to send them: an SMTP server as a URL, like
  // smtps://user:pass@smtp.example.com — any provider's SMTP settings.
  // Required in production; in development, unset prints emails to the
  // server log instead.
  smtpUrl: env.SMTP_URL || null,
  // Who they're from. Unset: no-reply at PUBLIC_URL's domain.
  mailFrom: env.MAIL_FROM || null,

  sessionDays: 30,
};

// Turned on, recovery emails must actually work. In production that also
// takes PUBLIC_URL: links in emails can't be built from a request's Host
// header, or anyone could send a reset request naming their own host, and
// the account's owner would get a working reset token pointed at it.
if (config.production && config.recoveryEmail && !(config.smtpUrl && config.publicUrl)) {
  throw new Error('RECOVERY_EMAIL=1 needs SMTP_URL and PUBLIC_URL in production');
}

if (config.production && !config.databaseUrl) {
  throw new Error('DATABASE_URL is required in production');
}
if (config.production && !config.googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID is required in production');
}
