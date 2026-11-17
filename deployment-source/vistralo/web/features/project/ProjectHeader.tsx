import { StatusBadge } from "../../components/ProjectCard";
import { projectTitle, statusHint, typeText } from "../../utils";
import React from "react";
import type { Project } from "../../contracts";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Controls";
import { DeletionNote } from "../../components/DeletionNote";
import { formatDuration } from "../flow-utils";

export function ProjectHeader({
  project,
  voiceText,
  canDownload,
  kitStage,
  active,
  back,
  downloadKit,
  onShare,
}: {
  project: Project;
  voiceText: string;
  canDownload: boolean;
  kitStage: string;
  active: boolean;
  back: () => void;
  downloadKit: () => Promise<void>;
  /** Present when there is something a link could show. */
  onShare?: () => void;
}) {
  return (
    <header className="flow-detail-heading">
      <div className="flow-stack">
        <nav className="flow-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <button className="button button-ghost" onClick={back}>
                Projects
              </button>
            </li>
            <li aria-current="page">
              <Icon name="chevronRight" size={16} />
              <span>{projectTitle(project)}</span>
            </li>
          </ol>
        </nav>
        <div className="flow-title-row">
          <h1>{projectTitle(project)}</h1>
          <StatusBadge project={project} />
        </div>
        <p className="flow-caption flow-muted edge">
          {typeText(project)}
          {project.source === "web" ? ` · ${project.sourceLabel || project.url || ""}` : ""}
          {project.duration ? ` · ${formatDuration(project.duration)}` : ""}
          {voiceText ? ` · ${voiceText}` : ""}
        </p>
        <DeletionNote project={project} variant="caption" />
      </div>
      <div className="flow-actions">
        {onShare && (
          <Button variant="primary" icon="link" onClick={onShare}>
            Share
          </Button>
        )}
        {canDownload && (
          <button
            type="button"
            className="button"
            disabled={!!kitStage || active}
            aria-live="polite"
            title="One ZIP for a coding agent: a compact prompt, the narrated video, captions and a still of each section"
            onClick={() => void downloadKit()}
          >
            {kitStage ? `${kitStage}…` : "Download files"}
          </button>
        )}
      </div>
    </header>
  );
}

export function NextStep({
  project,
  canAi,
  processing,
  onAddAi,
}: {
  project: Project;
  /** An AI walkthrough can be added to this project now. */
  canAi: boolean;
  processing: boolean;
  onAddAi: () => void;
}) {
  return (
    <div className="flow-next" role="status">
      <Icon
        name={project.status === "ready" ? "checkCircle" : "info"}
        size={16}
      />
      <span>{statusHint(project)}</span>
      {canAi && (
        <button
          className={`button ${project.data.narratedVideo ? "" : "button-primary"}`}
          disabled={processing}
          onClick={onAddAi}
        >
          <Icon name="sparkle" />
          {project.data.narratedVideo ? "Redo AI walkthrough" : "Add AI walkthrough"}
        </button>
      )}
    </div>
  );
}
