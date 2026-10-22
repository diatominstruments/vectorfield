import { config } from './config.js';

/**
 * Something that sends email, or null when recovery emails are off (see
 * RECOVERY_EMAIL in config.js): SMTP_URL when it's set (any provider's SMTP
 * settings), or — in development without it — the server log, so the links
 * in emails can be followed locally.
 */
export async function createMailer() {
  if (!config.recoveryEmail) return null;
  if (config.smtpUrl) {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport(config.smtpUrl);
    const from = config.mailFrom ?? `Vectorfield <no-reply@${new URL(config.publicUrl ?? 'http://localhost').hostname}>`;
    return { send: (message) => transport.sendMail({ from, ...message }) };
  }
  if (!config.production) {
    return { send: async ({ to, subject, text }) => console.log(`\n✉ To: ${to}\n  Subject: ${subject}\n\n${text}\n`) };
  }
  return null;
}

/** j•••@example.com: enough for its owner to recognise, not enough to give it away. */
const masked = (email) => email.replace(/^(.)[^@]*/, '$1•••');

/** Every email the site sends: plain text, about the account @username. */
export const emails = {
  verify: ({ username, link }) => ({
    subject: 'Confirm your recovery email for Vectorfield',
    text: `Someone, hopefully you, wants to be able to reset the password of @${username} on Vectorfield from this address. `
      + `To confirm it, open this link within 24 hours:\n\n${link}\n\n`
      + "If that wasn't you, ignore this email and the address won't be used.",
  }),

  reset: ({ username, link }) => ({
    subject: 'Reset your Vectorfield password',
    text: `Someone asked to reset the password of @${username} on Vectorfield. To choose a new one, open this link within an hour:\n\n${link}\n\n`
      + "If that wasn't you, ignore this email: your password hasn't changed.",
  }),

  passwordChanged: ({ username }) => ({
    subject: 'Your Vectorfield password was changed',
    text: `The password of @${username} on Vectorfield was just changed, and every other device signed out.\n\n`
      + 'If that wasn\'t you, reset it now with "Forgot password?" on the sign-in page. This address still can.',
  }),

  recoveryChanged: ({ username, email }) => ({
    subject: 'Your Vectorfield recovery email was changed',
    text: `The recovery email of @${username} on Vectorfield was just ${email ? `changed to ${masked(email)}` : 'removed'}, `
      + "so password resets won't come here any more.\n\n"
      + "If that wasn't you, someone else knows your password: sign in and change it now.",
  }),
};
