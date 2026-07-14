import type { ReactNode } from "react";

import s from "./game.module.css";

export interface FactualEventTargetProps {
  matchId: string;
  eventId: string;
  children: ReactNode;
}

export function factualEventTargetId(matchId: string, eventId: string): string {
  return `event-${encodeURIComponent(matchId)}-${encodeURIComponent(eventId)}`;
}

export function factualEventHref(matchId: string, eventId: string): string {
  return `#${factualEventTargetId(matchId, eventId)}`;
}

export function focusFactualEventTarget(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLElement) || target.closest("[hidden]") !== null) {
    return false;
  }
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

export function FactualEventTarget({ matchId, eventId, children }: FactualEventTargetProps) {
  return (
    <span id={factualEventTargetId(matchId, eventId)} className={s.boxEvent} tabIndex={-1}>
      {children}
    </span>
  );
}
