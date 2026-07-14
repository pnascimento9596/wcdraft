// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountClient } from "@/app/account/account-client";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { SignUpForm } from "@/app/sign-up/sign-up-form";
import { FormationSelect } from "@/components/game/draft-screen/setup";
import type { AccountRunsPage } from "@/lib/account/runs";
import type { GameData } from "@/lib/game/data";
import type { RunRecordV1 } from "@/lib/game/run-record";
import {
  advanceTime,
  buttonByText,
  click,
  mountReact,
  setInput,
  submit,
} from "@/lib/test/dom-harness";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const authContext = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
}));

type CreateRunResult = Awaited<
  ReturnType<(typeof import("@/lib/game/run-record"))["createNewRunRecord"]>
>;
const runRecordSeam = vi.hoisted(() => ({
  result: null as CreateRunResult | null,
  calls: 0,
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
    default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) =>
      React.createElement("img", {
        ...props,
        src: String(props.src),
        alt: props.alt,
        priority: undefined,
      }),
  };
});

vi.mock("@/components/auth-context", () => ({
  useAuth: () => ({
    authEnabled: true,
    session: {
      userId: "user-1",
      username: null,
      emailVerified: false,
      isAnonymous: false,
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
    ready: true,
    sessionError: null,
    isSignedIn: true,
    refresh: authContext.refresh,
  }),
}));

vi.mock("@/lib/game/run-record", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/run-record")>();
  return {
    ...actual,
    createNewRunRecord: (...args: Parameters<typeof actual.createNewRunRecord>) => {
      runRecordSeam.calls += 1;
      return runRecordSeam.result
        ? Promise.resolve(runRecordSeam.result)
        : actual.createNewRunRecord(...args);
    },
  };
});

const INITIAL_ACCOUNT: AccountRunsPage = {
  identity: {
    userId: "user-1",
    email: "manager@example.com",
    username: null,
    hasPassword: true,
    emailVerified: false,
  },
  runs: [],
  quota: { maxRows: 500, maxBytes: 8 * 1024 * 1024, usedRows: 0, usedBytes: 0 },
  stats: {
    totalRuns: 0,
    scoredRuns: 0,
    bestScore: null,
    averageScore: null,
    perfectRunCount: 0,
    qualifyingRate: null,
    undefeatedRate: null,
    dailyStreakDays: 0,
    todayBest: null,
    personalBest: null,
  },
  page: { limit: 25, offset: 0, total: 0, hasMore: false },
};

function heldOpenFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
}

async function mountHeld(node: ReactElement) {
  const fetcher = heldOpenFetch();
  vi.stubGlobal("fetch", fetcher);
  const view = await mountReact(node);
  return { view, fetcher };
}

type MountedView = Awaited<ReturnType<typeof mountReact>>;
type SignInOperation = "password" | "sign-in link" | "reset link";

async function prepareSignInOperation(view: MountedView, operation: SignInOperation) {
  const inputs = [...view.container.querySelectorAll("input")];
  const passwordForm = view.container.querySelector("form");
  if (!(passwordForm instanceof HTMLFormElement)) throw new Error("password form missing");

  let trigger: () => Promise<void>;
  let changedInput: HTMLInputElement;
  let lockedButton: HTMLButtonElement;
  if (operation === "password") {
    await setInput(inputs[0]!, "manager_10");
    await setInput(inputs[1]!, "secret-password");
    trigger = () => submit(passwordForm);
    changedInput = inputs[1]!;
    lockedButton = buttonByText(view.container, "Sign in");
  } else if (operation === "sign-in link") {
    await setInput(inputs[2]!, "manager@example.com");
    lockedButton = buttonByText(view.container, "Send link");
    trigger = () => click(lockedButton);
    changedInput = inputs[2]!;
  } else {
    await setInput(inputs[0]!, "manager@example.com");
    lockedButton = buttonByText(view.container, "Forgot password?");
    trigger = () => click(lockedButton);
    changedInput = inputs[0]!;
  }

  return { inputs, trigger, changedInput, lockedButton };
}

