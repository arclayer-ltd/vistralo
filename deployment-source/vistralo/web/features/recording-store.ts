interface StagedRecording {
  key: "pending";
  blob: Blob;
  name: string;
  created: string;
  microphone?: boolean;
  /** The project this recording is being saved into, once saving has started. */
  project?: string;
}

/** A recording that is waiting in this browser, not yet saved to Vistralo. */
export interface WaitingRecording {
  file: File;
  microphone: boolean;
  /** When the recording was put here. */
  created: string;
  /** The project it is being saved into; absent when saving never started, or it was put here by an older version. */
  project?: string;
}

/** How long before its project was made a recording put here by an older version (with no project named) may still be its source. */
const UNLINKED_MATCH_MS = 24 * 60 * 60_000;

/**
 * Whether a waiting recording is the source of this project. A recording that names its project
 * belongs only to that one. One that names none (an older version put it here) is offered to a
 * screen recording made after it, with no video yet, within a day; it is offered, never uploaded
 * on its own, because the match is a guess.
 */
export function recordingFor(
  waiting: Pick<WaitingRecording, "created" | "project"> | null,
  project: { id: string; source: string; created: string; video?: string; trashed?: boolean },
): "linked" | "likely" | null {
  if (!waiting || project.trashed || project.video || project.source !== "screen") return null;
  if (waiting.project) return waiting.project === project.id ? "linked" : null;
  const gap = Date.parse(project.created) - Date.parse(waiting.created);
  return gap >= -60_000 && gap <= UNLINKED_MATCH_MS ? "likely" : null;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vistralo-recording-recovery", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("recordings", { keyPath: "key" });
    request.onerror = () =>
      reject(
        request.error ?? new Error("Browser recovery storage is unavailable."),
      );
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("recordings", mode),
        request = run(tx.objectStore("recordings"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () =>
        reject(
          tx.error ??
            request.error ??
            new Error("Could not save the browser recovery copy."),
        );
    });
  } finally {
    // Close even when a synchronous quota, DataClone or transaction error occurs.
    db.close();
  }
}

export async function stageRecording(
  file: File,
  microphone = false,
): Promise<void> {
  await transaction("readwrite", (store) =>
    store.put({
      key: "pending",
      blob: file,
      name: file.name,
      created: new Date().toISOString(),
      microphone,
    } satisfies StagedRecording),
  );
}

export async function recoverRecording(): Promise<WaitingRecording | null> {
  const item = await transaction<StagedRecording | undefined>(
    "readonly",
    (store) => store.get("pending"),
  );
  return item
    ? {
        file: new File([item.blob], item.name, {
          type: item.blob.type,
          lastModified: new Date(item.created).getTime(),
        }),
        microphone: item.microphone === true,
        created: item.created,
        ...(item.project ? { project: item.project } : {}),
      }
    : null;
}

/**
 * Notes which project the waiting recording is being saved into, so the project's page can
 * resume the upload if this one stops (the tab closed, the computer slept, the network dropped).
 */
export async function linkRecording(project: string, file: Blob): Promise<void> {
  const item = await transaction<StagedRecording | undefined>("readonly", (store) => store.get("pending"));
  // Only the copy of the recording being saved; a different one waiting here keeps no project.
  if (!item || item.project === project || item.blob.size !== file.size) return;
  await transaction("readwrite", (store) => store.put({ ...item, project } satisfies StagedRecording));
}

/** Clears the waiting recording, but only if it is still the one that was saved. */
export async function clearRecordingIf(created: string): Promise<void> {
  const item = await transaction<StagedRecording | undefined>("readonly", (store) => store.get("pending"));
  if (item?.created === created) await clearRecording();
}

export async function clearRecording(): Promise<void> {
  await transaction("readwrite", (store) => store.delete("pending"));
}
