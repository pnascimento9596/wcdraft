// @vitest-environment happy-dom

import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftScreen } from "@/components/game/draft-screen";
import { HistoryScreen } from "@/components/game/history-screen";
import { ModeSelect } from "@/components/game/mode-select";
import { ResultsScreen } from "@/components/game/results-screen";
import { ReviewScreen } from "@/components/game/review-screen";
import { ShareScreen } from "@/components/game/share-screen";
import { clearGameDataCacheForTests } from "@/lib/game/data";
import { advanceTime, buttonByText, click, mountReact } from "@/lib/test/dom-harness";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { ...props, href: typeof href === "string" ? href : "#" }, children),
  };
});

vi.mock("next/image", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: (
      props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean },
    ) =>
      React.createElement("img", {
        ...props,
        src: String(props.src),
        alt: props.alt,
        priority: undefined,
        fill: undefined,
      }),
  };
});

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// Keep the production container budgets and data-loader delegation, but use a
// fetch seam without the lower loader's nested budget. That leaves exactly one
// timer boundary under test and models a transport that ignores AbortSignal.
vi.mock("@wcdraft/data/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wcdraft/data/client")>();
  const heldGet = async (url: string, signal?: AbortSignal) => {
    const response = await fetch(url, { method: "GET", signal });
    return response.json();
  };
  return {
    ...actual,
    loadDataManifest: ({ signal }: { signal?: AbortSignal } = {}) =>
      heldGet("/test/runtime-manifest", signal),
    loadDraftPoolBundle: ({ signal }: { signal?: AbortSignal } = {}) =>
      heldGet("/test/draft-pool", signal),
    loadDailySeedSaltMap: ({ signal }: { signal?: AbortSignal } = {}) =>
      heldGet("/test/daily-seeds", signal),
  };
});

vi.mock("@/components/auth-context", () => ({
  useAuth: () => ({
    authEnabled: true,
    session: null,
    ready: true,
    sessionError: null,
    isSignedIn: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/game/local-progress-band", () => ({
  LocalProgressBand: () => null,
  LocalProgressBandFromStorage: () => null,
  LocalProgressBandWithVersions: () => null,
}));

interface ScreenCase {
  readonly name: string;
  readonly component: ComponentType<Record<string, never>>;
  readonly params: string;
  readonly budgetMs: number;
  readonly loading: string;
  readonly timeout: string;
  readonly retry: string;
  readonly alternate: string;
  readonly home?: boolean;
}

const CASES: readonly ScreenCase[] = [
  {
    name: "ModeSelect",
    component: ModeSelect,
    params: "",
    budgetMs: 12_000,
    loading: "Checking today's Daily",
    timeout: "Today's Daily check timed out",
    retry: "Retry Daily check",
    alternate: "Play Classic instead",
  },
  {
    name: "DraftScreen",
    component: DraftScreen,
    params: "",
    budgetMs: 30_000,
    loading: "Loading draft setup",
    timeout: "Runtime data took too long to load",
    retry: "Retry",
    alternate: "Choose another mode",
    home: true,
  },
  {
    name: "HistoryScreen",
    component: HistoryScreen,
    params: "",
    budgetMs: 30_000,
    loading: "Loading your run history",
    timeout: "Runtime data took too long to load",
    retry: "Try again",
    alternate: "Start a new draft",
    home: true,
  },
  {
    name: "ResultsScreen",
    component: ResultsScreen,
    params: "run=held-open",
    budgetMs: 30_000,
    loading: "Loading the run",
    timeout: "Runtime data took too long to load",
    retry: "Retry loading",
    alternate: "Start a new draft",
    home: true,
  },
  {
    name: "ReviewScreen",
    component: ReviewScreen,
    params: "run=held-open",
    budgetMs: 30_000,
    loading: "Loading your draft",
    timeout: "Runtime data took too long to load",
    retry: "Retry loading",
    alternate: "Start a new draft",
    home: true,
  },
  {
    name: "ShareScreen",
    component: ShareScreen,
    params: "run=held-open",
    budgetMs: 30_000,
    loading: "Building your share card",
    timeout: "Runtime data took too long to load",
    retry: "Retry loading",
    alternate: "Start a new draft",
    home: true,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  clearGameDataCacheForTests();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/play");
});

afterEach(() => {
  clearGameDataCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("mounted game containers with held-open first reads", () => {
  it.each(CASES)(
    "$name leaves loading at the budget and exposes a safe read Retry + alternate",
    async ({ component, params, budgetMs, loading, timeout, retry, alternate, home }) => {
      navigation.params = new URLSearchParams(params);
      const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
      vi.stubGlobal("fetch", fetcher);

      const view = await mountReact(createElement(component));
      try {
        expect(view.container.textContent).toContain(loading);
        const initialCalls = fetcher.mock.calls.length;
        expect(initialCalls).toBeGreaterThan(0);

        await advanceTime(budgetMs);

        expect(view.container.textContent).toContain(timeout);
        expect(view.container.textContent).toContain(alternate);
        if (home === true) {
          const homeLink = Array.from(view.container.querySelectorAll("a")).find(
            (link) => link.textContent?.trim() === "Home",
          );
          expect(homeLink?.getAttribute("href")).toBe("/");
        }
        expect(view.container.textContent).not.toContain(loading);

        await click(buttonByText(view.container, retry));
        const retryCalls = fetcher.mock.calls.slice(initialCalls);
        expect(retryCalls.length).toBeGreaterThan(0);
        for (const call of retryCalls) {
          const method = (call[1] as RequestInit | undefined)?.method ?? "GET";
          expect(method).toBe("GET");
        }

        await advanceTime(budgetMs);
        expect(view.container.textContent).toContain(timeout);
      } finally {
        await view.unmount();
      }
    },
  );
});
