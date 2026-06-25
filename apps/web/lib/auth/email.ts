// F-2 — pluggable EmailSender.
//
// LogEmailSender (default; no human gate) prints the magic-link URL to the
// server log so the F-2 build + every negative test runs without any
// external service. ResendEmailSender hits Resend's REST API directly via
// fetch — no new npm dep — and is exercised only when RESEND_API_KEY is set
// (production / staging). Both implementations satisfy the same contract.
//
// The sender NEVER receives the raw token (only the URL the user receives),
// so the only place the secret exists is the email itself.

export interface SendMagicLinkArgs {
  readonly toEmail: string;
  readonly magicLinkUrl: string;
  /** Best-effort label for log/UI ("from address" in production). */
  readonly fromAddress: string;
}

export interface EmailSender {
  readonly kind: "log" | "resend";
  sendMagicLink(args: SendMagicLinkArgs): Promise<void>;
}

/**
 * LOG sender — prints the magic-link URL via the supplied logger. Used in
 * development, tests, and CI. Returns the URL via the `lastSent` field so
 * integration tests can grab it without parsing log lines.
 */
export class LogEmailSender implements EmailSender {
  readonly kind = "log" as const;
  lastSent: SendMagicLinkArgs | null = null;
  constructor(private readonly logger: (line: string) => void = console.info) {}
  async sendMagicLink(args: SendMagicLinkArgs): Promise<void> {
    this.lastSent = args;
    this.logger(
      `[auth/email/log] would send magic link to ${args.toEmail} ` +
        `from ${args.fromAddress}: ${args.magicLinkUrl}`,
    );
    return Promise.resolve();
  }
}

/**
 * RESEND sender — calls https://api.resend.com/emails with the provided
 * API key and from-address. No SDK; just fetch + JSON. The HTML body is a
 * single anchor that opens the verify endpoint; plain-text fallback is the
 * URL.
 */
export class ResendEmailSender implements EmailSender {
  readonly kind = "resend" as const;
  constructor(
    private readonly apiKey: string,
    private readonly fromAddressOverride: string,
  ) {}
  async sendMagicLink(args: SendMagicLinkArgs): Promise<void> {
    const fromAddress = this.fromAddressOverride || args.fromAddress;
    const safeUrl = escapeHtml(args.magicLinkUrl);
    const body = {
      from: fromAddress,
      to: args.toEmail,
      subject: "Sign in to wcdraft",
      html:
        `<p>Click to sign in. This link expires in 15 minutes and can only be used once.</p>` +
        `<p><a href="${safeUrl}">Sign in to wcdraft</a></p>` +
        `<p>If you didn't ask for this, ignore the email — no account is created.</p>`,
      text:
        `Sign in to wcdraft. Link expires in 15 minutes and is single-use:\n\n` +
        `${args.magicLinkUrl}\n\n` +
        `If you didn't ask for this, ignore — no account is created.`,
    };
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Resend API failed: HTTP ${resp.status.toString()} ${txt.slice(0, 300)}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Factory: pick the prod adapter when configured, otherwise fall back to LOG.
 * No human gate to start the F-2 build — LOG sender works everywhere.
 */
export function getEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();
  if (key && from) {
    return new ResendEmailSender(key, from);
  }
  return new LogEmailSender();
}
