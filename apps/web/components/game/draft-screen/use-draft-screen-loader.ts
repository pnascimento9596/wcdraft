import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { loadDailyAvailability, loadGameData, type GameData } from "@/lib/game/data";
import { DAILY_DRAFT_CONFIG, dailyChallengeForDate, dailyCoverageForDate } from "@/lib/game/daily";
import { describeGameError, isRuntimeDataTimeout } from "@/lib/game/errors";
import {
  createNewRunRecord,
  evictStaleRunRecords,
  isStorageVolatile,
  type RunRecordV1,
} from "@/lib/game/run-record";
import { resolveDisplayRun } from "@/lib/game/run-screen-loader";
import { VOLATILE_STORAGE_WARNING } from "./constants";
import {
  verifyFriendChallenge,
  type FriendChallengeRef,
  type FriendChallengeSearchState,
  type VerifiedFriendChallengeSetup,
} from "@/lib/game/friend-challenge";

export type DraftScreenMode =
  | { kind: "loading" }
  | { kind: "daily_unavailable" }
  | { kind: "formation_select"; gameData: GameData }
  | {
      kind: "friend_setup";
      gameData: GameData;
      ref: FriendChallengeRef;
      challenge: VerifiedFriendChallengeSetup;
    }
  | {
      kind: "ready";
      gameData: GameData;
      record: RunRecordV1;
      persistenceWarning: string | null;
    }
  | {
      kind: "recovery";
      gameData: GameData;
      title: string;
      reason: string;
      runId: string | null;
      retryable: boolean;
    }
  | { kind: "error"; title: string; message: string };

export type InitialDraftDataResult =
  | { readonly kind: "loaded"; readonly gameData: GameData }
  | { readonly kind: "daily_unavailable" };

export interface InitialDraftDataDeps {
  readonly loadDailyAvailability: (date: string) => Promise<boolean>;
  readonly loadGameData: () => Promise<GameData>;
}

const INITIAL_DRAFT_DATA_DEPS: InitialDraftDataDeps = {
  loadDailyAvailability,
  loadGameData,
};

/**
 * New Daily runs must prove lightweight publication coverage before the full
 * draft pool starts loading. Historical run-id resumes intentionally bypass
 * that rolling-coverage check so honest stored runs remain readable.
 */
export async function loadInitialDraftData(
  requestRunId: string | null,
  dailyDate: string | null,
  deps: InitialDraftDataDeps = INITIAL_DRAFT_DATA_DEPS,
): Promise<InitialDraftDataResult> {
  if (requestRunId === null && dailyDate !== null) {
    try {
      if (!(await deps.loadDailyAvailability(dailyDate))) {
        return { kind: "daily_unavailable" };
      }
    } catch (error) {
      // A timeout is distinct from honest publication unavailability: the
      // request outcome is unknown, so let the container render its bounded
      // Retry + alternate-mode recovery panel. Other metadata failures remain
      // fail-closed as A1 requires.
      if (isRuntimeDataTimeout(error)) throw error;
      return { kind: "daily_unavailable" };
    }
  }
  return { kind: "loaded", gameData: await deps.loadGameData() };
}

