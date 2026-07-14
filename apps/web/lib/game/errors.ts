// Game-layer error classes + display helpers.
//
// The integration plan's non-negotiable: missing IDs are HARD failures, never
// silent fallbacks. Use these classes at every adapter join site so the UI
// can render a recovery panel with an honest message instead of a `0` or `—`
// where a real record was expected.

import { isRequestTimeoutError, RuntimeDataIntegrityError } from "@wcdraft/data/client";

/** What kind of join missed. */
export type MissingRecordKind =
  | "player_card"
  | "manager_card"
  | "rating"
  | "nation"
  | "tournament"
  | "formation"
  | "slot";

export class GameDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameDataError";
  }
}

export class MissingRecordError extends GameDataError {
  readonly kind: MissingRecordKind;
  readonly id: string;
  constructor(kind: MissingRecordKind, id: string, hint?: string) {
    super(`Missing ${kind} for id "${id}"${hint ? ` — ${hint}` : ""}`);
    this.name = "MissingRecordError";
    this.kind = kind;
    this.id = id;
  }
}

export class RuntimeDataLoadError extends GameDataError {
  readonly kind: "corrupt" | "timeout" | "unavailable";
  override readonly cause?: unknown;
  constructor(kind: "corrupt" | "timeout" | "unavailable", message: string, cause?: unknown);
  constructor(message: string, cause?: unknown);
  constructor(
    kindOrMessage: "corrupt" | "timeout" | "unavailable" | string,
    messageOrCause?: string | unknown,
    explicitCause?: unknown,
  ) {
    const explicitKind = ["corrupt", "timeout", "unavailable"].includes(kindOrMessage);
    const cause = explicitKind ? explicitCause : messageOrCause;
    const kind = explicitKind
      ? (kindOrMessage as "corrupt" | "timeout" | "unavailable")
      : isTimeoutCause(cause)
        ? "timeout"
        : "unavailable";
    const message = explicitKind ? String(messageOrCause) : kindOrMessage;
    super(message);
    this.name = "RuntimeDataLoadError";
    this.kind = kind;
    this.cause = cause;
  }
}

function isTimeoutCause(cause: unknown): boolean {
  return (
    isRequestTimeoutError(cause) ||
    (cause instanceof Error && ["AbortError", "RequestTimeoutError"].includes(cause.name))
  );
}

export function isRuntimeDataTimeout(error: unknown): boolean {
  return error instanceof RuntimeDataLoadError && error.kind === "timeout";
}

export function toRuntimeDataLoadError(context: string, cause: unknown): RuntimeDataLoadError {
  if (cause instanceof RuntimeDataLoadError) return cause;
  const kind =
    cause instanceof RuntimeDataIntegrityError
      ? "corrupt"
      : isTimeoutCause(cause)
        ? "timeout"
        : "unavailable";
  const message =
    kind === "timeout"
      ? "Runtime data took too long to load. Retry, or return to mode selection."
      : `${context}: ${cause instanceof Error ? cause.message : String(cause)}`;
  return new RuntimeDataLoadError(kind, message, cause);
}

export class RunRecordError extends GameDataError {
  constructor(message: string) {
    super(message);
    this.name = "RunRecordError";
  }
}

export class StorageUnavailableError extends RunRecordError {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export class RunStoreCoordinationError extends RunRecordError {
  constructor(message: string) {
    super(message);
    this.name = "RunStoreCoordinationError";
  }
}

export class StorageQuotaError extends RunRecordError {
  constructor(message: string) {
    super(message);
    this.name = "StorageQuotaError";
  }
}

export class DraftTransitionError extends GameDataError {
  override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "DraftTransitionError";
    this.cause = cause;
  }
}

/** UI display payload mapping an error to a user-facing recovery copy. */
export interface ErrorDisplay {
  title: string;
  message: string;
  action?: "reload" | "start_new" | "back_to_draft";
}

/** Lift any thrown value into a stable display struct for the recovery UI. */
export function describeGameError(err: unknown): ErrorDisplay {
  if (err instanceof MissingRecordError) {
    return {
      title: "Missing data",
      message: `We couldn't find the ${err.kind.replace("_", " ")} "${err.id}" in the runtime data bundle. This is usually a stale draft after a dataset bump.`,
      action: "start_new",
    };
  }
  if (err instanceof RuntimeDataLoadError) {
    console.error("[game] runtime data load failed", {
      kind: err.kind,
      message: err.message,
      cause: err.cause,
    });
    return err.kind === "timeout"
      ? { title: "Runtime data unavailable", message: err.message, action: "reload" }
      : {
          title: "Player database unavailable",
          message: "We couldn't load the player database. Please try again.",
          action: "reload",
        };
  }
  if (err instanceof DraftTransitionError) {
    return {
      title: "Pick didn't lock",
      message: err.message,
      action: "back_to_draft",
    };
  }
  if (err instanceof StorageQuotaError) {
    return {
      title: "Browser storage full",
      message:
        "Your draft is being held in this tab only. Free up storage or clear older drafts to resume persistence.",
    };
  }
  if (err instanceof RunStoreCoordinationError) {
    return {
      title: "Browser update required",
      message: err.message,
    };
  }
  if (err instanceof StorageUnavailableError) {
    return {
      title: "Storage unavailable",
      message:
        "We can't persist this draft because your browser blocks site storage. The draft will live for the duration of this tab only.",
    };
  }
  if (err instanceof GameDataError) {
    logUnexpectedGameError(err);
    return {
      title: "Something went wrong",
      message: "Something went wrong — try again, or start a fresh run",
      action: "start_new",
    };
  }
  if (err instanceof Error) {
    logUnexpectedGameError(err);
    return {
      title: "Something went wrong",
      message: "Something went wrong — try again, or start a fresh run",
      action: "start_new",
    };
  }
  logUnexpectedGameError(err);
  return {
    title: "Something went wrong",
    message: "Something went wrong — try again, or start a fresh run",
    action: "start_new",
  };
}

function logUnexpectedGameError(err: unknown): void {
  if (err instanceof Error) {
    console.error("[game] unexpected error", { message: err.message, stack: err.stack });
    return;
  }
  console.error("[game] unexpected error", { message: String(err ?? "Unknown") });
}