beforeEach(() => {
  vi.useFakeTimers();
  navigation.params = new URLSearchParams();
  runRecordSeam.result = null;
  runRecordSeam.calls = 0;
  document.cookie = "wcdraft_csrf=test-token; Path=/";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("mounted sign-in mutation locks", () => {
  it.each(["password", "sign-in link", "reset link"] as const)(
    "locks a held-open %s POST until the user changes that operation",
    async (operation) => {
      const { view, fetcher } = await mountHeld(createElement(SignInForm));
      try {
        const { inputs, trigger, changedInput, lockedButton } = await prepareSignInOperation(
          view,
          operation,
        );

        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);
        await advanceTime(12_000);

        expect(view.container.textContent).toContain("This request is locked");
        expect(lockedButton.disabled).toBe(true);
        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();
        expect(navigation.refresh).not.toHaveBeenCalled();

        const unrelatedInput = operation === "password" ? inputs[2]! : inputs[1]!;
        await setInput(unrelatedInput, "unrelated-change");
        expect(lockedButton.disabled).toBe(true);
        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);

        await setInput(changedInput, `${changedInput.value}-changed`);
        expect(lockedButton.disabled).toBe(false);
      } finally {
        await view.unmount();
      }
    },
  );

  it.each([
    ["password", 502],
    ["sign-in link", 408],
    ["reset link", 500],
  ] as const)(
    "keeps an ambiguous %s POST at exactly one dispatch after HTTP %i",
    async (operation, status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ message: "Upstream did not acknowledge the request." }), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      const view = await mountReact(createElement(SignInForm));
      try {
        const { trigger, lockedButton } = await prepareSignInOperation(view, operation);

        await trigger();
        await advanceTime(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(lockedButton.disabled).toBe(true);
        expect(view.container.textContent).toContain("This request is locked");
        expect(view.container.textContent).toContain("Refresh to check state");

        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();
        expect(navigation.replace).not.toHaveBeenCalled();
        expect(navigation.refresh).not.toHaveBeenCalled();
        if (operation !== "password") {
          expect(view.container.textContent).not.toContain("We sent a single-use");
        }
      } finally {
        await view.unmount();
      }
    },
  );

  it.each([
    ["password", 401],
    ["sign-in link", 400],
    ["reset link", 429],
  ] as const)("releases the %s latch after definitive HTTP %i", async (operation, status) => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "Definitive rejection." }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = await mountReact(createElement(SignInForm));
    try {
      const { trigger, lockedButton } = await prepareSignInOperation(view, operation);

      await trigger();
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(lockedButton.disabled).toBe(false);
      await trigger();
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(navigation.push).not.toHaveBeenCalled();
      expect(navigation.refresh).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it.each([
    ["password", { ok: true, redirectTo: "/play" }, "password"],
    ["sign-in link", { ok: true }, "single-use sign-in"],
    ["reset link", { ok: true }, "password reset"],
  ] as const)("keeps a valid %s success usable", async (operation, responseBody, outcome) => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = await mountReact(createElement(SignInForm));
    try {
      const { trigger } = await prepareSignInOperation(view, operation);

      await trigger();
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
      if (outcome === "password") {
        expect(navigation.push).toHaveBeenCalledWith("/play");
        expect(navigation.refresh).toHaveBeenCalledOnce();
      } else {
        expect(view.container.textContent).toContain(outcome);
        expect(navigation.push).not.toHaveBeenCalled();
      }
    } finally {
      await view.unmount();
    }
  });
});

