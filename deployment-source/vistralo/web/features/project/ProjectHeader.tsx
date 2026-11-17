import { StatusBadge } from "../../components/ProjectCard";
import { projectTitle, statusHint, typeText } from "../../utils";
import React, { useEffect, useRef, useState } from "react";
import type { Project } from "../../contracts";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Controls";
import { DeletionNote } from "../../components/DeletionNote";
import { Menu, ToolButton, type MenuAction } from "../../components/Primitives";
import { formatDuration } from "../flow-utils";

/**
 * The project's name as its page title, renamed in place: Rename (or a click on the name) turns
 * it into a field, Enter or leaving the field saves, Escape puts the old name back.
 */
export function EditableTitle({
  project,
  onRename,
  editing,
  setEditing,
}: {
  project: Project;
  onRename?: (name: string) => Promise<void>;
  editing: boolean;
  setEditing: (editing: boolean) => void;
}) {
  const [value, setValue] = useState(project.name);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setValue(project.name);
    else requestAnimationFrame(() => field.current?.select());
  }, [editing, project.name]);
  async function commit() {
    const name = value.replace(/\s+/g, " ").trim().slice(0, 120);
    setEditing(false);
    if (name && name !== project.name) await onRename?.(name);
  }
  if (editing && onRename)
    return (
      <input
        ref={field}
        className="title-field"
        aria-label="Project name"
        value={value}
        maxLength={120}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setValue(project.name);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <h1 className="editable-title">
      {onRename ? (
        <button
          type="button"
          className="title-button"
          aria-description="Rename"
          title="Rename"
          onClick={() => setEditing(true)}
        >
          {projectTitle(project)}
          <Icon name="edit" size={16} />
        </button>
      ) : (
        projectTitle(project)
      )}
    </h1>
  );
}

/**
 * The top of a project page, kept short so the video sits high: where you are, the name (renamed
 * in place), what it is, and its actions. Share is the one primary action; the rest sit beside
 * it as plain buttons and a More menu.
 */
export function ProjectHeader({
  project,
  voiceText,
  canDownload,
  kitStage,
  active,
  back,
  downloadKit,
  onShare,
  canAi,
  onAddAi,
  onRename,
  more,
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
  canAi?: boolean;
  onAddAi?: () => void;
  onRename?: (name: string) => Promise<void>;
  /** Everything else, in the More menu. */
  more?: MenuAction[];
}) {
  const [editing, setEditing] = useState(false),
    [menu, setMenu] = useState(false);
  const items: MenuAction[] = [
    ...(onRename ? [{ label: "Rename", icon: "edit", onClick: () => setEditing(true) }] : []),
    ...(more || []),
  ];
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
          <EditableTitle project={project} onRename={onRename} editing={editing} setEditing={setEditing} />
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
        {canAi && onAddAi && (
          <Button icon="sparkle" disabled={active} onClick={onAddAi}>
            {project.data.narratedVideo ? "Redo AI walkthrough" : "Add AI walkthrough"}
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
            <Icon name="download" />
            {kitStage ? `${kitStage}…` : "Download"}
          </button>
        )}
        {items.length > 0 && (
          <div className="menu-anchor">
            <ToolButton
              icon="more"
              label="More actions"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            />
            {menu && <Menu items={items} onClose={() => setMenu(false)} />}
          </div>
        )}
      </div>
    </header>
  );
}

/** A one-line strip with what the status means and what moves the project on. */
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
