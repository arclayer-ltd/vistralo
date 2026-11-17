import React from "react";
import type { Project } from "../contracts";
import { Icon } from "./Icon";
import { deletionText, projectDeletion, useRetention } from "../retention";

/**
 * When a project is deleted (3 months after it was made). Shows nothing while the deletion switch is off.
 * card: one short line under a card's subtitle, amber with a warning sign in the last 7 days.
 * caption: the date and the rule on a project page, under its title, until the last week.
 * notice: the project page's warning box, only in the last 7 days.
 */
export function DeletionNote({
  project,
  locale,
  variant,
}: {
  project: Pick<Project, "created" | "retainFrom">;
  locale?: string;
  variant: "card" | "caption" | "notice";
}) {
  const settings = useRetention();
  const notice = projectDeletion(project, settings);
  if (!notice) return null;
  const { label, detail } = deletionText(notice, locale);
  const when = <time dateTime={new Date(notice.at).toISOString()}>{label}</time>;
  if (variant === "notice") {
    if (!notice.soon) return null;
    return (
      <div className="deletion-notice" role="status">
        <Icon name="warning" size={16} />
        <p>
          <strong>{when}</strong> {detail}
        </p>
      </div>
    );
  }
  // In the last week the warning box says it; the caption would only repeat it.
  if (variant === "caption")
    return notice.soon ? null : (
      <p className="deletion-caption flow-caption">
        {when}
        <span> · {detail}</span>
      </p>
    );
  return (
    <p
      className={`card-deletion ${notice.soon ? "is-soon" : ""}`}
      title={detail}
    >
      {notice.soon && <Icon name="warning" size={14} />}
      {when}
      <span className="sr-only">. {detail}</span>
    </p>
  );
}
