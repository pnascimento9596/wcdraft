import { describe, expect, it } from "vitest";

import { serviceWorkerRegistrationPlan } from "../../../components/sw-register";

describe("service worker registration timing", () => {
  it("registers immediately when hydration runs after the load event", () => {
    expect(
      serviceWorkerRegistrationPlan({
        nodeEnv: "production",
        hasServiceWorker: true,
        documentReadyState: "complete",
      }),
    ).toBe("register-now");
  });

  it("waits for load only while the document is still loading", () => {
    expect(
      serviceWorkerRegistrationPlan({
        nodeEnv: "production",
        hasServiceWorker: true,
        documentReadyState: "loading",
      }),
    ).toBe("register-on-load");
  });

  it("stays disabled outside production or unsupported browsers", () => {
    expect(
      serviceWorkerRegistrationPlan({
        nodeEnv: "test",
        hasServiceWorker: true,
        documentReadyState: "complete",
      }),
    ).toBe("disabled");
    expect(
      serviceWorkerRegistrationPlan({
        nodeEnv: "production",
        hasServiceWorker: false,
        documentReadyState: "complete",
      }),
    ).toBe("disabled");
  });
});
