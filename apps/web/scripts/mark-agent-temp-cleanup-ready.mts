import { markAgentTempCleanupReady } from "./agent-temp-lifecycle";

const candidate = process.argv[2];
if (!candidate) {
  throw new Error("usage: mark-agent-temp-cleanup-ready.mts <completed-agent-temp-path>");
}
await markAgentTempCleanupReady(candidate);
console.log(`agent-temp-lifecycle: cleanup-ready ${candidate}`);
