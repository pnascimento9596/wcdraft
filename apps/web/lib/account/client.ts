// Browser-only account read client. Safe GETs use the shared auth/account
// budget and may be retried explicitly by the UI after a timeout.

import { boundedRequest, REQUEST_BUDGET_MS } from "@wcdraft/data/client";

import type { AccountRunsPage } from "./runs";

export async function fetchAccountRunsPage(
  input: { readonly limit: number; readonly offset: number },
  fetcher: typeof fetch = fetch.bind(globalThis),
): Promise<AccountRunsPage> {
  return boundedRequest(
    async (signal) => {
      const query = new URLSearchParams({
        limit: input.limit.toString(),
        offset: input.offset.toString(),
      });
      const response = await fetcher(`/api/account/runs?${query.toString()}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) {
        throw new Error(`account runs returned HTTP ${response.status.toString()}`);
      }
      return (await response.json()) as AccountRunsPage;
    },
    {
      operation: "account run history",
      timeoutMs: REQUEST_BUDGET_MS.auth,
      safety: "safe-read",
    },
  );
}
