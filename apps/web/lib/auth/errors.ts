// F-2 — typed auth errors.
//
// Route handlers translate these into clean HTTP responses; tests assert on
// the discriminant. Strings keep round-tripping cheap. Status codes are
// included so the adapter doesn't have to map.
export type AuthErrorCode =
  | "TOKEN_EXPIRED"
  | "TOKEN_CONSUMED"
  | "TOKEN_UNKNOWN"
  | "TOKEN_MALFORMED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_TAMPERED"
  | "CSRF_MISSING"
  | "CSRF_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "ANON_FORBIDDEN"
  | "RATE_LIMITED"
  | "EMAIL_INVALID";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = statusFor(code);
    this.name = "AuthError";
  }
}

function statusFor(code: AuthErrorCode): number {
  switch (code) {
    case "TOKEN_EXPIRED":
    case "TOKEN_CONSUMED":
    case "TOKEN_UNKNOWN":
    case "TOKEN_MALFORMED":
    case "SESSION_INVALID":
    case "SESSION_EXPIRED":
    case "SESSION_TAMPERED":
    case "CSRF_MISSING":
    case "CSRF_MISMATCH":
    case "ORIGIN_MISMATCH":
      return 401;
    case "ANON_FORBIDDEN":
      return 403;
    case "RATE_LIMITED":
      return 429;
    case "EMAIL_INVALID":
      return 400;
  }
}
