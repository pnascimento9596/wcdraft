// Game-layer error classes + display helpers.
//
// The integration plan's non-negotiable: missing IDs are HARD failures, never
// silent fallbacks. Use these classes at every adapter join site so the UI
// can render a recovery panel with an honest message instead of a `0` or `—`
// where a real record was expected.

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
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RuntimeDataLoadError";
    this.cause = cause;
  }
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
    return {
      title: "Runtime data unavailable",
      message: err.message,
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
  if (err instanceof StorageUnavailableError) {
    return {
      title: "Storage unavailable",
      message:
        "We can't persist this draft because your browser blocks site storage. The draft will live for the duration of this tab only.",
    };
  }
  if (err instanceof GameDataError) {
    return { title: "Something is off", message: err.message };
  }
  if (err instanceof Error) {
    return { title: "Unexpected error", message: err.message };
  }
  return { title: "Unexpected error", message: String(err ?? "Unknown") };
}
