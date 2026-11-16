import React from "react";
import { counted } from "./projectActions";
import type { Project, WorkspaceAdapter } from "../contracts";
import { Dialog, TextDialog } from "../components/Primitives";
import { MoveDialog } from "../features/FolderDialogs";
import { folderName, type Folder } from "../features/folders";
import type { ProjectEdit, Run } from "./projectActions";
/** Files projects in a folder (or none). A folder is a name on its projects, so it moves with them. */
export async function moveToFolder(adapter: WorkspaceAdapter, projects: Project[], target: string) {
  const name = folderName(target);
  for (const p of projects) if ((p.folder || "") !== name) await adapter.update(p.id, { folder: name });
}

export function EditProjectsDialog({
  edit,
  adapter,
  notify,
  refresh,
  onClose,
  folders,
  folder,
  go,
}: {
  edit: ProjectEdit;
  adapter: WorkspaceAdapter;
  notify: (s: string, error?: boolean) => void;
  refresh: () => Promise<Project[]>;
  onClose: () => void;
  folders: Folder[];
  /** The folder being renamed, for edit.kind "folder". */
  folder: string;
  go: (to: string) => void;
}) {
  if (edit.kind === "move")
    return (
      <MoveDialog
        projects={edit.projects}
        folders={folders}
        onClose={onClose}
        onMove={async (target) => {
          await moveToFolder(adapter, edit.projects, target);
          notify(
            target
              ? `${counted(edit.projects.length)} moved to “${folderName(target)}”`
              : `${counted(edit.projects.length)} taken out of the folder`,
          );
          await refresh();
        }}
      />
    );
  if (edit.kind === "folder")
    return (
      <TextDialog
        title="Rename folder"
        icon="folder"
        label="Folder name"
        initial={folder}
        submitLabel="Rename"
        onClose={onClose}
        onSubmit={async (value) => {
          const name = folderName(value);
          if (name === folder) return;
          await moveToFolder(adapter, edit.projects, name);
          notify(`Folder renamed to “${name}”`);
          await refresh();
          go("folder/" + encodeURIComponent(name));
        }}
      />
    );
  return (
    <TextDialog
      title="Rename project"
      icon="edit"
      label="Project name"
      initial={edit.projects[0].name}
      onClose={onClose}
      onSubmit={async (value) => {
        await adapter.update(edit.projects[0].id, { name: value });
        notify("Project renamed");
        await refresh();
      }}
    />
  );
}
export function DeleteProjectsDialog({
  deleting,
  adapter,
  run,
  onClose,
}: {
  deleting: string[];
  adapter: WorkspaceAdapter;
  run: Run;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Permanently delete projects?"
      description={`This permanently deletes ${deleting.length} trashed ${deleting.length === 1 ? "project" : "projects"} and their files. This cannot be undone.`}
      icon="trash"
      tone="danger"
      size="compact"
      className="sheet-alert"
      closable={false}
      onClose={onClose}
      footer={
        <>
          <button
            className="button"
            data-autofocus
            onClick={() => onClose()}
          >
            Cancel
          </button>
          <button
            className="button button-danger-solid"
            onClick={() =>
              run(async () => {
                await adapter.remove(deleting);
                onClose();
              }, `${counted(deleting.length)} permanently deleted`)
            }
          >
            Delete permanently
          </button>
        </>
      }
    />
  );
}
