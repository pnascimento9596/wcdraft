import { users, type Db } from "@wcdraft/db";
import { eq } from "drizzle-orm";

import { validateDisplayName, type DisplayNameRejection } from "@/lib/leaderboard/display-name";

export interface PublicProfile {
  readonly user_id: string;
  readonly username: string | null;
}

export type UsernameUpdateResult =
  | { readonly ok: true; readonly profile: PublicProfile }
  | {
      readonly ok: false;
      readonly code: "INVALID_USERNAME";
      readonly reason: DisplayNameRejection;
    }
  | { readonly ok: false; readonly code: "USERNAME_TAKEN" };

export async function readPublicProfile(db: Db, userId: string): Promise<PublicProfile | null> {
  const rows = await db
    .select({ user_id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateUsername(
  db: Db,
  userId: string,
  rawUsername: unknown,
): Promise<UsernameUpdateResult> {
  const checked = validateDisplayName(rawUsername);
  if (!checked.ok) {
    return { ok: false, code: "INVALID_USERNAME", reason: checked.reason };
  }
  try {
    const updated = await db
      .update(users)
      .set({ username: checked.name })
      .where(eq(users.id, userId))
      .returning({ user_id: users.id, username: users.username });
    const profile = updated[0];
    if (!profile) throw new Error("updateUsername: user row missing");
    return { ok: true, profile };
  } catch (err) {
    if (isUniqueCollision(err)) return { ok: false, code: "USERNAME_TAKEN" };
    throw err;
  }
}

function isUniqueCollision(err: unknown): boolean {
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
      if (o.code === "23505" || o.constraint === "users_username_ci_uq") return true;
      if (typeof o.message === "string" && /users_username_ci_uq|duplicate key/i.test(o.message)) {
        return true;
      }
      queue.push(o.cause);
      if (Array.isArray(o.errors)) queue.push(...o.errors);
    }
  }
  return false;
}
