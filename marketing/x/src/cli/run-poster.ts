// CLI: run one Phase A poster slot.
//
// Dry-run by default (writes an artifact). Live posting requires
// MARKETING_LIVE=true AND credentials in the environment. Phase A (posting)
// works on the Free API tier, so no tier gate here. The global kill switch
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
