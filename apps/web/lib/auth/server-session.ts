import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, validateSessionCookie, type SessionDeps } from "./sessions";
import { buildRuntimeDeps } from "./handler-helpers";
import { isAuthEnabled } from "./auth-enabled";
import { safeNextPath } from "./safe-next-path";

export interface SignedInServerSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly csrfSecret: string;
  readonly deps: SessionDeps & ReturnType<typeof buildRuntimeDeps>;
}

export async function requireSignedInServerSession(
  returnTo: string,
): Promise<SignedInServerSession> {
  if (!isAuthEnabled()) {
    redirect(signInHref(returnTo));
  }
  const deps = buildRuntimeDeps();
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!cookie) {
    redirect(signInHref(returnTo));
  }
  try {
    const session = await validateSessionCookie(cookie, deps);
    if (session.userId === null) {
      redirect(signInHref(returnTo));
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      csrfSecret: session.csrfSecret,
      deps,
    };
  } catch {
    redirect(signInHref(returnTo));
  }
}

function signInHref(returnTo: string): string {
  const next = safeNextPath(returnTo);
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
