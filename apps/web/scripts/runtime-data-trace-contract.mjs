import { readFileSync } from "node:fs";

const GENERATED_MANIFEST_URL = new URL(
  "../../../packages/data/src/generated/manifest.json",
  import.meta.url,
);

const manifest = JSON.parse(readFileSync(GENERATED_MANIFEST_URL, "utf8"));
if (
  typeof manifest.schema_version !== "string" ||
  !/^runtime-data-\d+\.\d+\.\d+$/u.test(manifest.schema_version)
) {
  throw new Error("runtime-data trace contract: generated manifest has an invalid schema_version");
}

export const SERVER_RUNTIME_DATA_SCHEMA_VERSION = manifest.schema_version;
export const SERVER_RUNTIME_DATA_TRACE_PATTERN = `./public/data/wcdraft/${SERVER_RUNTIME_DATA_SCHEMA_VERSION}/**/*`;
export const SERVER_RUNTIME_DATA_TRACE_ROUTES = ["/api/og/sign", "/api/challenge/verify"];
