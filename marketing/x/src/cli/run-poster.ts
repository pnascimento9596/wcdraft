// CLI: run one Phase A poster slot.
//
// DORMANT (2026-06-12): @WCDraft has no X API credits, so live posting is not
// possible (POST /2/tweets → 402 CreditsDepleted). This CLI is kept built +
// tested but is NOT scheduled by any workflow and is gated behind
// MARKETING_PAUSED=true. It activates only if API credits are ever loaded (set
// MARKETING_PAUSED=false + MARKETING_LIVE=true). The live operating model is the
// content-pack pipeline (gen:pack / gen:banks) — see marketing/x/ROUTINE.md.
// Browser-automation posting is forbidden (X ToS / ban risk).
//
// Dry-run by default (writes an artifact). Live posting requires
// MARKETING_LIVE=true AND credentials in the environment. The global kill switch
// (MARKETING_PAUSED=true) halts everything.

import { isLive, isPaused } from "../config.ts";
import { loadXCreds, XClient } from "../x-client/client.ts";
import { runPoster, type Poster } from "../pipeline.ts";

async function main(): Promise<void> {
  const env = process.env;
  if (isPaused(env)) {
    console.log("MARKETING_PAUSED=true — posting halted.");
    return;
  }

  let poster: Poster | undefined;
  const creds = loadXCreds(env);
  if (creds) poster = new XClient(creds);

  const wantLive = isLive(env);
  if (wantLive && !poster) {
    console.log("MARKETING_LIVE=true but no credentials in env — staying in dry-run.");
  }

  const res = await runPoster({ env, poster });
  switch (res.action) {
    case "paused":
      console.log("paused.");
      break;
    case "cap_reached":
      console.log(`daily cap reached (${res.count}/${res.cap}) — nothing posted.`);
      break;
    case "nothing_to_post":
      console.log(`nothing to post: ${res.detail}`);
      break;
    case "dry_run":
      console.log(`DRY-RUN [${res.source} · ${res.post.family}] (${res.post.id})`);
      console.log(res.post.text);
      break;
    case "posted":
      console.log(`POSTED [${res.source} · ${res.post.family}] x_post_id=${res.x_post_id}`);
      console.log(res.post.text);
      break;
  }
}

void main();
