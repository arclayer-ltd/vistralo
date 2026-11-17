import { useSyncExternalStore } from "react";
import {
  deletionNotice,
  RETENTION_MONTHS,
  type DeletionNotice,
  type RetentionSettings,
} from "../src/retention.cjs";
import type { Project } from "./contracts";

export { RETENTION_MONTHS, type DeletionNotice, type RetentionSettings };

// The retention switch as the workspace last read it. Null (the switch is off, or not installed yet) means no
// project shows a deletion date, because none is deleted.
let current: RetentionSettings | null = null;
const listeners = new Set<() => void>();

export function setRetention(next: RetentionSettings | null) {
  const same =
    current?.enabled === next?.enabled &&
    (current?.graceStart ?? null) === (next?.graceStart ?? null);
  current = next;
  if (!same) listeners.forEach((listener) => listener());
}
export function retention() {
  return current;
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function useRetention() {
  return useSyncExternalStore(subscribe, retention, retention);
}

export function projectDeletion(
  project: Pick<Project, "created" | "retainFrom">,
  settings: RetentionSettings | null,
  now = Date.now(),
): DeletionNotice | null {
  return deletionNotice(
    { created: project.created, retainFrom: project.retainFrom },
    settings,
    now,
  );
}

const DAY = 86400000;
const startOfDay = (time: number) => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};
export const deletionDate = (at: number, locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(at));

/**
 * What a card and a project page say. `label` is the short line; `detail` says why and what to do.
 * Within the last week the label counts the days, in the viewer's own calendar.
 */
export function deletionText(
  notice: DeletionNotice,
  locale?: string,
  now = Date.now(),
): { label: string; detail: string } {
  const date = deletionDate(notice.at, locale);
  const rule = `Projects are deleted ${RETENTION_MONTHS} months after they are made.`;
  if (notice.due)
    return {
      label: "Being deleted",
      detail: `${rule} This one reached its date and is removed within the hour.`,
    };
  if (!notice.soon) return { label: `Deleted on ${date}`, detail: `${rule} Download anything you want to keep before then.` };
  const days = Math.round((startOfDay(notice.at) - startOfDay(now)) / DAY);
  const label =
    days <= 0
      ? "Deleted today"
      : days === 1
        ? "Deleted tomorrow"
        : `Deleted in ${days} days`;
  return {
    label,
    detail: `Deleted on ${date}. ${rule} Download anything you want to keep now.`,
  };
}
