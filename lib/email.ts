// Email-sending abstraction.
//
// Every caller in this starter uses `sendEmail(...)` from this module. No
// caller imports a vendor SDK directly. That makes "which mailer to run in
// production" a per-project decision, not a starter-baked assumption.
//
// This starter ships THREE dev-grade providers:
//   - 'console' (default) — prints emails to stdout so dev/test flows can
//     grep the reset link. Tests in tests/password-reset.test.ts capture
//     it via a console.log spy.
//   - 'file'              — appends each email as a JSON line to the file
//     at EMAIL_OUTBOX_PATH (default /tmp/starter-test-emails.jsonl). Used
//     by the Playwright E2E suite, which can't reliably tap the dev
//     server's stdout from a separate test process. Dev/test only — the
//     file is unauthenticated, so this MUST NOT be selected in
//     production. Choosing it in NODE_ENV=production throws at module
//     load with a clear message.
//   - 'resend' / 'postmark' — stubs that throw a loud not-yet-implemented
//     error if selected. Real provider wiring is work for each project's
//     production setup (you bring your own deliverability config).
//
// The provider is resolved eagerly at module-import time (see the
// `sendEmail` export at the bottom). An unknown EMAIL_PROVIDER value
// therefore crashes the app at boot with a clear message — not on the
// first email two days into a deploy.

import { appendFile } from 'node:fs/promises';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type SendEmail = (msg: EmailMessage) => Promise<void>;

// Strips HTML tags from a body for the plain-text fallback. Intentionally
// dumb — the console provider prints whichever body the caller passed; this
// only kicks in when a caller skipped `text`. Real providers should be given
// both an html and a text body by the caller, so this fallback is mostly a
// dev-console nicety.
function htmlToText(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Surface anchor hrefs inline ("text (url)") so reset links remain
      // grep-able when a caller passes only html. Critical for the
      // console-provider's "tests can read the link off stdout" promise.
      .replace(
        /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, href, inner) =>
          `${String(inner)
            .replace(/<[^>]+>/g, '')
            .trim()} (${href})`,
      )
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

const consoleProvider: SendEmail = async (msg) => {
  const body = msg.text ?? htmlToText(msg.html);
  // The reset link MUST appear unredacted so dev/test flows can grep it.
  // (Better-Auth's password-reset flow puts the token in the URL body of
  // the email; tests in tests/password-reset.test.ts capture this stdout.)
  // eslint-disable-next-line no-console -- console is the entire point of this provider
  console.log(`[EMAIL] To: ${msg.to} Subject: ${msg.subject}\n${body}`);
};

function unimplementedProvider(name: string): SendEmail {
  return async () => {
    throw new Error(
      `Email provider '${name}' is not yet implemented in this starter. ` +
        `Wire your own production provider (see lib/email.ts). ` +
        `Set EMAIL_PROVIDER=console for local dev.`,
    );
  };
}

// Dev-only file provider. Appends each email as a single JSON line to the
// path in EMAIL_OUTBOX_PATH (defaults to /tmp/starter-test-emails.jsonl).
// Playwright E2E specs subscribe to this file to read the reset link —
// the dev server's stdout isn't reliably tappable from a separate test
// process, but a file on disk is.
//
// Atomicity: Node's fs.appendFile opens the file with O_APPEND, so even
// if multiple concurrent emails are flushing at once the OS guarantees
// each line-sized write lands intact (POSIX guarantees writes ≤ PIPE_BUF
// against an O_APPEND fd are atomic; a single 1–2KB JSON line is well
// inside that). No external lockfile needed.
//
// Trailing newline is REQUIRED — readers split on `\n`, so a missing
// final newline would silently drop the last email.
//
// SECURITY: the outbox file is unauthenticated and world-readable by
// whatever process started the dev server. Refusing to enable this
// provider in production keeps the contract obvious: 'file' is a test
// harness, not a deliverability path.
function fileProvider(): SendEmail {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      `Email provider 'file' is not allowed in production. ` +
        `It is a test-only sink that writes emails to a local file. ` +
        `Set EMAIL_PROVIDER to a real provider (or 'console' for dev).`,
    );
  }
  const path = process.env['EMAIL_OUTBOX_PATH'] ?? '/tmp/starter-test-emails.jsonl';
  return async (msg) => {
    const line =
      JSON.stringify({
        to: msg.to,
        subject: msg.subject,
        text: msg.text ?? htmlToText(msg.html),
        html: msg.html,
        sentAt: new Date().toISOString(),
      }) + '\n';
    await appendFile(path, line, { encoding: 'utf8' });
  };
}

export function getEmailProvider(): SendEmail {
  const provider = process.env['EMAIL_PROVIDER'] ?? 'console';
  switch (provider) {
    case 'console':
      return consoleProvider;
    case 'file':
      return fileProvider();
    case 'resend':
      return unimplementedProvider('resend');
    case 'postmark':
      return unimplementedProvider('postmark');
    default:
      throw new Error(
        `Unknown EMAIL_PROVIDER='${provider}'. ` +
          `Valid values: 'console' (default), 'file' (dev/test only), 'resend', 'postmark'. ` +
          `See lib/email.ts for the abstraction.`,
      );
  }
}

export const sendEmail: SendEmail = getEmailProvider();
