# merit-v3.1 88-Wall Design Verdict

Date: 2026-06-12
Branch: `merit-v3.1` on current merge base `origin/main` `12dd2b934760a2deac8670b195b932ef4f2638a2`
Tier: Red design gate before any W3 implementation

## Scope

This document answers W3 from the merit-v3.1 dispatch: can the shipped
merit-v3 no-award historical point mass be spread with deterministic public
facts while preserving the no-award ceiling invariant and the standing §7
distribution/control gates?

The implementation decision is **STOP W3**. A no-award soft-cap spread is
technically possible, but the pre-registered W3 gate is stronger than the
88-wall problem: "pile-up <=4% at any display value" is incompatible with the
still-standing median/control contract on the integer 66-99 display scale. Any
code change that claims to pass W3 without waiving one of those constraints is
silently changing the design problem.

## Current Mechanism

The shipped merit-v3 wall has two independent parts:

- The high-band 88 wall: 1,150 historical no-award cards sit at internal
  exactly `62.0` because `_raw_only_score(...)` clamps no-award raw tournament
  scores at `RAW_ONLY_GLOBAL_CEILING = 0.62`. The no-award ceiling is the
  invariant: those cards must not enter award-gated headroom.
- The low-band piles: the pooled display curve maps the lower half of the pool
  into a small integer band around 66-73 so the median remains 73 +/- 1. The
  shipped V4 gate measured 71 at about 17.8% and 72 at about 15.3%.

The first part is fixable in principle. For example, no-award rows above the
ceiling could be mapped monotonically to a deterministic value just below
`0.62` using already-staged factual differentiators like appearance percentile,
team finish, and raw tournament percentile:

```text
no_award_soft_cap(raw, participation, finish)
  = ceiling - spread * monotone_gap(raw, participation, finish)
```

That would preserve `score <= 0.62` and therefore preserve the no-award
headroom invariant. It would spread the 88 point mass across several display
values below 88.

The second part is the blocker. The W3 acceptance gate is not "88 share <=4%";
it is "pile-up <=4% at any display value." Under the still-standing merit-v3
anti-inflation gate, the pooled median must remain 73 +/- 1. With 12,219
ratings, at least 6,110 ratings must be at or below the median. If the median is
kept at 73, those ratings occupy only the eight integer display values 66-73.
By pigeonhole:

```text
6110 / 8 / 12219 = 6.25%
```

So some display value must exceed 4%, even if the 88 wall is perfectly
dispersed. This proof does not depend on the exact curve shape or on which
public differentiator is chosen for the no-award soft cap.

## Tradeoffs Considered

1. **No-award soft cap below 88.**
   This is feasible and production-safe if the only target is the high-band
   wall. It preserves the no-award ceiling because no no-award row exceeds
   `0.62`. It does not satisfy W3's "any display value <=4%" gate because the
   low-band median piles remain.

2. **Curve refit to use more display integers below the median.**
   This can reduce 71/72 pile-ups only by moving a large share of the lower half
   above the current median band or by changing the median target itself. That
   breaks the standing anti-inflation gate and risks the original controls,
   especially the baseline-anchor cohort.

3. **Widen the emitted display scale or use decimal displays.**
   This would solve the pigeonhole problem mechanically, but it changes product
   semantics and runtime/UI contracts, not just rating mechanics. It is outside
   W3 and would require a separate product design.

## Verdict

W3 implementation is stopped for merit-v3.1 unless the owner explicitly changes
the gate. The compatible narrow gate would be:

```text
88 display share <=4% for no-award historical cards,
with no no-award row exceeding RAW_ONLY_GLOBAL_CEILING,
median 73 +/- 1 preserved, controls unchanged.
```

The dispatch did not request that weaker gate; it requested <=4% at any display
value. Therefore this season should carry W1, W2, W2b, W4, and report W3 as a
design-level incompatibility rather than implementing a partial spread and
calling it a pass.
