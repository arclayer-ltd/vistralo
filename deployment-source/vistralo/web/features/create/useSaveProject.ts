import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  Project,
  ProjectSource,
  UploadProgress,
  WorkspaceAdapter,
} from "../../contracts";
import { clearRecording } from "../recording-store";
import { automaticName, errorMessage, publicWebsite, validateVideo } from "../flow-utils";
import type { CreateFlow } from "../create-flows";
import { screenshotsVideo } from "../../slideshow";

interface SaveOptions {
  source: ProjectSource;
  flow?: CreateFlow;
  screenshots: boolean;
  adapter: WorkspaceAdapter;
  name: string;
  url: string;
  /** The recorded tab's or window's title, when the browser gave one. */
  sharedTitle?: string;
  file: File | null;
  shots: File[];
  mobile: boolean;
  narrate: boolean;
  voiceover: boolean;
  /** With an AI voice, stop after the script so the owner can edit it before it is voiced. */
  review: boolean;
  spoken: boolean;
  activeRecording: boolean;
  offersVoiceover: boolean;
  mounted: RefObject<boolean>;
  setError: (message: string) => void;
  notify: (message: string, error?: boolean) => void;
  onCreated: (project: Project) => void;
}

export function useSaveProject({
  source,
  flow,
  screenshots,
  adapter,
  name,
  url,
  sharedTitle,
  file,
  shots,
  mobile,
  narrate,
  voiceover,
  review,
  spoken,
  activeRecording,
  offersVoiceover,
  mounted,
  setError,
  notify,
  onCreated,
}: SaveOptions) {
  const controller = useRef<AbortController | null>(null),
    created = useRef<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [building, setBuilding] = useState<number | null>(null);
  const built = useRef<{ shots: File[]; video: File } | null>(null);
  // A take that is thrown away takes its half-made project with it, so the next take starts a new one.
  useEffect(() => {
    if (!file && !shots.length) created.current = null;
  }, [file, shots.length]);

  async function save() {
    if (busy || activeRecording) return;
    setError("");
    setBusy(true);
    try {
      // The site address is only asked for where narration will use it; elsewhere a value left
      // over from before the field was hidden is ignored.
      const typed =
        (source === "screen" && spoken) ||
        (source === "upload" && !screenshots && !voiceover)
          ? ""
          : url;
      const sourceUrl =
        source === "web" || typed.trim() ? publicWebsite(typed) : undefined;
      let media = file;
      if (source !== "web") {
        if (screenshots) {
          if (!shots.length) throw new Error("Add at least one screenshot.");
          if (built.current?.shots !== shots) {
            controller.current = new AbortController();
            setBuilding(0);
            built.current = {
              shots,
              video: await screenshotsVideo(shots, {
                signal: controller.current.signal,
                onProgress: setBuilding,
              }),
            };
          }
          media = built.current.video;
        }
        if (!media) throw new Error("Choose or record a video first.");
        validateVideo(media, adapter.mode === "cloud");
      }
      // A site typed only to open on start still says what was recorded, so it names the take.
      let siteForName = sourceUrl;
      if (!siteForName && url.trim())
        try {
          siteForName = publicWebsite(url);
        } catch {
          /* Not a public address: it does not name anything. */
        }
      const typedName = name.trim().slice(0, 120);
      const fileName = screenshots ? undefined : media?.name;
      const projectName =
        typedName ||
        automaticName({
          flow,
          source,
          url: siteForName,
          title: source === "screen" ? sharedTitle : undefined,
          fileName,
          shotNames: screenshots ? shots.map((shot) => shot.name) : [],
          shots: shots.length,
          spoken,
        });
      const project =
        created.current ??
        (await adapter.create({
          name: projectName,
          source,
          type: source === "web" ? "brief" : "walkthrough",
          url: sourceUrl,
          // Only a name Vistralo chose may later be replaced by a better one, such as the first screen of the script.
          autoName: !typedName,
          ...(source === "screen" && sharedTitle ? { pageTitle: sharedTitle.slice(0, 300) } : {}),
          ...(fileName && source === "upload" ? { sourceName: fileName.slice(0, 300) } : {}),
        }));
      created.current = project;
      if (source === "web") {
        await adapter.rpc("walkthrough", {
          id: project.id,
          url: sourceUrl,
          pages: [],
          viewports: [
            { width: 1440, height: 900 },
            ...(mobile ? [{ width: 390, height: 844 }] : []),
          ],
          narrate,
        });
        notify(
          adapter.mode === "demo"
            ? "Demo website analysis started. This is a local simulation."
            : "Website analysis started. You can leave this page while it runs.",
        );
      } else {
        controller.current = new AbortController();
        const uploaded = await adapter.upload(project.id, media!, {
          signal: controller.current.signal,
          onProgress: setProgress,
          review,
          ...(source === "screen" && spoken
            ? { voice: "microphone" as const }
            : source === "upload" && offersVoiceover
              ? {
                  voice:
                    screenshots || voiceover
                      ? ("ai" as const)
                      : ("original" as const),
                }
              : {}),
        });
        if (source === "screen") await clearRecording().catch(() => {});
        const voice = (uploaded as { voice?: string }).voice;
        notify(
          adapter.mode === "demo"
            ? "Recording saved in this browser demo."
            : voice === "microphone"
              ? "Recording saved with your voice."
              : voice === "queued"
              ? review
                ? "Upload finished. Vistralo is writing the narration; open the project to read it before it is voiced."
                : "Upload finished. Vistralo is writing the narration and adding the AI voice. This takes a few minutes."
              : voice === "offline"
                ? "Recording saved. The capture worker is offline, so the voice was not started."
              : "Recording uploaded. The worker checks its checksum before processing it.",
        );
      }
      let refreshed = project;
      try {
        refreshed = (await adapter.project(project.id)).project;
      } catch {
        /* The successful job still exists when a subsequent refresh fails. */
      }
      onCreated(refreshed);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
        setBuilding(null);
      }
    }
  }

  return { controller, created, busy, progress, building, save };
}
