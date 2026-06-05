"use client";

import {
  formatNullableNumber,
  formatStatValue,
  positionShape,
  type ManagerCardView,
  type PlayerCardView,
} from "@/lib/game/view-models";
import s from "./game.module.css";

const AWARD_LABEL: Record<string, string> = {
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

/** Compact channel bar. Honest: 0 means a measured zero, not "unknown". */
function Channel({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={s.channel} title={`${label} ${value}`}>
      <span className={s.channelLabel}>{label}</span>
      <span className={s.channelTrack}>
        <span className={s.channelFill} style={{ width: `${clamped}%` }} />
      </span>
      <span className={s.channelVal}>{value}</span>
    </div>
  );
}

function PositionGlyph({ position }: { position: PlayerCardView["eligible_positions"][number] }) {
  const shape = positionShape(position);
  return (
    <span
      className={`${s.posTag} ${s[`posShape_${shape}`]!}`}
      aria-label={position}
      title={position}
    >
      {position}
    </span>
  );
}

export function CandidateCard({
  card,
  selected,
  disabled,
  onSelect,
}: {
  card: PlayerCardView;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const classes = [s.cand];
  classes.push(s[`prov_${card.rating.badge_kind}`]!);
  if (selected) classes.push(s.candSelected);
  if (disabled) classes.push(s.candDisabled);

  const coveragePct = Math.round(card.rating.coverage * 100);
  // Coarse `Position` already, no need for slot-position resolution.
  const primaryLine = card.position_listed ?? card.eligible_positions[0] ?? "MF";
  const headShape = positionShape(primaryLine);

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
          <span
            className={`${s.candNationFlag} ${s[`flagShape_${headShape}`]!}`}
            aria-label={card.nation_name}
            title={card.nation_name}
          >
            {card.nation_code}
          </span>
          <div className={s.candNameWrap}>
            <span className={s.candName}>
              {card.name}
              {card.captain ? (
                <span className={s.candCaptain} title="Captain">
                  C
                </span>
              ) : null}
            </span>
            <span className={s.candSub}>
              {card.year} ·{" "}
              {card.position_listed ?? card.eligible_positions[0] ?? "—"} ·{" "}
              {card.club_label ?? "—"}
            </span>
          </div>
        </div>
        <div className={s.candOverall}>
          <span className={s.candOverallNum}>{formatNullableNumber(card.rating.overall)}</span>
          <span className={s.candOverallLabel}>OVR</span>
        </div>
      </div>

      <div className={s.candBadgeRow}>
        <span className={`${s.provBadge} ${s[`provBadge_${card.rating.badge_kind}`]!}`}>
          {card.rating.badge_label}
        </span>
        {card.shirt_number !== null ? (
          <span className={s.candShirt}>#{card.shirt_number}</span>
        ) : null}
        {disabled ? <span className={s.candDrafted}>Drafted</span> : null}
      </div>

      <div className={s.candPositions}>
        {card.eligible_positions.map((p) => (
          <PositionGlyph key={p} position={p} />
        ))}
      </div>

      <div className={s.channels}>
        <Channel label="ATT" value={card.rating.attack} />
        <Channel label="MID" value={card.rating.midfield} />
        <Channel label="DEF" value={card.rating.defense} />
        <Channel label="GK" value={card.rating.goalkeeping} />
      </div>

      <div className={s.candStats}>
        {card.stats.map((stat) => (
          <span key={stat.label} title={stat.title}>
            <b>{formatStatValue(stat.value)}</b> {stat.label}
          </span>
        ))}
        <span className={s.candCoverage} title="Honest-state data coverage">
          <span className={s.candCoverageTrack}>
            <span
              className={s.candCoverageFill}
              style={{ width: `${coveragePct}%` }}
            />
          </span>
          <span className={s.candCoverageVal}>{coveragePct}%</span>
        </span>
      </div>

      {card.awards && card.awards.length > 0 ? (
        <div className={s.candAwards}>
          {card.awards.map((a, i) => (
            <span key={i} className={s.award}>
              {AWARD_LABEL[a.award_type] ?? a.award_type}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

export function ManagerCandidate({
  coach,
  selected,
  disabled,
  onSelect,
}: {
  coach: ManagerCardView;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const classes = [s.cand, s.candManager, s.prov_manager];
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
          <span
            className={`${s.candNationFlag} ${s.flagShape_diamond}`}
            aria-label={coach.nation_name}
            title={coach.nation_name}
          >
            {coach.nation_code}
          </span>
          <div className={s.candNameWrap}>
            <span className={s.candName}>{coach.name}</span>
            <span className={s.candSub}>
              Manager · {coach.nation_name} · {coach.year}
            </span>
          </div>
        </div>
        <div className={s.candOverall}>
          <span className={s.candOverallLabel}>Manager slot</span>
        </div>
      </div>

      <div className={s.candBadgeRow}>
        <span className={`${s.provBadge} ${s.provBadge_manager}`}>
          Rating unavailable
        </span>
        {disabled ? <span className={s.candDrafted}>Drafted</span> : null}
      </div>

      <div className={s.candStats}>
        <span>
          <b>{formatNullableNumber(coach.matches)}</b> matches
        </span>
        <span>
          finish{" "}
          <b>
            {coach.final_placement !== null ? `#${coach.final_placement}` : "—"}
          </b>
        </span>
        <span className={s.candManagerTag}>Goes to the dedicated manager slot</span>
      </div>
    </button>
  );
}
