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

/** Mini channel-bar height as a % of the fixed bar track. Honest: a measured
 *  zero renders as an empty bar, never a fabricated stub. `null` is the
 *  Memory-mode blind — also an empty bar (hidden, not zero). */
function barHeight(value: number | null): string {
  if (value === null) return "0%";
  return `${Math.max(0, Math.min(100, value))}%`;
}

/** Compact channel bar (expanded detail). Honest: 0 means a measured zero;
 *  `null` is the Memory-mode blind and renders `—` with an empty track. */
function Channel({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className={s.channel} title={`${label} hidden`}>
        <span className={s.channelLabel}>{label}</span>
        <span className={s.channelTrack} />
        <span className={s.channelVal}>—</span>
      </div>
    );
  }
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

/**
 * Compact, scannable player row (video-game lineup density). One horizontal
 * line by default; tapping selects AND expands the full detail in-place. Only
 * the selected card is expanded, so the pool stays dense and fast to scan.
 *
 * Honest-state: unknown OVR shows "—" (never 0); coverage and channels are the
 * real runtime values (`null` is the Memory-mode blind — "—" with an empty
 * bar); provenance is encoded by the left hue stripe + dot.
 */
export function CandidateCard({
  card,
  selected,
  disabled,
  rarePick = false,
  onSelect,
}: {
  card: PlayerCardView;
  selected: boolean;
  disabled?: boolean;
  /** ENGINE-V2 E-2: this candidate belongs to a rare-marked spin (gold accent). */
  rarePick?: boolean;
  onSelect: () => void;
}) {
  const classes = [s.candRow];
  classes.push(s[`prov_${card.rating.badge_kind}`]!);
  if (selected) classes.push(s.candRowSelected);
  if (disabled) classes.push(s.candRowDisabled);
  // ws-ux/mobile-polish-2: rare is marked by the inline gold "Rare" chip
  // (see candRareTag below), not a full-width gold top band — one accent
  // axis per edge: provenance owns the left stripe, gold marks pick/win
  // moments at the moment site (chip, selected ring), never a second bar.

  const coveragePct = card.rating.coverage === null ? null : Math.round(card.rating.coverage * 100);
  const primaryLine = card.position_listed ?? card.eligible_positions[0] ?? "MF";
  const headShape = positionShape(primaryLine);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      aria-expanded={selected}
    >
      <span className={s.candRowLine}>
        <span
          className={`${s.candRowFlag} ${s[`flagShape_${headShape}`]!}`}
          aria-label={card.nation_name}
          title={card.nation_name}
        >
          {card.nation_code}
        </span>

        <span className={s.candRowMain}>
          <span className={s.candRowName}>
            {card.name}
            {card.captain ? (
              <span className={s.candCaptain} title="Captain">
                C
              </span>
            ) : null}
            {rarePick ? (
              <span className={s.candRareTag} title="Rare pick — low roll probability">
                Rare
              </span>
            ) : null}
          </span>
          <span className={s.candRowSub}>
            {card.year} · {card.position_listed ?? card.eligible_positions[0] ?? "—"}
            {card.club_label ? ` · ${card.club_label}` : ""}
          </span>
        </span>

        <span
          className={`${s.candRowProv} ${s[`provDot_${card.rating.badge_kind}`]!}`}
          title={card.rating.badge_label}
          aria-hidden="true"
        />
        <span className={`${s.candRowShape} ${s[`shapeDot_${headShape}`]!}`} aria-hidden="true" />

        <span className={s.candRowBars} aria-hidden="true">
          <i style={{ height: barHeight(card.rating.attack) }} />
          <i style={{ height: barHeight(card.rating.midfield) }} />
          <i style={{ height: barHeight(card.rating.defense) }} />
          <i style={{ height: barHeight(card.rating.goalkeeping) }} />
        </span>

        <span className={s.candRowOvr}>
          <b>{formatNullableNumber(card.rating.overall)}</b>
          <i>OVR</i>
        </span>

        <span className={s.candRowCov} title="Honest-state data coverage">
          {coveragePct === null ? "—" : `${coveragePct}%`}
        </span>

        <span className={s.candRowChevron} aria-hidden="true">
          {selected ? "▴" : "▾"}
        </span>
      </span>

      {selected ? (
        <span className={s.candDetail}>
          <span className={s.candBadgeRow}>
            <span className={`${s.provBadge} ${s[`provBadge_${card.rating.badge_kind}`]!}`}>
              {card.rating.badge_label}
            </span>
            {card.rating.basis === "current" ? (
              <span
                className={s.basisChip}
                title="Rated on at-tournament (Current) strength, not career peak."
              >
                Current
              </span>
            ) : null}
            {card.shirt_number !== null ? (
              <span className={s.candShirt}>#{card.shirt_number}</span>
            ) : null}
            {disabled ? <span className={s.candDrafted}>Drafted</span> : null}
          </span>

          <span className={s.candPositions}>
            {card.eligible_positions.map((p) => (
              <PositionGlyph key={p} position={p} />
            ))}
          </span>

          <span className={s.channels}>
            <Channel label="ATT" value={card.rating.attack} />
            <Channel label="MID" value={card.rating.midfield} />
            <Channel label="DEF" value={card.rating.defense} />
            <Channel label="GK" value={card.rating.goalkeeping} />
          </span>

          <span className={s.candStats}>
            {card.stats.map((stat) => (
              <span key={stat.label} title={stat.title}>
                <b>{formatStatValue(stat.value)}</b> {stat.label}
              </span>
            ))}
            <span className={s.candCoverage} title="Honest-state data coverage">
              <span className={s.candCoverageTrack}>
                {coveragePct === null ? null : (
                  <span className={s.candCoverageFill} style={{ width: `${coveragePct}%` }} />
                )}
              </span>
              <span className={s.candCoverageVal}>
                {coveragePct === null ? "—" : `${coveragePct}%`}
              </span>
            </span>
          </span>

          {card.awards && card.awards.length > 0 ? (
            <span className={s.candAwards}>
              {card.awards.map((a, i) => (
                <span key={i} className={s.award}>
                  {AWARD_LABEL[a.award_type] ?? a.award_type}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

export function ManagerCandidate({
  manager,
  selected,
  disabled,
  rarePick = false,
  onSelect,
}: {
  manager: ManagerCardView;
  selected: boolean;
  disabled?: boolean;
  /** ENGINE-V2 E-2: this candidate belongs to a rare-marked spin (gold accent). */
  rarePick?: boolean;
  onSelect: () => void;
}) {
  const classes = [s.candRow, s.candRowManager, s.prov_manager];
  if (selected) classes.push(s.candRowSelected);
  if (disabled) classes.push(s.candRowDisabled);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      aria-expanded={selected}
    >
      <span className={s.candRowLine}>
        <span
          className={`${s.candRowFlag} ${s.flagShape_diamond}`}
          aria-label={manager.nation_name}
          title={manager.nation_name}
        >
          {manager.nation_code}
        </span>

        <span className={s.candRowMain}>
          <span className={s.candRowName}>
            {manager.name}
            {rarePick ? (
              <span className={s.candRareTag} title="Rare pick — low roll probability">
                Rare
              </span>
            ) : null}
          </span>
          {/* Honest-state: managers carry NO rating, and the row renders no
              number — the "Manager · …" subtitle marks the card kind. The
              old "Rating unavailable" pill restated this and is gone; the
              dedicated ManagerSlot card still carries the explicit badge. */}
          <span className={s.candRowSub}>
            Manager · {manager.nation_name} · {manager.year}
          </span>
        </span>

        <span className={s.candRowChevron} aria-hidden="true">
          {selected ? "▴" : "▾"}
        </span>
      </span>

      {selected ? (
        <span className={s.candDetail}>
          <span className={s.candStats}>
            <span>
              <b>{formatNullableNumber(manager.matches)}</b> matches
            </span>
            <span>
              finish <b>{manager.final_placement !== null ? `#${manager.final_placement}` : "—"}</b>
            </span>
            <span className={s.candManagerTag}>Goes to the dedicated manager slot</span>
          </span>
          {manager.traits.length > 0 ? (
            <span className={s.managerTraits} aria-label="Manager style traits — flavor only">
              {manager.traits.map((t) => (
                <span
                  key={t.id}
                  className={s.managerTraitChip}
                  title="Flavor trait only — no gameplay effect."
                >
                  {t.label}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
