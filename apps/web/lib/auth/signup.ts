import { eq, sql } from "drizzle-orm";
import { users, type Db, type User } from "@wcdraft/db";

import { validateDisplayName, type DisplayNameRejection } from "@/lib/leaderboard/display-name";
import { hashPassword, isValidEmail, normalizeEmail, validatePasswordStrength } from "./passwords";

export type CreatePasswordAccountResult =
  | { readonly ok: true; readonly user: User }
  | {
      readonly ok: false;
      readonly code: "EMAIL_INVALID" | "EMAIL_TAKEN" | "PASSWORD_WEAK";
      readonly status: 400 | 409;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: "INVALID_USERNAME";
      readonly status: 422;
      readonly message: string;
      readonly usernameReason: DisplayNameRejection;
    }
  | {
      readonly ok: false;
      readonly code: "USERNAME_TAKEN";
      readonly status: 409;
      readonly message: string;
    };

export interface CreatePasswordAccountDeps {
  readonly db: Db;
  readonly now: () => number;
}

export async function createPasswordAccount(
  args: { readonly username: unknown; readonly email: unknown; readonly password: unknown },
  deps: CreatePasswordAccountDeps,
): Promise<CreatePasswordAccountResult> {
  const email = normalizeEmail(args.email);
  if (!isValidEmail(email)) {
    return {
      ok: false,
      code: "EMAIL_INVALID",
      status: 400,
      message: "Enter a valid email address.",
    };
  }

  const username = validateDisplayName(args.username);
  if (!username.ok) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      status: 422,
      message: "Choose a username with 3-20 letters, numbers, or underscores.",
      usernameReason: username.reason,
    };
  }

  const strength = validatePasswordStrength(args.password, email);
  if (strength !== null) {
    return { ok: false, code: "PASSWORD_WEAK", status: 400, message: strength };
  }

  const existingEmail = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingEmail[0]) {
    return {
      ok: false,
      code: "EMAIL_TAKEN",
      status: 409,
      message: "That email already has an account. Sign in instead.",
    };
  }

  const existingUsername = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${username.name}`)
    .limit(1);
  if (existingUsername[0]) {
    return {
      ok: false,
      code: "USERNAME_TAKEN",
      status: 409,
      message: "That username is already taken.",
    };
  }

  const passwordHash = await hashPassword(args.password as string);
  try {
    const inserted = await deps.db
      .insert(users)
      .values({
        email,
        username: username.name,
        passwordHash,
        passwordSetAt: new Date(deps.now()),
        emailVerifiedAt: null,
      })
      .returning();
    const user = inserted[0];
    if (!user) throw new Error("createPasswordAccount: insert returned no row");
    return { ok: true, user };
  } catch (err) {
    if (isUniqueCollision(err, "users_email_unique")) {
      return {
        ok: false,
        code: "EMAIL_TAKEN",
        status: 409,
        message: "That email already has an account. Sign in instead.",
      };
    }
    if (isUniqueCollision(err, "users_username_ci_uq")) {
      return {
        ok: false,
        code: "USERNAME_TAKEN",
        status: 409,
        message: "That username is already taken.",
      };
    }
    throw err;
  }
}

function isUniqueCollision(err: unknown, constraint: string): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "object") {
      const o = current as {
        code?: unknown;
        constraint?: unknown;
        cause?: unknown;
        errors?: unknown;
        message?: unknown;
      };
      if (o.code === "23505" && o.constraint === constraint) return true;
      if (typeof o.message === "string" && o.message.includes(constraint)) return true;
      queue.push(o.cause);
      if (Array.isArray(o.errors)) queue.push(...o.errors);
    }
  }
  return false;
}
