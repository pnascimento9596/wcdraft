import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { loadScenario2026Bundle } from "../src/client.js";
import { RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../src/index.js";
import type { RuntimeDataManifest } from "../src/types.js";

const BODY = JSON.stringify(SCENARIO_2026_BUNDLE);

function manifestFor(body: string): RuntimeDataManifest {
  const manifest = structuredClone(RUNTIME_DATA_MANIFEST);
  const digest = createHash("sha256").update(body).digest("hex");
  Object.assign(manifest.bundles.scenario_2026, {
    bytes: Buffer.byteLength(body),
    sha256: digest,
    raw_sha256: digest,
    options: {
      ...manifest.bundles.scenario_2026.options!,
      size_hint: Buffer.byteLength(body),
    },
  });
  return manifest;
}

describe("runtime-data client manifest digest enforcement", () => {
  it("accepts an exact raw-byte match and only then parses the bundle", async () => {
    const bundle = await loadScenario2026Bundle({
      manifest: manifestFor(BODY),
      fetch: vi.fn(async () => new Response(BODY)),
    });
    expect(bundle.schema_version).toBe(SCENARIO_2026_BUNDLE.schema_version);
    expect(bundle.teams).toEqual(SCENARIO_2026_BUNDLE.teams);
  });

  it("rejects one-byte corruption even when the byte length still matches", async () => {
    const bytes = Buffer.from(BODY);
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 48 ? 49 : 48;

    const failure = await loadScenario2026Bundle({
      manifest: manifestFor(BODY),
      fetch: vi.fn(async () => new Response(bytes)),
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "RuntimeDataIntegrityError",
      failure: "digest_mismatch",
    });
    expect((failure as { bundleKey?: unknown }).bundleKey).toBe(["scenario", "2026"].join("_"));
  });

  it("fails closed before fetch when the manifest lacks the bundle fingerprint", async () => {
    const manifest = manifestFor(BODY);
    delete (manifest.bundles as Record<string, unknown>).scenario_2026;
    const fetchImpl = vi.fn(async () => new Response(BODY));

    await expect(loadScenario2026Bundle({ manifest, fetch: fetchImpl })).rejects.toMatchObject({
      failure: "missing_fingerprint",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("distinguishes byte-count mismatch from same-length digest corruption", async () => {
    await expect(
      loadScenario2026Bundle({
        manifest: manifestFor(BODY),
        fetch: vi.fn(async () => new Response(`${BODY} `)),
      }),
    ).rejects.toMatchObject({
      failure: "byte_length_mismatch",
    });
  });
});
