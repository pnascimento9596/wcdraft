import { describe, expect, it } from "vitest";

import {
  BoundedBodyError,
  boundedPlainObject,
  boundedString,
  requireJsonObject,
} from "../../http/bounded-body";
import { readClientIp } from "../../http/client-ip";
import { readBoundedText } from "../../http/read-bounded-text";

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://www.wcdraft.com/api/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

async function expectBodyError(request: Request, code: string, status: number): Promise<void> {
  await expect(requireJsonObject(request, { maxBytes: 16 })).rejects.toMatchObject({
    code,
    status,
  });
}

describe("requireJsonObject", () => {
  it("returns a JSON object under the byte cap", async () => {
    await expect(requireJsonObject(req('{"ok":true}'), { maxBytes: 16 })).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects non-JSON content-type before reading the body", async () => {
    await expectBodyError(
      req('{"ok":true}', { "content-type": "text/plain" }),
      "UNSUPPORTED_MEDIA_TYPE",
      415,
    );
  });

  it("rejects declared content-length over the cap", async () => {
    await expectBodyError(req('{"ok":true}', { "content-length": "17" }), "BODY_TOO_LARGE", 413);
  });

  it("rejects actual body size over the cap when content-length lies low", async () => {
    await expectBodyError(
      req(JSON.stringify({ token: "x".repeat(32) }), { "content-length": "2" }),
      "BODY_TOO_LARGE",
      413,
    );
  });

  it("rejects declared/actual content-length mismatch", async () => {
    await expectBodyError(
      req('{"ok":true}', { "content-length": "3" }),
      "CONTENT_LENGTH_MISMATCH",
      400,
    );
  });

  it("rejects malformed JSON and non-object JSON", async () => {
    await expectBodyError(req("{"), "INVALID_BODY", 400);
    await expectBodyError(req("[]"), "INVALID_BODY", 400);
  });
});

describe("bounded body field helpers", () => {
  it("rejects over-length strings and too-wide objects with typed body errors", () => {
    expect(() => boundedString("abcd", { field: "name", maxChars: 3 })).toThrow(BoundedBodyError);
    expect(() =>
      boundedPlainObject({ a: 1, b: 2 }, { field: "versionAnchors", maxKeys: 1 }),
    ).toThrow(BoundedBodyError);
  });
});

describe("unified readBoundedText call sites", () => {
  it("rejects over-limit streams pre-decode for both former readers (lineup direct + requireJsonObject)", async () => {
    const maxBytes = 8;
    const overLimit = "x".repeat(maxBytes + 1);

    // Direct consumer (lineup-route path): too_large, no decoded value.
    const direct = await readBoundedText(req(overLimit), maxBytes);
    expect(direct).toEqual({ status: "too_large" });
    expect(direct).not.toMatchObject({ value: expect.anything() });

    // requireJsonObject path: same byte-boundary rejection vocabulary.
    await expect(requireJsonObject(req(overLimit), { maxBytes })).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });

    // At the exact cap both paths accept the body (pre-decode accounting only).
    const atCap = "y".repeat(maxBytes);
    const ok = await readBoundedText(req(atCap), maxBytes);
    expect(ok).toEqual({ status: "ok", value: atCap, bytes: maxBytes });
  });
});

describe("readClientIp", () => {
  it("uses the first x-forwarded-for hop and falls back to x-real-ip", () => {
    expect(readClientIp(req("{}", { "x-forwarded-for": "198.51.100.1, 10.0.0.2" }))).toBe(
      "198.51.100.1",
    );
    expect(readClientIp(req("{}", { "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(readClientIp(req("{}"))).toBe("unknown");
  });
});
