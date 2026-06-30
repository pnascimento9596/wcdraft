"use client";

import { resolveClubCrest } from "@/lib/game/club-crests";
import s from "./game.module.css";

export function ClubCrestMark({
  clubName,
  tournamentYear,
}: {
  clubName: string;
  tournamentYear: number;
}) {
  const resolution = resolveClubCrest(clubName, tournamentYear);
  if (!resolution) return null;

  if (resolution.kind === "crest") {
    return (
      <img
        src={resolution.src}
        alt={resolution.alt}
        title={`${clubName} club crest`}
        className={`${s.clubCrestMark} ${s.clubCrestImage}`}
        loading="lazy"
        decoding="async"
        draggable={false}
        data-club-crest-kind="crest"
      />
    );
  }

  return (
    <span
      className={`${s.clubCrestMark} ${s.clubCrestFallback} ${s[`clubTone_${resolution.tone}`]!}`}
      aria-label={`${clubName} club monogram fallback`}
      title={`${clubName} crest unavailable`}
      data-club-crest-kind="monogram"
      data-club-crest-reason={resolution.reason}
    >
      <span aria-hidden="true">{resolution.initials}</span>
    </span>
  );
}
