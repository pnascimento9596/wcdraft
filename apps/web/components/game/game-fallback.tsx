import { DraftAppBar } from "./draft-screen/app-bar";
import s from "./game.module.css";

export function GameFallback({
  title = "Loading wcdraft",
  message = "Fetching and parsing the real 1930-2026 draft pool before the screen opens.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className={s.draftShell} aria-busy="true">
      <DraftAppBar spinNumber={null} progressPct={0} />
      <section
        className={`${s.formationSelect} ${s.setupSkeleton}`}
        role="status"
        aria-live="polite"
      >
        <div className={s.formationHead}>
          <h1 className={s.formationTitle}>{title}</h1>
          <p className={s.formationSub}>{message}</p>
        </div>
        <div className={s.setupSkeletonPanel} aria-hidden="true">
          <span className={s.setupSkeletonLine} />
          <div className={s.setupSkeletonSeg}>
            <span />
            <span />
            <span />
          </div>
          <span className={s.setupSkeletonLine} />
        </div>
        <div className={s.setupSkeletonGrid} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={s.setupSkeletonTile}>
              <span className={s.setupSkeletonPitch} />
              <span className={s.setupSkeletonLine} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
