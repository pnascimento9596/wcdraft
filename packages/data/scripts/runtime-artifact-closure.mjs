import { createHash } from "node:crypto";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";

export const RETAINED_PRIOR_SCHEMA_COUNT = 2;

const RUNTIME_SCHEMA_RE = /^runtime-data-(\d+)\.(\d+)\.(\d+)$/u;
const REQUIRED_BUNDLE_KEYS = ["draft_pool", "scenario_2026"];
const CANONICAL_COMPRESSED_FIELDS = [
  "raw_sha256",
  "compressed_sha256",
  "compressed_bytes",
  "brotli_impl_version",
  "options",
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

export function assertManifestVersion(manifest) {
  const value = assertObject(manifest, "manifest.json");
  if (typeof value.schema_version !== "string" || value.schema_version.length === 0) {
    throw new Error("manifest.json missing schema_version");
  }
  return value.schema_version;
}

function parseRuntimeSchemaVersion(version) {
  const match = RUNTIME_SCHEMA_RE.exec(version);
  if (!match) {
    throw new Error(`runtime schema version is malformed: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Runtime schemas currently advance by one minor `.0` release at a time. Fail
 * closed if that cadence changes: a major/patch transition needs an explicit
 * retention-policy update rather than guessing which historical releases are
 * the last two.
 */
export function expectedRetainedSchemaVersions(currentVersion) {
  const { major, minor, patch } = parseRuntimeSchemaVersion(currentVersion);
  if (patch !== 0 || minor < RETAINED_PRIOR_SCHEMA_COUNT) {
    throw new Error(
      `retention policy cannot derive ${RETAINED_PRIOR_SCHEMA_COUNT} prior minor schemas from ${currentVersion}`,
    );
  }
  return Array.from(
    { length: RETAINED_PRIOR_SCHEMA_COUNT },
    (_, index) => `runtime-data-${major}.${minor - RETAINED_PRIOR_SCHEMA_COUNT + index}.0`,
  );
}

export function assertRetainedSchemaPolicy(currentVersion, retainedVersions) {
  const expected = expectedRetainedSchemaVersions(currentVersion);
  const actual = [...retainedVersions].sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== RETAINED_PRIOR_SCHEMA_COUNT ||
    actual.some((version, index) => version !== sortedExpected[index])
  ) {
    throw new Error(
      `retention policy for ${currentVersion} requires exactly ${expected.join(", ")}; ` +
        `found ${actual.length > 0 ? actual.join(", ") : "none"}`,
    );
  }
  return expected;
}

function assertSafeBundlePath(bundlePath, label) {
  if (
    typeof bundlePath !== "string" ||
    bundlePath.length === 0 ||
    bundlePath.includes("\\") ||
    path.posix.isAbsolute(bundlePath) ||
    path.posix.normalize(bundlePath) !== bundlePath ||
    bundlePath === ".." ||
    bundlePath.startsWith("../")
  ) {
    throw new Error(`${label}.path is not a safe relative path`);
  }
}

function assertRawFingerprintShape(fingerprint, label) {
  const value = assertObject(fingerprint, `${label} fingerprint`);
  assertSafeBundlePath(value.path, label);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error(`${label}.bytes is malformed`);
  }
  if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256)) {
    throw new Error(`${label}.sha256 is malformed`);
  }
  return value;
}

function hasCanonicalCompressionMetadata(fingerprint, label) {
  const present = CANONICAL_COMPRESSED_FIELDS.filter((field) => fingerprint[field] !== undefined);
  if (present.length === 0) return false;
  if (present.length !== CANONICAL_COMPRESSED_FIELDS.length) {
    throw new Error(`${label} canonical Brotli metadata is incomplete`);
  }
  if (
    fingerprint.raw_sha256 !== fingerprint.sha256 ||
    typeof fingerprint.compressed_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(fingerprint.compressed_sha256) ||
    !Number.isSafeInteger(fingerprint.compressed_bytes) ||
    fingerprint.compressed_bytes < 0 ||
    fingerprint.bytes_brotli !== fingerprint.compressed_bytes ||
    typeof fingerprint.brotli_impl_version !== "string" ||
    fingerprint.brotli_impl_version.length === 0 ||
    !fingerprint.options ||
    fingerprint.options.quality !== 11 ||
    fingerprint.options.mode !== "text" ||
    fingerprint.options.size_hint !== fingerprint.bytes
  ) {
    throw new Error(`${label} canonical Brotli metadata is malformed`);
  }
  return true;
}

/**
 * Derive the complete served file set from one manifest. The draft pool is the
 * one bundle whose browser contract is always `.br`; other legacy entries are
 * raw-only unless their own C1 fingerprint advertises a canonical Brotli file.
 */
export function deriveRuntimeArtifactSpecs(manifest) {
  assertManifestVersion(manifest);
  const bundles = assertObject(manifest.bundles, "manifest.json bundles");
  for (const key of REQUIRED_BUNDLE_KEYS) {
    if (!bundles[key]) throw new Error(`manifest.json is missing required bundle ${key}`);
  }

  const specs = [];
  const paths = new Set();
  const add = (spec) => {
    if (paths.has(spec.relativePath)) {
      throw new Error(`manifest.json maps multiple artifacts to ${spec.relativePath}`);
    }
    paths.add(spec.relativePath);
    specs.push(spec);
  };

  for (const [key, candidate] of Object.entries(bundles)) {
    const fingerprint = assertRawFingerprintShape(candidate, `bundle ${key}`);
    const canonicalCompressed = hasCanonicalCompressionMetadata(fingerprint, `bundle ${key}`);
    if (key === "draft_pool") {
      add({
        bundleKey: key,
        relativePath: `${fingerprint.path}.br`,
        encoding: "brotli",
        fingerprint,
        canonicalCompressed,
      });
      continue;
    }

    add({
      bundleKey: key,
      relativePath: fingerprint.path,
      encoding: "raw",
      fingerprint,
      canonicalCompressed,
    });
    if (canonicalCompressed) {
      add({
        bundleKey: key,
        relativePath: `${fingerprint.path}.br`,
        encoding: "brotli",
        fingerprint,
        canonicalCompressed: true,
      });
    }
  }
  return specs;
}

function assertRawFingerprint(label, buf, expected) {
  const actualSha = sha256(buf);
  if (buf.length !== expected.bytes || actualSha !== expected.sha256) {
    throw new Error(
      `${label} raw fingerprint mismatch; got ${buf.length} bytes / ${actualSha}, ` +
        `expected ${expected.bytes} bytes / ${expected.sha256}`,
    );
  }
}

export function validateRuntimeArtifactBytes(spec, bytes, label = spec.relativePath) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (spec.encoding === "raw") {
    assertRawFingerprint(label, buf, spec.fingerprint);
    return;
  }
  if (spec.encoding !== "brotli") {
    throw new Error(`${label} has unsupported encoding ${spec.encoding}`);
  }

  if (spec.canonicalCompressed) {
    const actualCompressedSha = sha256(buf);
    if (
      buf.length !== spec.fingerprint.compressed_bytes ||
      actualCompressedSha !== spec.fingerprint.compressed_sha256
    ) {
      throw new Error(
        `${label} compressed fingerprint mismatch; got ${buf.length} bytes / ` +
          `${actualCompressedSha}, expected ${spec.fingerprint.compressed_bytes} bytes / ` +
          `${spec.fingerprint.compressed_sha256}`,
      );
    }
  }

  let raw;
  try {
    raw = brotliDecompressSync(buf);
  } catch (err) {
    throw new Error(
      `${label} cannot be decompressed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  assertRawFingerprint(label, raw, spec.fingerprint);
}
