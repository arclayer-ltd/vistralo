import type { Project } from "../contracts";

/** Folders are a name on each project (`project.folder`); a folder exists while a project is in it. */
export const FOLDER_NAME_LIMIT = 60;

export type Folder = { name: string; count: number };

/** A folder name as it is stored: single spaces, trimmed, at most 60 characters. Empty means no folder. */
export function folderName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length > FOLDER_NAME_LIMIT)
    throw new Error(`Use a folder name of up to ${FOLDER_NAME_LIMIT} characters.`);
  return name;
}

/** Folders in use outside Trash, by name, with how many projects each holds. */
export function folderList(projects: Project[]): Folder[] {
  const counts = new Map<string, number>();
  for (const p of projects) {
    const name = (p.folder || "").trim();
    if (!p.trashed && name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

/** The app route of a folder; the name is encoded so a slash in it stays one path segment. */
export const folderRoute = (name: string) => `folder/${encodeURIComponent(name)}`;

/** The folder named by a route such as ["folder", "Client%20work"], or "" for any other route. */
export function folderFromRoute(path: string[]): string {
  if (path[0] !== "folder" || !path[1]) return "";
  try {
    return decodeURIComponent(path[1]);
  } catch {
    return "";
  }
}

/** Projects outside Trash that sit in the folder. */
export const inFolder = (projects: Project[], name: string) =>
  projects.filter((p) => !p.trashed && (p.folder || "").trim() === name);