export function useDraftScreenLoader(
  requestRunId: string | null,
  opts: { dailyDate?: string | null; friendChallenge?: FriendChallengeSearchState } = {},
): {
  mode: DraftScreenMode;
  setMode: Dispatch<SetStateAction<DraftScreenMode>>;
  retryFromError: () => void;
} {
  const [mode, setMode] = useState<DraftScreenMode>({ kind: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const reqToken = useRef(0);

  useEffect(() => {
    const myToken = ++reqToken.current;
    const controller = new AbortController();
    const dailyDate = opts.dailyDate ?? null;
    const friendChallenge = opts.friendChallenge ?? { kind: "none" as const };
    setMode({ kind: "loading" });
    loadInitialDraftData(requestRunId, dailyDate)
      .then(async (initial) => {
        if (myToken !== reqToken.current) return;
        if (initial.kind === "daily_unavailable") {
          setMode({ kind: "daily_unavailable" });
          return;
        }
        const gd = initial.gameData;
        if (friendChallenge.kind === "invalid") {
          setMode({
            kind: "recovery",
            gameData: gd,
            title: "Couldn’t verify that challenge",
            reason: "This friend challenge link is malformed or incomplete.",
            runId: null,
            retryable: false,
          });
          return;
        }
        if (friendChallenge.kind === "ready") {
          const verified = await verifyFriendChallenge(friendChallenge.ref, controller.signal);
          if (myToken !== reqToken.current) return;
          if (!verified.ok) {
            setMode({
              kind: "recovery",
              gameData: gd,
              title: "Couldn’t verify that challenge",
              reason:
                verified.error === "DAILY_UNAVAILABLE"
                  ? "This Daily challenge is outside the currently published coverage window."
                  : verified.error === "RATE_LIMITED"
                    ? "Friend challenge verification is busy. Try again shortly."
                    : verified.error === "RATE_LIMIT_UNAVAILABLE"
                      ? "Friend challenge verification is temporarily unavailable. Wait a moment and try again."
                      : verified.error === "INVALID_CHALLENGE"
                        ? "This friend challenge could not be verified. Ask for a fresh link."
                        : "Friend challenge verification is unavailable right now.",
              runId: null,
              // RATE_LIMITED may retry after Retry-After. Store faults (503) and
              // generic UNAVAILABLE are NOT auto-retryable — immediate retry would
              // amplify load against an already-failing limiter/DB.
              retryable: verified.error === "RATE_LIMITED",
            });
            return;
          }
          if (verified.challenge.dailyDate !== dailyDate) {
            setMode({
              kind: "recovery",
              gameData: gd,
              title: "Couldn’t verify that challenge",
              reason: "This friend challenge was opened on the wrong play route.",
              runId: null,
              retryable: false,
            });
            return;
          }
          setMode({
            kind: "friend_setup",
            gameData: gd,
            ref: friendChallenge.ref,
            challenge: verified.challenge,
          });
          return;
        }
        if (!requestRunId) await evictStaleRunRecords(gd.versions);
        if (requestRunId) {
          const resolved = await resolveDisplayRun(
            { kind: "id", run_id: requestRunId },
            { allowUnsimulatedLocalRun: true },
            { loadGameData: async () => gd },
          );
          if (myToken !== reqToken.current) return;
          if (resolved.kind === "ready") {
            setMode({
              kind: "ready",
              gameData: gd,
              record: resolved.record,
              // Re-derive the volatile-storage warning on the resume path so
              // it survives the formation-lock `router.replace` (and a real
              // refresh) — otherwise the spin stage flashes blank between the
              // initial save and the next durable-failing pick.
              persistenceWarning: isStorageVolatile() ? VOLATILE_STORAGE_WARNING : null,
            });
          } else {
            setMode({
              kind: "recovery",
              gameData: gd,
              title: "Couldn’t resume that draft",
              reason:
                resolved.kind === "missing" && resolved.localStatus === "missing"
                  ? "We couldn't find a draft for that link."
                  : resolved.kind === "stale"
                    ? "This draft was created on an older data bundle and has been evicted."
                    : "This draft record is invalid and has been removed.",
              runId: requestRunId,
              retryable: false,
            });
          }
        } else if (dailyDate) {
          if (!dailyCoverageForDate(dailyDate, gd.dailySeedSaltMap).covered) {
            setMode({ kind: "daily_unavailable" });
            return;
          }
          const challenge = dailyChallengeForDate(dailyDate, gd.dailySeedSaltMap);
          const created = await createNewRunRecord(gd, {
            formation_id: DAILY_DRAFT_CONFIG.formationId,
            mode: DAILY_DRAFT_CONFIG.mode,
            team_name: DAILY_DRAFT_CONFIG.teamName,
            parent_seed: challenge.seed,
            challenge,
            era_preset: DAILY_DRAFT_CONFIG.eraPreset,
            draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
            rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
          });
          const warning =
            created.persistence === "volatile" || created.warnings.length > 0
              ? created.warnings.join(" · ") || VOLATILE_STORAGE_WARNING
              : null;
          setMode({
            kind: "ready",
            gameData: gd,
            record: created.record,
            persistenceWarning: warning,
          });
        } else {
          setMode({ kind: "formation_select", gameData: gd });
        }
      })
      .catch((err) => {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      });
    return () => {
      controller.abort();
      reqToken.current += 1;
    };
  }, [requestRunId, opts.dailyDate, opts.friendChallenge, retryNonce]);

  const retryFromError = useCallback(() => {
    setRetryNonce((value) => value + 1);
  }, []);

  return { mode, setMode, retryFromError };
}

export async function createFriendChallengeRun(
  gameData: GameData,
  ref: FriendChallengeRef,
  challenge: VerifiedFriendChallengeSetup,
): Promise<Awaited<ReturnType<typeof createNewRunRecord>>> {
  return createNewRunRecord(gameData, {
    formation_id: challenge.formationId,
    mode: challenge.mode,
    parent_seed: challenge.parentSeed,
    era_preset: challenge.eraPreset,
    draft_flow: challenge.draftFlow,
    rating_basis: challenge.ratingBasis,
    ...(challenge.dailyDate === null
      ? {}
      : {
          challenge: {
            kind: "daily" as const,
            date: challenge.dailyDate,
            seed: challenge.parentSeed,
          },
        }),
    friend_challenge: ref,
  });
}
