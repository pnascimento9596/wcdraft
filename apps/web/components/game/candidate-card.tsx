"use client";

import type { ManagerCard, PlayerCard } from "@/lib/mock";
import s from "./game.module.css";

const AWARD_GLYPH: Record<string, string> = {
  golden_ball: "Golden Ball",
  silver_ball: "Silver Ball",
  bronze_ball: "Bronze Ball",
  golden_boot: "Golden Boot",
  silver_boot: "Silver Boot",
  bronze_boot: "Bronze Boot",
  golden_glove: "Golden Glove",
  best_young_player: "Best Young Player",
  all_tournament_team: "Team of the Tournament",
  fair_play: "Fair Play",
};

/** A compact rating-channel bar. */
function Channel({ label, value }: { label: string; value: number }) {
  return (
    <div className={s.channel} title={`${label} ${value}`}>
      <span className={s.channelLabel}>{label}</span>
      <span className={s.channelTrack}>
        <span className={s.channelFill} style={{ width: `${value}%` }} />
      </span>
      <span className={s.channelVal}>{value}</span>
    </div>
  );
}

export function CandidateCard({
  card,
  selected,
  disabled,
  onSelect,
}: {
  card: PlayerCard;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const classes = [s.cand];
  if (selected) classes.push(s.candSelected);
  if (disabled) classes.push(s.candDisabled);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div className={s.candTop}>
        <div className={s.candId}>
          <span className={s.candShirt}>{card.shirt_number ?? "—"}</span>
          <div className={s.candNameWrap}>
            <span className={s.candName}>
              {card.name}
              {card.captain && <span className={s.candCaptain} title="Captain">C</span>}
            </span>
            <span className={s.candSub}>
              {card.position_listed ?? card.eligible_positions[0]} ·{" "}
              {card.club_at_tournament ?? "—"}
            </span>
          </div>
        </div>
        <div className={s.candOverall}>
          <span className={s.candOverallNum}>{card.rating.overall ?? "—"}</span>
          <span className={s.candOverallLabel}>OVR</span>
        </div>
      </div>

      <div className={s.candPositions}>
        {card.eligible_positions.map((p) => (
          <span key={p} className={s.posTag}>
            {p}
          </span>
        ))}
        {disabled && <span className={s.candDrafted}>Drafted</span>}
      </div>

      <div className={s.channels}>
        <Channel label="ATT" value={card.rating.attack} />
        <Channel label="MID" value={card.rating.midfield} />
        <Channel label="DEF" value={card.rating.defense} />
        <Channel label="GK" value={card.rating.goalkeeping} />
      </div>

      <div className={s.candStats}>
        <span>
          <b>{card.appearances ?? "—"}</b> apps
        </span>
        <span>
          <b>{card.goals ?? "—"}</b> goals
        </span>
        <span className={s.candCoverage} title="Honest-state data coverage">
          {Math.round(card.rating.coverage * 100)}% data
        </span>
      </div>

      {card.awards && card.awards.length > 0 && (
        <div className={s.candAwards}>
          {card.awards.map((a, i) => (
            <span key={i} className={s.award}>
              {AWARD_GLYPH[a.award_type] ?? a.award_type}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export function ManagerCandidate({
  coach,
  selected,
  disabled,
  onSelect,
}: {
  coach: ManagerCard;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const classes = [s.cand, s.candManager];
  if (selected) classes.push(s.candSelected);
  if (disabled) classes.push(s.candDisabled);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div className={s.candTop}>
        <div className={s.candId}>
          <span className={s.candShirt}>★</span>
          <div className={s.candNameWrap}>
            <span className={s.candName}>{coach.name}</span>
            <span className={s.candSub}>Manager · {coach.nation_name}</span>
          </div>
        </div>
        <div className={s.candOverall}>
          <span className={s.candOverallNum}>{coach.rating.overall ?? "—"}</span>
          <span className={s.candOverallLabel}>OVR</span>
        </div>
      </div>
      <div className={s.channels}>
        <Channel label="PED" value={coach.rating.pedigree} />
        <Channel label="EXP" value={coach.rating.experience} />
      </div>
      <div className={s.candStats}>
        <span>
          <b>{coach.matches ?? "—"}</b> matches
        </span>
        <span>
          finish <b>{coach.final_placement ? `#${coach.final_placement}` : "—"}</b>
        </span>
        <span className={s.candManagerTag}>Takes the manager slot</span>
      </div>
    </button>
  );
}
