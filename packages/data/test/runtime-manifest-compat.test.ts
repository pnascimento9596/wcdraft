import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadDataManifest } from "../src/client.js";
import { RUNTIME_DATA_MANIFEST } from "../src/index.js";
import { parseRuntimeDataManifest } from "../src/validation.js";

const LEGACY_MANIFEST_URL = new URL(
  "./fixtures/runtime-data-2.9.0-pre-c1-manifest.json",
  import.meta.url,
);
const LEGACY_MANIFEST_BYTES = readFileSync(LEGACY_MANIFEST_URL);
const LEGACY_MANIFEST_SHA256 = "7979fa756545287ef84a4cc338d9d2fa7d362f03e5ad84814318cf1bd7cc28bb";

type JsonRecord = Record<string, unknown>;

function cloneRecord(value: unknown): JsonRecord {
  const clone: unknown = structuredClone(value);
  if (typeof clone !== "object" || clone === null || Array.isArray(clone)) {
    throw new Error("test fixture must be an object");
  }
  return clone as JsonRecord;
}

function draftFingerprint(manifest: JsonRecord): JsonRecord {
  const bundles = manifest.bundles;
  if (typeof bundles !== "object" || bundles === null || Array.isArray(bundles)) {
    throw new Error("test manifest bundles must be an object");
  }
  const draftPool = (bundles as JsonRecord).draft_pool;
  if (typeof draftPool !== "object" || draftPool === null || Array.isArray(draftPool)) {
    throw new Error("test draft-pool fingerprint must be an object");
  }
  return draftPool as JsonRecord;
}

function legacyManifest(): JsonRecord {
  return cloneRecord(JSON.parse(LEGACY_MANIFEST_BYTES.toString("utf8")));
}

function currentSchemaLegacyShapeManifest(): JsonRecord {
  return { ...legacyManifest(), schema_version: RUNTIME_DATA_MANIFEST.schema_version };
}

const MATERIALIZATION_FIELDS = [
  "raw_sha256",
  "compressed_sha256",
  "compressed_bytes",
  "brotli_impl_version",
  "options",
] as const;

describe("runtime manifest materialization compatibility", () => {
  it("keeps the exact pre-C1 runtime-data-2.9.0 manifest as a locked fixture", () => {
    expect(createHash("sha256").update(LEGACY_MANIFEST_BYTES).digest("hex")).toBe(
      LEGACY_MANIFEST_SHA256,
    );
  });

  it("rejects the retained 2.9 manifest as honest version skew", () => {
    expect(() => parseRuntimeDataManifest(legacyManifest())).toThrow(
      /schema_version mismatch: got "runtime-data-2\.9\.0", expected "runtime-data-2\.11\.0"/u,
    );
  });

  it("continues to accept the pre-C1 fingerprint shape for the current schema", () => {
    const legacy = currentSchemaLegacyShapeManifest();
    const parsed = parseRuntimeDataManifest(legacy);

    expect(parsed).toBe(legacy);
    expect(parsed.bundles.draft_pool.sha256).toBe(
      "461601c64221289ccddabc97db426d54fbd4d39ef06bcd2a9bbdae129d2a487a",
    );
    expect(parsed.bundles.draft_pool.raw_sha256).toBeUndefined();
    expect(parsed.bundles.draft_pool.compressed_sha256).toBeUndefined();
    expect(parsed.bundles.draft_pool.compressed_bytes).toBeUndefined();
    expect(parsed.bundles.draft_pool.brotli_impl_version).toBeUndefined();
    expect(parsed.bundles.draft_pool.options).toBeUndefined();
  });

  it("loads the pre-C1 fingerprint shape through the current browser-facing URL", async () => {
    const calls: string[] = [];
    const currentSchemaLegacyBytes = Buffer.from(
      JSON.stringify(currentSchemaLegacyShapeManifest()),
    );
    const fetchLegacy: typeof fetch = ((input: unknown) => {
      calls.push(String(input));
      return Promise.resolve(
        new Response(currentSchemaLegacyBytes, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const parsed = await loadDataManifest({
      basePath: "/data/wcdraft/runtime-data-2.11.0",
      fetch: fetchLegacy,
    });

    expect(calls).toEqual(["/data/wcdraft/runtime-data-2.11.0/manifest.json"]);
    expect(parsed.bundles.scenario_2026.sha256).toBe(
      "7846fa3abe0eab4aa283efd1e8382959593ec1248030eba13913fac0ae8da398",
    );
    expect(parsed.bundles.scenario_2026.compressed_sha256).toBeUndefined();
  });

  it("continues to parse the fully materialized current manifest", () => {
    const parsed = parseRuntimeDataManifest(structuredClone(RUNTIME_DATA_MANIFEST));
    expect(parsed.bundles.draft_pool.raw_sha256).toBe(parsed.bundles.draft_pool.sha256);
    expect(parsed.bundles.draft_pool.compressed_bytes).toBe(parsed.bundles.draft_pool.bytes_brotli);
  });

  it.each(MATERIALIZATION_FIELDS)(
    "rejects the current manifest when draft_pool.%s is missing",
    (field) => {
      const partial = cloneRecord(RUNTIME_DATA_MANIFEST);
      delete draftFingerprint(partial)[field];

      expect(() => parseRuntimeDataManifest(partial)).toThrow(
        new RegExp(`materialization metadata must be all-or-none; missing .*${field}`, "u"),
      );
    },
  );

  it("rejects a legacy fingerprint with only one newly introduced field", () => {
    const partial = currentSchemaLegacyShapeManifest();
    const fingerprint = draftFingerprint(partial);
    fingerprint.raw_sha256 = fingerprint.sha256;

    expect(() => parseRuntimeDataManifest(partial)).toThrow(
      /materialization metadata must be all-or-none; missing compressed_sha256/u,
    );
  });

  it("still rejects malformed complete materialization metadata", () => {
    const malformed = cloneRecord(RUNTIME_DATA_MANIFEST);
    draftFingerprint(malformed).raw_sha256 = "f".repeat(64);

    expect(() => parseRuntimeDataManifest(malformed)).toThrow(/sha256 must equal raw_sha256/u);
  });
});
