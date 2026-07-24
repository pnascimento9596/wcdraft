// Shared request-error seam for route handlers outside the auth package.
// Public responses carry only stable codes + a correlation id; internal
// codes and raw error messages stay in structured logs (PII-free).

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { AuthError } from "../auth/errors";

type SafeErrorClass = "auth" | "database" | "network" | "timeout" | "unexpected";

export function createRequestCorrelationId(): string {
  return randomUUID();
}

/** Structured and deliberately message-free: raw DB/provider errors may contain PII. */
export function logRequestError(args: {
  readonly code: string;
  readonly correlationId: string;
  readonly route?: string;
  readonly error?: unknown;
  readonly internalCode?: string;
}): void {
  console.error(
    "[request]",
    JSON.stringify({
      code: args.code,
      correlation_id: args.correlationId,
      ...(args.route !== undefined ? { route: args.route } : {}),
      ...(args.internalCode !== undefined ? { internal_code: args.internalCode } : {}),
      error_class: classifyError(args.error),
    }),
  );
}

export function internalErrorResponse(
  route: string,
  err: unknown,
): NextResponse<Record<string, unknown>> {
  const correlationId = createRequestCorrelationId();
  logRequestError({ code: "INTERNAL_ERROR", correlationId, route, error: err });
  return NextResponse.json(
    {
      error: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      correlation_id: correlationId,
    },
    { status: 500 },
  );
}

export function rateLimitUnavailableResponse(args: {
  readonly correlationId: string;
  readonly retryAfterSeconds: number;
  readonly message?: string;
  /** Shape used by routes that return `{ ok: false, error }` (OG / challenge). */
  readonly okFalse?: boolean;
}): NextResponse<Record<string, unknown>> {
  const body: Record<string, unknown> = args.okFalse
    ? {
        ok: false,
        error: "RATE_LIMIT_UNAVAILABLE",
        correlation_id: args.correlationId,
      }
    : {
        error: "RATE_LIMIT_UNAVAILABLE",
        message: args.message ?? "Rate limiting is temporarily unavailable. Try again shortly.",
        correlation_id: args.correlationId,
      };
  return NextResponse.json(body, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(args.retryAfterSeconds),
    },
  });
}

function classifyError(error: unknown): SafeErrorClass {
  if (error instanceof AuthError) return "auth";
  if (!(error instanceof Error)) return "unexpected";
  const name = error.name.toLowerCase();
  if (name.includes("timeout") || name === "aborterror") return "timeout";
  if (name.includes("postgres") || name.includes("database") || name.includes("drizzle")) {
    return "database";
  }
  if (error instanceof TypeError || name.includes("fetch") || name.includes("network")) {
    return "network";
  }
  return "unexpected";
}
