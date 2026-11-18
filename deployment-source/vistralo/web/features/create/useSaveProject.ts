import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  Project,
  ProjectSource,
  UploadProgress,
  WorkspaceAdapter,
} from "../../contracts";
import { clearRecording, linkRecording } from "../recording-store";
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
  spoken: boolean;
  activeRecording: boolean;
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
  spoken,
  activeRecording,
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
      // A recording with your voice hides the address field, so a value left from before is ignored.
      const typed = source === "screen" && spoken ? "" : url;
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
          // The shared namer still knows the flows by their old names.
          flow: screenshots ? "narrate-screenshots" : flow,
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
          ...(screenshots ? { origin: "images" as const } : {}),
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
          // Recording a website is free of paid AI; a walkthrough is added from the project later.
          narrate: false,
        });
        notify(
          adapter.mode === "demo"
            ? "Demo website recording started. This is a local simulation."
            : "Recording the website. You can leave this page while it runs.",
        );
      } else {
        // If this page closes before the upload ends, the project's page finds the copy kept in
        // this browser and carries on from where the upload stopped.
        if (source === "screen") await linkRecording(project.id, media!).catch(() => {});
        controller.current = new AbortController();
        const uploaded = await adapter.upload(project.id, media!, {
          signal: controller.current.signal,
          onProgress: setProgress,
          // Saving keeps the video's own sound. Nothing paid starts until the owner adds an AI walkthrough.
          voice: source === "screen" && spoken ? ("microphone" as const) : ("original" as const),
        });
        if (source === "screen") await clearRecording().catch(() => {});
        const voice = (uploaded as { voice?: string }).voice;
        notify(
          adapter.mode === "demo"
            ? "Saved in this browser demo."
            : voice === "microphone"
              ? "Saved to Vistralo with your voice."
              : "Saved to Vistralo. Add an AI walkthrough from the project whenever you like.",
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
