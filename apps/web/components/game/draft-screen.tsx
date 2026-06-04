"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Position } from "@wcdraft/core";
import {
  FIRST_QUEUE_SPIN_INDEX,
  FORMATION,
  LOCKED_SLOT_IDS,
  SPIN_QUEUE,
  TOTAL_SPINS,
  compatLabel,
  compatTier,
  mockPositionCompatibility,
  mockSynergy,
  placeCard,
  seededSquad,
  type ManagerCard,
  type PlayerCard,
} from "@/lib/mock";
import { Pitch } from "./pitch";
import { CandidateCard, ManagerCandidate } from "./candidate-card";
import { SynergyPanel } from "./synergy-panel";
import s from "./game.module.css";

type Selection =
  | { kind: "player"; card: PlayerCard }
  | { kind: "manager"; card: ManagerCard }
  | null;

type PosFilter = "ALL" | Position;
type SortKey = "ovr" | "name" | "pos";

const POS_FILTERS: PosFilter[] = ["ALL", "GK", "DF", "MF", "FW"];

export function DraftScreen() {
  const [squad, setSquad] = useState(() => seededSquad());
  const [manager, setManager] = useState<ManagerCard | null>(null);
  const [spinIdx, setSpinIdx] = useState(0);
  const [drafted, setDrafted] = useState<Set<string>>(
    () => new Set(seededSquad().starters.flatMap((sl) => (sl.card ? [sl.card.player_id] : []))),
  );
  const [sel, setSel] = useState<Selection>(null);
  const [selSlot, setSelSlot] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("ovr");

  const { starters, bench } = squad;
  const currentSquad = spinIdx < SPIN_QUEUE.length ? SPIN_QUEUE[spinIdx]! : null;
  const complete = currentSquad === null;
  const spinNumber = FIRST_QUEUE_SPIN_INDEX + spinIdx + 1;

  const openSlots = useMemo(
    () => [...starters, ...bench].filter((sl) => !sl.card && !LOCKED_SLOT_IDS.includes(sl.slot_id)),
    [starters, bench],
  );

  // Live candidate list for this spin.
  const candidates = useMemo(() => {
    if (!currentSquad) return [];
    const q = search.trim().toLowerCase();
    let list = currentSquad.players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.full_name.toLowerCase().includes(q)) {
        return false;
      }
      if (posFilter !== "ALL" && !p.eligible_positions.includes(posFilter)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortKey === "ovr") return (b.rating.overall ?? 0) - (a.rating.overall ?? 0);
      if (sortKey === "name") return a.name.localeCompare(b.name);
      const ord: Position[] = ["GK", "DF", "MF", "FW"];
      return (
        ord.indexOf(a.eligible_positions[0] ?? "MF") - ord.indexOf(b.eligible_positions[0] ?? "MF")
      );
    });
    return list;
  }, [currentSquad, search, posFilter, sortKey]);

  // Preview compatibility for every open slot, given the selected player.
  const previewCompat = useMemo(() => {
    if (sel?.kind !== "player") return null;
    const map: Record<string, number> = {};
    for (const slot of openSlots) {
      map[slot.slot_id] = mockPositionCompatibility(sel.card.eligible_positions, slot.slot_position);
    }
    return map;
  }, [sel, openSlots]);

  // Base + preview synergy.
  const baseSynergy = useMemo(() => mockSynergy(starters, FORMATION, manager), [starters, manager]);
  const previewSynergy = useMemo(() => {
    if (sel?.kind === "manager") return mockSynergy(starters, FORMATION, sel.card);
    if (sel?.kind === "player" && selSlot) {
      const hypothetical = starters.map((sl) =>
        sl.slot_id === selSlot ? placeCard(sl, sel.card) : sl,
      );
      return mockSynergy(hypothetical, FORMATION, manager);
    }
    return baseSynergy;
  }, [sel, selSlot, starters, manager, baseSynergy]);
  const synergyDelta = previewSynergy.overall - baseSynergy.overall;

  // Soft GK state.
  const gkSlot = starters.find((sl) => sl.line === "GK");
  const hasKeeper =
    !!gkSlot?.card && gkSlot.card.eligible_positions.includes("GK");
  const placedStarters = starters.filter((sl) => sl.card).length;

  function bestOpenSlotFor(card: PlayerCard): string | null {
    const starterOpen = openSlots.filter((sl) => sl.is_starter);
    const pool = starterOpen.length > 0 ? starterOpen : openSlots;
    let best: { id: string; c: number } | null = null;
    for (const slot of pool) {
      const c = mockPositionCompatibility(card.eligible_positions, slot.slot_position);
      if (!best || c > best.c) best = { id: slot.slot_id, c };
    }
    return best?.id ?? null;
  }

  function selectPlayer(card: PlayerCard) {
    setSel({ kind: "player", card });
    setSelSlot(bestOpenSlotFor(card));
  }
  function selectManager(card: ManagerCard) {
    setSel({ kind: "manager", card });
    setSelSlot(null);
  }
  function selectSlot(slotId: string) {
    if (sel?.kind !== "player") return;
    if (LOCKED_SLOT_IDS.includes(slotId)) return;
    const slot = [...starters, ...bench].find((sl) => sl.slot_id === slotId);
    if (!slot || slot.card) return;
    setSelSlot(slotId);
  }

  const canLock = sel?.kind === "manager" || (sel?.kind === "player" && !!selSlot);

  function lockPick() {
    if (!sel) return;
    if (sel.kind === "player" && selSlot) {
      const card = sel.card;
      setSquad((prev) => ({
        starters: prev.starters.map((sl) => (sl.slot_id === selSlot ? placeCard(sl, card) : sl)),
        bench: prev.bench.map((sl) => (sl.slot_id === selSlot ? placeCard(sl, card) : sl)),
      }));
      setDrafted((prev) => new Set(prev).add(card.player_id));
    } else if (sel.kind === "manager") {
      setManager(sel.card);
    }
    setSel(null);
    setSelSlot(null);
    setSpinIdx((i) => i + 1);
  }

  const selectedSlotMeta =
    sel?.kind === "player" && selSlot
      ? [...starters, ...bench].find((sl) => sl.slot_id === selSlot) ?? null
      : null;
  const selectedCompat =
    selectedSlotMeta && sel?.kind === "player"
      ? mockPositionCompatibility(sel.card.eligible_positions, selectedSlotMeta.slot_position)
      : null;

  return (
    <div className={s.draft}>
      {/* ── Spin reveal header ─────────────────────────────────────────── */}
      <header className={s.spinHead}>
        <div className={s.spinCounter}>
          <span className={s.spinCounterNum}>
            Spin {Math.min(spinNumber, TOTAL_SPINS)}
          </span>
          <span className={s.spinCounterTotal}>/ {TOTAL_SPINS}</span>
        </div>
        <div className={s.spinProgress} aria-hidden="true">
          <span
            className={s.spinProgressFill}
            style={{ width: `${(Math.min(spinNumber - 1, TOTAL_SPINS) / TOTAL_SPINS) * 100}%` }}
          />
        </div>
        <span className={s.demoBadge}>Preview · mock data</span>
      </header>

      <div className={s.draftGrid}>
        {/* ── LEFT: pitch + bench + synergy + lock ──────────────────────── */}
        <section className={s.draftLeft} aria-label="Your formation">
          <div className={s.panel}>
            <div className={s.panelHead}>
              <h2 className={s.panelTitle}>{FORMATION.name}</h2>
              <span className={s.panelMeta}>
                {placedStarters}/11 starters · {bench.filter((b) => b.card).length}/5 bench ·{" "}
                {manager ? "1" : "0"}/1 manager
              </span>
            </div>

            <Pitch
              starters={starters}
              interactive
              selectedSlotId={selSlot}
              lockedSlotIds={LOCKED_SLOT_IDS}
              previewCompat={previewCompat}
              onSlotSelect={selectSlot}
            />

            {/* Bench strip */}
            <div className={s.bench}>
              <span className={s.benchLabel}>Bench</span>
              <div className={s.benchSlots}>
                {bench.map((b) => {
                  const isSel = b.slot_id === selSlot;
                  const pc = previewCompat?.[b.slot_id];
                  const cls = [s.benchSlot];
                  if (b.card) cls.push(s.benchFilled);
                  if (isSel) cls.push(s.slotSelected);
                  return (
                    <button
                      key={b.slot_id}
                      type="button"
                      className={cls.join(" ")}
                      disabled={!!b.card || sel?.kind !== "player"}
                      onClick={() => selectSlot(b.slot_id)}
                      aria-pressed={isSel}
                    >
                      <span className={s.slotPos}>{b.slot_position}</span>
                      <span className={s.slotName}>
                        {b.card ? b.card.name : pc != null ? `${Math.round(pc * 100)}%` : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Manager slot */}
            <div className={s.mgrSlot}>
              <span className={s.benchLabel}>Manager</span>
              <span className={manager ? s.mgrFilled : s.mgrEmpty}>
                {manager ? `${manager.name} · ${manager.nation_name}` : "Open — pick a coach on any spin"}
              </span>
            </div>
          </div>

          <div className={s.panel}>
            <SynergyPanel result={previewSynergy} delta={sel ? synergyDelta : null} />
            {!hasKeeper && (
              <p className={s.gkWarn} role="status">
                <span className={s.gkWarnGlyph} aria-hidden="true">
                  !
                </span>
                {gkSlot?.card
                  ? "An outfielder is in goal — heavy goalkeeping penalty in the sim."
                  : "No specialist goalkeeper placed yet — your goal is exposed."}
              </p>
            )}
          </div>
        </section>

        {/* ── RIGHT: spin reveal + candidates ───────────────────────────── */}
        <section className={s.draftRight} aria-label="Candidates">
          {complete ? (
            <div className={`${s.panel} ${s.completePanel}`}>
              <span className={s.eyebrowAccent}>Draft demo complete</span>
              <h2 className={s.panelTitle}>That&rsquo;s the loop.</h2>
              <p className={s.completeNote}>
                In a full draft you&rsquo;d keep spinning through all {TOTAL_SPINS} picks. This
                scaffold walks a few real spins on mock data — committed picks lock the instant you
                confirm them, no rearranging.
              </p>
              <Link href="/play/review" className="btn btn--primary">
                Review your squad →
              </Link>
            </div>
          ) : (
            <>
              <div className={`${s.panel} ${s.revealPanel}`}>
                <span className={s.eyebrowAccent}>This spin rolled</span>
                <div className={s.revealTeam}>
                  <span className={s.revealNation}>{currentSquad!.nation_name}</span>
                  <span className={s.revealYear}>{currentSquad!.year}</span>
                </div>
                <p className={s.revealHint}>
                  Pick <b>one</b> entity from this squad — a player <i>or</i> the coach. Choose a
                  slot, watch Synergy update, then lock it in.
                </p>
              </div>

              {/* Controls */}
              <div className={s.controls}>
                <input
                  type="search"
                  className={s.searchInput}
                  placeholder="Search players…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search players"
                />
                <div className={s.filterRow}>
                  <div className={s.segmented} role="group" aria-label="Filter by position">
                    {POS_FILTERS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={posFilter === p ? s.segActive : s.seg}
                        aria-pressed={posFilter === p}
                        onClick={() => setPosFilter(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <label className={s.sortLabel}>
                    Sort
                    <select
                      className={s.sortSelect}
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value as SortKey)}
                    >
                      <option value="ovr">Rating</option>
                      <option value="name">Name</option>
                      <option value="pos">Position</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* Coach option */}
              {currentSquad!.coach && (
                <ManagerCandidate
                  coach={currentSquad!.coach}
                  selected={sel?.kind === "manager"}
                  disabled={manager !== null}
                  onSelect={() => selectManager(currentSquad!.coach!)}
                />
              )}

              {/* Player candidates */}
              <div className={s.candList}>
                {candidates.map((card) => (
                  <CandidateCard
                    key={card.card_id}
                    card={card}
                    selected={sel?.kind === "player" && sel.card.card_id === card.card_id}
                    disabled={drafted.has(card.player_id)}
                    onSelect={() => selectPlayer(card)}
                  />
                ))}
                {candidates.length === 0 && (
                  <p className={s.emptyList}>No players match those filters.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ── Sticky lock bar ───────────────────────────────────────────── */}
      {!complete && (
        <div className={s.lockBar}>
          <div className={s.lockInfo}>
            {sel?.kind === "player" && selectedSlotMeta && selectedCompat != null ? (
              <span>
                <b>{sel.card.name}</b> → <b>{selectedSlotMeta.slot_position}</b>
                <span className={`${s.compatPill} ${s[`tier_${compatTier(selectedCompat)}`]}`}>
                  {compatLabel(selectedCompat)} · {Math.round(selectedCompat * 100)}%
                </span>
              </span>
            ) : sel?.kind === "manager" ? (
              <span>
                <b>{sel.card.name}</b> → manager slot
              </span>
            ) : (
              <span className={s.lockHint}>Select a player and a slot, or pick the coach.</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canLock}
            onClick={lockPick}
          >
            Lock pick 🔒
          </button>
        </div>
      )}
    </div>
  );
}
