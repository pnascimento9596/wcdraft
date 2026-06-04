"""Link parsed RSSSF starting-XI surnames to canonical player cards.

For each pre-1970 men's tournament this:

  1. parses the committed RSSSF snapshot into starting XIs (``rsssf`` module);
  2. GATES on completeness — the recovered match count must equal
     KNOWN_MATCH_COUNT, else the whole tournament is withheld (never half-sourced);
  3. assigns each RSSSF 3-letter team code to a canonical nation_id by surname
     overlap with that tournament's squads (self-validating; no hand-kept map),
     requiring a dominant, unambiguous best match;
  4. links each lineup surname to exactly one canonical card within that nation's
     squad — by family name, disambiguating same-surname squad-mates by the
     RSSSF initial. Anything that is not a unique link (no canonical match,
     a surname collision an initial can't split, an unrecognised squad) is NOT
     guessed: it is withheld and emitted to the review list.

Output is deterministic (sorted) and a pure function of the committed snapshots +
canonical tables. ``appearances`` is the count of distinct matches whose XI links
to the card; a squad player never found in a lineup is left null (we assert no
record, rather than a possibly-incomplete 0).
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import (
    KNOWN_MATCH_COUNT,
    RSSSF_ATTRIBUTION,
    RSSSF_BASE_URL,
    RSSSF_LICENSE,
    RSSSF_SOURCE_NAME,
    RSSSF_TOURNAMENTS,
    SOURCE_TAG,
)
from .rsssf import Lineup, PlayerToken, _norm, load_lineups

# Nation-assignment thresholds. The correct nation's squad contains essentially
# all of a team's lineup surnames (overlap ~1.0) while every other nation is near
# 0, so a dominant best match is required: enough absolute overlap AND a clear
# margin over the runner-up. A team that romanizes beyond recognition (e.g. some
# 1954/1966 squads) fails this and is sent to review rather than mis-assigned.
_MIN_OVERLAP = 0.5
_MIN_MARGIN = 0.10


def _squads_by_nation(cards: list[dict], tournament_id: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for c in cards:
        if c["tournament_id"] == tournament_id:
            out[c["nation_id"]].append(c)
    return out


def _assign_nation(
    team_surnames: set[str], nation_fams: dict[str, set[str]]
) -> tuple[str | None, float, float]:
    """Best nation_id for an RSSSF team block by surname overlap, with the best
    and runner-up overlaps for the dominance check."""
    ranked = sorted(
        (
            (len(team_surnames & fams) / max(1, len(team_surnames)), nid)
            for nid, fams in nation_fams.items()
        ),
        reverse=True,
    )
    if not ranked:
        return None, 0.0, 0.0
    best_ov, best_nid = ranked[0]
    second_ov = ranked[1][0] if len(ranked) > 1 else 0.0
    if best_ov < _MIN_OVERLAP or (best_ov - second_ov) < _MIN_MARGIN:
        return None, round(best_ov, 4), round(second_ov, 4)
    return best_nid, round(best_ov, 4), round(second_ov, 4)


def _resolve(
    token: PlayerToken, fam_to_cards: dict[str, list[dict]], given_initial: dict[str, str]
) -> tuple[dict | None, str]:
    """Resolve one surname token to one card, or return why it cannot be.

    Returns (card, method) on a unique link, else (None, reason)."""
    cands = fam_to_cards.get(token.key, [])
    if len(cands) == 1:
        return cands[0], "surname"
    if len(cands) == 0:
        return None, "no_canonical_match"
    # Same surname appears for >1 squad-mate: split strictly by the RSSSF initial
    # against each candidate's canonical given-name initial. RSSSF uses formal
    # initials (Robert "Bobby" Charlton -> "R"), so a non-unique split is left to
    # human review rather than guessed.
    if token.initial is not None:
        matched = [c for c in cands if given_initial.get(c["card_id"]) == token.initial.lower()]
        if len(matched) == 1:
            return matched[0], "surname+initial"
        return None, "ambiguous_collision"
    return None, "ambiguous_no_initial"


def _demerge(
    token: PlayerToken, fam_to_cards: dict[str, list[dict]], given_initial: dict[str, str]
) -> list[dict] | None:
    """Repair a wrap-merged token ("Murray Mudie" = two players whose separating
    comma the source dropped at a line break) by splitting its raw surname.

    SAFE — never a guess: a split is accepted only if BOTH halves each resolve to
    exactly one DISTINCT canonical squad card. If either half is unknown (e.g. the
    token is really one unlinkable name like "Arico Suárez"), no split is made and
    the whole token is left to review. Called ONLY for blocks short of 11 players,
    so a genuine multi-word surname in a complete XI is never split.
    """
    parts = token.raw.split()
    if len(parts) < 2:
        return None
    for k in range(1, len(parts)):
        left = PlayerToken(key=_norm(" ".join(parts[:k])), initial=None, raw=" ".join(parts[:k]))
        right = PlayerToken(key=_norm(" ".join(parts[k:])), initial=None, raw=" ".join(parts[k:]))
        lc, _ = _resolve(left, fam_to_cards, given_initial)
        rc, _ = _resolve(right, fam_to_cards, given_initial)
        if lc is not None and rc is not None and lc["card_id"] != rc["card_id"]:
            return [lc, rc]
    return None


def _record_review(acc: dict[tuple, dict], key: tuple, base: dict) -> None:
    """Accumulate a withheld case as one compact row per distinct unresolved name,
    counting ``lineup_occurrences`` — how many starting-XI lineups the raw token
    appeared in. (This is an occurrence count of an UNLINKED token, deliberately
    NOT a validated appearance total — the name was not linked to a player.)"""
    row = acc.setdefault(key, {**base, "lineup_occurrences": 0})
    row["lineup_occurrences"] += 1


def build_supplement(
    players: list[dict], cards: list[dict], tournaments: list[dict]
) -> dict:
    """Build the web-sourced appearance overlay + review list + coverage report.

    Returns a dict with ``sourced`` (linked appearance records), ``review``
    (unlinkable cases, aggregated per distinct name), and ``report`` (per-
    tournament link/coverage stats). Pure + deterministic.
    """
    player_by_id = {p["player_id"]: p for p in players}
    nation_of_card = {c["card_id"]: c["nation_id"] for c in cards}
    mens = {t["tournament_id"] for t in tournaments if "Men's" in t["name"]}

    sourced: list[dict] = []
    review: list[dict] = []
    report_tournaments: list[dict] = []

    for tournament_id, raw_file in RSSSF_TOURNAMENTS.items():
        if tournament_id not in mens:  # defensive; all 8 are men's
            continue
        source_url = f"{RSSSF_BASE_URL}{raw_file}"
        lineups = load_lineups(raw_file)
        matches_parsed = len(lineups) // 2
        known = KNOWN_MATCH_COUNT[tournament_id]
        complete = len(lineups) == 2 * known

        squads = _squads_by_nation(cards, tournament_id)
        nation_fams = {
            nid: {_norm(player_by_id[c["player_id"]]["family_name"]) for c in rows}
            for nid, rows in squads.items()
        }

        by_code: dict[str, list[Lineup]] = defaultdict(list)
        for lu in lineups:
            by_code[lu.team_code].append(lu)

        teams_resolved = 0
        teams_unresolved: list[str] = []
        linked_appearances: dict[str, int] = defaultdict(int)
        link_method: dict[str, str] = {}
        # review accumulator keyed by (reason, code/nation, surname, initial)
        review_acc: dict[tuple, dict] = {}

        if not complete:
            # Withhold the whole tournament — an incomplete parse must never be
            # silently sourced. Recorded in the report for the reviewer.
            report_tournaments.append(
                {
                    "tournament_id": tournament_id,
                    "source_url": source_url,
                    "complete": False,
                    "matches_parsed": matches_parsed,
                    "matches_known": known,
                    "note": "withheld: parsed match count != known; not sourced",
                }
            )
            continue

        for code, code_lineups in sorted(by_code.items()):
            team_surnames = {tok.key for lu in code_lineups for tok in lu.players}
            nid, best_ov, second_ov = _assign_nation(team_surnames, nation_fams)
            if nid is None:
                teams_unresolved.append(code)
                # Iterate in deterministic document order (NOT a set — set order is
                # hash-seed-dependent and would make rsssf_surname / lineup_occurrences
                # vary between runs, breaking the golden git-diff). lineup_occurrences
                # then counts lineup appearances of the unlinked token, and the
                # representative spelling is the first in document order — both reproducible.
                for lu in code_lineups:
                    for tok in lu.players:
                        _record_review(
                            review_acc,
                            ("nation_unresolved", code, tok.key, tok.initial),
                            {
                                "reason": "nation_unresolved",
                                "tournament_id": tournament_id,
                                "rsssf_team_code": code,
                                "nation_id": None,
                                "rsssf_surname": tok.raw,
                                "rsssf_initial": tok.initial,
                                "best_overlap": best_ov,
                                "runner_up_overlap": second_ov,
                                "candidates": [],
                                "source_url": source_url,
                            },
                        )
                continue
            teams_resolved += 1
            fam_to_cards: dict[str, list[dict]] = defaultdict(list)
            for c in squads[nid]:
                fam_to_cards[_norm(player_by_id[c["player_id"]]["family_name"])].append(c)
            given_initial = {
                c["card_id"]: _norm(player_by_id[c["player_id"]]["given_name"] or "")[:1]
                for c in squads[nid]
            }

            for lu in code_lineups:
                seen_this_match: set[str] = set()
                # A complete starting XI is 11 names (12 with an annotated keeper
                # swap that dedupes to 11). A block short of 11 means the wrap
                # dropped a comma and merged two players; only then do we attempt
                # the canonical-verified de-merge, so genuine multi-word surnames
                # in complete XIs are left whole.
                short_block = len(lu.players) < 11
                for tok in lu.players:
                    card, outcome = _resolve(tok, fam_to_cards, given_initial)
                    resolved = [(card, outcome)] if card is not None else []
                    if not resolved and short_block and " " in tok.raw:
                        demerged = _demerge(tok, fam_to_cards, given_initial)
                        if demerged:
                            resolved = [(c, "demerged") for c in demerged]
                    if resolved:
                        for rcard, routcome in resolved:
                            cid = rcard["card_id"]
                            if cid not in seen_this_match:  # dedupe in-match keeper swap
                                linked_appearances[cid] += 1
                                seen_this_match.add(cid)
                                link_method[cid] = routcome
                        continue
                    cand_ids = [c["card_id"] for c in fam_to_cards.get(tok.key, [])]
                    _record_review(
                        review_acc,
                        (outcome, nid, tok.key, tok.initial),
                        {
                            "reason": outcome,
                            "tournament_id": tournament_id,
                            "rsssf_team_code": code,
                            "nation_id": nid,
                            "rsssf_surname": tok.raw,
                            "rsssf_initial": tok.initial,
                            "candidates": sorted(cand_ids),
                            "source_url": source_url,
                        },
                    )

        for cid, apps in sorted(linked_appearances.items()):
            pid, tid = cid.split(":", 1)
            sourced.append(
                {
                    "card_id": cid,
                    "player_id": pid,
                    "nation_id": nation_of_card[cid],
                    "tournament_id": tid,
                    "appearances": apps,
                    "appearances_source": SOURCE_TAG,
                    "method": link_method[cid],
                    "source_url": source_url,
                }
            )

        review.extend(review_acc.values())
        squad_total = sum(len(rows) for rows in squads.values())
        report_tournaments.append(
            {
                "tournament_id": tournament_id,
                "source_url": source_url,
                "complete": True,
                "matches_parsed": matches_parsed,
                "matches_known": known,
                "teams_total": len(by_code),
                "teams_resolved": teams_resolved,
                "teams_unresolved": sorted(teams_unresolved),
                "squad_cards": squad_total,
                "cards_sourced": len(linked_appearances),
                "cards_unsourced": squad_total - len(linked_appearances),
                "review_items": len(review_acc),
            }
        )

    sourced.sort(key=lambda r: r["card_id"])
    review.sort(
        key=lambda r: (
            r["tournament_id"],
            r["reason"],
            r.get("nation_id") or r.get("rsssf_team_code") or "",
            r["rsssf_surname"],
            r.get("rsssf_initial") or "",
        )
    )
    return {
        "sourced": sourced,
        "review": review,
        "report": {"tournaments": report_tournaments},
    }


def apply_overlay(cards: list[dict], sourced: list[dict]) -> int:
    """Overlay sourced appearances onto cards in place; return count overlaid.

    Only genuine gaps are filled (the target card's native appearances must be
    null — sourcing never overwrites a Fjelstul-measured value). Every card also
    gets an explicit ``appearances_source`` provenance tag so a value's origin is
    never ambiguous: Fjelstul match events, RSSSF starting XIs, or unavailable.
    """
    from ..cards import coverage_score

    sourced_by_id = {s["card_id"]: s for s in sourced}
    overlaid = 0
    for c in cards:
        s = sourced_by_id.get(c["card_id"])
        if s is not None:
            if c["appearances"] is not None:
                raise ValueError(
                    f"refusing to overwrite native appearances on {c['card_id']}"
                )
            c["appearances"] = s["appearances"]
            c["appearances_source"] = SOURCE_TAG
            # appearances are now present -> recompute the card's coverage so the
            # honest-state flag reflects the newly-sourced signal.
            c["coverage"] = coverage_score(True, c["shirt"])
            overlaid += 1
        elif c["appearances"] is not None:
            c["appearances_source"] = "fjelstul_match_events"
        else:
            c["appearances_source"] = None
    return overlaid


_REASON_BLURB = {
    "no_canonical_match": "RSSSF surname not found in the linked squad (usually a "
    "transliteration / nickname variant) — left null, not guessed",
    "nation_unresolved": "RSSSF team's surnames did not overlap any squad enough to "
    "assign a nation (heavily romanized squad) — whole team withheld",
    "ambiguous_collision": "two squad-mates share the surname and the RSSSF initial "
    "did not uniquely pick one — left null, not guessed",
    "ambiguous_no_initial": "two squad-mates share the surname and RSSSF gave no "
    "initial to split them — left null, not guessed",
}


def render_report(supp: dict) -> str:
    """Human-readable SUPPLEMENT.md: attribution, per-tournament link/coverage,
    and the review breakdown — so the sourcing is auditable at a glance."""
    sourced = supp["sourced"]
    review = supp["review"]
    tours = supp["report"]["tournaments"]
    total_apps = sum(s["appearances"] for s in sourced)
    lines: list[str] = []
    lines.append("# WS-A supplement — sourced pre-1970 World Cup appearances\n")
    lines.append(f"> {RSSSF_ATTRIBUTION}\n")
    lines.append(
        f"- **Source:** {RSSSF_SOURCE_NAME} — {RSSSF_LICENSE}\n"
        f"- **Sourced field:** `player_tournaments.appearances` (pre-1970), "
        f"`appearances_source = \"{SOURCE_TAG}\"`\n"
        f"- **Cards sourced:** {len(sourced):,} ({total_apps:,} total appearances)\n"
        f"- **Review items (withheld, not guessed):** {len(review):,}\n"
    )
    lines.append("\n## Per-tournament\n")
    lines.append(
        "| Tournament | Matches (parsed/known) | Teams linked | Cards sourced | "
        "Review |\n|---|---|---|---|---|"
    )
    for t in tours:
        if not t.get("complete", False):
            lines.append(
                f"| {t['tournament_id']} | {t['matches_parsed']}/{t['matches_known']} "
                f"| WITHHELD (incomplete) | — | — |"
            )
            continue
        unresolved = (
            f" (unresolved: {', '.join(t['teams_unresolved'])})" if t["teams_unresolved"] else ""
        )
        lines.append(
            f"| {t['tournament_id']} | {t['matches_parsed']}/{t['matches_known']} | "
            f"{t['teams_resolved']}/{t['teams_total']}{unresolved}"
            f" | {t['cards_sourced']}/{t['squad_cards']} | {t['review_items']} |"
        )
    lines.append("\n## Review breakdown (these stay `null` — never invented)\n")
    by_reason = Counter(r["reason"] for r in review)
    for reason, n in sorted(by_reason.items()):
        lines.append(f"- **{reason}** ({n}): {_REASON_BLURB.get(reason, '')}")
    lines.append(
        "\nEach review row in `link_review.json` carries the tournament, RSSSF team "
        "code, the raw surname/initial, and any canonical candidate ids, so a human "
        "can resolve it without re-deriving the link.\n"
    )
    return "\n".join(lines) + "\n"
