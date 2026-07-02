import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { loadGameData, type GameData } from "@/lib/game/data";
import { DAILY_DRAFT_CONFIG, dailyChallengeForDate } from "@/lib/game/daily";
import { describeGameError } from "@/lib/game/errors";
import {
  createNewRunRecord,
  evictStaleRunRecords,
  isStorageVolatile,
  type RunRecordV1,
} from "@/lib/game/run-record";
import { resolveDisplayRun } from "@/lib/game/run-screen-loader";
import { VOLATILE_STORAGE_WARNING } from "./constants";

export type DraftScreenMode =
  | { kind: "loading" }
  | { kind: "formation_select"; gameData: GameData }
  | {
      kind: "ready";
      gameData: GameData;
      record: RunRecordV1;
      persistenceWarning: string | null;
    }
  | { kind: "recovery"; gameData: GameData; reason: string; runId: string | null }
  | { kind: "error"; title: string; message: string };

export function useDraftScreenLoader(
  requestRunId: string | null,
  opts: { dailyDate?: string | null } = {},
): {
  mode: DraftScreenMode;
  setMode: Dispatch<SetStateAction<DraftScreenMode>>;
  retryFromError: () => void;
} {
  const [mode, setMode] = useState<DraftScreenMode>({ kind: "loading" });
  const reqToken = useRef(0);

  useEffect(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    loadGameData()
      .then(async (gd) => {
        if (myToken !== reqToken.current) return;
        evictStaleRunRecords(gd.versions);
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
              reason:
                resolved.kind === "missing" && resolved.localStatus === "missing"
                  ? "We couldn't find a draft for that link."
                  : resolved.kind === "stale"
                    ? "This draft was created on an older data bundle and has been evicted."
                    : "This draft record is invalid and has been removed.",
              runId: requestRunId,
            });
          }
        } else if (opts.dailyDate) {
          const challenge = dailyChallengeForDate(opts.dailyDate, gd.dailySeedSaltMap);
          const created = createNewRunRecord(gd, {
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
      reqToken.current += 1;
    };
  }, [requestRunId, opts.dailyDate]);

  const retryFromError = useCallback(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    loadGameData()
      .then((gd) => {
        if (myToken !== reqToken.current) return;
        setMode({ kind: "formation_select", gameData: gd });
      })
      .catch((err) => {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({
          kind: "error",
          title: d.title,
          message: d.message,
        });
      });
  }, []);

  return { mode, setMode, retryFromError };
}