describe("mounted sign-up mutation lock", () => {
  it("does not replay an unknown account creation and a changed body starts a new operation", async () => {
    const { view, fetcher } = await mountHeld(createElement(SignUpForm));
    try {
      const inputs = [...view.container.querySelectorAll("input")];
      await setInput(inputs[0]!, "manager_10");
      await setInput(inputs[1]!, "manager@example.com");
      await setInput(inputs[2]!, "secret-password");
      const form = view.container.querySelector("form");
      if (!(form instanceof HTMLFormElement)) throw new Error("sign-up form missing");

      await submit(form);
      await advanceTime(12_000);
      const button = buttonByText(view.container, "Create account");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(button.disabled).toBe(true);
      expect(view.container.textContent).toContain("This request is locked");

      await submit(form);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(navigation.push).not.toHaveBeenCalled();

      await setInput(inputs[0]!, "manager_11");
      expect(button.disabled).toBe(false);
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Username is unavailable." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await submit(form);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(button.disabled).toBe(false);
      expect(view.container.textContent).toContain("Username is unavailable.");
    } finally {
      await view.unmount();
    }
  });

  it("keeps an HTTP 503 account creation at one POST with no handoff", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "Service unavailable." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = await mountReact(createElement(SignUpForm));
    try {
      const inputs = [...view.container.querySelectorAll("input")];
      await setInput(inputs[0]!, "manager_10");
      await setInput(inputs[1]!, "manager@example.com");
      await setInput(inputs[2]!, "secret-password");
      const form = view.container.querySelector("form");
      if (!(form instanceof HTMLFormElement)) throw new Error("sign-up form missing");

      await submit(form);
      await advanceTime(0);
      const button = buttonByText(view.container, "Create account");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
      expect(button.disabled).toBe(true);
      expect(view.container.textContent).toContain("This request is locked");
      expect(view.container.textContent).toContain("Refresh to check state");

      await submit(form);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(navigation.push).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(navigation.refresh).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it("keeps a valid HTTP 201 account-creation handoff usable and committed", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, redirectTo: "/account" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = await mountReact(createElement(SignUpForm));
    try {
      const inputs = [...view.container.querySelectorAll("input")];
      await setInput(inputs[0]!, "manager_10");
      await setInput(inputs[1]!, "manager@example.com");
      await setInput(inputs[2]!, "secret-password");
      const form = view.container.querySelector("form");
      if (!(form instanceof HTMLFormElement)) throw new Error("sign-up form missing");

      await submit(form);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
      expect(navigation.push).toHaveBeenCalledWith("/account");
      expect(navigation.refresh).toHaveBeenCalledOnce();

      await submit(form);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });
});

type AccountOperation = "sign-out" | "username" | "verification" | "password" | "deletion";

async function prepareAccountOperation(view: MountedView, operation: AccountOperation) {
  let trigger: () => Promise<void>;
  let target: HTMLButtonElement;
  let changeOperation: (() => Promise<void>) | null = null;
  let method: "DELETE" | "POST" | "PUT";

  if (operation === "sign-out") {
    target = buttonByText(view.container, "Sign out");
    trigger = () => click(target);
    method = "DELETE";
  } else if (operation === "username") {
    const input = view.container.querySelector('input[placeholder="manager_10"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("username input missing");
    await setInput(input, "manager_10");
    target = buttonByText(view.container, "Save username");
    const form = target.closest("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("username form missing");
    trigger = () => submit(form);
    changeOperation = () => setInput(input, "manager_11");
    method = "PUT";
  } else if (operation === "verification") {
    target = buttonByText(view.container, "Resend verification");
    trigger = () => click(target);
    method = "POST";
  } else if (operation === "password") {
    const current = view.container.querySelector('input[autocomplete="current-password"]');
    const next = view.container.querySelector('input[autocomplete="new-password"]');
    if (!(current instanceof HTMLInputElement) || !(next instanceof HTMLInputElement)) {
      throw new Error("password inputs missing");
    }
    await setInput(current, "old-password");
    await setInput(next, "new-secret-password");
    target = buttonByText(view.container, "Change password");
    const form = target.closest("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("password form missing");
    trigger = () => submit(form);
    changeOperation = () => setInput(next, "different-secret-password");
    method = "PUT";
  } else {
    const input = view.container.querySelector('input[autocomplete="off"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("delete confirmation missing");
    await setInput(input, "delete my account");
    target = buttonByText(view.container, "Delete account");
    const form = target.closest("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("delete form missing");
    trigger = () => submit(form);
    // Editing confirmation does not identify a different account deletion.
    changeOperation = () => setInput(input, "delete my account again");
    method = "DELETE";
  }

  return { trigger, target, changeOperation, method };
}

describe("mounted Account mutation locks", () => {
  it.each(["sign-out", "username", "verification", "password", "deletion"] as const)(
    "keeps an unknown %s mutation at exactly one request",
    async (operation) => {
      const { view, fetcher } = await mountHeld(
        createElement(AccountClient, { initial: INITIAL_ACCOUNT }),
      );
      try {
        const { trigger, target, changeOperation } = await prepareAccountOperation(view, operation);

        await trigger();
        await advanceTime(12_000);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(target.disabled).toBe(true);
        expect(view.container.textContent).toContain("locked");
        expect(view.container.textContent).toContain("Reload Account to check state");

        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();

        if (changeOperation) {
          await changeOperation();
          expect(target.disabled).toBe(operation === "deletion");
        }
      } finally {
        await view.unmount();
      }
    },
  );

  it.each([
    ["username", 504],
    ["verification", 408],
    ["password", 500],
    ["deletion", 502],
  ] as const)(
    "keeps an ambiguous %s mutation at exactly one dispatch after HTTP %i",
    async (operation, status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ message: "Upstream did not acknowledge the request." }), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      const view = await mountReact(createElement(AccountClient, { initial: INITIAL_ACCOUNT }));
      try {
        const { trigger, target, method } = await prepareAccountOperation(view, operation);

        await trigger();
        await advanceTime(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe(method);
        expect(target.disabled).toBe(true);
        expect(view.container.textContent).toContain("locked");
        expect(view.container.textContent).toContain("Reload Account to check state");

        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();
        expect(navigation.replace).not.toHaveBeenCalled();
        expect(navigation.refresh).not.toHaveBeenCalled();
        expect(authContext.refresh).not.toHaveBeenCalled();
        if (operation === "username") {
          expect(view.container.textContent).toContain("Choose username");
        }
        if (operation === "verification") {
          expect(view.container.textContent).not.toContain("Verification link sent.");
        }
        if (operation === "password") {
          expect(view.container.textContent).not.toContain("Password updated.");
        }
      } finally {
        await view.unmount();
      }
    },
  );

  it.each([
    ["username", { ok: true }, "saved profile"],
    ["password", { ok: true }, "account state"],
  ] as const)(
    "locks a committed %s update when its required %s body is unusable",
    async (operation, responseBody, expectedCopy) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      const view = await mountReact(createElement(AccountClient, { initial: INITIAL_ACCOUNT }));
      try {
        const { trigger, target, method } = await prepareAccountOperation(view, operation);

        await trigger();
        await advanceTime(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe(method);
        expect(target.disabled).toBe(true);
        expect(view.container.textContent).toContain(expectedCopy);
        expect(view.container.textContent).toContain("Reload Account to check state");

        await trigger();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();
        expect(navigation.refresh).not.toHaveBeenCalled();
        expect(authContext.refresh).not.toHaveBeenCalled();
        if (operation === "username") {
          expect(view.container.textContent).toContain("Choose username");
          expect(view.container.textContent).not.toContain("Username saved.");
        } else {
          expect(view.container.textContent).not.toContain("Password updated.");
        }
      } finally {
        await view.unmount();
      }
    },
  );

  it.each([
    ["username", 400],
    ["verification", 429],
    ["password", 403],
    ["deletion", 409],
  ] as const)("releases the %s latch after definitive HTTP %i", async (operation, status) => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "Definitive rejection." }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = await mountReact(createElement(AccountClient, { initial: INITIAL_ACCOUNT }));
    try {
      const { trigger, target, method } = await prepareAccountOperation(view, operation);

      await trigger();
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe(method);
      expect(target.disabled).toBe(false);
      await trigger();
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(navigation.push).not.toHaveBeenCalled();
      expect(navigation.refresh).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it.each([
    ["username", { profile: { username: "manager_10" } }, "Username saved."],
    ["verification", { ok: true }, "Verification link sent."],
    ["password", { ok: true, hasPassword: true }, "Password updated."],
    ["deletion", { ok: true }, null],
  ] as const)("keeps a valid %s success usable", async (operation, responseBody, expectedCopy) => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = await mountReact(createElement(AccountClient, { initial: INITIAL_ACCOUNT }));
    try {
      const { trigger, target, method } = await prepareAccountOperation(view, operation);

      await trigger();
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe(method);
      if (operation === "deletion") {
        expect(target.disabled).toBe(true);
        expect(navigation.push).toHaveBeenCalledWith("/");
        expect(navigation.refresh).toHaveBeenCalledOnce();
      } else {
        expect(target.disabled).toBe(false);
        expect(view.container.textContent).toContain(expectedCopy);
        expect(navigation.push).not.toHaveBeenCalled();
        if (operation === "username" || operation === "password") {
          expect(authContext.refresh).toHaveBeenCalledOnce();
        }
      }
    } finally {
      await view.unmount();
    }
  });
});

function rankedAttemptBody(): Record<string, string> {
  return {
    attempt_id: "attempt-1",
    parent_seed: "seed-1",
    expires_at: "2026-07-10T15:00:00.000Z",
    season_key: "2026-s1",
    formation_id: "4-3-3",
    draft_mode: "classic",
    draft_order: "squad_first",
    era: "all_time",
    rating_basis: "career",
  };
}

async function mountRankedFormation(fetcher: ReturnType<typeof heldOpenFetch>, onLocked = vi.fn()) {
  vi.stubGlobal("fetch", fetcher);
  const view = await mountReact(
    createElement(FormationSelect, {
      gameData: {} as GameData,
      draftMode: "classic",
      initialRanked: true,
      onLocked,
    }),
  );
  return { view, onLocked, lock: buttonByText(view.container, "Lock 4-3-3 & spin") };
}

describe("mounted ranked seed issuance lock", () => {
  it("drops a delayed ranked success after unmount/navigation before local creation", async () => {
    const deferred: {
      resolve?: (response: Response) => void;
      signal?: AbortSignal;
    } = {};
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          deferred.resolve = resolve;
          if (init?.signal instanceof AbortSignal) deferred.signal = init.signal;
        }),
    );
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);

    await click(lock);
    expect(fetcher).toHaveBeenCalledOnce();
    await view.unmount();
    expect(deferred.signal?.aborted).toBe(true);

    deferred.resolve?.(
      new Response(JSON.stringify(rankedAttemptBody()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await advanceTime(0);

    expect(runRecordSeam.calls).toBe(0);
    expect(onLocked).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("lets a replacement mount supersede a delayed ranked request without stale handoff", async () => {
    const responses: Array<(response: Response) => void> = [];
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);
          if (init?.signal instanceof AbortSignal) signals.push(init.signal);
        }),
    );
    const first = await mountRankedFormation(fetcher);
    await click(first.lock);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await first.view.unmount();
    expect(signals[0]?.aborted).toBe(true);

    runRecordSeam.result = {
      record: { run_id: "replacement-ranked-run" } as RunRecordV1,
      persistence: "durable",
      warnings: [],
    };
    const replacementOnLocked = vi.fn();
    const replacement = await mountRankedFormation(fetcher, replacementOnLocked);
    try {
      await click(replacement.lock);
      expect(fetcher).toHaveBeenCalledTimes(2);

      await act(async () => {
        responses[0]?.(
          new Response(JSON.stringify(rankedAttemptBody()), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        );
        await Promise.resolve();
      });
      expect(runRecordSeam.calls).toBe(0);
      expect(first.onLocked).not.toHaveBeenCalled();
      expect(replacementOnLocked).not.toHaveBeenCalled();

      await act(async () => {
        responses[1]?.(
          new Response(JSON.stringify(rankedAttemptBody()), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        );
        await Promise.resolve();
      });
      expect(runRecordSeam.calls).toBe(1);
      expect(first.onLocked).not.toHaveBeenCalled();
      expect(replacementOnLocked).toHaveBeenCalledOnce();
      expect(replacementOnLocked.mock.calls[0]?.[0]).toMatchObject({
        run_id: "replacement-ranked-run",
      });
    } finally {
      await replacement.view.unmount();
    }
  });

  it("never remints after a held-open timeout", async () => {
    const fetcher = heldOpenFetch();
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);
    try {
      await click(lock);
      await advanceTime(12_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(lock.disabled).toBe(true);
      expect(view.container.textContent).toContain("configuration is locked");
      expect(view.container.textContent).toContain("Check account");
      expect(view.container.textContent).toContain("Choose another mode");
      await click(lock);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onLocked).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it("never remints after a transport-unknown failure", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("connection lost");
    });
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);
    try {
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(lock.disabled).toBe(true);
      await click(lock);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onLocked).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it("never remints after an HTTP 503 acknowledgement-ambiguous response", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "Service unavailable." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);
    try {
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
      expect(lock.disabled).toBe(true);
      expect(view.container.textContent).toContain(
        "server could not confirm whether the ranked attempt was issued",
      );
      expect(view.container.textContent).toContain("configuration is locked");
      expect(view.container.textContent).toContain("Check account");
      expect(view.container.textContent).toContain("Choose another mode");

      await click(lock);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onLocked).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it.each([
    ["unreadable", "not-json"],
    ["malformed", JSON.stringify({ attempt_id: "incomplete-attempt" })],
  ])("never remints after committed HTTP 201 with an %s body", async (_label, responseBody) => {
    const fetcher = vi.fn(
      async () =>
        new Response(responseBody, {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);
    try {
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(lock.disabled).toBe(true);
      expect(view.container.textContent).toContain("attempt may have been issued");
      expect(view.container.textContent).toContain("configuration is locked");
      expect(view.container.textContent).toContain("Check account");
      expect(view.container.textContent).toContain("Choose another mode");
      await click(lock);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onLocked).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it("re-enables issuance after a definitive HTTP failure", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Sign in first." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);
    try {
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(lock.disabled).toBe(false);
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onLocked).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it("keeps an issued seed latched when local creation fails", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(rankedAttemptBody()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { view, onLocked, lock } = await mountRankedFormation(fetcher);
    try {
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onLocked).not.toHaveBeenCalled();
      expect(view.container.textContent).toContain("ranked seed was issued");
      expect(lock.disabled).toBe(true);
      await click(lock);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it("keeps an issued seed latched when the parent handoff throws", async () => {
    runRecordSeam.result = {
      record: { run_id: "run-after-issued-seed" } as RunRecordV1,
      persistence: "durable",
      warnings: [],
    };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(rankedAttemptBody()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const onLocked = vi.fn(() => {
      throw new Error("parent handoff failed");
    });
    const { view, lock } = await mountRankedFormation(fetcher, onLocked);
    try {
      await click(lock);
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onLocked).toHaveBeenCalledOnce();
      expect(view.container.textContent).toContain("ranked seed was issued");
      expect(lock.disabled).toBe(true);
      await click(lock);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });
});
