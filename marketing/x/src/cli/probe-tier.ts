// CLI: probe the X API tier + confirm the authenticated account.
// Prints ONLY the public handle + detected tier — never a credential value.
// Usage: source the creds into the env, then `pnpm probe-tier`.

import { loadXCreds, XClient } from "../x-client/client.ts";
import { probeTier } from "../x-client/tier-probe.ts";

async function main(): Promise<void> {
  const creds = loadXCreds(process.env);
  if (!creds) {
    console.error(
      "no X credentials in env (need X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET)",
    );
    process.exit(1);
  }
  const client = new XClient(creds);
  try {
    const me = await client.getMe();
    console.log(`auth OK: @${me.username} (id ${me.id}) — "${me.name}"`);
  } catch (err) {
    console.error(`getMe failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const probe = await probeTier(client);
  console.log(`tier: ${probe.tier}`);
  console.log(`detail: ${probe.detail}`);
}

void main();
