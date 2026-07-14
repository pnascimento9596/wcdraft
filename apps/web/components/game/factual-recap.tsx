import type { FactualRecapView } from "@/lib/game/results-adapters";

import s from "./game.module.css";

export interface FactualRecapProps {
  view: FactualRecapView;
  onOpenMatch?: (matchId: string) => void;
}

function eventHref(matchId: string, eventId: string): string {
  return `#event-${encodeURIComponent(matchId)}-${encodeURIComponent(eventId)}`;
}

/** Persisted match facts only; all display adaptation happens before render. */
export function FactualRecap({ view, onOpenMatch }: FactualRecapProps) {
  return (
    <section className={`${s.panel} ${s.factualRecap}`} aria-labelledby="factual-recap-title">
      <div className={s.panelHead}>
        <div>
          <span className={s.factualRecapKicker}>Persisted match facts</span>
          <h2 id="factual-recap-title" className={s.panelTitle}>
            Why it went this way
          </h2>
        </div>
        <span className={s.panelMeta}>Run-record facts · final match: {view.finalMatchLabel}</span>
      </div>

      <div className={s.factualRecapGrid}>
        <section className={s.factualRecapBlock} aria-labelledby="recap-strength-title">
          <h3 id="recap-strength-title" className={s.factualRecapHeading}>
            Final line strength
          </h3>
          {view.lineStrengths ? (
            <dl className={s.factualStrengthGrid}>
              <div>
                <dt>Attack</dt>
                <dd>{view.lineStrengths.attack}</dd>
              </div>
              <div>
                <dt>Midfield</dt>
                <dd>{view.lineStrengths.midfield}</dd>
              </div>
              <div>
                <dt>Defense</dt>
                <dd>{view.lineStrengths.defense}</dd>
              </div>
              <div>
                <dt>Goalkeeping</dt>
                <dd>{view.lineStrengths.goalkeeping}</dd>
              </div>
            </dl>
          ) : (
            <p className={s.factualEmpty}>—</p>
          )}
        </section>

        <section className={s.factualRecapBlock} aria-labelledby="recap-fit-title">
          <h3 id="recap-fit-title" className={s.factualRecapHeading}>
            Below-natural-fit starters
          </h3>
          {view.belowNaturalFit ? (
            <>
              <p className={s.factualMetric}>{view.belowNaturalFit.count}</p>
              {view.belowNaturalFit.starters.length > 0 ? (
                <ul className={s.factualList}>
                  {view.belowNaturalFit.starters.map((starter, index) => (
                    <li key={`${starter.name}-${starter.slot}-${index.toString()}`}>
                      <span>{starter.name}</span>
                      <span>
                        {starter.slot} · {starter.fit} fit
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className={s.factualEmpty}>— · not recorded for this arranged XI</p>
          )}
        </section>

        <section className={s.factualRecapBlock} aria-labelledby="recap-synergy-title">
          <h3 id="recap-synergy-title" className={s.factualRecapHeading}>
            Synergy
          </h3>
          {view.synergy ? (
            <>
              <p className={s.factualMetric}>{view.synergy.multiplier}</p>
              {view.synergy.nationLines.length > 0 ? (
                <ul className={s.factualList} aria-label="Shipped nation lines">
                  {view.synergy.nationLines.map((line, index) => (
                    <li key={`${line.nation}-${index.toString()}`}>
                      <span>{line.nation}</span>
                      <span>
                        {line.starters} starter{line.starters === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={s.factualEmpty}>Nation lines · —</p>
              )}
            </>
          ) : (
            <p className={s.factualEmpty}>—</p>
          )}
        </section>

        <section className={s.factualRecapBlock} aria-labelledby="recap-manager-title">
          <h3 id="recap-manager-title" className={s.factualRecapHeading}>
            Manager
          </h3>
          {view.manager ? (
            <dl className={s.factualDefinitionList}>
              <div>
                <dt>Presence</dt>
                <dd>{view.manager.presence}</dd>
              </div>
              <div>
                <dt>Nation link</dt>
                <dd>{view.manager.link}</dd>
              </div>
              <div>
                <dt>Tactical band</dt>
                <dd>{view.manager.tactical}</dd>
              </div>
            </dl>
          ) : (
            <p className={s.factualEmpty}>—</p>
          )}
        </section>
      </div>

      <section className={s.factualRecapDetail} aria-labelledby="recap-activation-title">
        <h3 id="recap-activation-title" className={s.factualRecapHeading}>
          Bench activations
        </h3>
        {view.activations.length === 0 ? (
          <p className={s.factualEmpty}>No activations</p>
        ) : (
          <ul className={s.factualEventList}>
            {view.activations.map((activation, index) => (
              <li key={`${activation.matchId}-${activation.eventId ?? index.toString()}`}>
                <span>
                  <b>{activation.incomingName}</b> for {activation.outgoingName}
                  <small>
                    {activation.matchLabel} · {activation.line} slot contribution{" "}
                    {activation.contributionDelta}
                  </small>
                </span>
                {activation.eventId ? (
                  <a
                    className={s.factualEventLink}
                    href={eventHref(activation.matchId, activation.eventId)}
                    onClick={() => onOpenMatch?.(activation.matchId)}
                  >
                    Event log
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.factualRecapDetail} aria-labelledby="recap-short-title">
        <h3 id="recap-short-title" className={s.factualRecapHeading}>
          Short-handed matches
        </h3>
        {view.shortHandedMatches.length === 0 ? (
          <p className={s.factualEmpty}>—</p>
        ) : (
          <ul className={s.factualEventList}>
            {view.shortHandedMatches.flatMap((match) =>
              match.entries.map((entry, index) => (
                <li key={`${match.matchId}-${entry.eventId ?? index.toString()}`}>
                  <span>
                    <b>{match.matchLabel}</b>
                    <small>
                      {entry.playerName} unavailable · {entry.line} unfilled
                    </small>
                  </span>
                  {entry.eventId ? (
                    <a
                      className={s.factualEventLink}
                      href={eventHref(match.matchId, entry.eventId)}
                      onClick={() => onOpenMatch?.(match.matchId)}
                    >
                      Event log
                    </a>
                  ) : null}
                </li>
              )),
            )}
          </ul>
        )}
      </section>
    </section>
  );
}
