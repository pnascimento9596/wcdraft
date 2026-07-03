import { hash, verify } from "@node-rs/argon2";
import { eq, or, sql } from "drizzle-orm";
import { users, type Db, type User } from "@wcdraft/db";

import { AuthError } from "./errors";
import { consumeRateLimit } from "./rate-limit";

export const PASSWORD_KDF = "argon2id via @node-rs/argon2";
export const PASSWORD_RATE_PER_EMAIL = { maxCount: 10, windowMs: 15 * 60 * 1000 };
export const PASSWORD_RATE_PER_IP = { maxCount: 30, windowMs: 15 * 60 * 1000 };

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$/XeBnMPZVmvqm90RlZMhSA$6R+U4k+OSZrL/lVw48ZxZtytjJkYlgJMHSpH8537bng";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export interface PasswordDeps {
  readonly db: Db;
  readonly now: () => number;
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw);
}

export function validatePasswordStrength(password: unknown, email?: string): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 256) return "Use 256 characters or fewer.";
  const lower = password.toLowerCase();
  const compactEmail = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (compactEmail.length >= 4 && lower.includes(compactEmail)) {
    return "Do not include your email name in the password.";
  }
  if (/^(.)\1+$/u.test(password)) return "Use more than one repeated character.";
  if (/(password|wcdraft|football|123456|qwerty|letmein)/iu.test(password)) {
    return "Use a less obvious password.";
  }
  if (!/[A-Za-z]/u.test(password) || !/[^A-Za-z]/u.test(password)) {
    return "Mix letters with numbers or symbols.";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPasswordHash(
  passwordHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const hashToVerify = passwordHash ?? DUMMY_PASSWORD_HASH;
  try {
    const ok = await verify(hashToVerify, password, ARGON2_OPTIONS);
    return Boolean(passwordHash && ok);
  } catch {
    return false;
  }
}

export async function authenticatePassword(
  args: { readonly identifier: unknown; readonly password: unknown; readonly ipAddress: string },
  deps: PasswordDeps,
): Promise<{ user: User }> {
  const identifier =
    typeof args.identifier === "string" ? args.identifier.trim().toLowerCase() : "";
  const password = typeof args.password === "string" ? args.password : "";
  if (identifier.length === 0 || password.length === 0) {
    throw new AuthError("INVALID_CREDENTIALS", "Identifier or password is incorrect.");
  }

  const emailRate = await consumeRateLimit(
    {
      bucket: { kind: "password-email-15m", value: identifier },
      windowMs: PASSWORD_RATE_PER_EMAIL.windowMs,
      maxCount: PASSWORD_RATE_PER_EMAIL.maxCount,
    },
    deps,
  );
  const ipRate = await consumeRateLimit(
    {
      bucket: { kind: "password-ip-15m", value: args.ipAddress || "unknown" },
      windowMs: PASSWORD_RATE_PER_IP.windowMs,
      maxCount: PASSWORD_RATE_PER_IP.maxCount,
    },
    deps,
  );
  if (!emailRate.allowed || !ipRate.allowed) {
    throw new AuthError("RATE_LIMITED", "Too many password attempts. Wait and try again.");
  }

  const rows =
    isValidEmail(identifier) || USERNAME_RE.test(identifier)
      ? await deps.db
          .select()
          .from(users)
          .where(
            isValidEmail(identifier)
              ? or(eq(users.email, identifier), sql`lower(${users.username}) = ${identifier}`)
              : sql`lower(${users.username}) = ${identifier}`,
          )
          .limit(1)
      : [];
  const user = rows[0] ?? null;
  const ok = await verifyPasswordHash(user?.passwordHash ?? null, password);
  if (!user || !ok) {
    throw new AuthError("INVALID_CREDENTIALS", "Identifier or password is incorrect.");
  }
  return { user };
}
