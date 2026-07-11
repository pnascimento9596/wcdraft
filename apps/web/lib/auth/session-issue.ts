import { eq } from "drizzle-orm";
import { sessions as sessionsTable, type Session } from "@wcdraft/db";

import { createSession, SESSION_TTL_MS, signCookie, type SessionDeps } from "./sessions";
import { generateOpaqueToken } from "./tokens";
import { createCorrelationId, logSecurityEvent } from "./security-log";

export interface IssueAuthenticatedSessionArgs {
  readonly session: Session;
  readonly userId: string;
  readonly onAuthenticatedSessionReady?: (args: {
    readonly sessionId: string;
    readonly userId: string;
  }) => Promise<void>;
}

export interface IssueAuthenticatedSessionResult {
  readonly sessionId: string;
  readonly userId: string;
  readonly sessionCookieValue: string;
  readonly csrfSecret: string;
}

/**
 * Promote the already server-minted session to an authenticated user session.
 * This is the shared issuance path for magic-link and password login.
 */
export async function issueAuthenticatedSession(
  args: IssueAuthenticatedSessionArgs,
  deps: SessionDeps,
): Promise<IssueAuthenticatedSessionResult> {
  const newCsrf = generateOpaqueToken();
  const rotated = await deps.db
    .update(sessionsTable)
    .set({
      userId: args.userId,
      csrfSecret: newCsrf,
      expiresAt: new Date(deps.now() + SESSION_TTL_MS),
    })
    .where(eq(sessionsTable.id, args.session.id))
    .returning();

  let sessionId: string;
  let sessionCookieValue: string;
  let csrfSecret: string;
  if (rotated[0]) {
    sessionId = args.session.id;
    sessionCookieValue = signCookie(sessionId, deps.cookieSecret);
    csrfSecret = newCsrf;
  } else {
    const fresh = await createSession({ userId: args.userId }, deps);
    sessionId = fresh.session.id;
    sessionCookieValue = fresh.cookieValue;
    csrfSecret = fresh.session.csrfSecret;
  }

  if (args.onAuthenticatedSessionReady) {
    try {
      await args.onAuthenticatedSessionReady({
        sessionId,
        userId: args.userId,
      });
    } catch (error) {
      logSecurityEvent({
        code: "AUTH_POST_SESSION_HOOK_FAILED",
        correlationId: createCorrelationId(),
        error,
      });
    }
  }

  return { sessionId, userId: args.userId, sessionCookieValue, csrfSecret };
}
