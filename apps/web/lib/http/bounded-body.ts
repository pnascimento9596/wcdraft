import { NextResponse } from "next/server";

export type BoundedBodyErrorCode =
  | "UNSUPPORTED_MEDIA_TYPE"
  | "BODY_TOO_LARGE"
  | "CONTENT_LENGTH_MISMATCH"
  | "INVALID_BODY";

const STATUS_BY_CODE: Record<BoundedBodyErrorCode, number> = {
  UNSUPPORTED_MEDIA_TYPE: 415,
  BODY_TOO_LARGE: 413,
  CONTENT_LENGTH_MISMATCH: 400,
  INVALID_BODY: 400,
};

export class BoundedBodyError extends Error {
  readonly code: BoundedBodyErrorCode;
  readonly status: number;

  constructor(code: BoundedBodyErrorCode, message: string) {
    super(message);
    this.name = "BoundedBodyError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export interface RequireJsonObjectOptions {
  readonly maxBytes: number;
  readonly allowedContentTypes?: readonly string[];
}

export async function requireJsonObject(
  request: Pick<Request, "headers" | "body">,
  options: RequireJsonObjectOptions,
): Promise<Record<string, unknown>> {
  const allowed = options.allowedContentTypes ?? ["application/json"];
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!allowed.map((x) => x.toLowerCase()).includes(mediaType)) {
    throw new BoundedBodyError("UNSUPPORTED_MEDIA_TYPE", "content-type must be application/json");
  }

  const declared = request.headers.get("content-length");
  const declaredBytes = declared === null || declared === "" ? null : Number(declared);
  if (declaredBytes !== null) {
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      throw new BoundedBodyError("INVALID_BODY", "content-length must be a non-negative number");
    }
    if (declaredBytes > options.maxBytes) {
      throw new BoundedBodyError("BODY_TOO_LARGE", `body exceeds ${options.maxBytes} bytes`);
    }
  }

  const read = await readBoundedText(request, options.maxBytes);
  if (read.status === "too_large") {
    throw new BoundedBodyError("BODY_TOO_LARGE", `body exceeds ${options.maxBytes} bytes`);
  }
  if (read.status === "invalid") {
    throw new BoundedBodyError("INVALID_BODY", "body could not be read");
  }
  if (declaredBytes !== null && declaredBytes !== read.bytes) {
    throw new BoundedBodyError(
      "CONTENT_LENGTH_MISMATCH",
      "content-length does not match the actual body size",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.value);
  } catch {
    throw new BoundedBodyError("INVALID_BODY", "body must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BoundedBodyError("INVALID_BODY", "body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function boundedString(
  value: unknown,
  options: { readonly field: string; readonly maxChars: number; readonly allowEmpty?: boolean },
): string | null {
  if (typeof value !== "string") return null;
  if (!options.allowEmpty && value.length === 0) return null;
  if (value.length > options.maxChars) {
    throw new BoundedBodyError(
      "INVALID_BODY",
      `${options.field} exceeds ${options.maxChars} characters`,
    );
  }
  return value;
}

export function nullableBoundedString(
  value: unknown,
  options: { readonly field: string; readonly maxChars: number; readonly allowEmpty?: boolean },
): string | null {
  if (value === null || value === undefined) return null;
  return boundedString(value, options);
}

export function boundedPlainObject(
  value: unknown,
  options: { readonly field: string; readonly maxKeys?: number } = { field: "value" },
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (options.maxKeys !== undefined && Object.keys(obj).length > options.maxKeys) {
    throw new BoundedBodyError("INVALID_BODY", `${options.field} has too many fields`);
  }
  return obj;
}

export function boundedBodyErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof BoundedBodyError)) return null;
  return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
}

async function readBoundedText(
  request: Pick<Request, "body">,
  maxBytes: number,
): Promise<
  { status: "ok"; value: string; bytes: number } | { status: "too_large" } | { status: "invalid" }
> {
  const body = request.body;
  if (!body) return { status: "ok", value: "", bytes: 0 };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "invalid" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", value: new TextDecoder().decode(bytes), bytes: total };
}
