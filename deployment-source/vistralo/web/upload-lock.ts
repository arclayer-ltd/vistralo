// One upload per project at a time across this browser's tabs. The tab that uploads holds a Web
// Lock named for the project, so a project's page can tell a running upload (in any tab) from
// one that stopped when its page closed, and never starts a second copy of a running one.

export const uploadLockName = (project: string) => `vistralo-upload:${project}`;

type Locks = {
  request: (name: string, options: { ifAvailable: boolean }, run: (lock: unknown) => Promise<unknown>) => Promise<unknown>;
  query: () => Promise<{ held?: { name?: string }[] }>;
};
const locks = (): Locks | undefined =>
  typeof navigator !== "undefined" ? ((navigator as unknown as { locks?: Locks }).locks ?? undefined) : undefined;

/** Runs an upload while holding the project's lock; refuses when another tab already holds it. */
export async function withUploadLock<T>(project: string, run: () => Promise<T>): Promise<T> {
  const api = locks();
  if (!api) return run();
  return (await api.request(uploadLockName(project), { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("This project is already uploading in another tab. Leave that tab open until it finishes.");
    return run();
  })) as T;
}

/** Whether a tab in this browser is uploading to this project now. Unknown counts as no. */
export async function uploadRunning(project: string): Promise<boolean> {
  try {
    const state = await locks()?.query();
    return !!state?.held?.some((lock) => lock.name === uploadLockName(project));
  } catch {
    return false;
  }
}

/** Resolves when the browser is back online; rejects if the upload is paused meanwhile. */
export function backOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false || typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("online", done);
      signal?.removeEventListener("abort", paused);
      resolve();
    };
    const paused = () => {
      window.removeEventListener("online", done);
      reject(new DOMException("Upload paused. Select the same file to resume.", "AbortError"));
    };
    window.addEventListener("online", done);
    signal?.addEventListener("abort", paused, { once: true });
  });
}
