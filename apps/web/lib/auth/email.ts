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
import { boundedRequest } from "@wcdraft/data/client";

export const RESEND_TIMEOUT_MS = 8_000;

export interface SendMagicLinkArgs {
  readonly toEmail: string;
  readonly magicLinkUrl: string;
  /** Best-effort label for log/UI ("from address" in production). */
  readonly fromAddress: string;
  readonly purpose?: "signin" | "verification" | "reset";
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
    const purpose = args.purpose ?? "signin";
    this.logger(
      `[auth/email/log] would send ${purpose} link to ${args.toEmail} ` +
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
    const copy = emailCopy(args.purpose ?? "signin");
    const body = {
      from: fromAddress,
      to: args.toEmail,
      subject: copy.subject,
      html:
        `<p>${escapeHtml(copy.lede)}</p>` +
        `<p><a href="${safeUrl}">${escapeHtml(copy.cta)}</a></p>` +
        `<p>${escapeHtml(copy.footer)}</p>`,
      text: `${copy.lede}\n\n${args.magicLinkUrl}\n\n${copy.footer}`,
    };
    await boundedRequest(
      async (signal) => {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });
        if (!resp.ok) {
          // Consume inside the same deadline. The provider body is never
          // logged by the centralized security logger.
          const txt = await resp.text();
          throw new Error(`Resend API failed: HTTP ${resp.status.toString()} ${txt.slice(0, 300)}`);
        }
      },
      {
        operation: "authentication email delivery",
        timeoutMs: RESEND_TIMEOUT_MS,
        safety: "unsafe-mutation",
      },
    );
  }
}

function emailCopy(purpose: NonNullable<SendMagicLinkArgs["purpose"]>): {
  subject: string;
  lede: string;
  cta: string;
  footer: string;
} {
  switch (purpose) {
    case "verification":
      return {
        subject: "Verify your wcdraft email",
        lede: "Verify your wcdraft email. This link expires in 15 minutes and can only be used once.",
        cta: "Verify email",
        footer: "If you didn't create this account, ignore this email.",
      };
    case "reset":
      return {
        subject: "Reset your wcdraft password",
        lede: "Reset your wcdraft password. This link expires in 15 minutes and can only be used once.",
        cta: "Reset password",
        footer: "If you didn't ask for this, ignore this email.",
      };
    case "signin":
      return {
        subject: "Sign in to wcdraft",
        lede: "Sign in to wcdraft. This link expires in 15 minutes and can only be used once.",
        cta: "Sign in to wcdraft",
        footer: "If you didn't ask for this, ignore this email.",
      };
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
