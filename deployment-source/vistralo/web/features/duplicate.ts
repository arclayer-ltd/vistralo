/**
 * Duplicating a cloud project copies its files into the new project's folder
 * ({owner}/{project}/...), so every stored path that points into the old folder
 * is rewritten to the new one. Paths are found anywhere in the project data:
 * the file list, the video, the output, captions, the build brief, script stills.
 */
export function projectPrefix(owner: string, id: string) {
  return `${owner}/${id}/`;
}

/** Rewrites every string under `from` to start with `to`, including object keys; other values are copied as they are. */
export function remapPaths<T>(value: T, from: string, to: string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.startsWith(from) ? to + v.slice(from.length) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([key, item]) => [
          key.startsWith(from) ? to + key.slice(from.length) : key,
          walk(item),
        ]),
      );
    return v;
  };
  return walk(value) as T;
}

/** The stored objects to copy: every listed file and the poster that live in the project's own folder. */
export function filesToCopy(
  files: Record<string, unknown> | undefined,
  thumbnail: string | undefined,
  from: string,
): string[] {
  const listed = Object.keys(files || {});
  return [...new Set([...listed, ...(thumbnail ? [thumbnail] : [])])].filter(
    (file) => file.startsWith(from) && !file.slice(from.length).split("/").includes(".."),
  );
}
