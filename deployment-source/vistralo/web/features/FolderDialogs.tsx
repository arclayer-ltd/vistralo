import React, { useId, useState } from "react";
import type { Project } from "../contracts";
import { Dialog } from "../components/Primitives";
import { FOLDER_NAME_LIMIT, folderName, type Folder } from "./folders";

const NONE = "";
const NEW = "\u0000new";

/** Files projects in an existing folder, a new one, or no folder. */
export function MoveDialog({
  projects,
  folders,
  onClose,
  onMove,
}: {
  projects: Project[];
  folders: Folder[];
  onClose: () => void;
  onMove: (folder: string) => Promise<void>;
}) {
  const current = projects.every((p) => (p.folder || "") === (projects[0].folder || ""))
    ? projects[0].folder || NONE
    : null;
  const [choice, setChoice] = useState<string>(current ?? (folders[0]?.name || NEW));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  const count = projects.length === 1 ? `“${projects[0].name}”` : `${projects.length} projects`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const target = choice === NEW ? folderName(name) : choice;
      if (choice === NEW && !target) throw new Error("Name the new folder.");
      setBusy(true);
      await onMove(target);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Move to folder"
      description={`Choose where ${count} should go.`}
      icon="folder"
      size="compact"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            form={formId}
            className="button button-primary"
            disabled={busy || (choice === NEW && !name.trim()) || choice === current}
          >
            {busy ? "Moving…" : "Move"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="folder-form">
        <fieldset className="folder-choices">
          <legend className="sr-only">Folder</legend>
          {folders.map((folder) => (
            <label key={folder.name} className="folder-choice">
              <input
                type="radio"
                name="folder"
                value={folder.name}
                checked={choice === folder.name}
                onChange={() => setChoice(folder.name)}
              />
              <span>{folder.name}</span>
              <small>{folder.count}</small>
            </label>
          ))}
          <label className="folder-choice">
            <input
              type="radio"
              name="folder"
              value={NEW}
              checked={choice === NEW}
              onChange={() => setChoice(NEW)}
            />
            <span>New folder</span>
          </label>
          {choice === NEW && (
            <label className="field">
              <span className="sr-only">New folder name</span>
              <input
                autoFocus
                maxLength={FOLDER_NAME_LIMIT}
                value={name}
                placeholder="Folder name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label className="folder-choice">
            <input
              type="radio"
              name="folder"
              value={NONE}
              checked={choice === NONE}
              onChange={() => setChoice(NONE)}
            />
            <span>No folder</span>
          </label>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
