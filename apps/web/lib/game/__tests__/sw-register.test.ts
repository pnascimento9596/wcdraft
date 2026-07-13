import { describe, expect, it } from "vitest";

import {
  serviceWorkerNativeShellPolicy,
  serviceWorkerRegistrationPlan,
  usesRemoteDocumentUrl,
} from "../../../components/sw-register";

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

describe("service worker native shell coexistence (M1a)", () => {
  it("keeps the PWA SW when Capacitor loads the remote production origin", () => {
    expect(serviceWorkerNativeShellPolicy({ usesRemoteServerUrl: true })).toBe("register-as-pwa");
  });

  it("would disable SW only for a local file:// shell (not used in M1a)", () => {
    expect(serviceWorkerNativeShellPolicy({ usesRemoteServerUrl: false })).toBe(
      "disable-local-file",
    );
  });

  it("treats http(s) document protocols as remote and file: as local", () => {
    expect(usesRemoteDocumentUrl("https:")).toBe(true);
    expect(usesRemoteDocumentUrl("http:")).toBe(true);
    expect(usesRemoteDocumentUrl("file:")).toBe(false);
    expect(usesRemoteDocumentUrl("capacitor:")).toBe(false);
  });
});
