import Link from "next/link";

import s from "./game.module.css";

export const DAILY_UNAVAILABLE_TITLE = "Today's Daily is temporarily unavailable" as const;

export function DailyUnavailableNotice() {
  return (
    <div className={s.dailyUnavailable} role="status">
      <div className={s.dailyUnavailableCopy}>
        <h2 className={s.dailyUnavailableTitle}>{DAILY_UNAVAILABLE_TITLE}</h2>
        <p className={s.dailyUnavailableMessage}>Classic is ready whenever you are.</p>
      </div>
      <Link className="btn btn--primary" href="/play/draft">
        Play Classic instead
      </Link>
    </div>
  );
}
