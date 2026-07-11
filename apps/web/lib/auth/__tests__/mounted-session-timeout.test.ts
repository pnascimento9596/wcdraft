// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/components/account-menu";
import { AuthProvider } from "@/components/auth-context";
import { advanceTime, buttonByText, click, mountReact } from "@/lib/test/dom-harness";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { ...props, href: typeof href === "string" ? href : "#" }, children),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("mounted AuthProvider + AccountMenu first load", () => {
  it("expires a held-open session read and retries only the idempotent GET", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);

    const view = await mountReact(
      createElement(AuthProvider, {
        authEnabled: true,
        children: createElement(AccountMenu),
      }),
    );
    try {
      expect(view.container.querySelector('[aria-label="Checking session"]')).not.toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await advanceTime(12_000);

      expect(view.container.textContent).toContain("Session check timed out.");
      expect(view.container.textContent).toContain("Keep playing");
      expect(view.container.querySelector('[aria-label="Checking session"]')).toBeNull();

      await click(buttonByText(view.container, "Retry"));
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(view.container.querySelector('[aria-label="Checking session"]')).not.toBeNull();

      await advanceTime(12_000);
      expect(view.container.textContent).toContain("Session check timed out.");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
    }
  });
});
